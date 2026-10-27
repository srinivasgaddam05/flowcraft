export const executionStatuses = ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED'] as const;
export type ExecutionStatus = (typeof executionStatuses)[number];
export type NodeStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'RETRYING';

export interface WorkflowNodeData {
  id: string;
  type: string;
  name: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}

export interface WorkflowEdgeData {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface WorkflowDocument {
  id?: string;
  name: string;
  description?: string;
  active?: boolean;
  nodes: WorkflowNodeData[];
  edges: WorkflowEdgeData[];
}

export interface ExecutionEvent {
  type: 'execution.started' | 'node.started' | 'node.progress' | 'node.completed' | 'node.failed' | 'node.skipped' | 'execution.completed' | 'execution.failed' | 'execution.cancelled';
  executionId: string;
  nodeId?: string;
  status: ExecutionStatus | NodeStatus;
  message?: string;
  data?: unknown;
  timestamp: string;
}
