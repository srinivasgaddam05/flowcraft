import { Worker } from 'bullmq';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WorkflowsService } from './workflows.service';
import type { WorkflowJob } from './queue.service';
import { redisEnabled } from './config';

async function startWorker(): Promise<void> {
  if (!redisEnabled) throw new Error('Redis is disabled. Set DEMO_MODE=false and REDIS_URL to start the workflow worker');
  process.env.FLOWCRAFT_WORKER = 'true';
  const app = await NestFactory.createApplicationContext(AppModule);
  const workflows = app.get(WorkflowsService);
  const worker = new Worker<WorkflowJob>('workflow-execution', async (job) => workflows.runQueued(job.data.workflowId, job.data.executionId, job.data.triggerData, job.data.triggerNodeId), { connection: { url: process.env.REDIS_URL } });
  worker.on('completed', (job) => console.log(JSON.stringify({ event: 'queue.completed', jobId: job.id })));
  worker.on('failed', (job, error) => console.error(JSON.stringify({ event: 'queue.failed', jobId: job?.id, error: error.message })));
  const shutdown = async (): Promise<void> => { await worker.close(); await app.close(); process.exit(0); };
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
}
void startWorker();