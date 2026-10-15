import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { executeDag, validateDag } from '@flowcraft/engine';
import type { ExecutionEvent, WorkflowDocument } from '@workflow/shared-types';
import { ExecutionEventsService } from './execution-events.service';
import { QueueService } from './queue.service';
import { NodeService } from './nodes';
import { PrismaService } from './prisma.service';
import { databaseEnabled } from './config';
import { createWorkflowFromTemplate, listWorkflowTemplates } from './workflow-templates';

export interface ExecutionRecord {
  id: string;
  workflowId: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  startedAt?: string;
  completedAt?: string;
  error?: string;
  events: ExecutionEvent[];
}

@Injectable()
export class WorkflowsService implements OnModuleInit, OnModuleDestroy {
  private readonly memory = new Map<string, WorkflowDocument>();
  private readonly owners = new Map<string, string>();
  private readonly executions = new Map<string, ExecutionRecord>();
  private readonly schedules = new Map<string, NodeJS.Timeout>();
  private readonly cancelled = new Set<string>();
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(NodeService) private readonly nodes: NodeService, @Inject(QueueService) private readonly queue: QueueService, @Inject(ExecutionEventsService) private readonly events: ExecutionEventsService) {}

  async onModuleInit(): Promise<void> {
    if (process.env.FLOWCRAFT_WORKER === 'true') return;
    for (const workflow of await this.list()) if (workflow.active) this.registerSchedule(workflow);
  }
  onModuleDestroy(): void { for (const id of this.schedules.keys()) this.clearSchedule(id); }
  private async isCancelled(id: string): Promise<boolean> {
    if (this.cancelled.has(id)) return true;
    if (!databaseEnabled) return false;
    const record = await this.prisma.execution.findUnique({ where: { id }, select: { status: true } });
    return record?.status === 'CANCELLED';
  }
  async list(ownerId?: string): Promise<WorkflowDocument[]> {
    if (!databaseEnabled) return [...this.memory.entries()].filter(([id]) => !ownerId || this.owners.get(id) === ownerId).map(([, workflow]) => workflow);
    const workflows = await this.prisma.workflow.findMany({ where: ownerId ? { ownerId } : undefined, include: { nodes: true, edges: true }, orderBy: { updatedAt: 'desc' } });
    return workflows.map((workflow) => ({ id: workflow.id, name: workflow.name, description: workflow.description ?? '', active: workflow.active, nodes: workflow.nodes.map((node) => ({ id: node.id, type: node.type, name: node.name, position: node.position as { x: number; y: number }, config: node.config as Record<string, unknown> })), edges: workflow.edges.map((edge) => ({ id: edge.id, source: edge.sourceNodeId, target: edge.targetNodeId, sourceHandle: edge.sourceHandle ?? undefined, targetHandle: edge.targetHandle ?? undefined })) }));
  }
  async get(id: string, ownerId?: string): Promise<WorkflowDocument> { const workflow = (await this.list(ownerId)).find((item) => item.id === id); if (!workflow) throw new NotFoundException('Workflow not found'); return workflow; }
  async save(document: WorkflowDocument, ownerId = 'demo'): Promise<WorkflowDocument> {
    if (!document || typeof document.name !== 'string' || !document.name.trim() || !Array.isArray(document.nodes) || !Array.isArray(document.edges)) {
      throw new BadRequestException('A workflow name, nodes array, and edges array are required');
    }
    const errors = this.validate(document);
    if (errors.length) throw new BadRequestException(errors.join('; '));
    if (document.id) await this.get(document.id, ownerId);
    const id = document.id ?? randomUUID();
    const saved = { ...document, id };
    if (databaseEnabled) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.workflow.upsert({
            where: { id },
            update: {
              name: document.name,
              description: document.description,
              active: document.active,
              nodes: { deleteMany: {}, create: document.nodes.map((node) => ({ id: node.id, type: node.type, name: node.name, position: node.position as Prisma.InputJsonValue, config: node.config as Prisma.InputJsonValue })) },
              edges: { deleteMany: {}, create: document.edges.map((edge) => ({ id: edge.id, sourceNodeId: edge.source, targetNodeId: edge.target, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle })) },
            },
            create: {
              id,
              name: document.name,
              description: document.description,
              active: document.active,
              ownerId,
              nodes: { create: document.nodes.map((node) => ({ id: node.id, type: node.type, name: node.name, position: node.position as Prisma.InputJsonValue, config: node.config as Prisma.InputJsonValue })) },
              edges: { create: document.edges.map((edge) => ({ id: edge.id, sourceNodeId: edge.source, targetNodeId: edge.target, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle })) },
            },
          });
        });
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
          throw new ConflictException('A workflow or node with this ID already exists. Reload the editor and try again.');
        }
        throw error;
      }
    }
    this.memory.set(id, saved);
    this.owners.set(id, ownerId);
    if (saved.active) this.registerSchedule(saved); else this.clearSchedule(id);
    return saved;
  }
  async remove(id: string, ownerId?: string): Promise<void> {
    await this.get(id, ownerId);
    this.memory.delete(id);
    this.owners.delete(id);
    this.clearSchedule(id);
    if (databaseEnabled) await this.prisma.workflow.delete({ where: { id } });
  }
  async duplicate(id: string, ownerId?: string): Promise<WorkflowDocument> {
    const source = await this.get(id, ownerId);
    const ids = new Map(source.nodes.map((node) => [node.id, randomUUID()]));
    return this.save({ name: `${source.name} copy`, description: source.description, active: false, nodes: source.nodes.map((node) => ({ ...node, id: ids.get(node.id) ?? randomUUID() })), edges: source.edges.map((edge) => ({ ...edge, id: randomUUID(), source: ids.get(edge.source) ?? edge.source, target: ids.get(edge.target) ?? edge.target })) }, ownerId);
  }
  async setActive(id: string, active: boolean, ownerId?: string): Promise<WorkflowDocument> {
    const workflow = await this.get(id, ownerId);
    const updated = { ...workflow, active };
    this.memory.set(id, updated);
    if (databaseEnabled) await this.prisma.workflow.update({ where: { id }, data: { active } });
    if (active) this.registerSchedule(updated); else this.clearSchedule(id);
    return updated;
  }
  private clearSchedule(id: string): void { const timer = this.schedules.get(id); if (timer) clearInterval(timer); this.schedules.delete(id); }
  private registerSchedule(workflow: WorkflowDocument): void { const id = workflow.id; this.clearSchedule(id ?? ''); const trigger = workflow.nodes.find((node) => node.type === 'scheduleTrigger'); const intervalMs = Number(trigger?.config.intervalMs ?? 0); if (!id || !trigger || !Number.isFinite(intervalMs) || intervalMs < 1000) return; this.schedules.set(id, setInterval(() => { void this.execute(id, undefined, {}, trigger.id).catch(() => undefined); }, intervalMs)); }
  listTemplates(): ReturnType<typeof listWorkflowTemplates> { return listWorkflowTemplates(); }
  async instantiateTemplate(templateId: string, ownerId: string): Promise<WorkflowDocument> {
    const document = createWorkflowFromTemplate(templateId);
    if (!document) throw new NotFoundException('Workflow template not found');
    return this.save(document, ownerId);
  }
  validate(document: WorkflowDocument): string[] {
    if (!document || !Array.isArray(document.nodes) || !Array.isArray(document.edges)) return ['Nodes and edges must be arrays'];
    if (document.nodes.some((node) => !node || typeof node.id !== 'string' || typeof node.type !== 'string' || !node.config || typeof node.config !== 'object' || Array.isArray(node.config) || !node.position || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y))) return ['Every node requires an ID, type, position, and configuration object'];
    if (document.edges.some((edge) => !edge || typeof edge.id !== 'string' || typeof edge.source !== 'string' || typeof edge.target !== 'string')) return ['Every edge requires an ID, source, and target'];
    const errors = validateDag(document.nodes, document.edges);
    for (const node of document.nodes) {
      try { errors.push(...this.nodes.registry.get(node.type).validate(node.config)); }
      catch { errors.push(`Unknown node type: ${node.type}`); }
    }
    return errors;
  }
  async listExecutions(ownerId?: string): Promise<ExecutionRecord[]> {
    if (databaseEnabled) {
      const records = await this.prisma.execution.findMany({ where: ownerId ? { workflow: { ownerId } } : undefined, orderBy: { createdAt: 'desc' }, take: 100 });
      return records.map((record) => ({ id: record.id, workflowId: record.workflowId, status: record.status, startedAt: record.startedAt?.toISOString(), completedAt: record.completedAt?.toISOString(), error: record.error ?? undefined, events: [] }));
    }
    return [...this.executions.values()].filter((record) => !ownerId || this.owners.get(record.workflowId) === ownerId).reverse();
  }
  async getExecution(id: string, ownerId?: string): Promise<ExecutionRecord> {
    const memoryRecord = this.executions.get(id);
    if (!databaseEnabled && memoryRecord && (!ownerId || this.owners.get(memoryRecord.workflowId) === ownerId)) return memoryRecord;
    if (databaseEnabled) {
      const record = await this.prisma.execution.findFirst({ where: { id, ...(ownerId ? { workflow: { ownerId } } : {}) }, include: { nodes: true } });
      if (record) {
        const events: ExecutionEvent[] = [{ type: 'execution.started', executionId: id, status: 'QUEUED', timestamp: record.createdAt.toISOString() }];
        if (record.startedAt) events.push({ type: 'execution.started', executionId: id, status: 'RUNNING', timestamp: record.startedAt.toISOString() });
        for (const node of record.nodes) {
          if (node.startedAt) events.push({ type: 'node.started', executionId: id, nodeId: node.nodeId, status: 'RUNNING', timestamp: node.startedAt.toISOString() });
          if (node.completedAt) {
            const type: ExecutionEvent['type'] = node.status === 'FAILED' ? 'node.failed' : node.status === 'SKIPPED' ? 'node.skipped' : 'node.completed';
            const status: ExecutionEvent['status'] = node.status === 'FAILED' ? 'FAILED' : node.status === 'SKIPPED' ? 'SKIPPED' : 'SUCCESS';
            events.push({ type, executionId: id, nodeId: node.nodeId, status, data: node.output ?? undefined, message: node.error ?? undefined, timestamp: node.completedAt.toISOString() });
          }
        }
        if (record.completedAt) {
          const type: ExecutionEvent['type'] = record.status === 'CANCELLED' ? 'execution.cancelled' : record.status === 'FAILED' ? 'execution.failed' : 'execution.completed';
          events.push({ type, executionId: id, status: record.status, message: record.error ?? undefined, timestamp: record.completedAt.toISOString() });
        }
        events.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
        return { id: record.id, workflowId: record.workflowId, status: record.status, startedAt: record.startedAt?.toISOString(), completedAt: record.completedAt?.toISOString(), error: record.error ?? undefined, events };
      }
    }
    throw new NotFoundException('Execution not found');
  }
  private recordEvent(event: ExecutionEvent): void { const execution = this.executions.get(event.executionId); if (!execution) return; execution.events.push(event); if (event.status === 'RUNNING' && event.type === 'execution.started') { execution.status = 'RUNNING'; execution.startedAt = event.timestamp; } if (event.type === 'execution.completed') { execution.status = 'SUCCESS'; execution.completedAt = event.timestamp; } if (event.type === 'execution.failed') { execution.status = 'FAILED'; execution.completedAt = event.timestamp; execution.error = event.message; } }
  private async persistExecution(id: string, status: 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED', startedAt?: string, completedAt?: string, error?: string): Promise<void> { if (!databaseEnabled) return; await this.prisma.execution.update({ where: { id }, data: { status, startedAt: startedAt ? new Date(startedAt) : undefined, completedAt: completedAt ? new Date(completedAt) : status === 'RUNNING' ? null : undefined, error: error ?? null } }); }
  private async persistNodeEvent(executionId: string, workflow: WorkflowDocument, event: ExecutionEvent): Promise<void> { if (!databaseEnabled || !event.nodeId) return; const node = workflow.nodes.find((candidate) => candidate.id === event.nodeId); if (!node) return; const status = event.type === 'node.started' ? 'RUNNING' : event.type === 'node.completed' ? 'SUCCESS' : event.type === 'node.skipped' ? 'SKIPPED' : 'FAILED'; await this.prisma.executionNode.upsert({ where: { executionId_nodeId: { executionId, nodeId: node.id } }, create: { id: `${executionId}-${node.id}`, executionId, nodeId: node.id, status, output: event.data as Prisma.InputJsonValue, error: event.message, startedAt: event.type === 'node.started' ? new Date(event.timestamp) : undefined, completedAt: event.type !== 'node.started' ? new Date(event.timestamp) : undefined }, update: { status, output: event.data as Prisma.InputJsonValue, error: event.message, startedAt: event.type === 'node.started' ? new Date(event.timestamp) : undefined, completedAt: event.type !== 'node.started' ? new Date(event.timestamp) : undefined } }); }
  async runQueued(id: string, executionId: string, triggerData: unknown = {}, triggerNodeId?: string): Promise<void> {
    if (await this.isCancelled(executionId)) return;
    const workflow = await this.get(id);
    try {
      const started: ExecutionEvent = { type: 'execution.started', executionId, status: 'RUNNING', timestamp: new Date().toISOString() }; this.recordEvent(started); await this.persistExecution(executionId, 'RUNNING', started.timestamp); this.events.publish(started);
      await executeDag(id, executionId, workflow.nodes, workflow.edges, this.nodes.registry, async (event) => {
        if (await this.isCancelled(executionId)) throw new Error('Execution cancelled');
        const update: ExecutionEvent = { type: event.type as ExecutionEvent['type'], executionId, nodeId: event.nodeId, data: event.data, message: event.message, status: event.type.endsWith('failed') ? 'FAILED' : event.type.endsWith('started') ? 'RUNNING' : event.type.endsWith('skipped') ? 'SKIPPED' : 'SUCCESS', timestamp: new Date().toISOString() }; this.recordEvent(update); await this.persistNodeEvent(executionId, workflow, update); this.events.publish(update);
      }, triggerData, triggerNodeId);
      if (await this.isCancelled(executionId)) return;
      const completed: ExecutionEvent = { type: 'execution.completed', executionId, status: 'SUCCESS', timestamp: new Date().toISOString() }; this.recordEvent(completed); await this.persistExecution(executionId, 'SUCCESS', undefined, completed.timestamp); this.events.publish(completed);
    } catch (error) {
      if (await this.isCancelled(executionId)) return;
      const failed: ExecutionEvent = { type: 'execution.failed', executionId, status: 'FAILED', message: error instanceof Error ? error.message : 'Execution failed', timestamp: new Date().toISOString() }; this.recordEvent(failed); await this.persistExecution(executionId, 'FAILED', undefined, failed.timestamp, failed.message); this.events.publish(failed);
      throw error;
    }
  }
  async cancel(id: string, ownerId?: string): Promise<ExecutionRecord> { const execution = await this.getExecution(id, ownerId); if (execution.status === 'QUEUED' || execution.status === 'RUNNING') { this.cancelled.add(id); execution.status = 'CANCELLED'; execution.completedAt = new Date().toISOString(); const event: ExecutionEvent = { type: 'execution.cancelled', executionId: id, status: 'CANCELLED', message: 'Execution cancelled', timestamp: new Date().toISOString() }; execution.events.push(event); this.events.publish(event); await this.persistExecution(id, 'CANCELLED', undefined, event.timestamp, event.message); } return execution; }
  async execute(id: string, ownerId?: string, triggerData: unknown = {}, triggerNodeId?: string): Promise<{ executionId: string; status: string }> {
    await this.get(id, ownerId);
    const executionId = randomUUID();
    const queued: ExecutionEvent = { type: 'execution.started', executionId, status: 'QUEUED', timestamp: new Date().toISOString() }; this.executions.set(executionId, { id: executionId, workflowId: id, status: 'QUEUED', events: [queued] }); if (databaseEnabled) await this.prisma.execution.create({ data: { id: executionId, workflowId: id, status: 'QUEUED', triggerData: triggerData as Prisma.InputJsonValue } }); this.events.publish(queued);
    try {
      await this.queue.enqueue({ workflowId: id, executionId, triggerData, triggerNodeId }, () => this.runQueued(id, executionId, triggerData, triggerNodeId));
    } catch (error) {
      const failed: ExecutionEvent = { type: 'execution.failed', executionId, status: 'FAILED', timestamp: new Date().toISOString(), message: 'Unable to queue execution' };
      this.recordEvent(failed);
      await this.persistExecution(executionId, 'FAILED', undefined, failed.timestamp, failed.message);
      throw error;
    }
    return { executionId, status: 'QUEUED' };
  }
  async triggerWebhook(workflowId: string, triggerId: string, triggerData: unknown): Promise<{ executionId: string; status: string }> {
    const workflow = await this.get(workflowId);
    if (!workflow.active) throw new ConflictException('Activate this workflow before calling its webhook');
    const trigger = workflow.nodes.find((node) => node.id === triggerId && node.type === 'webhookTrigger');
    if (!trigger) throw new NotFoundException('Webhook trigger not found');
    if (workflow.edges.some((edge) => edge.target === triggerId)) throw new BadRequestException('Webhook trigger must be a root node');
    return this.execute(workflowId, undefined, triggerData, trigger.id);
  }
}