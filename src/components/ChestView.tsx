"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatEther } from "viem";
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import type { ChartResponse, OpeningsResponse, SummaryResponse, TradesResponse } from "@/lib/pons";
import { chestAbi } from "@/lib/contracts";
import { explorer, ponsTradeUrl, robinhoodChain } from "@/lib/chain";
import { formatCap, formatDateTime, formatEthAuto, formatPrice, formatTokenAmount, formatWei, formatWeiExact, shortAddress } from "@/lib/format";
import { formatBps, formatLock, readBack, splitLoot } from "@/lib/rules";
import { site, percent } from "@/lib/site";
import { useNow } from "@/lib/useNow";
import { ChestScene } from "@/components/ChestScene";
import { TokenLogo } from "@/components/TokenLogo";
import { TierBadge } from "@/components/TierBadge";
import { SplitBar } from "@/components/SplitBar";
import { CopyButton } from "@/components/CopyButton";
import { PriceChart } from "@/components/PriceChart";
import { TradePanel } from "@/components/TradePanel";
import { ConnectButton, useMounted } from "@/components/ConnectButton";

function countdown(seconds: number): string {
  if (seconds <= 0) return "now";
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * A chest's page: the chest itself (its lid follows the allocation's
 * unlock), the three cards that were sealed at launch, the loot — what is
 * waiting, the key for whoever opens it, the log — and the market. Every
 * number is read from the chain through the API; the two actions (open,
 * unlock) are direct calls to the chest.
 */
async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = (await res.json()) as T & { ok?: boolean; error?: string };
  if (!res.ok || json.ok === false) throw new Error(json.error ?? "chain unreachable");
  return json;
}

export function ChestView({ token }: { token: `0x${string}` }) {
  const mounted = useMounted();
  const queryClient = useQueryClient();
  const keys = useMemo(() => ({ summary: ["chest", token, "summary"], rest: ["chest", token, "rest"] }), [token]);
  const summaryQuery = useQuery({
    queryKey: keys.summary,
    queryFn: () => getJson<SummaryResponse>(`/api/chest/${token}/summary`),
    refetchInterval: 15_000,
    retry: (count, e) => (e instanceof Error && e.message === "unknown token" ? false : count < 2),
  });
  const restQuery = useQuery({
    queryKey: keys.rest,
    enabled: summaryQuery.isSuccess,
    queryFn: async () => {
      const [trades, chart, openings] = await Promise.all([
        getJson<TradesResponse>(`/api/chest/${token}/trades`),
        getJson<ChartResponse>(`/api/chest/${token}/chart`),
        getJson<OpeningsResponse>(`/api/chest/${token}/openings`),
      ]);
      return { trades, chart, openings };
    },
    refetchInterval: 15_000,
  });
  const summary = summaryQuery.data ?? null;
  const error = summaryQuery.error instanceof Error ? summaryQuery.error.message : null;
  const trades = restQuery.data?.trades ?? null;
  const chart = restQuery.data?.chart ?? null;
  const openings = restQuery.data?.openings ?? null;

  const now = useNow(summary?.readAt);
  const { address, isConnected, chainId } = useAccount();
  const onChain = isConnected && chainId === robinhoodChain.id;
  const { writeContractAsync, isPending } = useWriteContract();
  const [pending, setPending] = useState<`0x${string}` | undefined>();
  const [submitNote, setSubmitNote] = useState<string | null>(null);
  const { data: receipt } = useWaitForTransactionReceipt({ hash: pending, chainId: robinhoodChain.id });
  // The receipt is keyed by the pending hash, so "in flight" and the note
  // are derived; when it lands, re-read the chest.
  const inFlight = Boolean(pending) && !receipt;
  useEffect(() => {
    if (receipt) void queryClient.invalidateQueries({ queryKey: ["chest", token] });
  }, [receipt, queryClient, token]);
  const note = receipt
    ? receipt.status === "success"
      ? `Confirmed · ${shortAddress(receipt.transactionHash, 8)}`
      : "The transaction reverted."
    : submitNote;

  const chest = summary?.chest;
  const status = chest?.status;

  const numbers = useMemo(() => {
    if (!chest || !status) return null;
    const allocation = BigInt(status.allocation);
    const locked = BigInt(status.locked);
    const unlockable = BigInt(status.unlockable);
    const unlocked = BigInt(status.unlocked);
    const lootable = BigInt(status.lootable);
    const vested = allocation > 0n ? Number(((allocation - locked) * 10_000n) / allocation) / 100 : 0;
    const liveVested = allocation > 0n && chest.lockDuration > 0 ? Math.min(100, Math.max(0, ((now - status.launchedAt) / chest.lockDuration) * 100)) : vested;
    const key = splitLoot(lootable, chest.burnBps, status.graduated).opener;
    return { allocation, locked, unlockable, unlocked, lootable, vested: liveVested, key, openness: allocation > 0n ? liveVested / 100 : 1 };
  }, [chest, status, now]);

  async function act(fn: "open" | "unlock") {
    if (!chest || !address) return;
    setSubmitNote(null);
    setPending(undefined);
    try {
      const hash = await writeContractAsync({
        address: chest.chest as `0x${string}`,
        abi: chestAbi,
        functionName: fn,
        args: fn === "open" ? [address] : [],
        chainId: robinhoodChain.id,
      });
      setPending(hash);
      setSubmitNote(`${fn === "open" ? "Opening" : "Unlock"} submitted · ${shortAddress(hash, 8)}`);
    } catch (err) {
      setSubmitNote(err instanceof Error ? err.message.split("\n")[0] : "Transaction failed");
    }
  }

  if (error && !summary) {
    return (
      <div className="glass flex flex-col items-start gap-3 p-8">
        <p className="label">Chest</p>
        <h1 className="display text-[30px] text-ink">{error === "unknown token" ? "Not a chest." : "The chain did not answer."}</h1>
        <p className="max-w-md text-sm text-ink-3">
          {error === "unknown token" ? "This address was not launched through the router. Only chests opened here have a page." : error}
        </p>
        <Link href="/chests" className="btn btn-glass btn-sm">
          All chests
        </Link>
      </div>
    );
  }

  if (!chest || !status || !numbers || !summary) {
    return (
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="skeleton h-[520px] rounded-[20px]" />
        <div className="skeleton h-[520px] rounded-[20px]" />
      </div>
    );
  }

  const m = summary.market;
  const rules = { firstBuyWei: BigInt(chest.firstBuy), lockSeconds: chest.lockDuration, burnBps: chest.burnBps, creatorTaxBps: chest.creatorTaxBps };
  const lines = readBack(rules, { launchAt: chest.launchedAt, graduated: status.graduated });
  const lockLeft = status.lockEnd - now;
  const nextBurnIn = status.nextBurnAt - now;
  const accruing = BigInt(m.accruingWei);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <TokenLogo logo={chest.logo} symbol={chest.symbol} size={64} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="display text-[28px] text-ink sm:text-[34px]">{chest.name}</h1>
                <span className="mono text-sm text-ink-3">${chest.symbol}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <TierBadge tier={chest.tier} />
                <span className={`pill ${m.graduated ? "" : "pill-open"}`}>{m.graduated ? "in the pool" : "on the curve"}</span>
                <span className="mono flex items-center gap-1 text-xs text-ink-3">
                  <a href={explorer.token(chest.token)} target="_blank" rel="noreferrer" className="hover:text-ink">
                    {shortAddress(chest.token, 6)}
                  </a>
                  <CopyButton value={chest.token} variant="icon" />
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={ponsTradeUrl(chest.token)} target="_blank" rel="noreferrer" className="btn btn-glass btn-sm">
              On Pons ↗
            </a>
            <a href={explorer.address(chest.chest)} target="_blank" rel="noreferrer" className="btn btn-glass btn-sm">
              Chest contract ↗
            </a>
          </div>
        </div>

        {/* The chest */}
        <div className="glass relative mt-6 overflow-hidden">
          <ChestScene open={numbers.openness} framing="card" className="mx-auto aspect-[16/9] w-full max-w-[720px]" />
          <p className="absolute bottom-3 left-0 right-0 text-center text-xs text-ink-4">
            {numbers.allocation > 0n
              ? numbers.vested >= 100
                ? "Fully unlocked. The lid stays open."
                : `${numbers.vested.toFixed(1)}% of the allocation unlocked — the lid follows the schedule.`
              : "Nothing locked inside. The lid stays open."}
          </p>
        </div>

        {/* The three cards */}
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <article className="glass p-5">
            <p className="label">01 · The token</p>
            <p className="mt-3 text-[14px] leading-relaxed text-ink-2">{chest.description || "No description."}</p>
            <dl className="mt-4 space-y-2 text-sm">
              <Row k="Creator">
                <a href={explorer.address(chest.creator)} target="_blank" rel="noreferrer" className="mono text-ink hover:text-gold">
                  {shortAddress(chest.creator)}
                </a>
              </Row>
              <Row k="Curve">
                <a href={explorer.address(chest.curve)} target="_blank" rel="noreferrer" className="mono text-ink hover:text-gold">
                  {shortAddress(chest.curve)}
                </a>
              </Row>
              <Row k="Chest">
                <a href={explorer.address(chest.chest)} target="_blank" rel="noreferrer" className="mono text-ink hover:text-gold">
                  {shortAddress(chest.chest)}
                </a>
              </Row>
              <Row k="Launched">
                <span className="mono text-ink">{formatDateTime(chest.launchedAt)}</span>
              </Row>
            </dl>
          </article>

          <article className="glass p-5">
            <p className="label">02 · The allocation</p>
            {numbers.allocation === 0n ? (
              <>
                <p className="display mt-3 text-[24px] text-ink">{BigInt(chest.firstBuy) > 0n ? "In the wallet" : "None"}</p>
                <p className="mt-2 text-sm text-ink-3">
                  {BigInt(chest.firstBuy) > 0n
                    ? `The creator's first buy of ${formatWei(chest.firstBuy, 4)} ETH went to their wallet. No lock.`
                    : "No first buy. The chest holds no tokens."}
                </p>
              </>
            ) : (
              <>
                <p className="display mt-3 text-[24px] text-gold">{chest.allocationPct.toFixed(2)}%</p>
                <p className="mt-1 text-sm text-ink-3">
                  of the supply — {formatTokenAmount(status.allocation)} {chest.symbol} for {formatWei(chest.firstBuy, 4)} ETH.
                </p>
                <div className="mt-4">
                  <div className="split">
                    <span className="split-creator" style={{ width: `${numbers.vested}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-ink-3">
                    <span className="mono text-ink">{numbers.vested.toFixed(1)}%</span> unlocked over {formatLock(chest.lockDuration)} ·{" "}
                    {lockLeft > 0 ? `fully in ${countdown(lockLeft)}` : "fully unlocked"}
                  </p>
                </div>
                <dl className="mt-3 space-y-1.5 text-sm">
                  <Row k="Still inside">
                    <span className="mono text-ink">{formatTokenAmount(status.locked)}</span>
                  </Row>
                  <Row k="Paid out">
                    <span className="mono text-ink">{formatTokenAmount(status.unlocked)}</span>
                  </Row>
                  <Row k="Unlockable now">
                    <span className="mono text-ink">{formatTokenAmount(status.unlockable)}</span>
                  </Row>
                </dl>
                {numbers.unlockable > 10n ** 18n ? (
                  <button type="button" className="btn btn-glass btn-sm mt-4 w-full" disabled={!mounted || !onChain || isPending || inFlight} onClick={() => act("unlock")}>
                    Unlock for the creator
                  </button>
                ) : null}
              </>
            )}
          </article>

          <article className="glass p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="label">03 · The rules</p>
              <TierBadge tier={chest.tier} />
            </div>
            <SplitBar burnBps={chest.burnBps} graduated={status.graduated} className="mt-4" />
            <dl className="mt-4 space-y-1.5 text-sm">
              <Row k="Burn">
                <span className="text-ink">{chest.burnBps > 0 ? (status.graduated ? "ended at graduation" : `${chest.burnBps / 100}% until graduation`) : "none"}</span>
              </Row>
              <Row k="Creator fee">
                <span className="text-ink">{formatBps(chest.creatorTaxBps)}</span>
              </Row>
              <Row k="Lock">
                <span className="text-ink">{numbers.allocation > 0n ? formatLock(chest.lockDuration) : "none"}</span>
              </Row>
              <Row k="Burned so far">
                <span className="mono text-ink">{formatWei(status.totalBurnedEth, 4)} ETH</span>
              </Row>
              {BigInt(status.tokensBurned) > 0n ? (
                <Row k="Tokens burned">
                  <span className="mono text-ink">{formatTokenAmount(status.tokensBurned)}</span>
                </Row>
              ) : null}
            </dl>
          </article>
        </div>

        {/* The loot */}
        <div className="glass mt-6 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="label">The loot</p>
              <h2 className="display mt-2 text-[24px] text-ink">
                <span className="text-gold">{formatWeiExact(status.lootable)} ETH</span> waiting.
              </h2>
              <p className="mt-1 text-sm text-ink-3">
                {accruing > 0n ? `Plus ${formatWeiExact(accruing.toString())} ETH accruing on the curve, swept to the escrow by Pons on its own schedule.` : "Nothing accruing on the curve right now."}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-ink-3">Your key, if you open it</p>
              <p className="mono text-lg text-gold">{formatWeiExact(numbers.key)} ETH</p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {!mounted || !isConnected || !onChain ? (
              <ConnectButton size="md" />
            ) : (
              <button type="button" className="btn btn-gold" disabled={(numbers.lootable === 0n && BigInt(status.burnable) === 0n) || isPending || inFlight} onClick={() => act("open")}>
                {isPending ? "Confirm in wallet…" : inFlight ? "Waiting for the chain…" : `Open the chest · earn ${percent.opener}`}
              </button>
            )}
            <span className="text-xs text-ink-4">
              Anyone can open it. Pays {percent.opener} to you, {percent.pad} to {site.name}, {chest.burnBps > 0 && !status.graduated ? `${chest.burnBps / 100}% of the rest to the burn, ` : ""}the rest to the creator.
            </span>
          </div>
          {note ? <p className={`mt-3 text-xs ${note.includes("revert") || note.includes("failed") ? "text-down" : "text-ink-3"}`}>{note}</p> : null}
          {BigInt(status.burnReserve) > 0n ? (
            <p className="mt-3 text-xs text-ink-3">
              {formatWeiExact(status.burnReserve)} ETH of burn loot is waiting for its slice{status.graduated ? " — burned as ETH at the next opening" : nextBurnIn > 0 ? ` (next burn in ${countdown(nextBurnIn)})` : " (burnable at the next opening)"}.
            </p>
          ) : null}
          <dl className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            <Stat k="Loot out" v={`${formatWei(status.totalLoot, 4)} ETH`} />
            <Stat k="To the creator" v={`${formatWei(status.totalToCreator, 4)} ETH`} />
            <Stat k="Burned" v={`${formatWei(status.totalBurnedEth, 4)} ETH`} />
            <Stat k="To openers" v={`${formatWei(status.totalToOpeners, 5)} ETH`} />
            <Stat k="Openings" v={String(status.openings)} />
          </dl>
          {openings && openings.openings.length > 0 ? (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="label">
                  <tr>
                    <th className="py-2 pr-3 font-normal">When</th>
                    <th className="py-2 pr-3 font-normal">Opener</th>
                    <th className="py-2 pr-3 font-normal">Loot</th>
                    <th className="py-2 pr-3 font-normal">Creator</th>
                    <th className="py-2 pr-3 font-normal">Burn</th>
                    <th className="py-2 pr-3 font-normal">Key</th>
                  </tr>
                </thead>
                <tbody className="mono">
                  {openings.openings.map((o) => (
                    <tr key={o.id} className="border-t border-edge-ink">
                      <td className="py-2 pr-3 text-ink-3">
                        <a href={explorer.tx(o.transactionHash)} target="_blank" rel="noreferrer" className="hover:text-ink">
                          {formatDateTime(o.timestamp)}
                        </a>
                      </td>
                      <td className="py-2 pr-3 text-ink-2">{shortAddress(o.opener)}</td>
                      <td className="py-2 pr-3 text-ink">{formatWei(o.loot, 5)}</td>
                      <td className="py-2 pr-3 text-ink-2">{formatWei(o.toCreator, 5)}</td>
                      <td className="py-2 pr-3 text-ink-2">{formatWei(o.toBurn, 5)}</td>
                      <td className="py-2 pr-3 text-ink-2">{formatWei(o.toOpener, 6)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-4 text-xs text-ink-4">No opening yet. The log starts with the first one.</p>
          )}
        </div>

        {/* Market */}
        <div className="glass mt-6 p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="label">Market</p>
              <p className="mono mt-2 text-2xl text-ink">{formatCap(m.marketCapUsd, m.marketCapEth)}</p>
              <p className="text-xs text-ink-3">market cap · {formatPrice(m.priceUsd, m.priceEth)} per token</p>
            </div>
            <div className="text-right text-sm">
              <p className="mono text-ink">{m.graduated ? "graduated" : `${Math.floor(m.graduationProgressPct)}% to graduation`}</p>
              <p className="text-xs text-ink-3">
                {formatEthAuto(m.raisedEth)} raised of {m.graduationThresholdEth} ETH
              </p>
            </div>
          </div>
          <div className="mt-5">
            {chart ? <PriceChart points={chart.points} launchSupply={chart.launchSupply} ethUsd={chart.ethUsd} /> : <div className="skeleton h-[220px]" />}
          </div>
          {trades && trades.trades.length > 0 ? (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="label">
                  <tr>
                    <th className="py-2 pr-3 font-normal">When</th>
                    <th className="py-2 pr-3 font-normal">Side</th>
                    <th className="py-2 pr-3 font-normal">{chest.symbol}</th>
                    <th className="py-2 pr-3 font-normal">ETH</th>
                    <th className="py-2 pr-3 font-normal">Account</th>
                  </tr>
                </thead>
                <tbody className="mono">
                  {trades.trades.slice(0, 20).map((t) => (
                    <tr key={t.id} className="border-t border-edge-ink">
                      <td className="py-2 pr-3 text-ink-3">
                        <a href={explorer.tx(t.transactionHash)} target="_blank" rel="noreferrer" className="hover:text-ink">
                          {formatDateTime(t.timestamp)}
                        </a>
                      </td>
                      <td className={`py-2 pr-3 ${t.side === "buy" ? "text-up" : "text-down"}`}>{t.side}</td>
                      <td className="py-2 pr-3 text-ink">{formatTokenAmount(t.tokenAmount)}</td>
                      <td className="py-2 pr-3 text-ink-2">{formatEther(BigInt(t.quoteAmount)).slice(0, 8)}</td>
                      <td className="py-2 pr-3 text-ink-2">{shortAddress(t.account)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-4 text-xs text-ink-4">No curve trade yet.</p>
          )}
        </div>
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
        <TradePanel token={chest.token as `0x${string}`} curve={chest.curve as `0x${string}`} symbol={chest.symbol} graduated={m.graduated} />
        <div className="panel-gold p-5">
          <p className="label text-gold">Read it back</p>
          <ul className="mt-3 space-y-3">
            {lines.map((l) => (
              <li key={l.key} className="flex gap-3 text-[13px] leading-relaxed text-ink">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rotate-45 bg-gold" aria-hidden="true" />
                <span>{l.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-3">{k}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="panel px-3 py-2.5">
      <dt className="text-xs text-ink-4">{k}</dt>
      <dd className="mono mt-0.5 text-ink">{v}</dd>
    </div>
  );
}
