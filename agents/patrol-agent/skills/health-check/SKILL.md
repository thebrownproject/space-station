---
name: health-check
description: "Review system health: open tasks, stale items, agent activity"
version: 1.0.0
tags:
  - monitoring
  - health
---

# Health Check

## Instructions

1. List all open tasks across all spaces:
   `spacestation node list --type task --status open --json`

2. List all in-progress tasks:
   `spacestation node list --type task --status in-progress --json`

3. For each task, check the `updatedAt` timestamp:
   - If older than 24 hours: flag as stale
   - If older than 72 hours: flag as critical

4. Count nodes by type and status for metrics

5. Post findings as a report with tags `[patrol, health-check]`

## Output Format

Post a report with structure:
- Total open tasks: N
- Stale tasks (24h+): N
- Critical stale (72h+): N
- Tasks by assignee: breakdown
- Recommendation: any actions needed
