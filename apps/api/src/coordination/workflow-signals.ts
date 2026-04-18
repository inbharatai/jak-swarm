/**
 * Distributed workflow signals (pause, stop, resume).
 *
 * Uses Redis pub/sub so signals reach the instance actually running the workflow.
 * Falls back to in-memory signals for local dev.
 *
 * Architecture:
 *   1. API instance receives pause/stop request
 *   2. Signal published to Redis channel `jak:workflow:signals`
 *   3. ALL instances receive the signal via subscription
 *   4. Instance running the workflow acts on it
 *   5. Instance NOT running it ignores it (no-op)
 */

export interface WorkflowSignal {
  // 'unpause' is broadcast so whichever instance holds the paused workflow can resume it.
  // 'resume' is reserved for resume-after-approval flows (Phase 1b).
  type: 'pause' | 'unpause' | 'stop' | 'resume';
  workflowId: string;
  issuedBy: string; // instance ID or user ID
  timestamp: string;
}

export interface WorkflowSignalBus {
  publish(signal: WorkflowSignal): Promise<void>;
  subscribe(handler: (signal: WorkflowSignal) => void): void;
  close(): Promise<void>;
}

// ─── Redis Implementation ───────────────────────────────────────────────────

const SIGNAL_CHANNEL = 'jak:workflow:signals';

export class RedisWorkflowSignalBus implements WorkflowSignalBus {
  private subscriber: { subscribe: (ch: string) => Promise<unknown>; on: (event: string, fn: (...args: unknown[]) => void) => void; quit: () => Promise<unknown> };
  private publisher: { publish: (ch: string, msg: string) => Promise<unknown> };
  private handlers: Array<(signal: WorkflowSignal) => void> = [];

  constructor(
    publisherRedis: unknown,
    subscriberRedis: unknown, // Must be a SEPARATE Redis connection for pub/sub
  ) {
    this.publisher = publisherRedis as RedisWorkflowSignalBus['publisher'];
    this.subscriber = subscriberRedis as RedisWorkflowSignalBus['subscriber'];

    this.subscriber.subscribe(SIGNAL_CHANNEL).catch((err: unknown) => {
      console.error('[signal-bus] Failed to subscribe to Redis channel:', err);
    });

    this.subscriber.on('message', (_channel: unknown, message: unknown) => {
      try {
        const signal = JSON.parse(String(message)) as WorkflowSignal;
        for (const handler of this.handlers) {
          handler(signal);
        }
      } catch {
        // Malformed message — ignore
      }
    });
  }

  async publish(signal: WorkflowSignal): Promise<void> {
    await this.publisher.publish(SIGNAL_CHANNEL, JSON.stringify(signal));
  }

  subscribe(handler: (signal: WorkflowSignal) => void): void {
    this.handlers.push(handler);
  }

  async close(): Promise<void> {
    await this.subscriber.quit();
  }
}

// ─── In-Memory Implementation (local dev) ───────────────────────────────────

export class InMemoryWorkflowSignalBus implements WorkflowSignalBus {
  private handlers: Array<(signal: WorkflowSignal) => void> = [];

  async publish(signal: WorkflowSignal): Promise<void> {
    // In-memory: deliver directly to local handlers
    for (const handler of this.handlers) {
      handler(signal);
    }
  }

  subscribe(handler: (signal: WorkflowSignal) => void): void {
    this.handlers.push(handler);
  }

  async close(): Promise<void> {
    this.handlers = [];
  }
}
