/**
 * Webhook notification system.
 * Sends HTTP POST requests when nodes are created/updated/deleted.
 *
 * Configuration via webhooks.yaml in project root:
 * ```yaml
 * webhooks:
 *   - url: https://hooks.slack.com/services/xxx
 *     events: [node.created, node.updated]
 *     filter:
 *       type: task
 *       priority: [high, critical]
 *   - url: http://localhost:9000/webhook
 *     events: [node.created, node.updated, node.deleted]
 * ```
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface WebhookConfig {
  url: string;
  events: string[];
  filter?: {
    type?: string | string[];
    priority?: string | string[];
    author?: string | string[];
  };
  secret?: string;
}

export interface WebhookPayload {
  event: string;
  timestamp: string;
  node: {
    id: string;
    type: string;
    title: string | null;
    path: string | null;
    author: string | null;
    status: string | null;
    priority: string | null;
    assignee: string | null;
    tags: string[];
  };
}

let webhooks: WebhookConfig[] | null = null;

function loadWebhooks(): WebhookConfig[] {
  if (webhooks !== null) return webhooks;

  const configPath = join(process.cwd(), 'webhooks.yaml');
  if (!existsSync(configPath)) {
    webhooks = [];
    return webhooks;
  }

  try {
    // Dynamic import to avoid loading yaml when not needed
    const { parse } = require('yaml');
    const content = readFileSync(configPath, 'utf-8');
    const config = parse(content);
    webhooks = (config?.webhooks as WebhookConfig[]) ?? [];
  } catch {
    webhooks = [];
  }

  return webhooks;
}

function matchesFilter(hook: WebhookConfig, node: WebhookPayload['node']): boolean {
  if (!hook.filter) return true;

  if (hook.filter.type) {
    const types = Array.isArray(hook.filter.type) ? hook.filter.type : [hook.filter.type];
    if (!types.includes(node.type)) return false;
  }

  if (hook.filter.priority) {
    const priorities = Array.isArray(hook.filter.priority) ? hook.filter.priority : [hook.filter.priority];
    if (!node.priority || !priorities.includes(node.priority)) return false;
  }

  if (hook.filter.author) {
    const authors = Array.isArray(hook.filter.author) ? hook.filter.author : [hook.filter.author];
    if (!node.author || !authors.includes(node.author)) return false;
  }

  return true;
}

/**
 * Send webhook notifications for a node event.
 * Non-blocking: errors are logged but don't throw.
 */
export async function notifyWebhooks(event: string, node: WebhookPayload['node']): Promise<void> {
  const hooks = loadWebhooks();
  if (hooks.length === 0) return;

  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    node,
  };

  const promises = hooks
    .filter(hook => hook.events.includes(event) && matchesFilter(hook, node))
    .map(async (hook) => {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'User-Agent': 'SpaceStation/0.3.0',
        };
        if (hook.secret) {
          // Simple HMAC signature for verification
          const { createHmac } = await import('node:crypto');
          const body = JSON.stringify(payload);
          const signature = createHmac('sha256', hook.secret).update(body).digest('hex');
          headers['X-SpaceStation-Signature'] = signature;
        }

        await fetch(hook.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(5000),
        });
      } catch (err) {
        // Log but don't throw - webhooks should never block the main flow
        console.error(`[webhook] Failed to notify ${hook.url}: ${err instanceof Error ? err.message : err}`);
      }
    });

  await Promise.allSettled(promises);
}

/**
 * Reload webhook configuration (useful after editing webhooks.yaml).
 */
export function reloadWebhooks(): void {
  webhooks = null;
}
