import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueueService, type WorkflowJob } from './queue.service';

test('Redis submissions honor an explicit single attempt for remote side effects', async () => {
  const service = new QueueService();
  const submissions: { job: WorkflowJob; attempts: number }[] = [];
  const fakeQueue = { add: async (_name: string, job: WorkflowJob, options: { attempts: number }) => { submissions.push({ job, attempts: options.attempts }); } };
  Object.assign(service, { queue: fakeQueue });
  const job = { workflowId: 'workflow', executionId: 'execution' };
  await service.enqueue(job, async () => { throw new Error('Local runner must not execute'); });
  await service.enqueue({ ...job, executionId: 'actor-execution' }, async () => { throw new Error('Local runner must not execute'); }, { attempts: 1 });
  assert.deepEqual(submissions.map(({ attempts }) => attempts), [3, 1]);
});
