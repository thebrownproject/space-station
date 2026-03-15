import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { sql, desc } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const agent = request.nextUrl.searchParams.get("agent");
  const limit = parseInt(request.nextUrl.searchParams.get("limit") ?? "20");

  try {
    const db = getDb();

    // Check if agent_runs table exists
    const tableExists = db.get(
      sql`SELECT name FROM sqlite_master WHERE type='table' AND name='agent_runs'`
    );
    if (!tableExists) {
      return NextResponse.json([]);
    }

    // Raw query since we don't have the schema imported in web
    let query = agent
      ? sql`SELECT * FROM agent_runs WHERE agent_name = ${agent} ORDER BY started_at DESC LIMIT ${limit}`
      : sql`SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT ${limit}`;

    const runs = db.all(query);
    return NextResponse.json(runs);
  } catch {
    return NextResponse.json({ error: "Failed to get runs" }, { status: 500 });
  }
}
