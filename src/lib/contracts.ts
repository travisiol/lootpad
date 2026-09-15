import type { Abi } from "viem";
import routerJson from "@/lib/abi/LootpadRouter.json";
import chestJson from "@/lib/abi/Chest.json";

/**
 * On-chain surface. The router address comes from the environment (or the
 * deployment record, see next.config.ts) and is null until deployed; the
 * ABIs are exported by `contracts/` on every compile.
 */

function envAddress(value: string | undefined): `0x${string}` | null {
  const v = value?.trim();
  return v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as `0x${string}`) : null;
}

/** The Lootpad router: launch → Pons V2 + one Chest per token. */
export const ROUTER_ADDRESS = envAddress(process.env.NEXT_PUBLIC_LOOTPAD_ROUTER);

export const routerAbi = routerJson as Abi;
export const chestAbi = chestJson as Abi;
