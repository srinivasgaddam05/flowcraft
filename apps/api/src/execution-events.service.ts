import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import Redis from 'ioredis';
import type { ExecutionEvent } from '@workflow/shared-types';
import { redisEnabled } from './config';

@Injectable()
export class ExecutionEventsService implements OnModuleDestroy {
  private readonly events = new EventEmitter();
  private readonly publisher?: Redis;
  private readonly subscriber?: Redis;
  constructor() {
    if (redisEnabled) {
      this.publisher = new Redis(process.env.REDIS_URL!);
      this.subscriber = new Redis(process.env.REDIS_URL!);
      this.publisher.on('error', () => undefined);
      this.subscriber.on('error', () => undefined);
      void this.subscriber.subscribe('flowcraft.execution-events').catch(() => undefined);
      this.subscriber.on('message', (_channel, message) => {
        try { this.events.emit('execution', JSON.parse(message) as ExecutionEvent); } catch { /* Ignore malformed notifications. */ }
      });
    }
  }
  publish(event: ExecutionEvent): void {
    if (this.publisher) void this.publisher.publish('flowcraft.execution-events', JSON.stringify(event)).catch(() => undefined);
    else this.events.emit('execution', event);
  }
  subscribe(listener: (event: ExecutionEvent) => void): () => void { this.events.on('execution', listener); return () => this.events.off('execution', listener); }
  async onModuleDestroy(): Promise<void> { this.publisher?.disconnect(); this.subscriber?.disconnect(); }
}
