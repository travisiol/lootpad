import type { TradesResponse } from "@/lib/pons";
import { chestTrades } from "@/lib/market";
import { isAddress } from "@/lib/format";

/** GET /api/chest/<token>/trades — curve trades, newest first, from the logs. */
export async function GET(_request: Request, ctx: RouteContext<"/api/chest/[address]/trades">) {
  const { address } = await ctx.params;
  if (!isAddress(address)) {
    return Response.json({ ok: false, error: "address must be a 0x address" }, { status: 400 });
  }
  try {
    const trades = await chestTrades(address);
    const body: TradesResponse = { ok: true, trades };
    return Response.json(body, { headers: { "cache-control": "public, max-age=15" } });
  } catch (e) {
    return Response.json({ ok: false, trades: [], error: e instanceof Error ? e.message : "chain unreachable" }, { status: 502 });
  }
}
