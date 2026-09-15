/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useState } from "react";
import { decodeEventLog, formatEther, parseEther, toHex } from "viem";
import { useAccount, useBalance, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { site, percent } from "@/lib/site";
import { ROUTER_ADDRESS, routerAbi } from "@/lib/contracts";
import { explorer, robinhoodChain } from "@/lib/chain";
import { DAY, TIERS, nextTierHint, readBack, tierOf, type Rules } from "@/lib/rules";
import { quoteBuy } from "@/lib/curvemath";
import { ConnectButton, useMounted } from "@/components/ConnectButton";
import { TokenLogo } from "@/components/TokenLogo";
import { TierBadge } from "@/components/TierBadge";
import { SplitBar } from "@/components/SplitBar";
import { Reveal } from "@/components/Reveal";

const LINK_RE = /(https?:\/\/|www\.|t\.me\/|\.(com|io|xyz|fun|app|org|net)\b)/i;
/** A fresh Pons curve: 1.68 ETH of phantom quote against the 1e9 launch supply, 1% fee. */
const FRESH_QUOTE = parseEther("1.68");
const FRESH_TOKENS = parseEther("1000000000");

type Fields = {
  name: string;
  ticker: string;
  description: string;
  imageUrl: string;
  x: string;
  telegram: string;
  website: string;
  firstBuy: string;
  lockDays: string;
  burnPct: string;
  creatorTaxBps: string;
};

const EMPTY: Fields = {
  name: "",
  ticker: "",
  description: "",
  imageUrl: "",
  x: "",
  telegram: "",
  website: "",
  firstBuy: "",
  lockDays: String(site.lockDays.default),
  burnPct: String(site.burnPct.default),
  creatorTaxBps: "0",
};

function validate(f: Fields) {
  const errors: Partial<Record<keyof Fields, string>> = {};
  if (!f.name.trim()) errors.name = "Required";
  else if (f.name.length > 32) errors.name = "32 characters max";
  if (!f.ticker.trim()) errors.ticker = "Required";
  else if (!/^[A-Z0-9]{1,10}$/.test(f.ticker)) errors.ticker = "A–Z and 0–9 only";
  if (f.description.length > 256) errors.description = "256 characters max";
  else if (LINK_RE.test(f.description)) errors.description = "No links in the description";
  if (f.imageUrl.trim() && !/^https:\/\/\S+$/.test(f.imageUrl.trim())) errors.imageUrl = "An https:// URL";
  else if (f.imageUrl.length > 256) errors.imageUrl = "256 characters max";
  if (f.firstBuy.trim() && !/^\d*\.?\d*$/.test(f.firstBuy)) errors.firstBuy = "Decimal ETH amount";
  const buy = Number.parseFloat(f.firstBuy || "0");
  const lock = Number.parseInt(f.lockDays || "0", 10);
  if (!Number.isFinite(lock) || lock < 0 || (lock !== 0 && (lock < site.lockDays.min || lock > site.lockDays.max))) {
    errors.lockDays = `0, or ${site.lockDays.min} to ${site.lockDays.max} days`;
  } else if (lock > 0 && !(buy > 0)) {
    errors.lockDays = "A lock needs a first buy";
  }
  const burn = Number.parseInt(f.burnPct || "0", 10);
  if (!Number.isFinite(burn) || burn < 0 || burn > 100) errors.burnPct = "0 to 100";
  const bps = Number.parseInt(f.creatorTaxBps || "0", 10);
  if (!Number.isFinite(bps) || bps < 0 || bps > 1000) errors.creatorTaxBps = "0 to 1000 bps";
  return errors;
}

function randomSalt(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

function normalizeUrl(value: string, host: string): string {
  const v = value.trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith("@")) return `https://${host}/${v.slice(1)}`;
  return `https://${v.replace(/^\/+/, "")}`;
}

/** "0.0500" → "0.05", "12.000" → "12". */
export function trimEth(value: string, digits = 6): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toFixed(digits).replace(/\.?0+$/, "") || "0";
}

type Submitted = { hash: `0x${string}` };

/** The Launched event of the router, out of a receipt's logs. */
function launchedFrom(receipt: { logs: readonly { data: `0x${string}`; topics: readonly `0x${string}`[] }[] } | undefined) {
  if (!receipt) return null;
  for (const log of receipt.logs) {
    try {
      const ev = decodeEventLog({ abi: routerAbi, data: log.data, topics: log.topics as [`0x${string}`, ...`0x${string}`[]] });
      if (ev.eventName === "Launched") {
        const a = ev.args as unknown as { token: `0x${string}`; chest: `0x${string}`; curve: `0x${string}` };
        return { token: a.token, chest: a.chest, curve: a.curve };
      }
    } catch {
      /* not ours */
    }
  }
  return null;
}

export function LaunchForm() {
  const [f, setF] = useState<Fields>(EMPTY);
  const [advanced, setAdvanced] = useState(false);
  const [customLock, setCustomLock] = useState(false);
  const [customBurn, setCustomBurn] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  // Errors only show on fields the creator has touched (or all of them once
  // they tried to submit); the interlocks panel reads the full validation.
  const [touched, setTouched] = useState<Partial<Record<keyof Fields, boolean>>>({});
  // Whether this pad can pin images (a key on the server). Without it the
  // form still takes an image URL; nothing about launching needs a file.
  const [uploads, setUploads] = useState<boolean | null>(null);
  const mounted = useMounted();

  useEffect(() => {
    let alive = true;
    fetch("/api/upload")
      .then((r) => r.json() as Promise<{ enabled: boolean }>)
      .then((j) => alive && setUploads(Boolean(j.enabled)))
      .catch(() => alive && setUploads(false));
    return () => {
      alive = false;
    };
  }, []);

  const filePreview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    if (!filePreview) return;
    return () => URL.revokeObjectURL(filePreview);
  }, [filePreview]);
  const preview = filePreview ?? (/^https:\/\/\S+$/.test(f.imageUrl.trim()) ? f.imageUrl.trim() : null);

  const { address, isConnected, chainId } = useAccount();
  const { data: balance } = useBalance({ address, chainId: robinhoodChain.id });
  const routerLive = ROUTER_ADDRESS !== null;
  const { data: feeWei } = useReadContract({
    address: ROUTER_ADDRESS ?? undefined,
    abi: routerAbi,
    functionName: "totalLaunchFee",
    chainId: robinhoodChain.id,
    query: { enabled: routerLive, refetchInterval: 30_000 },
  });
  const { data: gateOpen } = useReadContract({
    address: ROUTER_ADDRESS ?? undefined,
    abi: routerAbi,
    functionName: "canLaunchHere",
    chainId: robinhoodChain.id,
    query: { enabled: routerLive, refetchInterval: 30_000 },
  });
  const { writeContractAsync, isPending } = useWriteContract();
  const { data: receipt } = useWaitForTransactionReceipt({ hash: submitted?.hash, chainId: robinhoodChain.id });

  const launched = launchedFrom(receipt);

  const errors = useMemo(() => validate(f), [f]);
  const valid = Object.keys(errors).length === 0;
  const shown = (k: keyof Fields) => (touched[k] ? errors[k] : undefined);
  const onChain = isConnected && chainId === robinhoodChain.id;
  const fee = typeof feeWei === "bigint" ? feeWei : parseEther(site.launchFeeEth);
  const feeEth = trimEth(formatEther(fee));
  const firstBuyWei = (() => {
    try {
      return parseEther(f.firstBuy.trim() || "0");
    } catch {
      return 0n;
    }
  })();
  const lockDays = Number.parseInt(f.lockDays || "0", 10) || 0;
  const burnBps = (Number.parseInt(f.burnPct || "0", 10) || 0) * 100;
  const creatorTaxBps = Number.parseInt(f.creatorTaxBps || "0", 10) || 0;
  const rules: Rules = { firstBuyWei, lockSeconds: firstBuyWei > 0n ? lockDays * DAY : 0, burnBps, creatorTaxBps };
  const tier = tierOf(rules);
  const hint = nextTierHint(rules);
  // What the first buy gets on a fresh curve, and its share of the supply.
  const allocationTokens = firstBuyWei > 0n ? quoteBuy(FRESH_QUOTE, FRESH_TOKENS, firstBuyWei, 100n, BigInt(creatorTaxBps)) : 0n;
  const allocationPct = Number((allocationTokens * 10_000n) / FRESH_TOKENS) / 100;

  // Interlocks: every condition the button needs, each with the reason it
  // is open. The button reads this list; it cannot disagree with it.
  const interlocks = [
    { key: "router", label: "Router deployed", ok: routerLive, note: routerLive ? "reads and writes go to the chain" : "awaiting deployment" },
    { key: "gate", label: "Pons accepts launches", ok: gateOpen === true, note: gateOpen === undefined ? (routerLive ? "reading the factory" : "needs the router") : gateOpen ? "launchEnabled and canLaunch" : "closed on Pons' side" },
    { key: "wallet", label: "Wallet connected", ok: mounted && isConnected, note: mounted && isConnected ? "ready to sign" : "connect to sign" },
    { key: "chain", label: "On Robinhood Chain", ok: onChain, note: onChain ? `chain id ${robinhoodChain.id}` : "switch network" },
    { key: "fields", label: "Chest filled", ok: valid, note: valid ? "token, allocation, rules" : Object.values(errors)[0] ?? "" },
    {
      key: "funds",
      label: "Balance covers it",
      ok: balance ? balance.value >= fee + firstBuyWei : false,
      note: balance ? `${trimEth(formatEther(balance.value), 4)} ETH available` : "no balance read",
    },
  ] as const;
  const canSubmit = interlocks.every((i) => i.ok) && !isPending;

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setTouched((prev) => (prev[k] ? prev : { ...prev, [k]: true }));
    setF((prev) => ({ ...prev, [k]: k === "ticker" ? e.target.value.toUpperCase() : e.target.value }));
  };

  const setMax = () => {
    if (!balance) return;
    // Leave the launch fee plus a little gas behind.
    const spare = balance.value - fee - parseEther("0.0005");
    setF((prev) => ({ ...prev, firstBuy: spare > 0n ? trimEth(formatEther(spare), 4) : "0" }));
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ name: true, ticker: true, description: true, imageUrl: true, firstBuy: true, lockDays: true, burnPct: true, creatorTaxBps: true });
    if (!canSubmit || !ROUTER_ADDRESS) return;
    setStatus(null);
    try {
      let logo = f.imageUrl.trim();
      if (file && uploads) {
        const body = new FormData();
        body.append("file", file);
        const up = await fetch("/api/upload", { method: "POST", body });
        const json = (await up.json().catch(() => ({}))) as { uri?: string; error?: string };
        if (!up.ok || !json.uri) throw new Error(json.error ?? "Image upload failed. Remove the image or try again.");
        logo = json.uri;
      }
      const hash = await writeContractAsync({
        address: ROUTER_ADDRESS,
        abi: routerAbi,
        functionName: "launch",
        args: [
          {
            name: f.name.trim(),
            symbol: f.ticker.trim(),
            logo,
            description: f.description.trim(),
            x: normalizeUrl(f.x, "x.com"),
            telegram: normalizeUrl(f.telegram, "t.me"),
            website: normalizeUrl(f.website, ""),
            creatorTaxBps,
            salt: randomSalt(),
            firstBuy: firstBuyWei,
            minTokensOut: 0n,
            lockDuration: BigInt(rules.lockSeconds),
            burnBps,
          },
        ],
        value: fee + firstBuyWei,
        chainId: robinhoodChain.id,
      });
      setSubmitted({ hash });
    } catch (err) {
      setStatus(err instanceof Error ? err.message.split("\n")[0] : "Launch failed");
    }
  }

  const lockPreset = site.lockDays.options.some((d) => String(d) === f.lockDays) && !customLock;
  const burnPreset = site.burnPct.options.some((d) => String(d) === f.burnPct) && !customBurn;
  const readback = readBack(rules);

  if (submitted && launched) {
    return (
      <Reveal
        token={launched.token}
        chest={launched.chest}
        hash={submitted.hash}
        name={f.name.trim()}
        symbol={f.ticker.trim()}
        logo={preview}
        rules={rules}
        allocationPct={allocationPct}
        allocationTokens={allocationTokens}
      />
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[1fr_380px]">
      <form className="glass p-6 sm:p-8" noValidate onSubmit={onSubmit}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="eyebrow">Open a chest</p>
            <h1 className="display mt-3 text-[30px] text-ink sm:text-[38px]">Fill the chest.</h1>
            <p className="mt-1 text-sm text-ink-3">
              One transaction launches on {site.venue} with your Chest wired in. {percent.pad} of every opening is ours; the rest follows your rules.
            </p>
          </div>
          <ConnectButton />
        </div>

        <Section n="01" title="The token" className="mt-8">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" error={shown("name")}>
              <input className="field" maxLength={32} placeholder="Token name" value={f.name} onChange={set("name")} aria-invalid={Boolean(shown("name"))} />
            </Field>
            <Field label="Ticker" error={shown("ticker")}>
              <input className="field uppercase" maxLength={10} placeholder="SYMBOL" value={f.ticker} onChange={set("ticker")} aria-invalid={Boolean(shown("ticker"))} />
            </Field>
          </div>
          <Field label="Description" error={shown("description")} className="mt-4" hint={`${f.description.length}/256`}>
            <textarea className="field min-h-[88px] resize-y" maxLength={256} placeholder="Short description (no links)" value={f.description} onChange={set("description")} aria-invalid={Boolean(shown("description"))} />
          </Field>
          <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr]">
            <div>
              <span className="mb-2 block text-[13px] text-ink-2">Image</span>
              {uploads ? (
                <label className="flex cursor-pointer items-center gap-4 rounded-[12px] border border-dashed border-edge bg-black/20 px-4 py-4 transition-colors hover:border-gold hover:bg-black/30">
                  {preview ? <img src={preview} alt="" className="h-14 w-14 rounded-xl object-cover" /> : <TokenLogo logo={null} symbol={f.ticker || "?"} size={56} />}
                  <span className="text-sm text-ink-3">{file ? file.name : "Click to upload · pinned to IPFS"}</span>
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </label>
              ) : (
                <div className="flex items-center gap-4 rounded-[12px] border border-edge-ink bg-black/20 px-4 py-4">
                  {preview ? <img src={preview} alt="" className="h-14 w-14 rounded-xl object-cover" onError={() => setTouched((t) => ({ ...t, imageUrl: true }))} /> : <TokenLogo logo={null} symbol={f.ticker || "?"} size={56} />}
                  <span className="text-sm text-ink-3">{uploads === null ? "Checking uploads…" : "Paste an https:// image URL below. Optional."}</span>
                </div>
              )}
              <Field label={uploads ? "Or an image URL" : "Image URL"} error={shown("imageUrl")} className="mt-3" hint="https, optional">
                <input className="field" placeholder="https://…/token.png" value={f.imageUrl} onChange={set("imageUrl")} aria-invalid={Boolean(shown("imageUrl"))} />
              </Field>
            </div>
            <div className="grid gap-4">
              <Field label="X profile">
                <input className="field" placeholder="x.com/handle" value={f.x} onChange={set("x")} />
              </Field>
              <Field label="Telegram">
                <input className="field" placeholder="t.me/community" value={f.telegram} onChange={set("telegram")} />
              </Field>
            </div>
          </div>
        </Section>

        <div className="hairline my-8" />

        <Section n="02" title="The allocation">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Your first buy (ETH)" error={shown("firstBuy")} hint={allocationTokens > 0n ? `≈ ${allocationPct.toFixed(2)}% of the supply` : "optional"}>
              <div className="flex gap-2">
                <input className="field" inputMode="decimal" placeholder="0.00" value={f.firstBuy} onChange={set("firstBuy")} aria-invalid={Boolean(shown("firstBuy"))} />
                <button type="button" className="btn btn-glass btn-sm shrink-0" onClick={setMax} disabled={!balance}>
                  Max
                </button>
              </div>
            </Field>
            <Field label="Lock" error={shown("lockDays")} hint="linear unlock, from launch">
              <div className="seg" role="radiogroup" aria-label="Allocation lock">
                {site.lockDays.options.map((d) => (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={lockPreset && String(d) === f.lockDays}
                    className="seg-opt"
                    onClick={() => {
                      setCustomLock(false);
                      setTouched((t) => ({ ...t, lockDays: true }));
                      setF((p) => ({ ...p, lockDays: String(d) }));
                    }}
                  >
                    {d === 0 ? "none" : `${d}d`}
                  </button>
                ))}
                <button type="button" role="radio" aria-checked={!lockPreset} className="seg-opt" onClick={() => setCustomLock(true)}>
                  …
                </button>
              </div>
              {!lockPreset ? (
                <input className="field mt-2" inputMode="numeric" placeholder="days (1–365)" value={f.lockDays} onChange={set("lockDays")} aria-invalid={Boolean(shown("lockDays"))} />
              ) : null}
            </Field>
          </div>
          <p className="mt-3 text-xs text-ink-4">
            With a lock, the first buy is delivered to the chest and unlocks over time; your wallet pays the snipe tax like everyone. Without one, it lands in your wallet — and the chest says so.
          </p>
        </Section>

        <div className="hairline my-8" />

        <Section n="03" title="The rules">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Burn share" error={shown("burnPct")} hint="of the loot · bought back and burned until graduation">
              <div className="seg" role="radiogroup" aria-label="Burn share">
                {site.burnPct.options.map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={burnPreset && String(p) === f.burnPct}
                    className="seg-opt"
                    onClick={() => {
                      setCustomBurn(false);
                      setF((prev) => ({ ...prev, burnPct: String(p) }));
                    }}
                  >
                    {p}%
                  </button>
                ))}
                <button type="button" role="radio" aria-checked={!burnPreset} className="seg-opt" onClick={() => setCustomBurn(true)}>
                  …
                </button>
              </div>
              {!burnPreset ? (
                <input className="field mt-2" inputMode="numeric" placeholder="percent (0–100)" value={f.burnPct} onChange={set("burnPct")} aria-invalid={Boolean(shown("burnPct"))} />
              ) : null}
            </Field>
            <Field label="Creator fee (bps)" error={shown("creatorTaxBps")} hint={`0–1000 · on top of the ${site.tradeFeePct} trade fee`}>
              <input className="field" inputMode="numeric" placeholder="0" value={f.creatorTaxBps} onChange={set("creatorTaxBps")} aria-invalid={Boolean(shown("creatorTaxBps"))} />
            </Field>
          </div>
          <SplitBar burnBps={burnBps} className="mt-5" />
        </Section>

        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          aria-expanded={advanced}
          className="mt-6 flex w-full items-center justify-between rounded-[12px] border border-edge-ink bg-black/20 px-4 py-3 text-sm text-ink-2"
        >
          Website
          <span className="mono" aria-hidden="true">
            {advanced ? "−" : "+"}
          </span>
        </button>
        {advanced ? (
          <div className="mt-2 rounded-[12px] border border-edge-ink bg-black/20 p-4">
            <Field label="Website">
              <input className="field" placeholder="yourtoken.fun" value={f.website} onChange={set("website")} />
            </Field>
          </div>
        ) : null}

        <div className="hairline my-8" />

        <div className="panel-gold p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="label text-gold">Read it back</p>
            <TierBadge tier={tier} />
          </div>
          <ul className="mt-3 space-y-3">
            {readback.map((l) => (
              <li key={l.key} className="flex gap-3 text-[14px] leading-relaxed text-ink">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rotate-45 bg-gold" aria-hidden="true" />
                <span>{l.text}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-ink-3">
            {hint ? `Next tier — ${hint}.` : "The top tier: nothing more to give up."} Everything above is enforced by a contract with no owner; nothing can be edited after launch.
          </p>
        </div>

        {submitted ? (
          <div className="mt-6 panel-violet p-5">
            <p className="display text-[20px] text-ink">Submitted — waiting for the chain.</p>
            <p className="mt-1 text-sm text-ink-3">The chest opens as soon as the transaction confirms.</p>
            <p className="mono mt-2 break-all text-xs text-ink-3">
              <a href={explorer.tx(submitted.hash)} target="_blank" rel="noreferrer" className="hover:text-ink">
                {submitted.hash}
              </a>
            </p>
          </div>
        ) : (
          <button type="submit" className="btn btn-gold mt-6 w-full py-4 text-base" disabled={!canSubmit}>
            {isPending ? "Confirm in wallet…" : `Open the chest · ${feeEth} ETH${firstBuyWei > 0n ? ` + ${trimEth(f.firstBuy)} ETH first buy` : ""}`}
          </button>
        )}
        {status ? <p className="mt-3 break-words text-center text-xs text-down">{status}</p> : null}
      </form>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
        <div className="glass p-5">
          <div className="flex items-center gap-3">
            {preview ? <img src={preview} alt="" className="h-12 w-12 rounded-xl object-cover" /> : <TokenLogo logo={null} symbol={f.ticker || "?"} size={48} />}
            <div className="min-w-0 flex-1">
              <p className="display truncate text-[18px] text-ink">{f.name.trim() || "Your token"}</p>
              <p className="mono truncate text-xs text-ink-3">{f.ticker ? `$${f.ticker}` : "ticker"}</p>
            </div>
            <TierBadge tier={tier} />
          </div>
          <dl className="mt-5 space-y-2.5 text-sm">
            <Row k="Launch fee">
              <span className="mono">{feeEth} ETH</span>
            </Row>
            <Row k="First buy">
              <span className="mono">{firstBuyWei > 0n ? `${trimEth(f.firstBuy)} ETH` : "none"}</span>
            </Row>
            <Row k="Allocation">
              <span className="mono">{allocationTokens > 0n ? `≈ ${allocationPct.toFixed(2)}% of supply` : "—"}</span>
            </Row>
            <Row k="Lock">
              <span className="mono">{firstBuyWei > 0n && lockDays > 0 ? `${lockDays} days` : "none"}</span>
            </Row>
            <Row k="Burn share">
              <span className="mono">{burnBps / 100}%</span>
            </Row>
            <Row k="Creator fee">
              <span className="mono">{creatorTaxBps / 100}%</span>
            </Row>
            <Row k="Paired with">ETH</Row>
            <Row k="Graduation">{site.graduationEth} ETH</Row>
          </dl>
          <p className="mt-4 text-xs text-ink-4">{TIERS[tier].requirement}</p>
        </div>

        <div className="glass p-5">
          <p className="label">Interlocks</p>
          <ul className="mt-3 space-y-2.5">
            {interlocks.map((i) => (
              <li key={i.key} className="flex items-start gap-3">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rotate-45 ${i.ok ? "bg-gold shadow-[0_0_8px_var(--gold)]" : "border border-edge-2"}`} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm text-ink">{i.label}</span>
                    <span className="mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{i.ok ? "closed" : "open"}</span>
                  </div>
                  <p className="truncate text-xs text-ink-3">{i.note}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}

function Section({ n, title, className = "", children }: { n: string; title: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={className}>
      <div className="flex items-baseline gap-3">
        <span className="mono text-xs text-gold">{n}</span>
        <h2 className="display text-[20px] text-ink">{title}</h2>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Field({ label, error, hint, className = "", children }: { label: string; error?: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-ink-2">{label}</span>
        {error ? <span className="mono text-[11px] text-down">{error}</span> : hint ? <span className="text-[11px] text-ink-4">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-3">{k}</dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  );
}
