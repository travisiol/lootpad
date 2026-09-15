import type { NextRequest } from "next/server";
import type { ChestsResponse } from "@/lib/pons";
import { listChests } from "@/lib/market";

/**
 * GET /api/chests?limit=24 — tokens launched through the Lootpad router,
 * newest first, with their curve market and chest status read live.
 */
export async function GET(request: NextRequest) {
  const raw = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "24", 10);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 100) : 24;
  try {
    const { chests, readAt } = await listChests(limit);
    const body: ChestsResponse = { ok: true, chests, readAt };
    return Response.json(body, { headers: { "cache-control": "public, max-age=10" } });
  } catch (e) {
    return Response.json(
      { ok: false, chests: [], readAt: Math.floor(Date.now() / 1000), error: e instanceof Error ? e.message : "chain unreachable" },
      { status: 502 },
    );
  }
}
