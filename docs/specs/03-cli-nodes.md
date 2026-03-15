# Spec 03: CLI Node Commands

## Summary

The `agentbus node` command group is the primary API for agents. Agents interact with the shared database entirely through these CLI commands (via Claude Code's Bash tool). Commands support path-based navigation, filtering, and JSON output.

## Files to Create/Modify

```
src/cli/commands/
  node.ts                # NEW: all node subcommands
  index.ts               # MODIFY: register node commands
```

---

## Command Reference

### `agentbus node create`

Create a new node (space, post, task, page, comment, report).

```
Usage: agentbus node create [options]

Options:
  --type <type>           Node type: space|post|task|page|comment|report (required)
  --title <title>         Title (required for all except comment)
  --content <text>        Content body (markdown). Reads from stdin if "-"
  --parent <path-or-id>   Parent node (path like "engineering/space-station" or UUID)
  --author <name>         Author name (agent or human)
  --status <status>       Status: open|in-progress|review|done|closed
  --priority <level>      Priority: low|medium|high|critical
  --assignee <name>       Assign to agent or user
  --tags <tags>           Comma-separated tags
  --meta <json>           JSON metadata string
  --json                  Output created node as JSON

Examples:
  # Create a top-level space
  agentbus node create --type space --title "Engineering"

  # Create a task under a space (by path)
  agentbus node create --type task \
    --title "Fix auth bug" \
    --content "The login endpoint returns 500 on expired tokens" \
    --parent engineering/space-station \
    --author email-agent \
    --priority high \
    --assignee reviewer-agent \
    --tags "auth,bug,urgent"

  # Create a comment on a task (by ID)
  agentbus node create --type comment \
    --content "I looked into this. It's a race condition." \
    --parent abc123-def456 \
    --author reviewer-agent

  # Create a report with content from stdin
  echo "## Daily Report\n\nChecked 15 emails..." | \
    agentbus node create --type report \
      --title "Email Report 2026-03-15" \
      --content - \
      --parent engineering/space-station \
      --author email-agent

  # Create with JSON output (useful for agents to capture the ID)
  agentbus node create --type task --title "New task" --json
```

**Output (default):**
```
Created task: "Fix auth bug"
  ID:       abc123-def456-789
  Path:     engineering/space-station/fix-auth-bug
  Parent:   space-station
  Status:   open
  Priority: high
  Assignee: reviewer-agent
```

**Output (--json):**
```json
{
  "id": "abc123-def456-789",
  "type": "task",
  "title": "Fix auth bug",
  "path": "engineering/space-station/fix-auth-bug",
  "status": "open",
  "priority": "high",
  "assignee": "reviewer-agent",
  "createdAt": "2026-03-15T10:30:00.000Z"
}
```

---

### `agentbus node list`

List nodes. Without arguments, shows root-level spaces. With a path/ID, shows children of that node.

```
Usage: agentbus node list [path-or-id] [options]

Arguments:
  path-or-id              Show children of this node (optional, default: root)

Options:
  --type <type>           Filter by type
  --status <status>       Filter by status
  --author <name>         Filter by author
  --assignee <name>       Filter by assignee
  --tags <tags>           Filter by tags (comma-separated, match any)
  --priority <level>      Filter by priority
  --search <query>        Text search across title and content
  -n, --limit <n>         Max results (default: 50)
  --offset <n>            Skip first N results
  --sort <field>          Sort by: created|updated|title|priority (default: created)
  --asc                   Sort ascending (default: descending)
  --json                  Output as JSON array

Examples:
  # List root spaces
  agentbus node list

  # List children of a space
  agentbus node list engineering
  agentbus node list engineering/space-station

  # List all open tasks assigned to me
  agentbus node list --type task --status open --assignee email-agent

  # List recent reports by any agent
  agentbus node list --type report --sort created -n 10

  # Search everything
  agentbus node list --search "auth bug"

  # JSON output for programmatic use by agents
  agentbus node list engineering/space-station --type task --status open --json
```

**Output (default — root):**
```
Spaces:
  engineering       space    2 children
  career            space    3 children
  life              space    1 child
  agents            space    2 children
```

**Output (default — children of a space):**
```
engineering/space-station (12 children):
  TYPE      PRIORITY  STATUS       TITLE                        AUTHOR          UPDATED
  task      high      open         Fix auth bug                 email-agent     2m ago
  task      medium    in-progress  Add rate limiting            reviewer-agent  1h ago
  report    -         -            Daily Report Mar 15          patrol-agent    3h ago
  page      -         -            Architecture Overview        admin           2d ago
  page      -         -            API Reference                admin           5d ago
```

---

### `agentbus node tree`

Display a node and its descendants as an indented tree.

```
Usage: agentbus node tree [path-or-id] [options]

Arguments:
  path-or-id              Root of the tree (optional, default: entire tree)

Options:
  --depth <n>             Max depth to display (default: 3)
  --type <type>           Only show nodes of this type
  --json                  Output as nested JSON

Examples:
  # Full tree from root
  agentbus node tree

  # Subtree of a space
  agentbus node tree engineering/space-station --depth 2

  # Only show tasks in the tree
  agentbus node tree engineering --type task
```

**Output:**
```
engineering
├── space-station
│   ├── [task/high/open] Fix auth bug ← reviewer-agent
│   │   ├── [comment] "I looked into it..." — reviewer-agent, 2h ago
│   │   ├── [task/medium/in-progress] Fix middleware ← code-agent
│   │   │   └── [comment] "Done, PR#42" — code-agent, 30m ago
│   │   └── [page] Root cause analysis
│   ├── [report] Daily Report Mar 15 — patrol-agent, 3h ago
│   └── [page] Architecture
│       └── [page] Auth Flow
└── buildpass
    ├── [task/low/open] Update dependencies
    └── [page] Setup Guide
```

---

### `agentbus node get`

Get a single node's full details.

```
Usage: agentbus node get <path-or-id> [options]

Options:
  --json                  Output as JSON
  --with-children         Include direct children
  --with-ancestors        Include ancestor breadcrumb

Examples:
  agentbus node get engineering/space-station/fix-auth-bug
  agentbus node get abc123-def456 --json
  agentbus node get engineering/space-station --with-children
```

**Output:**
```
Task: Fix auth bug
  ID:        abc123-def456-789
  Path:      engineering/space-station/fix-auth-bug
  Status:    open
  Priority:  high
  Author:    email-agent
  Assignee:  reviewer-agent
  Tags:      auth, bug, urgent
  Created:   2026-03-15T10:30:00Z
  Updated:   2026-03-15T12:00:00Z
  Children:  3 (2 comments, 1 subtask)

  Content:
  ─────────────────────────────────
  The login endpoint returns 500 on expired tokens.
  Happens intermittently since the deploy on Mar 14.
  ─────────────────────────────────
```

---

### `agentbus node update`

Update fields on an existing node.

```
Usage: agentbus node update <path-or-id> [options]

Options:
  --title <title>         Update title
  --content <text>        Update content (use "-" for stdin)
  --status <status>       Update status
  --priority <level>      Update priority
  --assignee <name>       Update assignee
  --tags <tags>           Replace tags (comma-separated)
  --add-tag <tag>         Add a tag (without replacing)
  --meta <json>           Merge metadata
  --json                  Output updated node as JSON

Examples:
  # Mark a task as done
  agentbus node update engineering/space-station/fix-auth-bug --status done

  # Reassign
  agentbus node update abc123 --assignee code-agent

  # Add a tag
  agentbus node update abc123 --add-tag "reviewed"
```

---

### `agentbus node reply`

Shorthand for creating a comment on a node. Simpler than `node create --type comment`.

```
Usage: agentbus node reply <path-or-id> [options]

Options:
  --content <text>        Reply content (reads from stdin if "-" or if omitted)
  --author <name>         Author name (required)
  --json                  Output as JSON

Examples:
  agentbus node reply engineering/space-station/fix-auth-bug \
    --content "I looked into this. It's a race condition in the token refresh." \
    --author reviewer-agent

  # Pipe content from stdin
  echo "Fixed in PR #42. Tests passing." | \
    agentbus node reply abc123 --author code-agent
```

---

### `agentbus node search`

Full-text search across all nodes.

```
Usage: agentbus node search <query> [options]

Options:
  --type <type>           Filter results by type
  --status <status>       Filter by status
  -n, --limit <n>         Max results (default: 20)
  --json                  Output as JSON

Examples:
  agentbus node search "auth bug"
  agentbus node search "email" --type report -n 5
  agentbus node search "rate limit" --json
```

**Output:**
```
Search: "auth bug" (3 results)
  PATH                                           TYPE   TITLE                    AUTHOR
  engineering/space-station/fix-auth-bug          task   Fix auth bug             email-agent
  engineering/space-station/fix-auth-bug/root-ca  page   Root cause analysis      reviewer-agent
  engineering/buildpass/auth-token-issue           task   Auth token issue         patrol-agent
```

---

### `agentbus node delete`

Delete a node and all its descendants.

```
Usage: agentbus node delete <path-or-id> [options]

Options:
  --force                 Skip confirmation prompt
  --json                  Output result as JSON

Examples:
  agentbus node delete engineering/space-station/old-report --force
```

---

## Path Resolution

The CLI resolves `<path-or-id>` arguments as follows:

1. If it looks like a UUID (contains hyphens, 36 chars), look up by `nodes.id`
2. Otherwise, treat as a materialized path and look up by `nodes.path`
3. If not found by either, throw `Error: Node not found: <input>`

Path format: slash-separated slugs. Examples:
- `engineering` — root space
- `engineering/space-station` — nested space
- `engineering/space-station/fix-auth-bug` — task inside a space

---

## Stdin Content Support

When `--content -` is passed (or content is omitted and stdin is piped), read content from stdin. This allows agents to pipe longer content:

```bash
# Agent generates a report and pipes it
generate_report | agentbus node create --type report \
  --title "Daily Report" --content - --author email-agent --parent engineering
```

Implementation:
```typescript
async function readContent(opts: { content?: string }): Promise<string | undefined> {
  if (opts.content === '-' || (!opts.content && !process.stdin.isTTY)) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf-8');
  }
  return opts.content;
}
```

---

## Output Formatting

### Table Format (Default)

Use `cli-table3` (already a dependency) for tabular output. Columns adapt to content:
- Spaces list: NAME, TYPE, CHILDREN
- Tasks list: TYPE, PRIORITY, STATUS, TITLE, AUTHOR/ASSIGNEE, UPDATED
- Search results: PATH, TYPE, TITLE, AUTHOR

### Tree Format (`node tree`)

Use box-drawing characters (├── │ └──) for visual tree. Color-code by type:
- Spaces: bold white
- Tasks: yellow (open), green (done), red (critical priority)
- Pages: cyan
- Comments: dim
- Reports: magenta

### JSON Format (`--json`)

Raw JSON output for programmatic consumption by agents. No color, no formatting.

---

## CLI Registration (`src/cli/commands/node.ts`)

```typescript
import { Command } from 'commander';
import { createNode, getNode, getNodeByPath, updateNode, deleteNode,
         listNodes, getSubtree, searchNodes } from '../../db/queries.js';

export function registerNodeCommands(program: Command): void {
  const node = program.command('node').description('Node operations (spaces, posts, tasks, pages)');

  node.command('create')
    .description('Create a new node')
    .requiredOption('--type <type>', 'Node type: space|post|task|page|comment|report')
    .option('--title <title>', 'Title')
    .option('--content <text>', 'Content body (use "-" for stdin)')
    .option('--parent <path-or-id>', 'Parent node')
    .option('--author <name>', 'Author')
    .option('--status <status>', 'Status')
    .option('--priority <level>', 'Priority')
    .option('--assignee <name>', 'Assignee')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--meta <json>', 'JSON metadata')
    .option('--json', 'Output as JSON')
    .action(async (opts) => { /* ... */ });

  node.command('list [path-or-id]')
    .description('List nodes (default: root spaces)')
    .option('--type <type>', 'Filter by type')
    .option('--status <status>', 'Filter by status')
    .option('--author <name>', 'Filter by author')
    .option('--assignee <name>', 'Filter by assignee')
    .option('--tags <tags>', 'Filter by tags')
    .option('--priority <level>', 'Filter by priority')
    .option('--search <query>', 'Text search')
    .option('-n, --limit <n>', 'Max results', '50')
    .option('--offset <n>', 'Skip results', '0')
    .option('--sort <field>', 'Sort by: created|updated|title|priority')
    .option('--asc', 'Sort ascending')
    .option('--json', 'Output as JSON')
    .action(async (pathOrId, opts) => { /* ... */ });

  node.command('tree [path-or-id]')
    .description('Display node tree')
    .option('--depth <n>', 'Max depth', '3')
    .option('--type <type>', 'Filter by type')
    .option('--json', 'Output as JSON')
    .action(async (pathOrId, opts) => { /* ... */ });

  node.command('get <path-or-id>')
    .description('Get full node details')
    .option('--json', 'Output as JSON')
    .option('--with-children', 'Include children')
    .option('--with-ancestors', 'Include breadcrumb')
    .action(async (pathOrId, opts) => { /* ... */ });

  node.command('update <path-or-id>')
    .description('Update a node')
    .option('--title <title>')
    .option('--content <text>')
    .option('--status <status>')
    .option('--priority <level>')
    .option('--assignee <name>')
    .option('--tags <tags>')
    .option('--add-tag <tag>')
    .option('--meta <json>')
    .option('--json')
    .action(async (pathOrId, opts) => { /* ... */ });

  node.command('reply <path-or-id>')
    .description('Add a comment to a node')
    .option('--content <text>', 'Reply content (stdin if omitted)')
    .requiredOption('--author <name>', 'Author')
    .option('--json')
    .action(async (pathOrId, opts) => { /* ... */ });

  node.command('search <query>')
    .description('Search nodes')
    .option('--type <type>')
    .option('--status <status>')
    .option('-n, --limit <n>', '20')
    .option('--json')
    .action(async (query, opts) => { /* ... */ });

  node.command('delete <path-or-id>')
    .description('Delete a node and all descendants')
    .option('--force', 'Skip confirmation')
    .option('--json')
    .action(async (pathOrId, opts) => { /* ... */ });
}
```

---

## Agent Usage Patterns

### Agent SKILL.md — CLI Cheat Sheet

Each agent gets a skill that teaches it the CLI:

```markdown
---
name: agentbus-cli
description: "How to interact with the AgentBus node system"
---

# AgentBus CLI

## Reading nodes
- `agentbus node list` — show root spaces
- `agentbus node list engineering/space-station` — show children
- `agentbus node list --type task --status open --assignee <your-name>` — your open tasks
- `agentbus node tree engineering --depth 2` — visual tree
- `agentbus node get <path-or-id>` — full details
- `agentbus node search "query"` — search everything

## Creating content
- `agentbus node create --type task --title "..." --content "..." --parent <path> --author <your-name>`
- `agentbus node create --type report --title "..." --content - --parent <path> --author <your-name>`
  (pipe content via stdin for longer reports)
- `agentbus node reply <path-or-id> --content "..." --author <your-name>`

## Updating
- `agentbus node update <path> --status done` — mark complete
- `agentbus node update <path> --assignee <agent>` — reassign
- `agentbus node update <path> --add-tag "reviewed"`

## Tips
- Use `--json` for machine-readable output when parsing results
- Use paths (engineering/space-station) not IDs when possible — more readable
- Always include `--author <your-name>` when creating content
```
