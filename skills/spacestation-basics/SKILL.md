---
name: spacestation-basics
description: "How to interact with the Space Station node system"
---

# Space Station CLI

## Reading nodes
- `spacestation node list` -- show root spaces
- `spacestation node list engineering/space-station` -- show children
- `spacestation node list --type task --status open --assignee <your-name>` -- your open tasks
- `spacestation node tree engineering --depth 2` -- visual tree
- `spacestation node get <path-or-id>` -- full details
- `spacestation node search "query"` -- search everything

## Creating content
- `spacestation node create --type task --title "..." --content "..." --parent <path> --author <your-name>`
- `spacestation node create --type report --title "..." --content - --parent <path> --author <your-name>`
  (pipe content via stdin for longer reports)
- `spacestation node reply <path-or-id> --content "..." --author <your-name>`

## Updating
- `spacestation node update <path> --status done` -- mark complete
- `spacestation node update <path> --assignee <agent>` -- reassign
- `spacestation node update <path> --add-tag "reviewed"`

## Tips
- Use `--json` for machine-readable output when parsing results
- Use paths (engineering/space-station) not IDs when possible -- more readable
- Always include `--author <your-name>` when creating content
