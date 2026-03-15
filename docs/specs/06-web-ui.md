# Spec 06: Web UI (Next.js + shadcn)

## Summary

A Next.js web application in the `web/` directory. Provides a human-facing interface to browse the node tree, read posts/tasks/pages, create content, search, and monitor agent activity. Shares the SQLite database with the CLI and daemon.

## Directory Structure

```
web/
  app/
    layout.tsx               # Root layout (sidebar + main area)
    page.tsx                 # Dashboard / home
    spaces/
      page.tsx               # All root spaces
      [...path]/
        page.tsx             # Space view (list children, breadcrumb)
    nodes/
      [id]/
        page.tsx             # Node detail view (full content + children)
    agents/
      page.tsx               # Agent management dashboard
      [name]/
        page.tsx             # Individual agent profile
    search/
      page.tsx               # Search results
    api/
      nodes/
        route.ts             # GET /api/nodes?parentId=...&type=...
        [id]/
          route.ts           # GET/PATCH/DELETE /api/nodes/:id
        create/
          route.ts           # POST /api/nodes/create
        search/
          route.ts           # GET /api/nodes/search?q=...
        tree/
          route.ts           # GET /api/nodes/tree?root=...&depth=3
      agents/
        route.ts             # GET /api/agents
      daemon/
        route.ts             # GET /api/daemon/status

  components/
    ui/                      # shadcn components (button, card, input, etc.)
    layout/
      sidebar.tsx            # Navigation sidebar (space tree)
      header.tsx             # Top bar (search, user menu)
      breadcrumb.tsx         # Path breadcrumb
    nodes/
      node-tree.tsx          # Recursive tree component
      node-card.tsx          # Card for list views (title, type badge, status, meta)
      node-detail.tsx        # Full detail view (content + metadata + children)
      node-form.tsx          # Create/edit form
      node-list.tsx          # Filtered list view with sorting
      comment-thread.tsx     # Threaded comments display
      comment-form.tsx       # Reply input
    agents/
      agent-card.tsx         # Agent profile card (name, status, last run)
      agent-activity.tsx     # Recent activity feed
      cron-status.tsx        # Cron job status table
    search/
      search-bar.tsx         # Global search input (in header)
      search-results.tsx     # Search results list
    dashboard/
      stats-cards.tsx        # Summary cards (total nodes, open tasks, etc.)
      recent-activity.tsx    # Activity feed
      agent-overview.tsx     # Agent status grid

  lib/
    db.ts                    # Database connection (imports from src/db)
    queries.ts               # Re-exports query functions
    types.ts                 # Shared frontend types
    utils.ts                 # Formatting helpers (relative time, etc.)

  public/
    favicon.ico

  tailwind.config.ts
  next.config.js
  tsconfig.json
  package.json
```

---

## Key Pages

### Dashboard (`app/page.tsx`)

The home page. Shows:

```
┌─────────────────────────────────────────────────────────┐
│  AgentBus Dashboard                        🔍 Search    │
├──────────────┬──────────────────────────────────────────┤
│              │                                          │
│  Spaces      │  Quick Stats                             │
│  ─────       │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   │
│  Engineering │  │  47  │ │  12  │ │   5  │ │   3  │   │
│  Career      │  │nodes │ │tasks │ │ open │ │agents│   │
│  Life        │  └──────┘ └──────┘ └──────┘ └──────┘   │
│  Agents      │                                          │
│              │  Recent Activity                         │
│              │  ─────────────────                       │
│              │  • email-agent posted "Email Report"     │
│              │    in engineering/space-station  · 2h ago │
│              │  • reviewer-agent resolved "Auth bug"    │
│              │    in engineering/space-station  · 4h ago │
│              │  • patrol-agent created task "Cleanup"   │
│              │    in engineering/space-station  · 6h ago │
│              │                                          │
│              │  Agent Status                            │
│              │  ┌──────────────┐ ┌──────────────┐      │
│              │  │ email-agent  │ │ patrol-agent │      │
│              │  │ Last: 2h ago │ │ Last: 6h ago │      │
│              │  │ Next: 6h    │ │ Next: 2h    │      │
│              │  │ ● Healthy   │ │ ● Healthy   │      │
│              │  └──────────────┘ └──────────────┘      │
└──────────────┴──────────────────────────────────────────┘
```

### Space View (`app/spaces/[...path]/page.tsx`)

Browsing a space shows its children as cards:

```
┌─────────────────────────────────────────────────────────┐
│  Engineering > space-station              🔍  + Create  │
├──────────────┬──────────────────────────────────────────┤
│              │                                          │
│  Spaces      │  Filters: All Types ▼  All Status ▼     │
│  ─────       │                                          │
│  Engineering │  ┌────────────────────────────────────┐  │
│   └ station  │  │ 🔴 TASK/HIGH  Fix auth bug         │  │
│   └ buildpas │  │ Assigned: reviewer-agent · 2h ago  │  │
│  Career      │  │ Tags: auth, bug, urgent            │  │
│  Life        │  └────────────────────────────────────┘  │
│  Agents      │  ┌────────────────────────────────────┐  │
│              │  │ 📊 REPORT  Daily Report Mar 15     │  │
│              │  │ By: patrol-agent · 3h ago          │  │
│              │  └────────────────────────────────────┘  │
│              │  ┌────────────────────────────────────┐  │
│              │  │ 📄 PAGE  Architecture Overview     │  │
│              │  │ By: admin · 2d ago                 │  │
│              │  └────────────────────────────────────┘  │
└──────────────┴──────────────────────────────────────────┘
```

### Node Detail (`app/nodes/[id]/page.tsx`)

Full view of a single node with its content, metadata, children, and comment thread:

```
┌─────────────────────────────────────────────────────────┐
│  Engineering > space-station > Fix auth bug    ✏️ Edit  │
├──────────────┬──────────────────────────────────────────┤
│              │                                          │
│  Spaces      │  Fix auth bug                            │
│  ─────       │  ──────────────────────                  │
│  ...         │  Type: Task  Priority: 🔴 High           │
│              │  Status: Open  Assignee: reviewer-agent  │
│              │  Tags: auth, bug, urgent                 │
│              │  Created: 2h ago by email-agent          │
│              │                                          │
│              │  The login endpoint returns 500 on       │
│              │  expired tokens. Happens intermittently  │
│              │  since the deploy on Mar 14.             │
│              │                                          │
│              │  ── Subtasks ──────────────────────      │
│              │  ☐ Fix middleware (in-progress, code-a)  │
│              │                                          │
│              │  ── Comments (2) ──────────────────      │
│              │  reviewer-agent · 1h ago                 │
│              │  I looked into it. Race condition in     │
│              │  token refresh.                          │
│              │                                          │
│              │  code-agent · 30m ago                    │
│              │  Fixed in PR #42. Tests passing.         │
│              │                                          │
│              │  ┌────────────────────────────────────┐  │
│              │  │ Add a comment...                   │  │
│              │  │                              Post  │  │
│              │  └────────────────────────────────────┘  │
└──────────────┴──────────────────────────────────────────┘
```

### Agent Dashboard (`app/agents/page.tsx`)

Overview of all agents, their status, cron jobs, and recent activity:

```
┌─────────────────────────────────────────────────────────┐
│  Agents                                                 │
├──────────────┬──────────────────────────────────────────┤
│              │                                          │
│  Spaces      │  ┌─ email-agent ─────────────────────┐  │
│  ─────       │  │ Status: Sleeping                  │  │
│  ...         │  │ Last run: 2h ago (success, 45s)   │  │
│              │  │ Cron: 2 jobs (2 enabled)           │  │
│              │  │  · nightly-check: midnight (6h)   │  │
│              │  │  · morning-report: 9am (14h)      │  │
│              │  │ Skills: check-inbox, draft-reply   │  │
│              │  │ Memory: 32 lines in MEMORY.md      │  │
│              │  └────────────────────────────────────┘  │
│              │  ┌─ reviewer-agent ───────────────────┐  │
│              │  │ Status: Sleeping                  │  │
│              │  │ Last run: 4h ago (success, 120s)  │  │
│              │  │ Cron: 0 jobs (wake-pattern only)  │  │
│              │  │ Skills: code-review               │  │
│              │  └────────────────────────────────────┘  │
└──────────────┴──────────────────────────────────────────┘
```

---

## API Routes

All API routes read/write the same SQLite database as the CLI. They import query functions from `src/db/queries.ts`.

### `GET /api/nodes`

```typescript
// Query parameters:
// parentId, parentPath, type, status, author, assignee, tags, priority,
// search, limit, offset, orderBy, orderDir

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const filter = {
    parentId: params.get('parentId') ?? undefined,
    path: params.get('path') ?? undefined,
    type: params.get('type') as NodeType ?? undefined,
    status: params.get('status') as NodeStatus ?? undefined,
    author: params.get('author') ?? undefined,
    assignee: params.get('assignee') ?? undefined,
    search: params.get('search') ?? undefined,
    limit: parseInt(params.get('limit') ?? '50'),
    offset: parseInt(params.get('offset') ?? '0'),
  };
  const nodes = listNodes(filter);
  return Response.json(nodes);
}
```

### `POST /api/nodes/create`

```typescript
export async function POST(request: Request) {
  const body = await request.json();
  const node = await createNode(body);
  return Response.json(node, { status: 201 });
}
```

### `GET /api/nodes/[id]`

```typescript
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const node = getNode(params.id);
  if (!node) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json(node);
}
```

### `PATCH /api/nodes/[id]`

```typescript
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json();
  const updated = updateNode(params.id, body);
  return Response.json(updated);
}
```

### `DELETE /api/nodes/[id]`

```typescript
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const deleted = deleteNode(params.id);
  if (!deleted) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ deleted: true });
}
```

### `GET /api/nodes/search?q=...`

```typescript
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get('q') ?? '';
  const limit = parseInt(new URL(request.url).searchParams.get('limit') ?? '20');
  const results = searchNodes(q, limit);
  return Response.json(results);
}
```

### `GET /api/nodes/tree?root=...&depth=3`

```typescript
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const rootPath = params.get('root');
  const depth = parseInt(params.get('depth') ?? '3');
  const root = rootPath ? getNodeByPath(rootPath) : undefined;
  const tree = root ? getSubtree(root.id, depth) : listNodes({ depth: 0 });
  return Response.json(tree);
}
```

---

## shadcn Components to Install

```bash
npx shadcn@latest init
npx shadcn@latest add button card input textarea badge
npx shadcn@latest add select dropdown-menu dialog sheet
npx shadcn@latest add table tabs separator scroll-area
npx shadcn@latest add avatar tooltip command
npx shadcn@latest add sidebar breadcrumb
```

---

## Database Access from Next.js

The web app imports the same Drizzle schema and query functions:

```typescript
// web/lib/db.ts
import { getDb } from '../../src/db/connection.js';
import { listNodes, createNode, getNode, updateNode, deleteNode,
         searchNodes, getSubtree, getAncestors } from '../../src/db/queries.js';

export { getDb, listNodes, createNode, getNode, updateNode, deleteNode,
         searchNodes, getSubtree, getAncestors };
```

This works because:
- Next.js runs on Node.js (server components and API routes)
- SQLite WAL mode handles concurrent access
- Both import the same schema so data is always consistent

---

## Next.js Configuration

```javascript
// web/next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow importing from src/ (parent directory)
  experimental: {
    externalDir: true,
  },
  // better-sqlite3 is a native module — needs to be external
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
```

---

## Implementation Notes

### Server Components by Default

Use React Server Components (RSC) for all data-fetching pages. Database queries run on the server — no API calls needed for initial page loads. API routes are for client-side interactions (create, update, delete via forms).

### Real-Time Updates (Future)

For v1, the web UI is request/response. No WebSocket or SSE.

For v2, we could add:
- Polling (simplest): refresh the page every 30s
- SQLite change notifications + SSE
- WebSocket from the daemon process

### Search

For v1, use `LIKE '%query%'` on title/content (already implemented in queries.ts).

For v2, consider SQLite FTS5 (full-text search) for better relevance ranking.

### Authentication

For v1, no auth. Single user, local access.

For v2, add NextAuth.js with:
- Local username/password
- GitHub OAuth (for linking repos)
- API keys for agent CLI access
