import type { AgentCard, AgentRegistration } from '../types/agent.js';
import type { BusMessage } from '../types/message.js';
import type { MemoryEntry, MemoryScope } from '../types/memory.js';
import type { WakeEvent } from '../wake/index.js';
import { AgentBusPlatform, getPlatform } from '../platform.js';

type MessageHandler = (msg: BusMessage, ctx: AgentContext) => void | Promise<void>;
type WakeCallback = (event: WakeEvent, ctx: AgentContext) => void | Promise<void>;

/**
 * High-level SDK for building agents that connect to the AgentBus.
 *
 * Usage:
 *   const agent = new AgentBuilder('billing-agent')
 *     .description('Handles all billing operations')
 *     .capabilities(['invoice', 'refund', 'payment-status'])
 *     .wakeOn(['billing.>'])
 *     .onMessage('billing.invoice.created', async (msg, ctx) => {
 *       const result = await processInvoice(msg.payload);
 *       ctx.memory.set('last-invoice', result);
 *     })
 *     .onWake(async (event, ctx) => {
 *       console.log(`Woke up: ${event.reason}`);
 *     })
 *     .build();
 *
 *   await agent.start();
 */
export class AgentBuilder {
  private registration: AgentRegistration;
  private messageHandlers: Map<string, MessageHandler> = new Map();
  private wakeCallback?: WakeCallback;
  private platform?: AgentBusPlatform;

  constructor(name: string) {
    this.registration = {
      name,
      description: '',
      capabilities: [],
      wakePatterns: [],
    };
  }

  description(desc: string): this {
    this.registration.description = desc;
    return this;
  }

  version(ver: string): this {
    this.registration.version = ver;
    return this;
  }

  capabilities(caps: string[]): this {
    this.registration.capabilities = caps;
    return this;
  }

  wakeOn(patterns: string[]): this {
    this.registration.wakePatterns = patterns;
    return this;
  }

  endpoint(url: string): this {
    this.registration.endpoint = url;
    return this;
  }

  metadata(data: Record<string, unknown>): this {
    this.registration.metadata = data;
    return this;
  }

  /** Register a handler for messages matching a subject pattern */
  onMessage(subject: string, handler: MessageHandler): this {
    this.messageHandlers.set(subject, handler);
    return this;
  }

  /** Register a callback for when this agent gets woken up */
  onWake(callback: WakeCallback): this {
    this.wakeCallback = callback;
    return this;
  }

  /** Use a specific platform instance instead of the singleton */
  usePlatform(platform: AgentBusPlatform): this {
    this.platform = platform;
    return this;
  }

  build(): Agent {
    return new Agent(
      this.registration,
      this.messageHandlers,
      this.wakeCallback,
      this.platform,
    );
  }
}

/**
 * A running agent instance, created via AgentBuilder.
 */
export class Agent {
  private card?: AgentCard;
  private platform!: AgentBusPlatform;
  private explicitPlatform?: AgentBusPlatform;
  private registration: AgentRegistration;
  private messageHandlers: Map<string, MessageHandler>;
  private wakeCallback?: WakeCallback;
  private running = false;

  constructor(
    registration: AgentRegistration,
    messageHandlers: Map<string, MessageHandler>,
    wakeCallback: WakeCallback | undefined,
    platform?: AgentBusPlatform,
  ) {
    this.registration = registration;
    this.messageHandlers = messageHandlers;
    this.wakeCallback = wakeCallback;
    this.explicitPlatform = platform;
  }

  /** Start the agent: register, subscribe to subjects, set up wake handler */
  async start(): Promise<AgentCard> {
    if (this.running) {
      throw new Error(`Agent "${this.registration.name}" is already running`);
    }

    // Resolve the platform (async if using singleton)
    this.platform = this.explicitPlatform ?? await getPlatform();

    // Register with the registry
    this.card = this.platform.registry.register(this.registration);

    // Subscribe to message subjects
    const ctx = this.createContext();
    for (const [subject, handler] of this.messageHandlers) {
      this.platform.bus.subscribe(subject, this.card.id, (msg) => {
        Promise.resolve(handler(msg, ctx)).catch((err: unknown) => {
          console.error(`[${this.card!.name}] Error handling ${msg.subject}:`, err);
        });
      });
    }

    // Subscribe to direct ask messages
    this.platform.bus.subscribe(`_ask.${this.card.name}`, this.card.id, (msg) => {
      // If there's a handler for _ask, use it; otherwise auto-reply
      const handler = this.messageHandlers.get(`_ask.${this.card!.name}`);
      if (handler) {
        Promise.resolve(handler(msg, ctx)).catch((err: unknown) => {
          console.error(`[${this.card!.name}] Error handling ask:`, err);
        });
      }
    });

    // Register wake handler
    if (this.wakeCallback) {
      this.platform.wake.onWake(this.card.id, (_agent, event) => {
        return this.wakeCallback!(event, ctx);
      });
    }

    this.running = true;
    this.platform.saveState();

    return this.card;
  }

  /** Stop the agent: unregister, clean up subscriptions */
  async stop(): Promise<void> {
    if (!this.running || !this.card) return;

    this.platform.bus.unsubscribeAll(this.card.id);
    this.platform.wake.removeHandler(this.card.id);
    this.platform.registry.updateStatus(this.card.id, 'offline');
    this.platform.saveState();

    this.running = false;
  }

  /** Get the agent's card */
  getCard(): AgentCard | undefined {
    return this.card;
  }

  /** Check if the agent is running */
  isRunning(): boolean {
    return this.running;
  }

  private createContext(): AgentContext {
    const platform = this.platform;
    const card = () => this.card!;

    return {
      get agentId() {
        return card().id;
      },
      get agentName() {
        return card().name;
      },

      emit(subject: string, payload: unknown) {
        return platform.bus.publish(subject, payload, {
          from: card().id,
          type: 'event',
        });
      },

      async ask(agentName: string, message: string, timeout?: number) {
        return platform.bus.request(`_ask.${agentName}`, { message }, {
          from: card().id,
          timeout,
        });
      },

      reply(originalMessage: BusMessage, payload: unknown) {
        return platform.bus.reply(originalMessage, payload, card().id);
      },

      memory: {
        set(key: string, value: unknown, opts?: { scope?: MemoryScope; tags?: string[]; ttl?: number }) {
          return platform.memory.set(key, value, {
            ...opts,
            agentId: opts?.scope === 'agent' ? card().id : undefined,
          });
        },
        get(key: string, scope?: MemoryScope) {
          return platform.memory.get(key, {
            scope: scope ?? 'shared',
            agentId: scope === 'agent' ? card().id : undefined,
          });
        },
        search(query: string, limit?: number) {
          return platform.memory.query({ search: query, limit });
        },
      },

      /** Look up another agent in the registry */
      findAgent(nameOrId: string) {
        return platform.registry.resolve(nameOrId);
      },

      /** Find agents by capability */
      findByCapability(capability: string) {
        return platform.registry.findByCapability(capability);
      },
    };
  }
}

/**
 * Context object passed to message handlers and wake callbacks.
 * Provides convenient access to bus, memory, and registry operations
 * scoped to the current agent.
 */
export interface AgentContext {
  readonly agentId: string;
  readonly agentName: string;

  /** Publish an event to a subject */
  emit(subject: string, payload: unknown): BusMessage;

  /** Send a request to another agent and wait for a reply */
  ask(agentName: string, message: string, timeout?: number): Promise<BusMessage>;

  /** Reply to an incoming request message */
  reply(originalMessage: BusMessage, payload: unknown): BusMessage;

  /** Memory operations scoped to this agent */
  memory: {
    set(
      key: string,
      value: unknown,
      opts?: { scope?: MemoryScope; tags?: string[]; ttl?: number },
    ): MemoryEntry;
    get(key: string, scope?: MemoryScope): MemoryEntry | undefined;
    search(query: string, limit?: number): MemoryEntry[];
  };

  /** Look up another agent */
  findAgent(nameOrId: string): AgentCard | undefined;

  /** Find agents by capability */
  findByCapability(capability: string): AgentCard[];
}
