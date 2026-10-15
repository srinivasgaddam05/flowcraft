'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { addEdge, Background, Controls, Handle, MiniMap, Position, ReactFlow, useEdgesState, useNodesState, type Connection, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Activity, Box, CheckCircle2, ChevronRight, CirclePlay, Copy, FileText, GitBranch, LayoutDashboard, Plus, Save, Settings2, Sparkles, Terminal, Workflow } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { WorkflowDocument } from '@workflow/shared-types';
import { authHeaders, clearToken, getToken } from '../lib/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:4000';
const labels: Record<string, string> = { manualTrigger: 'Manual Trigger', webhookTrigger: 'Webhook Trigger', scheduleTrigger: 'Schedule Trigger', httpRequest: 'HTTP Request', transform: 'Transform Data', condition: 'Condition', delay: 'Delay', logger: 'Logger', groqChat: 'AI Support Triage' };
function nodeType(label: string): string { return Object.entries(labels).find(([, value]) => value === label)?.[0] ?? label.toLowerCase().replaceAll(' ', ''); }
async function responseError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const payload = JSON.parse(text) as { message?: string | string[] };
    return Array.isArray(payload.message) ? payload.message.join('; ') : payload.message ?? `Request failed (${response.status})`;
  } catch {
    return text || `Request failed (${response.status})`;
  }
}

function ConditionNode({ data }: NodeProps) {
  return <div className="condition-node"><Handle type="target" position={Position.Left} /><strong>{String(data.label)}</strong><span className="condition-branch true-branch">TRUE</span><Handle type="source" position={Position.Right} id="true" style={{ top: '35%' }} /><span className="condition-branch false-branch">FALSE</span><Handle type="source" position={Position.Right} id="false" style={{ top: '72%' }} /></div>;
}

export default function Home() {
  const router = useRouter();
  const editorId = useId().replaceAll(':', '');
  const starterNodes: Node[] = [
    { id: `${editorId}-trigger`, position: { x: 110, y: 180 }, data: { label: 'Manual Trigger' }, type: 'input' },
    { id: `${editorId}-transform`, position: { x: 390, y: 180 }, data: { label: 'Transform Data' } },
    { id: `${editorId}-logger`, position: { x: 680, y: 180 }, data: { label: 'Logger' } },
  ];
  const starterEdges: Edge[] = [{ id: `${editorId}-e1`, source: `${editorId}-trigger`, target: `${editorId}-transform` }, { id: `${editorId}-e2`, source: `${editorId}-transform`, target: `${editorId}-logger` }];
  const [nodes, setNodes, onNodesChange] = useNodesState(starterNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(starterEdges);
  const [selected, setSelected] = useState(`${editorId}-transform`);
  const [returnDemo, setReturnDemo] = useState('');
  useEffect(() => { setReturnDemo(new URLSearchParams(window.location.search).get('demo') ?? ''); }, []);
  const [workflowId, setWorkflowId] = useState<string>();
  const [workflowName, setWorkflowName] = useState('Untitled workflow');
  const [workflowActive, setWorkflowActive] = useState(false);
  const [message, setMessage] = useState('Ready to build');
  const [busy, setBusy] = useState(false);
  const [configs, setConfigs] = useState<Record<string, Record<string, unknown>>>({ [`${editorId}-logger`]: { message: 'Workflow completed' } });
  const [configDrafts, setConfigDrafts] = useState<Record<string, string>>({});
  const starterIdsInitialized = useRef(false);

  useEffect(() => { if (!getToken()) router.replace('/login'); }, [router]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('workflow')) return;
    if (starterIdsInitialized.current) return;
    starterIdsInitialized.current = true;
    const idMap = new Map([
      [`${editorId}-trigger`, crypto.randomUUID()],
      [`${editorId}-transform`, crypto.randomUUID()],
      [`${editorId}-logger`, crypto.randomUUID()],
    ]);
    setNodes((current) => current.map((node) => ({ ...node, id: idMap.get(node.id) ?? crypto.randomUUID() })));
    setEdges((current) => current.map((edge) => ({ ...edge, id: crypto.randomUUID(), source: idMap.get(edge.source) ?? edge.source, target: idMap.get(edge.target) ?? edge.target })));
    const loggerId = idMap.get(`${editorId}-logger`);
    if (loggerId) setConfigs((current) => ({ [loggerId]: current[`${editorId}-logger`] ?? { message: 'Workflow completed' } }));
    const transformId = idMap.get(`${editorId}-transform`);
    if (transformId) setSelected(transformId);
  }, [editorId, setNodes, setEdges]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('workflow');
    if (!id) return;
    void fetch(`${API_URL}/workflows/${id}`, { headers: authHeaders() })
      .then((response) => response.ok ? response.json() as Promise<WorkflowDocument> : Promise.reject(new Error('Workflow not found')))
      .then((workflow) => {
        setWorkflowId(workflow.id);
        setWorkflowName(workflow.name);
        setWorkflowActive(Boolean(workflow.active));
        setSelected(workflow.nodes.find((node) => node.type === 'webhookTrigger')?.id ?? workflow.nodes[0]?.id ?? '');
        setNodes(workflow.nodes.map((node) => ({ id: node.id, position: node.position, data: { label: node.name, nodeType: node.type }, type: node.type === 'condition' ? 'condition' : node.type.endsWith('Trigger') ? 'input' : 'default' })));
        setEdges(workflow.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle })));
        setConfigs(Object.fromEntries(workflow.nodes.map((node) => [node.id, node.config])));
      })
      .catch(() => setMessage('Unable to load workflow'));
  }, [setNodes, setEdges]);
  useEffect(() => {
    const socket = new WebSocket(`${WS_URL}?token=${encodeURIComponent(getToken() ?? '')}`);
    socket.onmessage = (event) => { const update = JSON.parse(event.data) as { type?: string; message?: string }; setMessage(update.message ?? update.type ?? 'Execution updated'); };
    return () => socket.close();
  }, []);

  const onConnect = useCallback((connection: Connection) => setEdges((current) => addEdge({ ...connection, animated: true }, current)), [setEdges]);
  const selectedNode = nodes.find((node) => node.id === selected);
  const selectedType = selectedNode ? String(selectedNode.data.nodeType ?? nodeType(String(selectedNode.data.label))) : '';
  const updateConfig = (key: string, value: unknown) => setConfigs((current) => ({ ...current, [selected]: { ...(current[selected] ?? {}), [key]: value } }));
  const addNode = (label: string) => {
    const id = `${nodeType(label)}-${crypto.randomUUID()}`;
    setNodes((current) => [...current, { id, position: { x: 240, y: 340 }, data: { label }, type: label === 'Condition' ? 'condition' : label.includes('Trigger') ? 'input' : 'default' }]);
    setSelected(id);
    setMessage(`${label} added to canvas`);
  };
  const document: WorkflowDocument = {
    id: workflowId,
    name: workflowName.trim() || 'Untitled workflow',
    description: 'Created in the visual editor',
    active: workflowActive,
    nodes: nodes.map((node) => ({ id: node.id, type: String(node.data.nodeType ?? nodeType(String(node.data.label))), name: String(node.data.label), position: node.position, config: configs[node.id] ?? {} })),
    edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle ?? undefined, targetHandle: edge.targetHandle ?? undefined })),
  };
  const documentWithDrafts = (): WorkflowDocument => ({
    ...document,
    nodes: document.nodes.map((node) => {
      const draft = configDrafts[node.id];
      if (draft === undefined) return node;
      let parsed: unknown;
      try { parsed = JSON.parse(draft); }
      catch { throw new Error(`Configuration for ${node.name} must be valid JSON`); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`Configuration for ${node.name} must be a JSON object`);
      return { ...node, config: node.type === 'transform' ? { ...node.config, fields: parsed } : parsed as Record<string, unknown> };
    }),
  });
  const save = async (): Promise<string | undefined> => {
    try {
      const payload = documentWithDrafts();
      const response = await fetch(`${API_URL}/workflows`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify(payload) });
      if (!response.ok) { setMessage(`Save failed: ${await responseError(response)}`); return undefined; }
      const saved = await response.json() as WorkflowDocument;
      setWorkflowId(saved.id);
      setWorkflowActive(Boolean(saved.active));
      setConfigs(Object.fromEntries(payload.nodes.map((node) => [node.id, node.config])));
      setConfigDrafts({});
      setMessage('Workflow saved');
      return saved.id;
    } catch (error) {
      setMessage(`Save failed: ${error instanceof Error ? error.message : 'Could not reach the API'}`);
      return undefined;
    }
  };
  const run = async () => {
    setBusy(true);
    try {
      const id = await save();
      if (!id) return;
      const response = await fetch(`${API_URL}/workflows/${id}/execute`, { method: 'POST', headers: authHeaders() });
      if (!response.ok) { setMessage(`Run failed: ${await responseError(response)}`); return; }
      const result = await response.json() as { executionId: string; status: string };
      setMessage(`Execution ${result.status.toLowerCase()}: ${result.executionId}`);
    } catch (error) {
      setMessage(`Run failed: ${error instanceof Error ? error.message : 'Could not reach the API'}`);
    } finally {
      setBusy(false);
    }
  };
  const toggleWorkflow = async () => {
    setBusy(true);
    try {
      const id = await save();
      if (!id) return;
      const active = !workflowActive;
      const response = await fetch(`${API_URL}/workflows/${id}/${active ? 'activate' : 'deactivate'}`, { method: 'POST', headers: authHeaders() });
      if (!response.ok) { setMessage(`Could not change workflow status: ${await responseError(response)}`); return; }
      setWorkflowActive(active);
      setMessage(active ? 'Workflow activated' : 'Workflow deactivated');
    } catch (error) {
      setMessage(`Could not change workflow status: ${error instanceof Error ? error.message : 'Could not reach the API'}`);
    } finally {
      setBusy(false);
    }
  };
  const validate = async () => {
    setBusy(true);
    try {
      const payload = documentWithDrafts();
      const response = await fetch(`${API_URL}/workflows/validate`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify(payload) });
      if (!response.ok) { setMessage(`Validation failed: ${await responseError(response)}`); return; }
      const result = await response.json() as { valid: boolean; errors: string[] };
      setMessage(result.valid ? 'Workflow is valid and ready to run' : result.errors.join('; '));
    } catch (error) {
      setMessage(`Validation failed: ${error instanceof Error ? error.message : 'Could not reach the API'}`);
    } finally {
      setBusy(false);
    }
  };
  const copyWebhook = async () => {
    if (!workflowId || !selectedNode) return;
    const url = `${API_URL}/webhooks/${workflowId}/${selectedNode.id}`;
    try { await navigator.clipboard.writeText(url); setMessage(`Webhook URL copied: ${url}`); }
    catch { setMessage(`Copy is unavailable in this browser. Webhook URL: ${url}`); }
  };
  const saveWebhookDraft = async () => {
    setBusy(true);
    try { await save(); }
    finally { setBusy(false); }
  };

  const configForm = selectedType === 'webhookTrigger'
    ? <div className="webhook-config">
        <span className="eyebrow">LIVE WEBHOOK</span>
        <p>Send a POST request with a JSON body to start this workflow.</p>
        {workflowId && selectedNode
          ? <>
              <div className="webhook-endpoint">
                <span>Endpoint URL</span>
                <code>{`${API_URL}/webhooks/${workflowId}/${selectedNode.id}`}</code>
              </div>
              <button className="save-config" disabled={busy} onClick={() => { void copyWebhook(); }}><Copy size={15} />Copy webhook URL</button>
            </>
          : <>
              <p>Save the workflow once to generate its unique endpoint URL.</p>
              <button className="primary" disabled={busy} onClick={() => { void saveWebhookDraft(); }}><Save size={15} />Save workflow to generate URL</button>
            </>}
        <button className={workflowActive ? 'outline' : 'primary'} disabled={busy} onClick={() => { void toggleWorkflow(); }}>{workflowActive ? 'Deactivate workflow' : 'Activate workflow'}</button>
        <span className={`active-pill ${workflowActive ? 'on' : ''}`}>{workflowActive ? 'Endpoint is accepting requests' : 'Activate to accept requests'}</span>
      </div>
    : selectedType === 'logger' ? <label>Message<input value={String(configs[selected]?.message ?? '')} onChange={(event) => updateConfig('message', event.target.value)} /></label>
    : selectedType === 'condition' ? <><label>Field<input value={String(configs[selected]?.field ?? '')} onChange={(event) => updateConfig('field', event.target.value)} placeholder="approved" /></label><label>Operator<select value={String(configs[selected]?.operator ?? 'equals')} onChange={(event) => updateConfig('operator', event.target.value)}><option value="equals">Equals</option><option value="notEquals">Not equals</option><option value="contains">Contains</option><option value="exists">Exists</option><option value="greaterThan">Greater than</option><option value="lessThan">Less than</option></select></label><label>Compare value<input value={String(configs[selected]?.value ?? '')} onChange={(event) => { const raw = event.target.value; let value: unknown = raw; try { value = JSON.parse(raw); } catch { /* Plain text comparisons stay strings. */ } updateConfig('value', value); }} /></label></>
    : selectedType === 'delay' ? <label>Milliseconds<input type="number" min="0" max="5000" value={Number(configs[selected]?.milliseconds ?? 1000)} onChange={(event) => updateConfig('milliseconds', Number(event.target.value))} /></label>
    : selectedType === 'transform' ? <label>Fields JSON<textarea value={configDrafts[selected] ?? String(configs[selected]?.fields ? JSON.stringify(configs[selected]?.fields, null, 2) : '{}')} onChange={(event) => setConfigDrafts((current) => ({ ...current, [selected]: event.target.value }))} /></label>
    : selectedType === 'httpRequest' ? <><label>URL<input value={String(configs[selected]?.url ?? '')} onChange={(event) => updateConfig('url', event.target.value)} placeholder="https://example.com" /></label><label>Method<select value={String(configs[selected]?.method ?? 'GET')} onChange={(event) => updateConfig('method', event.target.value)}>{['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => <option key={method}>{method}</option>)}</select></label></>
    : selectedType === 'groqChat' ? <><p>Analyzes the previous node’s JSON using Groq. The API key stays on the server.</p><label>Model<input value={String(configs[selected]?.model ?? 'openai/gpt-oss-20b')} onChange={(event) => updateConfig('model', event.target.value)} /></label><label>Analysis instructions<textarea value={String(configs[selected]?.instructions ?? '')} placeholder="Leave blank to use the support-triage instructions." onChange={(event) => updateConfig('instructions', event.target.value)} /></label></>
    : <label>Configuration<textarea value={configDrafts[selected] ?? JSON.stringify(configs[selected] ?? {}, null, 2)} onChange={(event) => setConfigDrafts((current) => ({ ...current, [selected]: event.target.value }))} /></label>;

  return <main className="shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark"><Sparkles size={16} /></div><span>flowcraft</span></div><div className="workspace-label">WORKSPACE <ChevronRight size={12} /></div><nav><a href="/demos"><Sparkles size={17} />Demo applications</a><a className="active" href="/"><LayoutDashboard size={17} />Overview</a><a href="/workflows"><Workflow size={17} />Workflows</a><a href="/executions"><Activity size={17} />Executions</a><a href="#node-library"><Box size={17} />Node library</a><a href="/workflows"><Settings2 size={17} />Workflow settings</a></nav><div className="sidebar-bottom"><div className="status-dot"><span />Workflow workspace</div><div className="user"><div className="avatar">DO</div><div><strong>Flowcraft account</strong><small>Personal workspace</small></div><button className="logout-button" title="Log out" onClick={() => { clearToken(); router.replace('/login'); }}>Log out</button></div></div></aside>
    <section className="content"><header className="topbar"><div><div className="crumb">Workflows <ChevronRight size={13} /> {workflowName}</div><h1>Build an automation</h1></div><div className="top-actions"><button className="ghost" onClick={() => router.push('/executions')}><Terminal size={15} />Logs</button><button className="outline" disabled={busy} onClick={() => { setBusy(true); void save().finally(() => setBusy(false)); }}><Save size={15} />Save</button><button className="primary" disabled={busy} onClick={() => { void run(); }}><CirclePlay size={15} />Run workflow</button></div></header>
      <div className="editor"><div className="canvas-panel"><div className="canvas-toolbar"><a href={returnDemo ? `/demos?demo=${returnDemo}` : "/demos"} className="back-link">← Back to application</a><div className="workflow-title"><div className="workflow-icon"><GitBranch size={17} /></div><div><input aria-label="Workflow name" value={workflowName} onChange={(event) => setWorkflowName(event.target.value)} style={{ border: 0, background: 'transparent', fontWeight: 700, fontSize: 14, color: 'inherit', padding: 0, width: 190 }} /><span>{workflowId ? workflowActive ? 'Active · Live triggers enabled' : 'Saved · Inactive' : 'Draft · Not saved yet'}</span></div></div><div className="toolbar-actions"><button className="icon-btn" title="Validate workflow" disabled={busy} onClick={() => { void validate(); }}><CheckCircle2 size={17} /></button><button className="icon-btn" title="Execution history" onClick={() => router.push('/executions')}><FileText size={17} /></button></div></div><div className="flow-wrap"><ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onNodeClick={(_, node) => setSelected(node.id)} nodeTypes={{ condition: ConditionNode }} fitView><Background color="#d8dee8" gap={24} /><Controls /><MiniMap /></ReactFlow><div className="canvas-hint" role="status" aria-live="polite">{message}</div></div></div>
        <aside className="inspector"><div className="inspector-head"><div><span className="eyebrow">NODE CONFIGURATION</span><h2>{String(selectedNode?.data.label ?? 'Select a node')}</h2></div><Settings2 size={17} /></div><div className="divider" />{configForm}{selectedType !== 'webhookTrigger' && <button className="save-config" disabled={busy} onClick={() => { setBusy(true); void save().finally(() => setBusy(false)); }}><Save size={15} />Save workflow and node</button>}<div className="inspector-footer"><span><span className="live-dot" />Live updates enabled</span><span>v0.1</span></div></aside>
      </div>
    </section>
    <aside className="library" id="node-library"><div className="library-head"><div><span className="eyebrow">NODE LIBRARY</span><h2>Build blocks</h2></div><Plus size={18} /></div><p className="library-copy">Add a block directly to the canvas.</p><h3>Triggers</h3>{['Manual Trigger', 'Webhook Trigger', 'Schedule Trigger'].map((label) => <button className="node-card" key={label} onClick={() => addNode(label)}><span className="node-symbol trigger"><CirclePlay size={15} /></span><span><strong>{label}</strong><small>{label === 'Webhook Trigger' ? 'Start from an HTTP request' : 'Start workflow'}</small></span><Plus size={15} /></button>)}<h3>Actions</h3>{['HTTP Request', 'AI Support Triage', 'Transform Data', 'Condition', 'Delay', 'Logger'].map((label) => <button className="node-card" key={label} onClick={() => addNode(label)}><span className="node-symbol action"><GitBranch size={15} /></span><span><strong>{label}</strong><small>{label === 'AI Support Triage' ? 'Classify and draft a grounded reply' : 'Configure action'}</small></span><Plus size={15} /></button>)}</aside>
  </main>;
}