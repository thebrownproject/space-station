import { NextRequest, NextResponse } from "next/server";
import { getDb, nodes } from "@/lib/db";
import { eq } from "drizzle-orm";

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, status, priority, assignee, title, content } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const db = getDb();
    const existing = db.select().from(nodes).where(eq(nodes.id, id)).get();
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { updatedAt: now };

    if (status !== undefined) updates.status = status;
    if (priority !== undefined) updates.priority = priority;
    if (assignee !== undefined) updates.assignee = assignee;
    if (title !== undefined) updates.title = title;
    if (content !== undefined) updates.content = content;

    db.update(nodes).set(updates).where(eq(nodes.id, id)).run();

    const updated = db.select().from(nodes).where(eq(nodes.id, id)).get();
    return NextResponse.json({
      ...updated,
      tags: JSON.parse((updated as any).tags || "[]"),
      metadata: JSON.parse((updated as any).metadata || "{}"),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    );
  }
}
