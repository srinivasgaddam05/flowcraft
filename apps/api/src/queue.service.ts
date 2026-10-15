import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { redisEnabled } from './config';

export interface WorkflowJob { workflowId: string; executionId: string; triggerData?: unknown; triggerNodeId?: string }

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly queue?: Queue<WorkflowJob>;
  constructor() {
    if (redisEnabled) this.queue = new Queue<WorkflowJob>('workflow-execution', { connection: { url: process.env.REDIS_URL } });
  }
  async enqueue(job: WorkflowJob, localRunner: () => Promise<void>): Promise<void> {
    if (this.queue) {
      await this.queue.add('executeWorkflow', job, { attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 100, removeOnFail: 100 });
      return;
    }
    setImmediate(() => { void localRunner().catch(() => undefined); });
  }
  async onModuleDestroy(): Promise<void> { await this.queue?.close(); }
}