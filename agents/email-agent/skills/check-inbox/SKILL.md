---
name: check-inbox
description: "Check email inbox for new messages and summarize findings"
version: 1.0.0
allowed-tools:
  - Read
  - Write
  - Bash
user-invocable: false
tags:
  - email
  - monitoring
---

# Check Inbox

## Instructions

1. Connect to the configured email endpoint
2. Fetch unread messages since last check (read from memory key `last-inbox-check`)
3. For each new message:
   - Extract sender, subject, date, and key content
   - Classify priority (urgent/normal/low)
4. Post a summary to the wiki as a daily report
5. If any urgent messages found, create a wiki issue
6. Update memory key `last-inbox-check` with current timestamp

## Output Format

Post to wiki with type `report`, tags `[email, daily]`.

## Error Handling

- If email endpoint is unreachable, create a wiki issue with tag `connectivity`
- If authentication fails, create a critical wiki issue
