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
