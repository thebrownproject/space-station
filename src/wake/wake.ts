import { EventEmitter } from 'eventemitter3';
import type { AgentCard } from '../types/agent.js';
import type { BusMessage } from '../types/message.js';
import type { AgentRegistry } from '../registry/registry.js';
import type { MessageBus } from '../bus/bus.js';

export interface WakeEvent {
  agentId: string;
  agentName: string;
  reason: string;
  triggerMessage?: BusMessage;
  timestamp: string;
}

interface WakeManagerEvents {
  wake: (event: WakeEvent) => void;
  error: (err: Error) => void;
}

export type WakeHandler = (agent: AgentCard, event: WakeEvent) => void | Promise<void>;

/**
 * Wake/Event system — monitors the message bus for events that match
 * registered agents' wake patterns, and triggers wake-up callbacks.
 *
 * This is the "agents waking each other up" mechanic. When Agent A
 * publishes to "billing.invoice.created", any agent whose wake patterns
 * include "billing.>" or "billing.invoice.*" gets woken up.
 */
export class WakeManager extends EventEmitter<WakeManagerEvents> {
  private registry: AgentRegistry;
  private bus: MessageBus;
  private wakeHandlers: Map<string, WakeHandler> = new Map();
  private wakeLog: WakeEvent[] = [];
  private maxLog: number;
  private listening = false;
  private messageHandler?: (msg: BusMessage) => void;

  constructor(
    registry: AgentRegistry,
    bus: MessageBus,
    options: { maxLog?: number } = {},
  ) {
    super();
    this.registry = registry;
    this.bus = bus;
    this.maxLog = options.maxLog ?? 1000;
  }

  /**
   * Start listening for wake events on the bus.
   * Call this after agents are registered with their wake patterns.
   */
  start(): void {
    if (this.listening) return;
    this.listening = true;

    this.messageHandler = (msg: BusMessage) => {
      // Don't wake on reply/heartbeat/wake messages (wake filtered to prevent cascades)
      if (msg.type === 'reply' || msg.type === 'heartbeat' || msg.type === 'wake') return;
      this.checkWakePatterns(msg);
    };
    this.bus.on('message', this.messageHandler);
  }

  stop(): void {
    this.listening = false;
    if (this.messageHandler) {
      this.bus.off('message', this.messageHandler);
      this.messageHandler = undefined;
    }
  }

  /**
   * Register a handler that gets called when a specific agent is woken up.
   * If no handler is registered, the wake event is still logged and emitted.
   */
  onWake(agentIdOrName: string, handler: WakeHandler): void {
    const agent = this.registry.resolve(agentIdOrName);
    if (!agent) {
      throw new Error(`Agent "${agentIdOrName}" not found in registry`);
    }
    this.wakeHandlers.set(agent.id, handler);
  }

  /** Remove a wake handler */
  removeHandler(agentIdOrName: string): boolean {
    const agent = this.registry.resolve(agentIdOrName);
    if (!agent) return false;
    return this.wakeHandlers.delete(agent.id);
  }

  /**
   * Manually wake an agent with a reason string.
   */
  async wake(agentIdOrName: string, reason: string): Promise<WakeEvent> {
    const agent = this.registry.resolve(agentIdOrName);
    if (!agent) {
      throw new Error(`Agent "${agentIdOrName}" not found in registry`);
    }

    const event: WakeEvent = {
      agentId: agent.id,
      agentName: agent.name,
      reason,
      timestamp: new Date().toISOString(),
    };

    // Update agent status
    this.registry.updateStatus(agent.id, 'online');

    // Publish wake message on the bus
    this.bus.publish(`_wake.${agent.name}`, { reason }, {
      from: 'system',
      to: agent.id,
      type: 'wake',
    });

    this.recordWakeEvent(event);
    await this.invokeHandler(agent, event);
    this.emit('wake', event);

    return event;
  }

  /** Get wake event history */
  getLog(agentId?: string, limit = 50): WakeEvent[] {
    let log = this.wakeLog;
    if (agentId) {
      log = log.filter((e) => e.agentId === agentId);
    }
    return log.slice(-limit);
  }

  private checkWakePatterns(msg: BusMessage): void {
    const matchingAgents = this.registry.findByWakePattern(msg.subject);

    for (const agent of matchingAgents) {
      // Don't wake an agent from its own messages
      if (agent.id === msg.from || agent.name === msg.from) continue;
      // Don't wake agents that are already busy or online
      if (agent.status === 'busy' || agent.status === 'online') continue;

      const event: WakeEvent = {
        agentId: agent.id,
        agentName: agent.name,
        reason: `Pattern match on "${msg.subject}"`,
        triggerMessage: msg,
        timestamp: new Date().toISOString(),
      };

      this.registry.updateStatus(agent.id, 'online');
      this.recordWakeEvent(event);
      this.invokeHandler(agent, event).catch((err) => {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      });
      this.emit('wake', event);
    }
  }

  private async invokeHandler(agent: AgentCard, event: WakeEvent): Promise<void> {
    const handler = this.wakeHandlers.get(agent.id);
    if (handler) {
      await handler(agent, event);
    }
  }

  private recordWakeEvent(event: WakeEvent): void {
    this.wakeLog.push(event);
    if (this.wakeLog.length > this.maxLog) {
      this.wakeLog = this.wakeLog.slice(-this.maxLog);
    }
  }
}
