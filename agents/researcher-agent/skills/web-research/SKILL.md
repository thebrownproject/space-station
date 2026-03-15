---
name: web-research
description: "Research a topic using web search and produce a structured findings report"
version: 1.0.0
allowed-tools:
  - Read
  - Write
  - Bash
  - WebSearch
  - WebFetch
tags:
  - research
  - web
  - analysis
---

# Web Research

## Instructions

1. Read the assigned task for the research topic and specific questions
2. Use WebSearch to find relevant sources (aim for 5-10 sources)
3. For the most relevant results, use WebFetch to read full content
4. Synthesize findings into a structured report

## Output Format

Post as a `page` node with the following structure:

```markdown
# [Topic Name]

## Key Takeaways
- Bullet point summary of main findings

## Detailed Findings

### [Subtopic 1]
Details with citations...

### [Subtopic 2]
Details with citations...

## Sources
- [Source Title](URL) - brief note on relevance
- [Source Title](URL) - brief note on relevance

## Confidence Level
State your confidence in the findings (high/medium/low) and note any gaps.
```

## Error Handling
- If web search returns no useful results, post what you found with a note about limitations
- If a specific URL is unreachable, note it and try alternative sources
