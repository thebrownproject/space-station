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
