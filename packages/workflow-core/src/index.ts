import type { WorkflowNodeData, WorkflowEdgeData } from '@workflow/shared-types';

export interface NodeContext {
  executionId: string;
  workflowId: string;
  input: unknown;
  variables: Record<string, unknown>;
}

export interface NodeResult { data: unknown; branch?: 'true' | 'false'; }
export interface WorkflowNodeExecutor {
  type: string;
  label: string;
  category: 'trigger' | 'action';
  validate(config: Record<string, unknown>): string[];
  execute(context: NodeContext, config: Record<string, unknown>): Promise<NodeResult>;
}

export class NodeRegistry {
  private readonly executors = new Map<string, WorkflowNodeExecutor>();
  register(executor: WorkflowNodeExecutor): void { this.executors.set(executor.type, executor); }
  get(type: string): WorkflowNodeExecutor {
    const executor = this.executors.get(type);
    if (!executor) throw new Error(`Unknown node type: ${type}`);
    return executor;
  }
  list(): WorkflowNodeExecutor[] { return [...this.executors.values()]; }
}

export function validateDag(nodes: WorkflowNodeData[], edges: WorkflowEdgeData[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.id)) errors.push(`Duplicate node id: ${node.id}`);
    ids.add(node.id);
  }
  if (!nodes.some((node) => node.type.endsWith('Trigger'))) errors.push('Workflow must contain a trigger node');
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) errors.push(`Edge ${edge.id} references a missing node`);
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, path: string[]): void => {
    if (visiting.has(id)) { errors.push(`Workflow contains a cycle: ${[...path, id].join(' -> ')}`); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const target of adjacency.get(id) ?? []) visit(target, [...path, id]);
    visiting.delete(id); visited.add(id);
  };
  ids.forEach((id) => visit(id, []));
  return [...new Set(errors)];
}

export async function executeDag(
  workflowId: string,
  executionId: string,
  nodes: WorkflowNodeData[],
  edges: WorkflowEdgeData[],
  registry: NodeRegistry,
  emit: (event: { type: string; nodeId?: string; data?: unknown; message?: string }) => Promise<void>,
  initialInput: unknown = {},
  triggerNodeId?: string,
): Promise<void> {
  const errors = validateDag(nodes, edges);
  if (errors.length) throw new Error(errors.join('; '));
  if (triggerNodeId) {
    const trigger = nodes.find((node) => node.id === triggerNodeId);
    if (!trigger || !trigger.type.endsWith('Trigger')) throw new Error('Selected trigger node was not found');
    if (edges.some((edge) => edge.target === triggerNodeId)) throw new Error('Selected trigger node must be a root node');
  }
  const reachable = new Set<string>();
  if (triggerNodeId) {
    const pending = [triggerNodeId];
    while (pending.length) {
      const id = pending.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      pending.push(...edges.filter((edge) => edge.source === id).map((edge) => edge.target));
    }
  }
  const outputs = new Map<string, unknown>();
  const remaining = new Set(nodes.map((node) => node.id));
  const inactiveEdges = new Set<string>();
  const skippedNodes = new Set<string>();
  while (remaining.size) {
    const next = nodes.find((node) => remaining.has(node.id) && edges.filter((edge) => edge.target === node.id).every((edge) => inactiveEdges.has(edge.id) || !remaining.has(edge.source)));
    if (!next) throw new Error('Unable to determine execution order');
    const incoming = edges.filter((edge) => edge.target === next.id);
    const activeIncoming = incoming.filter((edge) => !inactiveEdges.has(edge.id));
    const otherRootTrigger = triggerNodeId && !reachable.has(next.id);
    if (otherRootTrigger) {
      skippedNodes.add(next.id);
      remaining.delete(next.id);
      await emit({ type: 'node.skipped', nodeId: next.id, message: 'Another trigger started this execution' });
      continue;
    }
    if (incoming.length > 0 && (activeIncoming.length === 0 || activeIncoming.every((edge) => skippedNodes.has(edge.source)))) {
      skippedNodes.add(next.id); remaining.delete(next.id); await emit({ type: 'node.skipped', nodeId: next.id }); continue;
    }
    const parentOutputs = activeIncoming.filter((edge) => !skippedNodes.has(edge.source)).map((edge) => outputs.get(edge.source));
    await emit({ type: 'node.started', nodeId: next.id });
    try {
      const input = parentOutputs.length === 0 ? initialInput : parentOutputs.length === 1 ? parentOutputs[0] : parentOutputs;
      const result = await registry.get(next.type).execute({ executionId, workflowId, input, variables: {} }, next.config);
      outputs.set(next.id, result.data);
      if (result.branch) for (const edge of edges.filter((candidate) => candidate.source === next.id && candidate.sourceHandle && candidate.sourceHandle !== result.branch)) inactiveEdges.add(edge.id);
      await emit({ type: 'node.completed', nodeId: next.id, data: result.data });
    } catch (error) {
      await emit({ type: 'node.failed', nodeId: next.id, message: error instanceof Error ? error.message : 'Node failed' });
      throw error;
    }
    remaining.delete(next.id);
  }
}