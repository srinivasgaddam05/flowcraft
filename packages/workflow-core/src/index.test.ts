import assert from 'node:assert/strict';
import { test } from 'node:test';
import { executeDag, NodeRegistry, validateDag, type WorkflowNodeExecutor } from './index';

const node = (id: string, type: string) => ({ id, type, name: type, position: { x: 0, y: 0 }, config: {} });
const edge = (id: string, source: string, target: string) => ({ id, source, target });

test('rejects a graph containing a cycle', () => {
  const errors = validateDag([node('trigger', 'manualTrigger'), node('step', 'logger')], [edge('a', 'trigger', 'step'), edge('b', 'step', 'trigger')]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /cycle: trigger -> step -> trigger/);
});

test('rejects workflows without a trigger', () => {
  const errors = validateDag([node('step', 'logger')], []);
  assert.deepEqual(errors, ['Workflow must contain a trigger node']);
});

test('executes nodes in dependency order and passes outputs', async () => {
  const order: string[] = [];
  const registry = new NodeRegistry();
  const executor = (type: string, output: unknown): WorkflowNodeExecutor => ({ type, label: type, category: 'action', validate: () => [], execute: async (context) => { order.push(type); return { data: { output, input: context.input } }; } });
  registry.register({ ...executor('manualTrigger', 'started'), category: 'trigger' });
  registry.register(executor('logger', 'finished'));
  const events: string[] = [];
  await executeDag('workflow', 'execution', [node('trigger', 'manualTrigger'), node('logger', 'logger')], [edge('edge', 'trigger', 'logger')], registry, async (event) => { events.push(event.type); });
  assert.deepEqual(order, ['manualTrigger', 'logger']);
  assert.deepEqual(events, ['node.started', 'node.completed', 'node.started', 'node.completed']);
});

test('follows the selected condition branch and skips the other branch', async () => {
  const registry = new NodeRegistry();
  registry.register({ type: 'manualTrigger', label: 'Trigger', category: 'trigger', validate: () => [], execute: async () => ({ data: { approved: true } }) });
  registry.register({ type: 'condition', label: 'Condition', category: 'action', validate: () => [], execute: async () => ({ data: true, branch: 'true' }) });
  registry.register({ type: 'trueAction', label: 'True', category: 'action', validate: () => [], execute: async () => ({ data: 'true' }) });
  registry.register({ type: 'falseAction', label: 'False', category: 'action', validate: () => [], execute: async () => ({ data: 'false' }) });
  const events: string[] = [];
  await executeDag('workflow', 'execution', [node('trigger', 'manualTrigger'), node('condition', 'condition'), node('yes', 'trueAction'), node('no', 'falseAction')], [edge('a', 'trigger', 'condition'), { id: 'yes-edge', source: 'condition', target: 'yes', sourceHandle: 'true' }, { id: 'no-edge', source: 'condition', target: 'no', sourceHandle: 'false' }], registry, async (event) => { if (event.nodeId) events.push(`${event.type}:${event.nodeId}`); });
  assert.ok(events.includes('node.completed:yes'));
  assert.ok(events.includes('node.skipped:no'));
  assert.ok(!events.includes('node.started:no'));
});

test('runs only the branch belonging to the trigger that started the workflow', async () => {
  const order: string[] = [];
  const registry = new NodeRegistry();
  for (const type of ['webhookTrigger', 'scheduleTrigger', 'logger']) {
    registry.register({
      type,
      label: type,
      category: type.endsWith('Trigger') ? 'trigger' : 'action',
      validate: () => [],
      execute: async (context) => { order.push(`${type}:${JSON.stringify(context.input)}`); return { data: context.input }; },
    });
  }
  const events: string[] = [];
  await executeDag(
    'workflow',
    'execution',
    [node('webhook', 'webhookTrigger'), node('webhook-log', 'logger'), node('schedule', 'scheduleTrigger'), node('schedule-log', 'logger')],
    [edge('webhook-edge', 'webhook', 'webhook-log'), edge('schedule-edge', 'schedule', 'schedule-log')],
    registry,
    async (event) => { events.push(`${event.type}:${event.nodeId}`); },
    { event: 'webhook payload' },
    'webhook',
  );

  assert.deepEqual(order, ['webhookTrigger:{"event":"webhook payload"}', 'logger:{"event":"webhook payload"}']);
  assert.ok(events.includes('node.skipped:schedule'));
  assert.ok(events.includes('node.skipped:schedule-log'));
});
test('a selected webhook cannot execute disconnected actions', async () => {
  const registry = new NodeRegistry();
  const executed: string[] = [];
  for (const type of ['webhookTrigger', 'logger']) registry.register({ type, label: type, category: type === 'logger' ? 'action' : 'trigger', validate: () => [], execute: async (context) => { executed.push(type); return { data: context.input }; } });
  const skipped: string[] = [];
  await executeDag('workflow', 'execution', [node('hook', 'webhookTrigger'), node('connected', 'logger'), node('disconnected', 'logger')], [edge('a', 'hook', 'connected')], registry, async (event) => { if (event.type === 'node.skipped') skipped.push(event.nodeId!); }, { value: 1 }, 'hook');
  assert.deepEqual(executed, ['webhookTrigger', 'logger']);
  assert.deepEqual(skipped, ['disconnected']);
});

test('cancelled executions stop before starting a node', async () => {
  const events: string[] = [];
  const registry = new NodeRegistry();
  registry.register({ type: 'manualTrigger', label: 'Trigger', category: 'trigger', validate: () => [], execute: async () => { throw new Error('Must not execute'); } });
  await assert.rejects(executeDag('workflow', 'execution', [node('trigger', 'manualTrigger')], [], registry, async (event) => { events.push(event.type); }, {}, 'trigger', { checkCancelled: async () => { throw new Error('Execution cancelled'); } }), /Execution cancelled/);
  assert.deepEqual(events, []);
});

test('long-running executors receive a cancellation hook and stop between remote operations', async () => {
  const registry = new NodeRegistry();
  let cancelled = false;
  const operations: string[] = [];
  const events: string[] = [];
  registry.register({ type: 'manualTrigger', label: 'Trigger', category: 'trigger', validate: () => [], execute: async ({ input }) => ({ data: input }) });
  registry.register({ type: 'scrape', label: 'Scrape', category: 'action', validate: () => [], execute: async (context) => {
    await context.checkCancelled?.();
    operations.push('first page'); cancelled = true;
    await context.checkCancelled?.();
    operations.push('second page'); return { data: {} };
  } });
  await assert.rejects(executeDag('workflow', 'execution', [node('trigger', 'manualTrigger'), node('scrape', 'scrape')], [edge('a', 'trigger', 'scrape')], registry, async (event) => { events.push(`${event.type}:${event.nodeId}`); }, {}, 'trigger', { checkCancelled: async () => { if (cancelled) throw new Error('Execution cancelled'); } }), /Execution cancelled/);
  assert.deepEqual(operations, ['first page']);
  assert.ok(events.includes('node.failed:scrape'));
  assert.ok(!events.includes('node.completed:scrape'));
});

test('cancellation after a node returns prevents its output and downstream work', async () => {
  const registry = new NodeRegistry();
  let cancelled = false;
  const events: string[] = [];
  const executed: string[] = [];
  registry.register({ type: 'manualTrigger', label: 'Trigger', category: 'trigger', validate: () => [], execute: async () => { executed.push('trigger'); cancelled = true; return { data: 'must not publish' }; } });
  registry.register({ type: 'logger', label: 'Logger', category: 'action', validate: () => [], execute: async () => { executed.push('logger'); return { data: {} }; } });
  await assert.rejects(executeDag('workflow', 'execution', [node('trigger', 'manualTrigger'), node('logger', 'logger')], [edge('a', 'trigger', 'logger')], registry, async (event) => { events.push(`${event.type}:${event.nodeId}`); }, {}, 'trigger', { checkCancelled: async () => { if (cancelled) throw new Error('Execution cancelled'); } }), /Execution cancelled/);
  assert.deepEqual(executed, ['trigger']);
  assert.deepEqual(events, ['node.started:trigger', 'node.failed:trigger']);
});

test('long-running nodes report progress while downstream nodes receive only their final output', async () => {
  const registry = new NodeRegistry();
  const events: Array<{ type: string; nodeId?: string; data?: unknown; message?: string }> = [];
  let downstream: unknown;
  registry.register({ type: 'manualTrigger', label: 'Trigger', category: 'trigger', validate: () => [], execute: async ({ input }) => ({ data: input }) });
  registry.register({ type: 'remote', label: 'Remote operation', category: 'action', validate: () => [], execute: async (context) => {
    await context.reportProgress?.({ message: 'Remote run started', data: { runId: 'remote-123', status: 'RUNNING' } });
    await context.reportProgress?.({ message: 'Reading dataset', data: { runId: 'remote-123', status: 'SUCCEEDED' } });
    return { data: { items: [{ title: 'A real result' }] } };
  } });
  registry.register({ type: 'logger', label: 'Logger', category: 'action', validate: () => [], execute: async ({ input }) => { downstream = input; return { data: input }; } });
  await executeDag('workflow', 'execution', [node('trigger', 'manualTrigger'), node('remote', 'remote'), node('result', 'logger')], [edge('a', 'trigger', 'remote'), edge('b', 'remote', 'result')], registry, async (event) => { events.push(event); }, { url: 'https://example.com' }, 'trigger');
  assert.deepEqual(events.filter((event) => event.type === 'node.progress'), [
    { type: 'node.progress', nodeId: 'remote', message: 'Remote run started', data: { runId: 'remote-123', status: 'RUNNING' } },
    { type: 'node.progress', nodeId: 'remote', message: 'Reading dataset', data: { runId: 'remote-123', status: 'SUCCEEDED' } },
  ]);
  assert.deepEqual(downstream, { items: [{ title: 'A real result' }] });
  assert.ok(events.findIndex((event) => event.type === 'node.completed' && event.nodeId === 'remote') > events.map((event) => event.type).lastIndexOf('node.progress'));
});

test('progress callbacks retained after an executor settles cannot change its terminal state', async () => {
  const registry = new NodeRegistry();
  const events: string[] = [];
  let report: NonNullable<Parameters<WorkflowNodeExecutor['execute']>[0]['reportProgress']> | undefined;
  registry.register({ type: 'manualTrigger', label: 'Trigger', category: 'trigger', validate: () => [], execute: async (context) => {
    report = context.reportProgress;
    await report?.({ message: 'Before completion', data: { status: 'RUNNING' } });
    return { data: { status: 'SUCCESS' } };
  } });
  await executeDag('workflow', 'execution', [node('trigger', 'manualTrigger')], [], registry, async ({ type }) => { events.push(type); });
  await report?.({ message: 'Stale callback', data: { status: 'RUNNING' } });
  assert.deepEqual(events, ['node.started', 'node.progress', 'node.completed']);
});

test('cancellation prevents new progress output and node completion', async () => {
  const registry = new NodeRegistry();
  const events: string[] = [];
  let cancelled = false;
  registry.register({ type: 'manualTrigger', label: 'Trigger', category: 'trigger', validate: () => [], execute: async (context) => {
    cancelled = true;
    await context.reportProgress?.({ message: 'Must not publish', data: { runId: 'cancelled' } });
    return { data: {} };
  } });
  await assert.rejects(executeDag('workflow', 'execution', [node('trigger', 'manualTrigger')], [], registry, async ({ type }) => { events.push(type); }, {}, undefined, { checkCancelled: async () => { if (cancelled) throw new Error('Execution cancelled'); } }), /cancelled/);
  assert.deepEqual(events, ['node.started', 'node.failed']);
});
