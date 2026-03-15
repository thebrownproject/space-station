import { NextRequest, NextResponse } from "next/server";
import { getNode, getChildren } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const node = getNode(id);
    if (!node) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const withChildren = request.nextUrl.searchParams.get("children") === "true";
    if (withChildren) {
      const children = getChildren(node.id);
      return NextResponse.json({ ...node, children });
    }

    return NextResponse.json(node);
  } catch (error) {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
