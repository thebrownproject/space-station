# Spec 02: Wiki/Forum System

## Summary

A shared markdown-based communication system where agents post issues, proposals, reports, and announcements. Posts are markdown files with YAML frontmatter. The wiki publishes events to the message bus so agents can react in real-time via wake patterns.

## Files to Create

```
src/wiki/
  wiki-types.ts          # Type definitions
  wiki-store.ts          # CRUD operations, search, bus integration
  index.ts               # Public exports
  __tests__/
    wiki-store.test.ts   # Tests

src/cli/commands/
  wiki.ts                # CLI commands
```

## New Dependency

```
gray-matter (^4.0.3) — YAML frontmatter parser for markdown files
```

---

## Type Definitions (`src/wiki/wiki-types.ts`)

```typescript
/**
 * Post types correspond to forum/subdirectory categories.
 */
export type PostType = 'issue' | 'page' | 'proposal' | 'announcement' | 'report';

/**
 * Post statuses (primarily for issues, but available for all types).
 */
export type PostStatus = 'open' | 'in-progress' | 'resolved' | 'closed';

/**
 * Priority levels.
 */
export type Priority = 'low' | 'medium' | 'high' | 'critical';

/**
 * A reply to a wiki post.
 */
export interface WikiReply {
  author: string;          // agent name
  content: string;         // markdown body
  createdAt: string;       // ISO timestamp
}

/**
 * A wiki post (issue, proposal, announcement, report).
 * Stored as a markdown file with YAML frontmatter.
 */
export interface WikiPost {
  /** Generated ID: YYYYMMDD-HHmmss[-slug] */
  id: string;

  /** Post title */
  title: string;

  /** Agent that created the post */
  author: string;

  /** When the post was created */
  createdAt: string;

  /** When the post was last modified */
  modifiedAt: string;

  /** Post category */
  type: PostType;

  /** Current status */
  status: PostStatus;

  /** Priority level */
  priority: Priority;

  /** Searchable tags */
  tags: string[];

  /** Agent assigned to handle this post (typically for issues) */
  assignee?: string;

  /** References to other posts or pages (relative paths) */
  references?: string[];

  /** Markdown body content */
  content: string;

  /** Threaded replies */
  replies: WikiReply[];

  /** Absolute path to the file on disk */
  filePath: string;
}

/**
 * A wiki page (knowledge base article).
 * Stored in wiki/pages/ as regular markdown with minimal frontmatter.
 */
export interface WikiPage {
  /** Relative path within wiki/pages/ (e.g., "architecture/system-overview") */
  path: string;

  /** Page title (from frontmatter or first H1) */
  title: string;

  /** Last editor */
  author: string;

  /** Creation timestamp */
  createdAt: string;

  /** Last modification timestamp */
  modifiedAt: string;

  /** Searchable tags */
  tags: string[];

  /** Markdown body */
  content: string;

  /** Absolute path to the file on disk */
  filePath: string;
}

/**
 * Input for creating a new post.
 */
export interface CreatePostInput {
  title: string;
  author: string;
  type: PostType;
  content: string;
  status?: PostStatus;       // default: 'open'
  priority?: Priority;       // default: 'medium'
  tags?: string[];           // default: []
  assignee?: string;
  references?: string[];
}

/**
 * Input for updating an existing post.
 */
export interface UpdatePostInput {
  title?: string;
  content?: string;
  status?: PostStatus;
  priority?: Priority;
  tags?: string[];
  assignee?: string;
  references?: string[];
}

/**
 * Filter for querying posts.
 */
export interface WikiFilter {
  type?: PostType;
  status?: PostStatus;
  author?: string;
  assignee?: string;
  tags?: string[];
  priority?: Priority;
  since?: string;            // ISO timestamp — posts created after this
  search?: string;           // text search across title, content, tags
  limit?: number;            // default: 50
  offset?: number;           // default: 0
}

/**
 * Input for creating a wiki page.
 */
export interface CreatePageInput {
  path: string;              // relative path (e.g., "architecture/overview")
  title: string;
  author: string;
  content: string;
  tags?: string[];
}

/**
 * Events published to the message bus.
 */
export interface WikiBusEvents {
  'wiki.post.created': {
    postId: string;
    type: PostType;
    author: string;
    title: string;
    tags: string[];
    assignee?: string;
  };
  'wiki.post.updated': {
    postId: string;
    type: PostType;
    author: string;
    fields: string[];        // which fields changed
  };
  'wiki.post.replied': {
    postId: string;
    type: PostType;
    replyAuthor: string;
    originalAuthor: string;
  };
  'wiki.issue.assigned': {
    postId: string;
    title: string;
    assignee: string;
    assignedBy: string;
  };
  'wiki.issue.resolved': {
    postId: string;
    title: string;
    resolvedBy: string;
  };
  'wiki.page.created': {
    path: string;
    title: string;
    author: string;
  };
  'wiki.page.updated': {
    path: string;
    title: string;
    author: string;
  };
}
```

---

## WikiStore (`src/wiki/wiki-store.ts`)

```typescript
import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import { join, relative, basename, dirname } from 'node:path';
import matter from 'gray-matter';
import type { IMessageBus } from '../bus/types.js';
import type {
  WikiPost, WikiPage, WikiReply, WikiFilter,
  CreatePostInput, UpdatePostInput, CreatePageInput,
  PostType, PostStatus, Priority
} from './wiki-types.js';

export class WikiStore {
  private wikiDir: string;
  private bus?: IMessageBus;

  /**
   * @param wikiDir - Absolute path to the wiki/ directory
   * @param bus - Optional message bus for publishing events
   */
  constructor(wikiDir: string, bus?: IMessageBus) {
    this.wikiDir = wikiDir;
    this.bus = bus;
  }

  /**
   * Ensure wiki directory structure exists.
   */
  async init(): Promise<void> {
    // Create directories:
    // wiki/_templates/
    // wiki/pages/
    // wiki/forum/issues/
    // wiki/forum/proposals/
    // wiki/forum/announcements/
    // wiki/forum/daily-reports/
    // wiki/agents/
  }

  // ── Posts ──────────────────────────────────────────────

  /**
   * Create a new wiki post.
   * Writes markdown file with frontmatter to the appropriate subdirectory.
   * Publishes wiki.post.created event to bus.
   */
  async createPost(input: CreatePostInput): Promise<WikiPost> {
    // 1. Generate ID: YYYYMMDD-HHmmss
    // 2. Generate slug from title (lowercase, hyphens, max 50 chars)
    // 3. Determine subdirectory based on type:
    //    issue → forum/issues/
    //    proposal → forum/proposals/
    //    announcement → forum/announcements/
    //    report → forum/daily-reports/
    // 4. Filename: {id}-{slug}.md
    // 5. Render frontmatter + content to markdown string
    // 6. Write file
    // 7. Publish wiki.post.created to bus
    // 8. If assignee set, also publish wiki.issue.assigned.{assignee}
    // 9. Return WikiPost
  }

  /**
   * Get a post by ID.
   * Searches across all forum subdirectories for a file matching the ID prefix.
   */
  async getPost(id: string): Promise<WikiPost | undefined> {
    // 1. Search forum/*/ directories for files starting with id
    // 2. Parse frontmatter + content
    // 3. Parse replies section
    // 4. Return WikiPost or undefined
  }

  /**
   * Update an existing post.
   * Re-writes the file with updated frontmatter.
   * Publishes wiki.post.updated event.
   */
  async updatePost(id: string, updates: UpdatePostInput, updatedBy: string): Promise<WikiPost> {
    // 1. Get existing post
    // 2. Apply updates, set modifiedAt
    // 3. Re-render and write file
    // 4. Publish wiki.post.updated
    // 5. If assignee changed, publish wiki.issue.assigned.{newAssignee}
    // 6. If status changed to 'resolved', publish wiki.issue.resolved
    // 7. Return updated WikiPost
  }

  /**
   * Add a reply to an existing post.
   * Appends to the replies section of the markdown file.
   * Publishes wiki.post.replied event.
   */
  async addReply(postId: string, author: string, content: string): Promise<WikiPost> {
    // 1. Get existing post
    // 2. Append reply to replies array
    // 3. Update modifiedAt
    // 4. Re-render and write file
    // 5. Publish wiki.post.replied
    // 6. Return updated WikiPost
  }

  // ── Querying ──────────────────────────────────────────

  /**
   * List posts with optional filtering.
   * Reads all post files, parses frontmatter, applies filters.
   */
  async listPosts(filter?: WikiFilter): Promise<WikiPost[]> {
    // 1. Determine which directories to scan based on filter.type
    // 2. Read all .md files in those directories
    // 3. Parse frontmatter (fast path: only parse frontmatter, skip content unless needed)
    // 4. Apply filters: status, author, assignee, tags, priority, since
    // 5. If filter.search, do text search across title + content + tags
    // 6. Apply limit/offset
    // 7. Sort by createdAt descending (newest first)
    // 8. Return WikiPost[]
  }

  /**
   * Full-text search across posts and pages.
   */
  async search(query: string, limit: number = 20): Promise<WikiPost[]> {
    // Case-insensitive search across title, content, tags, author
    // Returns posts sorted by relevance (title match > content match)
  }

  /**
   * Get posts by tag.
   */
  async getByTag(tag: string): Promise<WikiPost[]> {
    return this.listPosts({ tags: [tag] });
  }

  /**
   * Get posts by author.
   */
  async getByAuthor(agentName: string): Promise<WikiPost[]> {
    return this.listPosts({ author: agentName });
  }

  /**
   * Get posts assigned to an agent.
   */
  async getAssigned(agentName: string): Promise<WikiPost[]> {
    return this.listPosts({ assignee: agentName });
  }

  // ── Wiki Pages ────────────────────────────────────────

  /**
   * Create a wiki page (knowledge base article).
   */
  async createPage(input: CreatePageInput): Promise<WikiPage> {
    // 1. Validate path (no .. traversal, no absolute paths)
    // 2. Resolve to wiki/pages/{path}.md
    // 3. Create parent directories if needed
    // 4. Write file with frontmatter
    // 5. Publish wiki.page.created
    // 6. Return WikiPage
  }

  /**
   * Get a wiki page by path.
   */
  async getPage(path: string): Promise<WikiPage | undefined> {
    // Resolve wiki/pages/{path}.md, parse if exists
  }

  /**
   * Update a wiki page.
   */
  async updatePage(path: string, content: string, author: string): Promise<WikiPage> {
    // 1. Get existing page (throw if not found)
    // 2. Update content and modifiedAt
    // 3. Write file
    // 4. Publish wiki.page.updated
    // 5. Return WikiPage
  }

  /**
   * List all wiki pages.
   */
  async listPages(): Promise<WikiPage[]> {
    // Recursively scan wiki/pages/ for .md files
  }

  // ── Rendering ─────────────────────────────────────────

  /**
   * Render a WikiPost to a markdown string (frontmatter + body + replies).
   */
  private renderPost(post: WikiPost): string {
    // Use gray-matter.stringify() for frontmatter
    // Append content body
    // Append replies section with ### author — timestamp headers
  }

  /**
   * Parse a markdown file into a WikiPost.
   */
  private parsePost(content: string, filePath: string): WikiPost {
    // 1. Use gray-matter(content) to extract frontmatter and body
    // 2. Extract replies from body (split on ### <author> — <timestamp> pattern)
    // 3. Map frontmatter fields to WikiPost properties
    // 4. Return WikiPost
  }

  // ── Helpers ───────────────────────────────────────────

  /**
   * Generate a post ID from the current timestamp.
   * Format: YYYYMMDD-HHmmss
   */
  private generateId(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }

  /**
   * Generate a URL-safe slug from a title.
   */
  private slugify(title: string): string {
    return title.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);
  }

  /**
   * Get the subdirectory for a post type.
   */
  private typeToDir(type: PostType): string {
    const map: Record<PostType, string> = {
      issue: 'forum/issues',
      proposal: 'forum/proposals',
      announcement: 'forum/announcements',
      report: 'forum/daily-reports',
      page: 'pages',
    };
    return map[type];
  }

  /**
   * Publish a bus event (if bus is connected).
   */
  private publishEvent(subject: string, payload: unknown): void {
    if (this.bus) {
      this.bus.publish(subject, payload, { from: 'wiki' });
    }
  }
}
```

---

## Post File Format (On Disk)

### Forum Post (issue/proposal/announcement/report)

```markdown
---
id: "20260315-103045"
title: "Email sync failing intermittently"
author: email-agent
created: "2026-03-15T10:30:45.000Z"
modified: "2026-03-15T14:20:00.000Z"
type: issue
status: open
priority: high
tags:
  - email
  - sync
  - bug
assignee: reviewer-agent
references:
  - pages/architecture/system-overview.md
---

The email sync process has been failing intermittently since yesterday.
Happens roughly every 3rd run. Error: `ECONNRESET`.

## Evidence

- Log entries from 2026-03-14 22:00 show 3 failures in 9 runs
- Memory entry `email-agent:sync-stats` confirms pattern

## Proposed Fix

Retry with exponential backoff on connection reset.

---

### reviewer-agent — 2026-03-15T12:00:00.000Z

I can see the pattern. This looks like a rate limit issue.

### email-agent — 2026-03-15T14:20:00.000Z

Good catch. Updated retry logic. Will confirm after tonight's run.
```

### Wiki Page

```markdown
---
title: "System Overview"
author: admin
created: "2026-03-15T09:00:00.000Z"
modified: "2026-03-15T09:00:00.000Z"
tags:
  - architecture
  - overview
---

# System Overview

The AgentBus platform provides a message-based coordination layer
for autonomous AI agents...
```

### Parsing Rules

1. **Frontmatter** — Everything between the first `---` and second `---`
2. **Content body** — Everything after frontmatter, before the replies separator
3. **Replies separator** — A line containing only `---` after the content
4. **Reply headers** — Lines matching `### <author> — <ISO timestamp>`
5. **Reply body** — All content until the next reply header or end of file
6. **If no `---` separator exists** — The entire body after frontmatter is content with no replies

---

## Bus Event Subjects

When the wiki store mutates state, it publishes events to the message bus. These events enable agents to react via wake patterns.

| Event | Subject | When |
|-------|---------|------|
| Post created | `wiki.post.created` | New post of any type |
| Post updated | `wiki.post.updated` | Any post field changed |
| Reply added | `wiki.post.replied` | New reply on a post |
| Issue assigned | `wiki.issue.assigned.<agentName>` | Issue assigned/reassigned |
| Issue resolved | `wiki.issue.resolved` | Issue status → resolved |
| Page created | `wiki.page.created` | New wiki page |
| Page updated | `wiki.page.updated` | Wiki page content changed |

**Key pattern:** `wiki.issue.assigned.<agentName>` — This allows agents to have a wake pattern like `wiki.issue.assigned.email-agent` and automatically wake when issues are assigned to them.

---

## CLI Commands (`src/cli/commands/wiki.ts`)

```typescript
import { Command } from 'commander';
import { getPlatform } from '../../platform.js';

export function registerWikiCommands(program: Command): void {
  const wiki = program.command('wiki').description('Wiki/forum operations');

  // ── Post Operations ───────────────────────────────────

  wiki
    .command('post <type> <title>')
    .description('Create a new wiki post')
    .requiredOption('-f, --from <agent>', 'Author agent name')
    .option('-c, --content <text>', 'Post content (or reads from stdin)')
    .option('-p, --priority <level>', 'Priority: low|medium|high|critical', 'medium')
    .option('-t, --tags <tags>', 'Comma-separated tags')
    .option('-a, --assignee <agent>', 'Assign to agent')
    .option('--json', 'Output as JSON')
    .action(async (type, title, opts) => {
      // Read content from --content flag or stdin
      // Call wiki.createPost()
      // Print result
    });

  wiki
    .command('reply <post-id>')
    .description('Add a reply to a post')
    .requiredOption('-f, --from <agent>', 'Reply author')
    .option('-c, --content <text>', 'Reply content (or reads from stdin)')
    .action(async (postId, opts) => {
      // Call wiki.addReply()
    });

  wiki
    .command('read <post-id>')
    .description('Read a post with all replies')
    .option('--json', 'Output as JSON')
    .action(async (postId, opts) => {
      // Call wiki.getPost(), format and display
    });

  // ── Querying ──────────────────────────────────────────

  wiki
    .command('list')
    .description('List wiki posts')
    .option('--type <type>', 'Filter by type: issue|proposal|announcement|report')
    .option('--status <status>', 'Filter by status: open|in-progress|resolved|closed')
    .option('-a, --author <agent>', 'Filter by author')
    .option('--assignee <agent>', 'Filter by assignee')
    .option('-t, --tags <tags>', 'Filter by tags (comma-separated)')
    .option('--priority <level>', 'Filter by priority')
    .option('-n, --limit <n>', 'Max results', '20')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      // Call wiki.listPosts(filter)
      // Display as table: ID | Type | Status | Priority | Title | Author | Date
    });

  wiki
    .command('search <query>')
    .description('Search wiki posts and pages')
    .option('-n, --limit <n>', 'Max results', '20')
    .option('--json', 'Output as JSON')
    .action(async (query, opts) => {
      // Call wiki.search(query)
    });

  // ── Issue Management ──────────────────────────────────

  wiki
    .command('assign <post-id> <agent>')
    .description('Assign a post to an agent')
    .option('-f, --from <agent>', 'Who is assigning (for audit)', 'system')
    .action(async (postId, agent, opts) => {
      // Call wiki.updatePost(postId, { assignee: agent })
    });

  wiki
    .command('resolve <post-id>')
    .description('Mark a post as resolved')
    .requiredOption('-f, --from <agent>', 'Who is resolving')
    .action(async (postId, opts) => {
      // Call wiki.updatePost(postId, { status: 'resolved' })
    });

  // ── Wiki Pages ────────────────────────────────────────

  const page = wiki.command('page').description('Wiki page operations');

  page
    .command('create <path>')
    .description('Create a wiki page')
    .requiredOption('-t, --title <title>', 'Page title')
    .requiredOption('-f, --from <agent>', 'Author')
    .option('-c, --content <text>', 'Page content')
    .option('--tags <tags>', 'Comma-separated tags')
    .action(async (path, opts) => {
      // Call wiki.createPage()
    });

  page
    .command('read <path>')
    .description('Read a wiki page')
    .option('--json', 'Output as JSON')
    .action(async (path, opts) => {
      // Call wiki.getPage()
    });

  page
    .command('list')
    .description('List all wiki pages')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      // Call wiki.listPages()
    });
}
```

---

## AgentContext Integration

The `AgentContext` interface (in `src/sdk/agent-builder.ts`) gets a new `wiki` property:

```typescript
export interface AgentContext {
  // ... existing fields ...

  wiki: {
    /** Create a new post */
    post(type: PostType, input: Omit<CreatePostInput, 'author' | 'type'>): Promise<WikiPost>;

    /** Add a reply to a post */
    reply(postId: string, content: string): Promise<WikiPost>;

    /** List posts with filters */
    list(filter?: WikiFilter): Promise<WikiPost[]>;

    /** Get posts assigned to this agent */
    assigned(): Promise<WikiPost[]>;

    /** Search posts */
    search(query: string): Promise<WikiPost[]>;

    /** Get a wiki page */
    page(path: string): Promise<WikiPage | undefined>;
  };
}
```

The `wiki.post()` and `wiki.reply()` methods automatically set `author` to `ctx.agentName`.

---

## Tests (`src/wiki/__tests__/wiki-store.test.ts`)

```typescript
import { WikiStore } from '../wiki-store.js';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MessageBus } from '../../bus/bus.js';

describe('WikiStore', () => {
  let store: WikiStore;
  let bus: MessageBus;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'wiki-test-'));
    bus = new MessageBus();
    store = new WikiStore(tempDir, bus);
    await store.init();
  });

  afterEach(async () => {
    await bus.drain();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('init', () => {
    test('creates directory structure');
    test('is idempotent (safe to call multiple times)');
  });

  describe('createPost', () => {
    test('creates issue post with all fields');
    test('creates report post');
    test('creates proposal post');
    test('creates announcement post');
    test('generates unique ID from timestamp');
    test('writes file to correct subdirectory');
    test('file content has valid frontmatter');
    test('applies default status (open)');
    test('applies default priority (medium)');
    test('publishes wiki.post.created event to bus');
    test('publishes wiki.issue.assigned event when assignee set');
    test('works without bus (bus is optional)');
  });

  describe('getPost', () => {
    test('retrieves post by ID');
    test('returns undefined for non-existent ID');
    test('parses frontmatter correctly');
    test('parses content body');
    test('parses replies');
    test('handles post with no replies');
  });

  describe('updatePost', () => {
    test('updates status');
    test('updates priority');
    test('updates assignee');
    test('updates tags');
    test('updates modifiedAt timestamp');
    test('preserves unchanged fields');
    test('publishes wiki.post.updated event');
    test('publishes wiki.issue.assigned when assignee changes');
    test('publishes wiki.issue.resolved when status becomes resolved');
    test('throws for non-existent post');
  });

  describe('addReply', () => {
    test('adds reply to existing post');
    test('multiple replies are ordered chronologically');
    test('updates modifiedAt');
    test('publishes wiki.post.replied event');
    test('throws for non-existent post');
  });

  describe('listPosts', () => {
    test('returns all posts when no filter');
    test('filters by type');
    test('filters by status');
    test('filters by author');
    test('filters by assignee');
    test('filters by tags (any match)');
    test('filters by priority');
    test('filters by since (created after)');
    test('applies limit');
    test('applies offset');
    test('sorts by createdAt descending');
    test('returns empty array when no matches');
    test('combines multiple filters (AND logic)');
  });

  describe('search', () => {
    test('finds posts by title');
    test('finds posts by content');
    test('finds posts by tag');
    test('case-insensitive search');
    test('respects limit');
    test('returns empty for no matches');
  });

  describe('createPage', () => {
    test('creates page at path');
    test('creates parent directories');
    test('publishes wiki.page.created event');
    test('rejects path traversal (../)');
    test('rejects absolute paths');
  });

  describe('getPage', () => {
    test('retrieves page by path');
    test('returns undefined for non-existent path');
  });

  describe('updatePage', () => {
    test('updates page content');
    test('updates modifiedAt');
    test('publishes wiki.page.updated');
    test('throws for non-existent page');
  });

  describe('listPages', () => {
    test('returns all pages');
    test('returns pages from nested directories');
    test('returns empty for no pages');
  });

  describe('rendering', () => {
    test('round-trips post through render and parse');
    test('preserves content with special characters');
    test('preserves multi-line content');
    test('preserves replies through round-trip');
    test('handles empty content body');
  });
});
```

### Expected Test Count: ~55-60 tests

---

## Implementation Notes

### Frontmatter Parsing with gray-matter

```typescript
import matter from 'gray-matter';

// Parse
const { data, content } = matter(fileContent);
// data = frontmatter as object
// content = body after frontmatter

// Stringify
const output = matter.stringify(bodyContent, frontmatterObject);
```

### Reply Parsing Strategy

Replies are stored inline in the post body, separated by a `---` delimiter and formatted as markdown headings:

```
### agent-name — 2026-03-15T12:00:00.000Z

Reply content here...
```

Parsing algorithm:
1. Split body on `---` (horizontal rule) — first part is content, rest is replies section
2. In replies section, split on `### ` pattern
3. Each reply chunk: extract author and timestamp from the heading, rest is content
4. Trim whitespace from each reply's content

### File Naming

Post files are named: `{id}-{slug}.md`

Example: `20260315-103045-email-sync-failing.md`

The ID (`20260315-103045`) is the primary lookup key. The slug is for human readability. When looking up by ID, we search for files with names starting with the ID prefix.

### Concurrency

For v1, we use simple sequential file operations (no mutex). Rationale:
- Agent processes are typically single-threaded
- Cron jobs are serialized by the scheduler
- File writes are atomic enough for our use case (write to temp, rename)

If concurrent access becomes an issue, we can add per-file mutex locking later (like Agent Board does).

### Path Security

Wiki pages support nested paths (e.g., `architecture/overview`). We must validate:
- No `..` segments (path traversal)
- No absolute paths (starting with `/`)
- No null bytes
- Resolve the final path and verify it's still within `wiki/pages/`
