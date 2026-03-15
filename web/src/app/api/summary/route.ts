import { NextResponse } from "next/server";
import { listNodes } from "@/lib/db";

export async function GET() {
  try {
    const types = ["space", "post", "task", "page", "comment", "report"] as const;
    const all: any[] = [];
    for (const type of types) {
      all.push(...listNodes({ type, limit: 1000 }));
    }

    const tasks = all.filter(n => n.type === "task");
    const openTasks = tasks.filter(t => t.status === "open");
    const inProgress = tasks.filter(t => t.status === "in-progress");
    const critical = tasks.filter(t => t.priority === "critical" && t.status !== "done" && t.status !== "closed");
    const reports = all.filter(n => n.type === "report");

    const dayAgo = new Date(Date.now() - 86400000).toISOString();
    const recentNodes = all.filter(n => n.updatedAt > dayAgo);
    const recentCreated = all.filter(n => n.createdAt > dayAgo);
    const activeAuthors = [...new Set(recentNodes.filter(n => n.author).map(n => n.author))];

    const twoDaysAgo = new Date(Date.now() - 172800000).toISOString();
    const staleTasks = tasks
      .filter(t => (t.status === "open" || t.status === "in-progress") && t.updatedAt < twoDaysAgo)
      .map(t => ({ title: t.title, path: t.path, assignee: t.assignee, lastUpdate: t.updatedAt }));

    return NextResponse.json({
      total: all.length,
      tasks: { open: openTasks.length, inProgress: inProgress.length, critical: critical.length, done: tasks.filter(t => t.status === "done").length },
      criticalItems: critical.map(t => ({ title: t.title, path: t.path, assignee: t.assignee })),
      reports: reports.length,
      last24h: { updated: recentNodes.length, created: recentCreated.length },
      activeAgents: activeAuthors,
      staleTasks,
    });
  } catch {
    return NextResponse.json({ error: "Failed to generate summary" }, { status: 500 });
  }
}
