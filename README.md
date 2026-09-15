# LOOTPAD

**Open. Discover. Launch.** — A launchpad for Pons V2 on Robinhood Chain where every launch is a chest: the token, its allocation and its rules are sealed in a contract with no owner and revealed when it opens.

## What a chest is

Pons V2 gives a launch two programmable surfaces: the address that receives the creator fees and the address that receives the developer's first buy. `LootpadRouter.launch()` deploys one `Chest` per launch and points both at it.

- **The token** — name, ticker, image, description, socials. Launched on a fresh Pons curve paired with ETH through the Pons launch forwarder. Metadata is stored in the router so the site needs no indexer.
- **The allocation** — the creator's first buy. With a lock (1–365 days) it is delivered to the chest and unlocks linearly; anyone can call `unlock()`, it always pays the creator. Without a lock it goes to the creator's wallet and the chest holds nothing (and says so). With a lock the creator's own wallet is *not* exempt from the Pons snipe tax — only the chest is.
- **The rules** — fixed at launch, no admin, no override. Every `open()` (anyone; the caller names who gets the key) splits the fresh loot: **1 % to the opener**, **10 % to the pad**, the creator's **burn share** of the rest is bought back on the curve and sent to the dead address, and the remainder goes to the creator. The creator fee on trades (0–10 %) is a rule too.

Burns are sliced (≤ 2 % of the curve's quote reserve per opening, ≥ 1 h apart) so a public `open()` cannot be sandwiched at a profit. The burn rule lives on the curve: from the first opening that sees graduation the burn share is zero and any reserve still waiting is burned as ETH.

**Tiers** (Common / Rare / Epic / Legendary) are computed from the chest's own rules by one function the whole site shares (`src/lib/rules.ts`) — earned, never rolled — and say what the creator gave up, not whether the token is any good.

## Layout

```
contracts/          Hardhat 2 + OpenZeppelin 5
  contracts/        LootpadRouter, ChestFactory, Chest, IPonsV2 (verified layouts), mocks
  test/             22 tests on a mock Pons
  scripts/          fork-check (against the real factory on a fork), serve-fork (front-end rehearsal), deploy, verify, export-abi
src/app/            Next 16 (App Router): /, /launch, /chests, /chest/[token], /docs, /api/*
src/lib/            chain, wagmi, contracts (ABIs exported on compile), rules, market (chain reader, no indexer), curve math, three.js chest
src/components/     ChestScene (three.js), LaunchForm + Reveal, ChestView, ChestList/ChestCard, TradePanel, …
scripts/capture.mjs Headless-Chrome screenshots (SwiftShader, WebGL without a GPU) → docs/captures
```

## Run it

```bash
npm install && npm --prefix contracts install
npm run dev                      # http://localhost:3960 with `next dev --port 3960`
npm run contracts:test           # 22 tests on the mock Pons
FORK_URL=https://rpc.mainnet.chain.robinhood.com npm run contracts:fork   # against the real factory on a fork
```

Without a router address the site shows honest empty states and the launch form's interlocks stay open.

### Rehearse the front end on a fork

```bash
cd contracts && FORK_URL=https://rpc.mainnet.chain.robinhood.com PORT=8596 npx hardhat run scripts/serve-fork.ts
```

It seeds three chests in three states and prints the four `NEXT_PUBLIC_*` values for `.env.local` (router, RPC `http://127.0.0.1:8596`, chain id 31337, and a "fork wallet" — an unlocked hardhat account the site offers as a connector that forwards transactions unsigned). Restart `next dev` after writing `.env.local`, and delete the file before any deployment. The public Robinhood RPC forgets the pinned block after ~10 minutes; seed and rehearse in one go.

## Deploy

1. `contracts/.env`: `DEPLOYER_PRIVATE_KEY` (funded on Robinhood Chain), optional `TREASURY_ADDRESS`, `OWNER_ADDRESS`.
2. `cd contracts && npm run deploy:robinhood` — deploys the ChestFactory and the router, writes `contracts/deployments/robinhood.json`, which `next.config.ts` reads so `npm run build` picks the address up (or set `NEXT_PUBLIC_LOOTPAD_ROUTER`).
3. `npm run verify:robinhood` (Blockscout).
4. Optional: `PINATA_JWT` for image uploads (the form always accepts an https URL), `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_X_URL`.

The router's owner can pause new launches, move the treasury address and set a pad launch fee (zero). It can never touch an existing chest.

## Proven

- 22 tests on a mock Pons (`npm run contracts:test`).
- `fork-check` against the real Pons V2 factory on a fork of Robinhood Chain: launch with a lock (5.9 M gas, allocation delivered to the chest, chest = fee recipient and snipe-exempt, creator wallet not exempt), launch without a lock, fees accruing, an opening with the exact split and a **real buyback + burn on the real curve**, linear unlock, and with `FULL=1` a curve that graduates for real: burn share to zero, leftover reserve burned as ETH.

## Open

- Deployment (a funded key) and the treasury address.
- The name and domain (`lootpad.fun` is a placeholder in `src/lib/site.ts`).
- Pons sweeps curve fees to its escrow on its own schedule; a chest can only open what has been swept. The chest page shows both numbers.
