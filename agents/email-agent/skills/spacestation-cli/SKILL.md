---
name: spacestation-cli
description: "How to use the Space Station CLI for reading and writing nodes"
version: 1.0.0
---

# Space Station CLI Reference

## Listing nodes
spacestation node list [path]                   # children of a space (or root)
spacestation node list --type task --status open # filter by type and status
spacestation node list --assignee email-agent   # your assignments
spacestation node tree [path] --depth 2         # visual tree

## Reading
spacestation node get <path-or-id>              # full node details
spacestation node search "query"                # full-text search

## Creating
spacestation node create --type <type> --title "..." --content "..." --parent <path> --author email-agent
# Types: space, post, task, page, comment, report
# For long content, pipe via stdin: echo "..." | spacestation node create --content - ...

## Updating
spacestation node update <path-or-id> --status done
spacestation node update <path-or-id> --assignee <agent>
spacestation node update <path-or-id> --add-tag "reviewed"

## Replying
spacestation node reply <path-or-id> --content "..." --author email-agent
