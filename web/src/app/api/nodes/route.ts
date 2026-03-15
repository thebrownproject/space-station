import { NextRequest, NextResponse } from "next/server";
import { listNodes, type NodeData } from "@/lib/db";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const filter: Parameters<typeof listNodes>[0] = {};

  if (params.get("parentId")) filter.parentId = params.get("parentId")!;
  if (params.get("type")) filter.type = params.get("type") as any;
  if (params.get("status")) filter.status = params.get("status") as any;
  if (params.get("author")) filter.author = params.get("author")!;
  if (params.get("assignee")) filter.assignee = params.get("assignee")!;
  if (params.get("search")) filter.search = params.get("search")!;
  if (params.get("depth")) filter.depth = parseInt(params.get("depth")!);
  if (params.get("limit")) filter.limit = parseInt(params.get("limit")!);

  try {
    const nodes = listNodes(filter);
    return NextResponse.json(nodes);
  } catch (error) {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
