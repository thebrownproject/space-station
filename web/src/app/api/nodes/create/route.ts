import { NextRequest, NextResponse } from "next/server";
import { getDb, nodes } from "@/lib/db";
import { v4 as uuid } from "uuid";
import { eq, and, isNull } from "drizzle-orm";

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, title, content, author, parentId, status, priority, assignee, tags } = body;

    if (!type || !title) {
      return NextResponse.json({ error: "type and title are required" }, { status: 400 });
    }

    const db = getDb();
    const now = new Date().toISOString();
    const id = uuid();

    // Resolve parent
    let parent: any = undefined;
    if (parentId) {
      parent = db.select().from(nodes).where(eq(nodes.id, parentId)).get();
      if (!parent) return NextResponse.json({ error: "Parent not found" }, { status: 404 });
    }

    // Generate unique slug
    let slug = slugify(title);
    let counter = 2;
    while (true) {
      const condition = parent
        ? and(eq(nodes.parentId, parent.id), eq(nodes.slug, slug))
        : and(isNull(nodes.parentId), eq(nodes.slug, slug));
      const existing = db.select().from(nodes).where(condition).get();
      if (!existing) break;
      slug = `${slugify(title)}-${counter}`;
      counter++;
    }

    const path = parent?.path ? `${parent.path}/${slug}` : slug;
    const depth = parent ? (parent.depth ?? 0) + 1 : 0;

    const row = {
      id,
      parentId: parent?.id ?? null,
      type,
      title,
      content: content ?? "",
      author: author ?? null,
      status: status ?? (type === "task" ? "open" : null),
      priority: priority ?? null,
      assignee: assignee ?? null,
      tags: JSON.stringify(tags ?? []),
      metadata: "{}",
      path,
      slug,
      depth,
      childCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    db.insert(nodes).values(row).run();

    if (parent) {
      db.update(nodes)
        .set({ childCount: (parent.childCount ?? 0) + 1 })
        .where(eq(nodes.id, parent.id))
        .run();
    }

    return NextResponse.json({
      ...row,
      tags: tags ?? [],
      metadata: {},
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    );
  }
}
