import type { OpeningsResponse } from "@/lib/pons";
import { chestOpenings } from "@/lib/market";
import { isAddress } from "@/lib/format";

/** GET /api/chest/<token>/openings — the loot log: every opening, newest first. */
export async function GET(_request: Request, ctx: RouteContext<"/api/chest/[address]/openings">) {
  const { address } = await ctx.params;
  if (!isAddress(address)) {
    return Response.json({ ok: false, error: "address must be a 0x address" }, { status: 400 });
  }
  try {
    const openings = await chestOpenings(address);
    const body: OpeningsResponse = { ok: true, openings };
    return Response.json(body, { headers: { "cache-control": "public, max-age=15" } });
  } catch (e) {
    return Response.json({ ok: false, openings: [], error: e instanceof Error ? e.message : "chain unreachable" }, { status: 502 });
  }
}
