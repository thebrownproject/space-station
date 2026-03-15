import type { AgentCard } from '../types/agent.js';
import type { BusMessage } from '../types/message.js';

/** Format data as a simple ASCII table */
export function formatTable(headers: string[], rows: string[][]): string {
  const colWidths = headers.map((h, i) => {
    const maxRow = rows.reduce((max, row) => Math.max(max, (row[i] ?? '').length), 0);
    return Math.max(h.length, maxRow);
  });

  const sep = colWidths.map((w) => '-'.repeat(w + 2)).join('+');
  const headerRow = headers.map((h, i) => ` ${h.padEnd(colWidths[i])} `).join('|');

  const dataRows = rows.map((row) =>
    row.map((cell, i) => ` ${(cell ?? '').padEnd(colWidths[i])} `).join('|'),
  );

  return [headerRow, sep, ...dataRows].join('\n');
}

/** Format an agent card for display */
export function formatAgentCard(card: AgentCard): string {
  const lines = [
    `  Name:         ${card.name}`,
    `  ID:           ${card.id}`,
    `  Status:       ${card.status}`,
    `  Version:      ${card.version}`,
    `  Description:  ${card.description}`,
    `  Capabilities: ${card.capabilities.map((c) => c.name).join(', ') || 'none'}`,
    `  Wake on:      ${card.wakePatterns.join(', ') || 'none'}`,
    `  Registered:   ${card.registeredAt}`,
    `  Last seen:    ${card.lastSeenAt}`,
  ];

  if (card.endpoint) {
    lines.push(`  Endpoint:     ${card.endpoint}`);
  }

  return lines.join('\n');
}

/** Format a bus message for display */
export function formatMessage(msg: BusMessage): string {
  const time = new Date(msg.timestamp).toLocaleTimeString();
  const payload =
    typeof msg.payload === 'string'
      ? msg.payload
      : JSON.stringify(msg.payload, null, 2);

  return `[${time}] ${msg.type} ${msg.subject} (from: ${msg.from})\n${payload}`;
}

/** Pretty-print JSON */
export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/** Relative time string from ISO timestamp. */
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Format milliseconds as human-readable duration. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s`;
}

/** Standard CLI error handler. */
export function handleCliError(err: unknown): void {
  console.error(`Error: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
}
