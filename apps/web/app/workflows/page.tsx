'use client';

import { useEffect, useState } from 'react';
import { Activity, ArrowLeft, Copy, FilePlus2, FolderGit2, Play, Power, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import Link from 'next/link';
import type { WorkflowDocument } from '@workflow/shared-types';
import '../../app/globals.css';
import { authHeaders } from '../../lib/auth';
import { getToken } from '../../lib/auth';
import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
async function responseError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as { message?: string | string[] } | null;
  return Array.isArray(payload?.message) ? payload.message.join('; ') : payload?.message ?? `Request failed (${response.status})`;
}

export default function WorkflowsPage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<WorkflowDocument[]>([]); const [message, setMessage] = useState('');
  const load = async () => {
    try {
      const response = await fetch(`${API_URL}/workflows`, { headers: authHeaders() });
      if (!response.ok) { setMessage(`Could not load workflows: ${await responseError(response)}`); return; }
      setWorkflows(await response.json() as WorkflowDocument[]);
    } catch (error) {
      setMessage(`Could not load workflows: ${error instanceof Error ? error.message : 'Could not reach the API'}`);
    }
  };
  useEffect(() => { if (!getToken()) { router.replace('/login'); return; } void load(); }, [router]);
  const action = async (url: string, method = 'POST') => {
    try {
      const response = await fetch(`${API_URL}${url}`, { method, headers: authHeaders() });
      if (!response.ok) { setMessage(`Action failed: ${await responseError(response)}`); return; }
      const result = response.headers.get('content-type')?.includes('application/json') ? await response.json() as { executionId?: string } : undefined;
      setMessage(result?.executionId ? `Execution queued: ${result.executionId}` : 'Workflow action completed');
      await load();
    } catch (error) {
      setMessage(`Action failed: ${error instanceof Error ? error.message : 'Could not reach the API'}`);
    }
  };
  return <main className="management-page"><header className="management-header"><div><Link className="back-link" href="/"><ArrowLeft size={15} /> Editor</Link><Link className="back-link" href="/demos">Demo applications</Link><div className="history-title"><div className="brand-mark"><Sparkles size={16} /></div><div><span className="eyebrow">WORKSPACE</span><h1>Workflows</h1></div></div><p>Create, organize, and operate your automation graph library.</p></div><div className="management-actions"><button className="icon-btn" title="Refresh" onClick={() => { void load(); }}><RefreshCw size={16} /></button><Link className="primary create-workflow" href="/"><FilePlus2 size={15} />New workflow</Link></div></header><div className="management-bar"><span>{workflows.length} workflows</span>{message && <span className="management-message">{message}</span>}</div>{workflows.length === 0 ? <section className="management-empty"><FolderGit2 size={30} /><strong>No workflows yet</strong><span>Build your first workflow in the visual editor.</span><Link className="primary" href="/">Open editor</Link></section> : <section className="workflow-grid">{workflows.map((workflow) => <article className="workflow-card" key={workflow.id}><div className="workflow-card-head"><div className="workflow-card-icon"><Activity size={17} /></div><span className={`active-pill ${workflow.active ? 'on' : ''}`}>{workflow.active ? 'Active' : 'Draft'}</span></div><h2>{workflow.name}</h2><p>{workflow.description || 'No description provided.'}</p><div className="workflow-meta"><span>{workflow.nodes.length} nodes</span><span>{workflow.edges.length} connections</span></div><div className="workflow-card-actions"><Link className="card-open" href={`/?workflow=${workflow.id}`}><FolderGit2 size={14} />Open</Link><button title="Execute" onClick={() => { void action(`/workflows/${workflow.id}/execute`); }}><Play size={14} /></button><button title="Duplicate" onClick={() => { void action(`/workflows/${workflow.id}/duplicate`); }}><Copy size={14} /></button><button title={workflow.active ? 'Deactivate' : 'Activate'} onClick={() => { void action(`/workflows/${workflow.id}/${workflow.active ? 'deactivate' : 'activate'}`); }}><Power size={14} /></button><button className="danger-action" title="Delete" onClick={() => { if (window.confirm(`Delete ${workflow.name}?`)) void action(`/workflows/${workflow.id}`, 'DELETE'); }}><Trash2 size={14} /></button></div></article>)}</section>}</main>;
}