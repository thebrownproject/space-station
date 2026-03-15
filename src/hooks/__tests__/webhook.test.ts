import { notifyWebhooks, reloadWebhooks } from '../webhook.js';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const WEBHOOK_CONFIG_PATH = join(process.cwd(), 'webhooks.yaml');
let originalExists = false;
let originalContent = '';

function writeConfig(yaml: string) {
  writeFileSync(WEBHOOK_CONFIG_PATH, yaml, 'utf-8');
  reloadWebhooks();
}

function cleanupConfig() {
  if (originalExists) {
    writeFileSync(WEBHOOK_CONFIG_PATH, originalContent, 'utf-8');
  } else if (existsSync(WEBHOOK_CONFIG_PATH)) {
    unlinkSync(WEBHOOK_CONFIG_PATH);
  }
  reloadWebhooks();
}

const sampleNode = {
  id: 'test-123',
  type: 'task',
  title: 'Test Task',
  path: 'engineering/test-task',
  author: 'test-agent',
  status: 'open',
  priority: 'high',
  assignee: 'reviewer',
  tags: ['test'],
};

describe('Webhook System', () => {
  beforeAll(() => {
    if (existsSync(WEBHOOK_CONFIG_PATH)) {
      originalExists = true;
      originalContent = require('node:fs').readFileSync(WEBHOOK_CONFIG_PATH, 'utf-8');
    }
  });

  afterAll(() => {
    cleanupConfig();
  });

  afterEach(() => {
    cleanupConfig();
  });

  test('does nothing when no config file exists', async () => {
    reloadWebhooks();
    // Should not throw
    await notifyWebhooks('node.created', sampleNode);
  });

  test('does nothing when config has no webhooks', async () => {
    writeConfig('webhooks: []');
    await notifyWebhooks('node.created', sampleNode);
  });

  test('does nothing when event does not match', async () => {
    writeConfig(`
webhooks:
  - url: http://localhost:9999/test
    events: [node.deleted]
`);
    // node.created should not trigger a node.deleted webhook
    await notifyWebhooks('node.created', sampleNode);
  });

  test('filters by type', async () => {
    writeConfig(`
webhooks:
  - url: http://localhost:9999/test
    events: [node.created]
    filter:
      type: report
`);
    // Task should not trigger a report-only webhook
    await notifyWebhooks('node.created', sampleNode);
  });

  test('filters by priority', async () => {
    writeConfig(`
webhooks:
  - url: http://localhost:9999/test
    events: [node.created]
    filter:
      priority: [critical]
`);
    // High priority should not trigger a critical-only webhook
    await notifyWebhooks('node.created', sampleNode);
  });

  test('matches when filter allows the type', async () => {
    writeConfig(`
webhooks:
  - url: http://localhost:9999/test
    events: [node.created]
    filter:
      type: task
`);
    // This would try to send a webhook (will fail because no server, but should not throw)
    await notifyWebhooks('node.created', sampleNode);
  });

  test('reloadWebhooks clears cached config', async () => {
    writeConfig('webhooks: []');
    reloadWebhooks();
    // After reload, config should be re-read
    await notifyWebhooks('node.created', sampleNode);
  });
});
