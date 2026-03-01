import { Command } from 'commander';
import { getPlatform } from '../../platform.js';
import { formatTable, formatJson, formatMessage } from '../formatters.js';

export function registerBusCommands(program: Command): void {
  // agentbus emit
  program
    .command('emit')
    .description('Publish an event to a subject')
    .argument('<subject>', 'NATS-style subject (e.g., "billing.invoice.created")')
    .option('-p, --payload <json>', 'JSON payload', '{}')
    .option('-f, --from <agent>', 'Sender agent name or ID', 'cli')
    .option('--json', 'Output as JSON')
    .action((subject, opts) => {
      const platform = getPlatform();

      let payload: unknown;
      try {
        payload = JSON.parse(opts.payload);
      } catch {
        console.error('Error: --payload must be valid JSON');
        process.exitCode = 1;
        return;
      }

      const msg = platform.bus.publish(subject, payload, {
        from: opts.from,
        type: 'event',
      });

      if (opts.json) {
        console.log(formatJson(msg));
      } else {
        console.log(`Event published to "${subject}" (id: ${msg.id.slice(0, 8)})`);
      }
    });

  // agentbus ask
  program
    .command('ask')
    .description('Send a request to an agent and wait for a reply')
    .argument('<agent>', 'Target agent name or ID')
    .argument('<message>', 'The message/question to send')
    .option('-t, --timeout <ms>', 'Timeout in milliseconds', '30000')
    .option('-f, --from <agent>', 'Sender agent name or ID', 'cli')
    .option('--json', 'Output as JSON')
    .action(async (agent, message, opts) => {
      const platform = getPlatform();

      const target = platform.registry.resolve(agent);
      if (!target) {
        console.error(`Agent "${agent}" not found. Use "agentbus ls" to see registered agents.`);
        process.exitCode = 1;
        return;
      }

      const subject = `_ask.${target.name}`;

      try {
        console.log(`Asking ${target.name}...`);
        const reply = await platform.bus.request(subject, { message }, {
          from: opts.from,
          to: target.id,
          timeout: parseInt(opts.timeout, 10),
        });

        if (opts.json) {
          console.log(formatJson(reply));
        } else {
          console.log(formatMessage(reply));
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });

  // agentbus logs
  program
    .command('logs')
    .description('Show message history')
    .option('-a, --agent <name>', 'Filter by agent name or ID')
    .option('-s, --subject <pattern>', 'Filter by subject pattern')
    .option('-n, --limit <n>', 'Number of messages to show', '20')
    .option('--type <type>', 'Filter by message type (event, request, reply, wake)')
    .option('--since <timestamp>', 'Show messages since timestamp')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      const platform = getPlatform();

      const messages = platform.bus.queryHistory(
        {
          from: opts.agent,
          subject: opts.subject,
          type: opts.type,
          since: opts.since,
        },
        parseInt(opts.limit, 10),
      );

      if (opts.json) {
        console.log(formatJson(messages));
        return;
      }

      if (messages.length === 0) {
        console.log('No messages found.');
        return;
      }

      const rows = messages.map((m) => [
        new Date(m.timestamp).toLocaleTimeString(),
        m.type,
        m.subject,
        m.from,
        typeof m.payload === 'string'
          ? m.payload.slice(0, 60)
          : JSON.stringify(m.payload).slice(0, 60),
      ]);

      console.log(formatTable(['Time', 'Type', 'Subject', 'From', 'Payload'], rows));
    });

  // agentbus subscribe
  program
    .command('subscribe')
    .description('Subscribe to messages on a subject and print them')
    .argument('<subject>', 'NATS-style subject pattern')
    .option('-a, --agent <name>', 'Subscribe as this agent', 'cli')
    .option('-q, --queue <group>', 'Queue group for load balancing')
    .option('--json', 'Output as JSON')
    .action((subject, opts) => {
      const platform = getPlatform();

      console.log(`Subscribing to "${subject}"... (Ctrl+C to stop)`);

      platform.bus.subscribe(subject, opts.agent, (msg) => {
        if (opts.json) {
          console.log(formatJson(msg));
        } else {
          console.log(formatMessage(msg));
        }
      }, opts.queue);

      // Keep the process alive
      process.on('SIGINT', () => {
        console.log('\nUnsubscribed.');
        process.exit(0);
      });

      // Prevent exit
      setInterval(() => {}, 1 << 30);
    });
}
