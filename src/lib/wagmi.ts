import { createConfig, http, injected } from "wagmi";
import { mock } from "wagmi/connectors";
import { robinhoodChain } from "@/lib/chain";

/**
 * NEXT_PUBLIC_FORK_WALLET=<address> adds a "fork wallet" connector that
 * signs nothing and forwards eth_sendTransaction to the RPC — which only
 * works against a hardhat fork with unlocked accounts (contracts/scripts/
 * serve-fork.ts). It exists for rehearsals and is never set in production.
 */
const FORK_WALLET = process.env.NEXT_PUBLIC_FORK_WALLET?.trim();
const forkWallet = FORK_WALLET && /^0x[0-9a-fA-F]{40}$/.test(FORK_WALLET) ? (FORK_WALLET as `0x${string}`) : null;

export const wagmiConfig = createConfig({
  chains: [robinhoodChain],
  connectors: [injected(), ...(forkWallet ? [mock({ accounts: [forkWallet] })] : [])],
  transports: {
    [robinhoodChain.id]: http(),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
