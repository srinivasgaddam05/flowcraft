'use client';

import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowLeft, Ban, ChevronDown, ChevronRight, RefreshCw, Sparkles } from 'lucide-react';
import Link from 'next/link';
import type { ExecutionEvent } from '@workflow/shared-types';
import '../../app/globals.css';
import { authHeaders } from '../../lib/auth';
import { getToken } from '../../lib/auth';
import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:4000';
type Execution = { id: string; workflowId: string; status: string; startedAt?: string; completedAt?: string; error?: string; events: ExecutionEvent[] };
function eventLabel(event: ExecutionEvent): string {
  if (event.type === 'execution.started' && event.status === 'QUEUED') return 'execution.queued';
  if (event.type === 'execution.started' && event.status === 'RUNNING') return 'execution.running';
  return event.type;
}
async function responseError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as { message?: string | string[] } | null;
  return Array.isArray(payload?.message) ? payload.message.join('; ') : payload?.message ?? `Request failed (${response.status})`;
}

export default function ExecutionsPage() {
  const router = useRouter();
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [expanded, setExpanded] = useState<string>();
  const expandedRef = useRef<string | undefined>(undefined);
  expandedRef.current = expanded;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const load = async () => { setLoading(true); try { const response = await fetch(`${API_URL}/executions`, { headers: authHeaders() }); if (!response.ok) throw new Error(await responseError(response)); const records = await response.json() as Execution[];
    if (expandedRef.current) { const detailResponse = await fetch(`${API_URL}/executions/${expandedRef.current}`, { headers: authHeaders() }); if (detailResponse.ok) { const detail = await detailResponse.json() as Execution; const index = records.findIndex((record) => record.id === detail.id); if (index >= 0) records[index] = detail; } }
    setExecutions(records); setLoadError(''); } catch (error) { setLoadError(`Unable to load executions: ${error instanceof Error ? error.message : 'Check that Flowcraft is running'}`); } finally { setLoading(false); } };
  const cancel = async (id: string) => { try { const response = await fetch(`${API_URL}/executions/${id}/cancel`, { method: 'POST', headers: authHeaders() }); if (!response.ok) throw new Error(await responseError(response)); setLoadError(''); await load(); } catch (error) { setLoadError(`Unable to cancel execution: ${error instanceof Error ? error.message : 'Check that Flowcraft is running'}`); } };
  useEffect(() => { if (!getToken()) { router.replace('/login'); return; } void load(); const socket = new WebSocket(`${WS_URL}?token=${encodeURIComponent(getToken() ?? '')}`); let refreshTimer: ReturnType<typeof setTimeout>; socket.onmessage = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { void load(); }, 750); }; const timer = setInterval(() => { void load(); }, 5000); return () => { socket.close(); clearInterval(timer); clearTimeout(refreshTimer); }; }, [router]);
  useEffect(() => { if (!expanded) return; void fetch(`${API_URL}/executions/${expanded}`, { headers: authHeaders() }).then(async (response) => { if (!response.ok) throw new Error(await responseError(response)); const detail = await response.json() as Execution; setExecutions((current) => current.map((execution) => execution.id === detail.id ? detail : execution)); }).catch((error: unknown) => setLoadError(`Unable to load execution details: ${error instanceof Error ? error.message : 'Request failed'}`)); }, [expanded]);
  return <main className="history-page"><header className="history-header"><div><Link className="back-link" href="/"><ArrowLeft size={15} /> Editor</Link><Link className="back-link" href="/demos">Demo applications</Link><div className="history-title"><div className="brand-mark"><Sparkles size={16} /></div><div><span className="eyebrow">OBSERVABILITY</span><h1>Execution history</h1></div></div><p>Inspect every run, status transition, and node output from your workflows.</p></div><button className="outline" onClick={() => { void load(); }}><RefreshCw size={15} />Refresh</button></header><section className="history-shell">{loadError && <p role="alert" style={{ margin: 16, color: '#a33' }}>{loadError}</p>}<div className="history-summary"><div><span className="eyebrow">TOTAL RUNS</span><strong>{executions.length}</strong></div><div><span className="eyebrow">SUCCESSFUL</span><strong>{executions.filter((execution) => execution.status === 'SUCCESS').length}</strong></div><div><span className="eyebrow">FAILED</span><strong>{executions.filter((execution) => execution.status === 'FAILED').length}</strong></div><div className="history-live"><span className="live-dot" />Live event stream enabled</div></div>{loading ? <div className="history-empty">Loading execution history...</div> : executions.length === 0 ? <div className="history-empty"><Activity size={28} /><strong>No executions yet</strong><span>Run a workflow from the editor to see its activity here.</span><Link className="primary history-action" href="/">Open editor</Link></div> : <div className="execution-list">{executions.map((execution) => { const isOpen = expanded === execution.id; const cancellable = execution.status === 'QUEUED' || execution.status === 'RUNNING'; return <article className="execution-row" key={execution.id}><div className="execution-main"><button className="execution-expand" onClick={() => setExpanded(isOpen ? undefined : execution.id)}><span className={`status-badge ${execution.status.toLowerCase()}`}><span />{execution.status}</span><span className="execution-id">{execution.id}</span><span className="execution-time">{execution.startedAt ? new Date(execution.startedAt).toLocaleString() : 'Queued'}</span>{isOpen ? <ChevronDown size={17} /> : <ChevronRight size={17} />}</button>{cancellable && <button className="cancel-button" title="Cancel execution" onClick={() => { void cancel(execution.id); }}><Ban size={14} />Cancel</button>}</div>{isOpen && <div className="execution-details"><div className="detail-heading"><strong>Event timeline</strong><span>{execution.events.length} events</span></div>{execution.error && <p role="alert">{execution.error}</p>}{execution.events.map((event, index) => <div className="event-row" key={`${event.timestamp}-${index}`}><span className={`event-dot ${event.status.toString().toLowerCase()}`} /><div><strong>{eventLabel(event)}</strong><small>{event.nodeId ? `Node ${event.nodeId} · ` : ''}{new Date(event.timestamp).toLocaleTimeString()}</small></div>{event.message && <code>{event.message}</code>}{event.data !== undefined && <pre style={{ gridColumn: '2 / -1', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 260, overflow: 'auto', margin: '6px 0 0', padding: 10, background: '#f1f5f9', borderRadius: 5, fontSize: 11 }}>{JSON.stringify(event.data, null, 2)}</pre>}</div>)}</div>}</article>; })}</div>}</section></main>;
}