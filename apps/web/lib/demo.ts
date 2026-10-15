import type { ExecutionEvent, ExecutionStatus, WorkflowDocument } from '@workflow/shared-types';
export interface DemoTemplate {
  id: string; name: string; summary: string; description: string; requiresAi: boolean;
  inputFields: { name: string; type: 'string' | 'number'; required: boolean; description: string }[];
  inputExample: Record<string, unknown>; expectedOutputs: string[];
}
export interface DemoExecution { id: string; workflowId: string; status: ExecutionStatus; error?: string; startedAt?: string; completedAt?: string; events: ExecutionEvent[] }
export function friendlyLabel(value: string): string { return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').replace(/^./, (char) => char.toUpperCase()); }
export function demoResult(workflow: WorkflowDocument, execution: DemoExecution) {
  const completed = execution.events.filter((event) => event.type === 'node.completed');
  const analysis = completed.find((event) => workflow.nodes.find((node) => node.id === event.nodeId)?.type === 'groqChat');
  const terminal = [...completed].reverse().find((event) => workflow.nodes.find((node) => node.id === event.nodeId)?.type === 'logger');
  const output = terminal?.data as { input?: Record<string, unknown>; message?: string } | undefined;
  const raw = analysis?.data ?? output?.input ?? {};
  const fields = Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([key]) => !['_ai', 'input', 'result'].includes(key)));
  return { fields, route: workflow.nodes.find((node) => node.id === terminal?.nodeId)?.name, message: output?.message };
}
