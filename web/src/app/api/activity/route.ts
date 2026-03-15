import { NextRequest, NextResponse } from "next/server";
import { listNodes, type NodeData } from "@/lib/db";

export async function GET(request: NextRequest) {
  const limit = parseInt(request.nextUrl.searchParams.get("limit") ?? "20");
  const since = request.nextUrl.searchParams.get("since"); // ISO timestamp

  try {
    const types = ["task", "report", "post", "comment", "page", "space"] as const;
    const all: NodeData[] = [];

    for (const type of types) {
      all.push(...listNodes({ type, limit: 50 }));
    }

    // Sort by updatedAt descending
    all.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    // Filter by since if provided
    let results = all;
    if (since) {
      results = all.filter(n => n.updatedAt > since);
    }

    return NextResponse.json(results.slice(0, limit));
  } catch {
    return NextResponse.json({ error: "Failed to get activity" }, { status: 500 });
  }
}
