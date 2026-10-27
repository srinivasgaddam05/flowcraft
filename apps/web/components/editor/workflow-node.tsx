'use client';
import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Activity, ArrowRight, Braces, Cloud, Database, ScanSearch, ChartNoAxesCombined, Check, Clock3, Code2, FileOutput, Filter, GitBranch, Globe, LoaderCircle, Play, SlidersHorizontal, Sparkles, Terminal, Webhook, X } from 'lucide-react';
import type { WorkflowNodeData } from '@workflow/shared-types';
import { blockFor } from '../../lib/editor';
const icons = { scan: ScanSearch, cloud: Cloud, database: Database, play: Play, webhook: Webhook, clock: Clock3, code: Code2, chart: ChartNoAxesCombined, filter: Filter, sliders: SlidersHorizontal, branch: GitBranch, globe: Globe, sparkles: Sparkles, result: FileOutput, terminal: Terminal };
export function BlockIcon({ type, size = 19 }: { type: string; size?: number }) { const Icon = icons[blockFor(type).icon as keyof typeof icons] ?? Braces; return <Icon size={size} />; }
export type CanvasNode = Node<{ block: WorkflowNodeData; status?: string; duration?: string; progress?: string }, 'workflow'>;
export const WorkflowNode = memo(function WorkflowNode({ data, selected }: NodeProps<CanvasNode>) {
  const block = data.block; const catalog = blockFor(block.type); const trigger = block.type.endsWith('Trigger'); const condition = block.type === 'condition';
  return <div className={`studio-node ${catalog.color} ${selected ? 'selected' : ''} node-${data.status?.toLowerCase() ?? 'idle'}`} data-testid={`workflow-node-${block.id}`}>
    {!trigger && <Handle type="target" position={Position.Left} id="in" aria-label={`Input for ${block.name}`} />}
    <div className="studio-node-head"><span className="studio-node-icon"><BlockIcon type={block.type} /></span><div><strong>{block.name}</strong><small>{catalog.label}</small></div><span className="studio-node-state">{data.status === 'SUCCESS' ? <Check size={14} /> : data.status === 'FAILED' ? <X size={14} /> : data.status === 'RUNNING' ? <LoaderCircle size={14} className="studio-spin" /> : <Activity size={12} />}</span></div>
    {data.progress && <div className="studio-node-progress" title={data.progress}>{data.progress}</div>}
    <div className="studio-node-foot"><span>{trigger ? 'TRIGGER' : block.type === 'expression' ? 'JSONATA' : condition ? 'BRANCH' : catalog.category.toUpperCase()}</span><span>{data.duration ?? (data.status === 'SKIPPED' ? 'Skipped' : data.status === 'SUCCESS' ? 'Complete' : 'Ready')}</span></div>
    {condition ? <><span className="studio-handle-label yes">true</span><Handle type="source" position={Position.Right} id="true" style={{ top: '36%' }} aria-label={`True output for ${block.name}`} /><span className="studio-handle-label no">false</span><Handle type="source" position={Position.Right} id="false" style={{ top: '75%' }} aria-label={`False output for ${block.name}`} /></> : <Handle type="source" position={Position.Right} aria-label={`Output for ${block.name}`} />}
  </div>;
});
export const workflowNodeTypes = { workflow: WorkflowNode };
