import { NextRequest, NextResponse } from "next/server";
import { listNodes } from "@/lib/db";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const type = request.nextUrl.searchParams.get("type") as any;
  const limit = parseInt(request.nextUrl.searchParams.get("limit") ?? "20");

  if (!q) {
    return NextResponse.json([]);
  }

  try {
    const results = listNodes({
      search: q,
      type: type || undefined,
      limit,
    });
    return NextResponse.json(results);
  } catch {
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
