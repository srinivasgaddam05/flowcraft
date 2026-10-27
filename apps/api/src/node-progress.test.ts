import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
import { NodeRegistry, type WorkflowNodeExecutor } from '@flowcraft/engine';
import type { ExecutionEvent, WorkflowDocument } from '@workflow/shared-types';

// Run the database code path against an in-process Prisma double, never a live database.
process.env.DEMO_MODE = 'false';
process.env.DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/progress_test';

const workflow: WorkflowDocument = {
  id: 'workflow-progress', name: 'Remote progress',
  nodes: [
    { id: 'trigger', type: 'manualTrigger', name: 'Manual', config: {}, position: { x: 0, y: 0 } },
    { id: 'remote', type: 'remote', name: 'Remote', config: {}, position: { x: 200, y: 0 } },
  ],
  edges: [{ id: 'trigger-remote', source: 'trigger', target: 'remote' }],
};

async function progressService(remote: WorkflowNodeExecutor['execute']) {
  const { WorkflowsService } = await import('./workflows.service');
  const nodes = new Map<string, Record<string, unknown>>();
  const published: ExecutionEvent[] = [];
  const execution: Record<string, unknown> = { id: 'execution-progress', workflowId: workflow.id, status: 'QUEUED', createdAt: new Date('2026-10-15T12:00:00Z'), startedAt: null, completedAt: null, error: null, triggerData: { url: 'https://example.com' }, triggerNodeId: 'trigger', workflowSnapshot: workflow };
  const apply = (target: Record<string, unknown>, data: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(data)) if (value !== undefined) target[key] = value === Prisma.JsonNull || value === Prisma.DbNull ? null : value;
    return target;
  };
  const prisma = {
    execution: {
      findFirst: async () => ({ ...execution, nodes: [...nodes.values()] }),
      findUnique: async () => ({ status: execution.status }),
      update: async ({ data }: { data: Record<string, unknown> }) => apply(execution, data),
    },
    executionNode: {
      upsert: async ({ where, create, update }: { where: { executionId_nodeId: { nodeId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const id = where.executionId_nodeId.nodeId;
        const existing = nodes.get(id);
        const result = apply(existing ?? {}, existing ? update : create);
        nodes.set(id, result);
        return result;
      },
      findUnique: async ({ where }: { where: { executionId_nodeId: { nodeId: string } } }) => nodes.get(where.executionId_nodeId.nodeId),
      updateMany: async ({ where, data }: { where: { nodeId: string; status: string }; data: Record<string, unknown> }) => {
        const existing = nodes.get(where.nodeId);
        if (!existing || existing.status !== where.status) return { count: 0 };
        apply(existing, data);
        return { count: 1 };
      },
    },
  };
  const registry = new NodeRegistry();
  registry.register({ type: 'manualTrigger', label: 'Manual', category: 'trigger', validate: () => [], execute: async ({ input }) => ({ data: input }) });
  registry.register({ type: 'remote', label: 'Remote', category: 'action', validate: () => [], execute: remote });
  const service = new WorkflowsService(prisma as never, { registry } as never, {} as never, { publish: (event: ExecutionEvent) => { published.push(event); } } as never);
  return { service, nodes, published };
}

test('remote progress is durable and pollable while its node stays running with the original input', async () => {
  let fixture: Awaited<ReturnType<typeof progressService>>;
  const input = { url: 'https://example.com' };
  fixture = await progressService(async (context) => {
    const startedAt = fixture.nodes.get('remote')?.startedAt;
    await context.reportProgress?.({ message: 'Actor launched', data: { run: { id: 'apify-123', status: 'RUNNING' } } });
    const row = fixture.nodes.get('remote')!;
    assert.equal(row.status, 'RUNNING');
    assert.equal(row.startedAt, startedAt);
    assert.equal(row.completedAt, null);
    assert.equal(row.duration, null);
    assert.deepEqual(row.input, input);
    assert.equal(row.error, null);
    const stored = await fixture.service.getExecution('execution-progress');
    const event = stored.events.find((candidate) => candidate.type === 'node.progress' && candidate.nodeId === 'remote');
    assert.deepEqual(event?.data, { run: { id: 'apify-123', status: 'RUNNING' } });
    assert.equal(event?.status, 'RUNNING');
    assert.equal(stored.events.filter((candidate) => candidate.nodeId === 'remote' && candidate.type === 'node.completed').length, 0);
    return { data: { count: 1, items: [{ title: 'Complete' }] } };
  });
  await fixture.service.runQueued(workflow.id!, 'execution-progress', input, 'trigger');
  assert.equal(fixture.published.find((event) => event.type === 'node.progress')?.status, 'RUNNING');
  const stored = await fixture.service.getExecution('execution-progress');
  assert.equal(stored.status, 'SUCCESS');
  assert.deepEqual(stored.events.find((event) => event.type === 'node.completed' && event.nodeId === 'remote')?.data, { count: 1, items: [{ title: 'Complete' }] });
});

test('failed remote nodes retain their last run ID and errors without accepting stale progress', async () => {
  const fixture = await progressService(async (context) => {
    await context.reportProgress?.({ message: 'Actor launched', data: { run: { id: 'inspect-this-run', status: 'RUNNING' } } });
    throw new Error('Remote polling failed');
  });
  await assert.rejects(fixture.service.runQueued(workflow.id!, 'execution-progress', {}, 'trigger'), /Remote polling failed/);
  const row = fixture.nodes.get('remote')!;
  assert.equal(row.status, 'FAILED');
  assert.deepEqual(row.output, { run: { id: 'inspect-this-run', status: 'RUNNING' } });
  assert.equal(row.error, 'Remote polling failed');
  assert.ok(row.completedAt instanceof Date);
  const persist = fixture.service as unknown as { persistNodeEvent: (id: string, document: WorkflowDocument, event: ExecutionEvent) => Promise<void> };
  await persist.persistNodeEvent('execution-progress', workflow, { type: 'node.progress', nodeId: 'remote', executionId: 'execution-progress', status: 'RUNNING', message: 'Stale update', data: { run: { id: 'must-not-replace' } }, timestamp: new Date().toISOString() });
  assert.equal(row.status, 'FAILED');
  assert.deepEqual(row.output, { run: { id: 'inspect-this-run', status: 'RUNNING' } });
  const stored = await fixture.service.getExecution('execution-progress');
  assert.equal(stored.status, 'FAILED');
  const failed = stored.events.find((event) => event.type === 'node.failed' && event.nodeId === 'remote');
  assert.deepEqual(failed?.data, row.output);
  assert.equal(failed?.message, 'Remote polling failed');
});
