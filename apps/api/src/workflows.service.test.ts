import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NodeService } from './nodes';
import type { EnqueueOptions, WorkflowJob } from './queue.service';
import { WorkflowsService } from './workflows.service';

type QueuedJob = { job: WorkflowJob; runner: () => Promise<void>; options?: EnqueueOptions };
function createService(queuedJobs: QueuedJob[] = []): WorkflowsService {
  const queue = { enqueue: async (job: WorkflowJob, runner: () => Promise<void>, options?: EnqueueOptions) => { queuedJobs.push({ job, runner, options }); } };
  const events = { publish: () => undefined };
  return new WorkflowsService({} as never, new NodeService(), queue as never, events as never);
}

const workflow = {
  name: 'Owned workflow',
  description: 'Test fixture',
  nodes: [
    { id: 'trigger', type: 'manualTrigger', name: 'Manual Trigger', position: { x: 0, y: 0 }, config: {} },
    { id: 'logger', type: 'logger', name: 'Logger', position: { x: 200, y: 0 }, config: { message: 'hello' } },
  ],
  edges: [{ id: 'trigger-to-logger', source: 'trigger', target: 'logger' }],
};

test('isolates workflow listing and reads by owner', async () => {
  const service = createService();
  const saved = await service.save(workflow, 'owner-a');

  assert.equal((await service.list('owner-a')).length, 1);
  assert.equal((await service.list('owner-b')).length, 0);
  await assert.rejects(service.get(saved.id!, 'owner-b'), { message: 'Workflow not found' });
});

test('duplicates nodes and remaps edge endpoints while retaining ownership', async () => {
  const service = createService();
  const saved = await service.save(workflow, 'owner-a');
  const copy = await service.duplicate(saved.id!, 'owner-a');

  assert.notEqual(copy.nodes[0].id, saved.nodes[0].id);
  assert.notEqual(copy.nodes[1].id, saved.nodes[1].id);
  assert.equal(copy.edges[0].source, copy.nodes[0].id);
  assert.equal(copy.edges[0].target, copy.nodes[1].id);
  assert.deepEqual(await service.list('owner-a'), [saved, copy]);
  assert.equal((await service.list('owner-b')).length, 0);
});

test('activates, deactivates, and deletes an owned workflow', async () => {
  const service = createService();
  const saved = await service.save(workflow, 'owner-a');

  assert.equal((await service.setActive(saved.id!, true, 'owner-a')).active, true);
  assert.equal((await service.setActive(saved.id!, false, 'owner-a')).active, false);
  await service.remove(saved.id!, 'owner-a');
  assert.equal((await service.list('owner-a')).length, 0);
});

test('accepts live webhook payloads only for active root webhook triggers', async () => {
  const queuedJobs: QueuedJob[] = [];
  const service = createService(queuedJobs);
  const saved = await service.save({
    name: 'Incoming webhook',
    nodes: [
      { id: 'hook', type: 'webhookTrigger', name: 'Webhook Trigger', position: { x: 0, y: 0 }, config: {} },
      { id: 'logger', type: 'logger', name: 'Logger', position: { x: 200, y: 0 }, config: {} },
    ],
    edges: [{ id: 'hook-to-logger', source: 'hook', target: 'logger' }],
  }, 'owner-a');

  await assert.rejects(service.triggerWebhook(saved.id!, 'hook', { event: 'created' }), /Activate this workflow/);
  await service.setActive(saved.id!, true, 'owner-a');
  const queued = await service.triggerWebhook(saved.id!, 'hook', { event: 'created' });

  assert.equal(queued.status, 'QUEUED');
  assert.equal(queuedJobs.length, 1);
  assert.deepEqual(queuedJobs[0].job.triggerData, { event: 'created' });
  assert.equal(queuedJobs[0].job.triggerNodeId, 'hook');
  await assert.rejects(service.triggerWebhook(saved.id!, 'logger', {}), /Webhook trigger not found/);
});

test('lists and creates five independently editable demo workflow templates', async () => {
  const service = createService();
  const templates = service.listTemplates();

  assert.equal(templates.length, 5);
  assert.deepEqual(templates.map((template) => template.id), [
    'support-ticket-triage',
    'lead-qualification',
    'feedback-insights',
    'order-intake-validation',
    'it-incident-prioritization',
  ]);

  const first = await service.instantiateTemplate('order-intake-validation', 'owner-a');
  const second = await service.instantiateTemplate('order-intake-validation', 'owner-a');

  assert.equal(first.active, false);
  assert.equal(first.nodes[0].type, 'webhookTrigger');
  assert.notEqual(first.nodes[0].id, second.nodes[0].id);
  assert.notEqual(first.edges[0].id, second.edges[0].id);
  assert.equal(first.nodes.some((node) => node.type === 'condition'), true);
  assert.equal((await service.list('owner-a')).length, 2);
  await assert.rejects(service.instantiateTemplate('missing-template', 'owner-a'), /Workflow template not found/);
});

test('order intake template passes through sequential checks and routes invalid orders', async () => {
  const queuedJobs: QueuedJob[] = [];
  const service = createService(queuedJobs);
  const document = await service.instantiateTemplate('order-intake-validation', 'owner-a');
  const webhook = document.nodes.find((node) => node.type === 'webhookTrigger');
  assert.ok(webhook);
  await service.setActive(document.id!, true, 'owner-a');

  const cases = [
    {
      input: { orderId: 'order-1', total: 25, paymentStatus: 'paid' },
      expectedNode: 'Order Ready',
    },
    {
      input: { total: 25, paymentStatus: 'paid' },
      expectedNode: 'Review Missing Order ID',
    },
    {
      input: { orderId: 'order-2', total: 0, paymentStatus: 'paid' },
      expectedNode: 'Review Invalid Total',
    },
    {
      input: { orderId: 'order-3', total: 25, paymentStatus: 'pending' },
      expectedNode: 'Review Payment Status',
    },
  ];

  for (const testCase of cases) {
    const queued = await service.triggerWebhook(document.id!, webhook.id, testCase.input);
    const queuedJob = queuedJobs.find(({ job }) => job.executionId === queued.executionId);
    assert.ok(queuedJob);
    await queuedJob.runner();
    const execution = await service.getExecution(queued.executionId, 'owner-a');
    const completedNodeIds = new Set(execution.events.filter((event) => event.type === 'node.completed').map((event) => event.nodeId));
    const completedNames = document.nodes.filter((node) => completedNodeIds.has(node.id)).map((node) => node.name);

    assert.equal(execution.status, 'SUCCESS');
    assert.ok(completedNames.includes(testCase.expectedNode));
    assert.equal(completedNames.filter((name) => name.startsWith('Review ') || name === 'Order Ready').length, 1);
  }
});
test('isolates execution history and details by account', async () => {
  const jobs: QueuedJob[] = [];
  const service = createService(jobs);
  const saved = await service.save(workflow, 'owner-a');
  const run = await service.execute(saved.id!, 'owner-a');
  assert.equal((await service.listExecutions('owner-a')).length, 1);
  assert.equal((await service.listExecutions('owner-b')).length, 0);
  await assert.rejects(service.getExecution(run.executionId, 'owner-b'), /Execution not found/);
});

test('cancelled queued executions never start', async () => {
  const jobs: QueuedJob[] = [];
  const service = createService(jobs);
  const saved = await service.save(workflow, 'owner-a');
  const run = await service.execute(saved.id!, 'owner-a');
  await service.cancel(run.executionId, 'owner-a');
  await jobs[0].runner();
  const record = await service.getExecution(run.executionId, 'owner-a');
  assert.equal(record.status, 'CANCELLED');
  assert.equal(record.events.some((event) => event.type === 'node.started'), false);
});

test('running integrations observe cancellation before a second external operation', async () => {
  const jobs: QueuedJob[] = [];
  const nodes = new NodeService();
  const service = new WorkflowsService({} as never, nodes, { enqueue: async (job: WorkflowJob, runner: () => Promise<void>) => { jobs.push({ job, runner }); } } as never, { publish: () => undefined } as never);
  let firstOperation!: () => void;
  const reachedFirstOperation = new Promise<void>((resolve) => { firstOperation = resolve; });
  let resume!: () => void;
  const released = new Promise<void>((resolve) => { resume = resolve; });
  const operations: string[] = [];
  nodes.registry.register({ type: 'longIntegration', label: 'Long integration', category: 'action', validate: () => [], execute: async (context) => {
    operations.push('first request'); firstOperation(); await released;
    await context.checkCancelled?.();
    operations.push('second request'); return { data: {} };
  } });
  const saved = await service.save({ ...workflow, nodes: workflow.nodes.map((node) => node.id === 'logger' ? { ...node, type: 'longIntegration' } : node) }, 'owner-a');
  const queued = await service.execute(saved.id!, 'owner-a');
  const running = jobs[0].runner();
  await reachedFirstOperation;
  await service.cancel(queued.executionId, 'owner-a');
  resume(); await running;
  const record = await service.getExecution(queued.executionId, 'owner-a');
  assert.deepEqual(operations, ['first request']);
  assert.equal(record.status, 'CANCELLED');
  assert.equal(record.events.some((event) => ['execution.failed', 'execution.completed'].includes(event.type)), false);
});

test('Actor workflows disable whole-workflow retries to avoid duplicate remote runs', async () => {
  const jobs: QueuedJob[] = [];
  const nodes = new NodeService();
  nodes.registry.register({ type: 'apifyActor', label: 'Apify Actor', category: 'action', validate: () => [], execute: async () => ({ data: {} }) });
  const service = new WorkflowsService({} as never, nodes, { enqueue: async (job: WorkflowJob, runner: () => Promise<void>, options?: EnqueueOptions) => { jobs.push({ job, runner, options }); } } as never, { publish: () => undefined } as never);
  const normal = await service.save(workflow, 'owner-a');
  await service.execute(normal.id!, 'owner-a');
  const actor = await service.save({ ...workflow, nodes: workflow.nodes.map((node) => node.id === 'logger' ? { ...node, type: 'apifyActor' } : node) }, 'owner-a');
  await service.execute(actor.id!, 'owner-a');
  assert.deepEqual(jobs.map(({ options }) => options?.attempts), [3, 1]);
});

test('records failed queue submissions rather than leaving them queued', async () => {
  const service = new WorkflowsService({} as never, new NodeService(), { enqueue: async () => { throw new Error('Queue unavailable'); } } as never, { publish: () => undefined } as never);
  const saved = await service.save(workflow, 'owner-a');
  await assert.rejects(service.execute(saved.id!, 'owner-a'), /Queue unavailable/);
  assert.equal((await service.listExecutions('owner-a'))[0].status, 'FAILED');
});

test('rejects unknown executor types and malformed graphs before saving', async () => {
  const service = createService();
  assert.deepEqual(service.validate(null as never), ['Nodes and edges must be arrays']);
  await assert.rejects(service.save({ ...workflow, nodes: [...workflow.nodes, { ...workflow.nodes[1], id: 'bad', type: 'missing' }] }, 'owner-a'), /Unknown node type/);
});

test('blank and whitespace order identifiers route to missing ID review', async () => {
  const jobs: QueuedJob[] = [];
  const service = createService(jobs);
  const saved = await service.instantiateTemplate('order-intake-validation', 'owner-a');
  await service.setActive(saved.id!, true, 'owner-a');
  for (const orderId of ['', '   ']) {
    const run = await service.triggerWebhook(saved.id!, saved.nodes[0].id, { orderId, total: 20, paymentStatus: 'paid' });
    await jobs.at(-1)!.runner();
    const record = await service.getExecution(run.executionId, 'owner-a');
    const route = saved.nodes.find((node) => node.name === 'Review Missing Order ID')!;
    assert.ok(record.events.some((event) => event.nodeId === route.id && event.type === 'node.completed'));
  }
});

test('an execution uses the graph captured when it was queued and records node inputs', async () => {
  const jobs: QueuedJob[] = [];
  const service = createService(jobs);
  const saved = await service.save(workflow, 'owner-a');
  const queued = await service.execute(saved.id!, 'owner-a', { amount: 42 });
  await service.save({ ...saved, nodes: saved.nodes.map((node) => node.type === 'logger' ? { ...node, config: { message: 'Edited after queueing' } } : node) }, 'owner-a');
  await jobs[0].runner();
  const record = await service.getExecution(queued.executionId, 'owner-a');
  assert.equal(record.status, 'SUCCESS');
  const output = record.events.find((event) => event.nodeId === 'logger' && event.type === 'node.completed')!;
  assert.deepEqual(output.data, { input: { amount: 42 }, message: 'hello' });
  assert.deepEqual(record.events.find((event) => event.nodeId === 'logger' && event.type === 'node.started')?.data, { amount: 42 });
  assert.deepEqual(record.input, { amount: 42 });
});

test('every active root schedule runs independently and deactivation clears all timers', async () => {
  const jobs: QueuedJob[] = []; const service = createService(jobs);
  try {
    const saved = await service.save({ name: 'Two schedules', nodes: [
      { id: 'first', type: 'scheduleTrigger', name: 'First schedule', position: { x: 0, y: 0 }, config: { intervalMs: 1000 } },
      { id: 'second', type: 'scheduleTrigger', name: 'Second schedule', position: { x: 0, y: 200 }, config: { intervalMs: 1000 } },
    ], edges: [] }, 'owner-a');
    await service.setActive(saved.id!, true, 'owner-a');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.deepEqual(new Set(jobs.map(({ job }) => job.triggerNodeId)), new Set(['first', 'second']));
    await service.setActive(saved.id!, false, 'owner-a'); const count = jobs.length;
    await new Promise((resolve) => setTimeout(resolve, 1100)); assert.equal(jobs.length, count);
  } finally { service.onModuleDestroy(); }
});
