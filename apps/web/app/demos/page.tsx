'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Activity, ArrowLeft, ArrowRight, CheckCircle2, Clock3, GitBranch, Headphones, Lightbulb, LoaderCircle, MessageSquare, PackageCheck, Play, RefreshCw, ShieldAlert, Sparkles, Users, XCircle } from 'lucide-react';
import type { WorkflowDocument } from '@workflow/shared-types';
import { api, ApiError } from '../../lib/api';
import { clearToken, getToken } from '../../lib/auth';
import { DemoExecution, DemoTemplate, demoResult, friendlyLabel } from '../../lib/demo';
import './style.css';

const presentations: Record<string, { title: string; verb: string; icon: typeof Headphones; color: string; category: string }> = {
  'support-ticket-triage': { title: 'Make support feel personal.', verb: 'Triage ticket', icon: Headphones, color: 'violet', category: 'CUSTOMER SUPPORT' },
  'lead-qualification': { title: 'Find your next great customer.', verb: 'Qualify lead', icon: Users, color: 'blue', category: 'SALES OPERATIONS' },
  'feedback-insights': { title: 'Hear what customers are saying.', verb: 'Analyze feedback', icon: MessageSquare, color: 'amber', category: 'CUSTOMER EXPERIENCE' },
  'order-intake-validation': { title: 'Get every order off to a good start.', verb: 'Validate order', icon: PackageCheck, color: 'green', category: 'COMMERCE' },
  'it-incident-prioritization': { title: 'Bring clarity to the next incident.', verb: 'Prioritize incident', icon: ShieldAlert, color: 'rose', category: 'IT OPERATIONS' },
};
const terminalStatuses = ['SUCCESS', 'FAILED', 'CANCELLED'];
function storageKey(userId: string, templateId: string) { return `flowcraft.demo.${userId}.${templateId}`; }
function renderValue(value: unknown): React.ReactNode {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return <ul>{value.map((item, index) => <li key={index}>{typeof item === 'object' ? JSON.stringify(item) : String(item)}</li>)}</ul>;
  if (value && typeof value === 'object') return <pre>{JSON.stringify(value, null, 2)}</pre>;
  return String(value ?? 'Not provided');
}
export default function DemosPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<DemoTemplate[]>([]);
  const [user, setUser] = useState<{ id: string; name: string }>();
  const [selected, setSelected] = useState<DemoTemplate>();
  const [workflow, setWorkflow] = useState<WorkflowDocument>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [execution, setExecution] = useState<DemoExecution>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [aiReady, setAiReady] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const pending = useRef(false);
  const selectedId = useRef('');
  const polling = useRef<AbortController | null>(null);
  const sample = (template: DemoTemplate) => setValues(Object.fromEntries(template.inputFields.map((field) => [field.name, String(template.inputExample[field.name] ?? '')])));
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [list, account, capabilities] = await Promise.all([api<DemoTemplate[]>('/workflow-templates'), api<{ id: string; name: string }>('/auth/me'), api<{ aiConfigured: boolean }>('/capabilities')]);
      setTemplates(list); setUser(account); setAiReady(capabilities.aiConfigured);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load applications'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (!getToken()) { router.replace('/login'); return; } void load(); return () => { polling.current?.abort(); }; }, [load, router]);
  const choose = async (template: DemoTemplate) => {
    polling.current?.abort(); selectedId.current = template.id;
    setSelected(template); sample(template); setExecution(undefined); setWorkflow(undefined); setError('');
    if (!user) return;
    const cached = localStorage.getItem(storageKey(user.id, template.id));
    if (!cached) { setRestoring(false); return; }
    setRestoring(true);
    try {
      const stored = JSON.parse(cached) as { workflowId: string; executionId?: string; values?: Record<string, string> };
      const saved = await api<WorkflowDocument>(`/workflows/${stored.workflowId}`);
      if (selectedId.current !== template.id) return;
      setWorkflow(saved);
      if (stored.values) setValues(stored.values);
      if (stored.executionId) {
        const run = await api<DemoExecution>(`/executions/${stored.executionId}`);
        if (selectedId.current !== template.id) return;
        setExecution(run);
        if (!terminalStatuses.includes(run.status)) void poll(run.id);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) localStorage.removeItem(storageKey(user.id, template.id));
      else if (selectedId.current === template.id) setError(err instanceof Error ? err.message : 'Unable to restore demo');
    } finally { if (selectedId.current === template.id) setRestoring(false); }
  };
  useEffect(() => {
    if (!templates.length) return;
    const id = new URLSearchParams(window.location.search).get('demo');
    const template = templates.find((item) => item.id === id);
    if (template) void choose(template);
  // Selection restoration runs after the account and templates arrive.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates]);
  async function poll(id: string) {
    polling.current?.abort(); const controller = new AbortController(); polling.current = controller;
    setRecovering(true); setError('');
    try {
      for (let count = 0; count < 120; count++) {
        const run = await api<DemoExecution>(`/executions/${id}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setExecution(run);
        if (terminalStatuses.includes(run.status)) return;
        await new Promise<void>((resolve) => { const timer = setTimeout(resolve, 2500); controller.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true }); });
        if (controller.signal.aborted) return;
      }
      setError('This run is taking longer than expected. Resume checking or inspect execution history.');
    } catch (err) { if (!controller.signal.aborted) setError(`Progress check interrupted: ${err instanceof Error ? err.message : 'Connection failed'}. You can resume checking below.`); }
    finally { if (polling.current === controller) setRecovering(false); }
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!selected || !user || pending.current) return;
    pending.current = true; setBusy(true); setError(''); setExecution(undefined);
    try {
      const input: Record<string, unknown> = {};
      for (const field of selected.inputFields) {
        const value = values[field.name]?.trim() ?? '';
        if (field.required && !value) throw new Error(`${friendlyLabel(field.name)} is required`);
        if (!value) continue;
        if (field.type === 'number' && !Number.isFinite(Number(value))) throw new Error(`${friendlyLabel(field.name)} must be a valid number`);
        input[field.name] = field.type === 'number' ? Number(value) : value;
      }
      let target = workflow;
      if (!target) {
        target = await api<WorkflowDocument>(`/workflow-templates/${selected.id}/instantiate`, { method: 'POST' });
        setWorkflow(target);
        localStorage.setItem(storageKey(user.id, selected.id), JSON.stringify({ workflowId: target.id }));
      }
      target = await api<WorkflowDocument>(`/workflows/${target.id}/activate`, { method: 'POST' }); setWorkflow(target);
      const trigger = target.nodes.find((node) => node.type === 'webhookTrigger');
      if (!trigger) throw new Error('This workflow no longer has a webhook trigger. Open the editor to restore it.');
      const queued = await api<{ executionId: string }>(`/webhooks/${target.id}/${trigger.id}`, { method: 'POST', body: JSON.stringify(input) }, false);
      localStorage.setItem(storageKey(user.id, selected.id), JSON.stringify({ workflowId: target.id, executionId: queued.executionId, values }));
      setExecution({ id: queued.executionId, workflowId: target.id!, status: 'QUEUED', events: [] });
      void poll(queued.executionId);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to submit this application'); }
    finally { setBusy(false); pending.current = false; }
  };
  const running = busy || restoring || Boolean(execution && !terminalStatuses.includes(execution.status));
  const result = workflow && execution?.status === 'SUCCESS' ? demoResult(workflow, execution) : undefined;
  const presentation = selected ? presentations[selected.id] : undefined;
  return <div className="demo-app"><header className="demo-nav"><Link href="/demos" className="demo-brand" onClick={() => { selectedId.current = ''; setSelected(undefined); polling.current?.abort(); }}><span><GitBranch size={20} /></span>flowcraft<small>APPLICATIONS</small></Link><nav><Link href="/workflows">Workflows</Link><Link href="/executions">Run history</Link><Link href="/">Open editor <ArrowRight size={14} /></Link><button onClick={() => { clearToken(); router.replace('/login'); }}>Sign out</button></nav></header><main className="demo-main">
    {!selected ? <><div className="demo-hero"><span className="demo-eyebrow"><span /> YOUR AUTOMATION WORKSPACE</span><h1>Less busywork.<br /><em>More possibilities.</em></h1><p>Five everyday problems. Five connected workflows.<br />Choose an application and let Flowcraft take care of the steps.</p><div className="demo-greeting">Welcome{user ? `, ${user.name}` : ''}. What would you like to move forward?</div></div>{loading && <div className="demo-loading"><LoaderCircle className="spin" />Loading your applications…</div>}{error && <div className="demo-error" role="alert">{error}<button onClick={() => void load()}>Try again</button></div>}<div className="demo-grid">{templates.map((template, index) => { const config = presentations[template.id]; const Icon = config?.icon ?? Activity; return <button key={template.id} className={`demo-card ${config?.color}`} onClick={() => { router.replace(`/demos?demo=${template.id}`, { scroll: false }); void choose(template); }}><div className="demo-card-top"><span className="demo-icon"><Icon size={24} /></span><span className="demo-mode">{template.requiresAi ? <><Sparkles size={12} />AI assisted</> : <><CheckCircle2 size={12} />Rules based</>}</span></div><span className="demo-category">{config?.category}</span><h2>{config?.title ?? template.name}</h2><p>{template.summary}</p><div className="demo-card-foot"><span>{config?.verb ?? 'Open application'}</span><ArrowRight size={19} /></div><span className="demo-card-number">0{index + 1}</span></button>; })}<aside className="demo-explainer"><span className="demo-icon"><GitBranch size={24} /></span><h2>Every result has a story.</h2><p>Follow your input through the visual workflow. See each decision, each route, and each output.</p><Link href="/">Explore the editor <ArrowRight size={16} /></Link></aside></div><div className="demo-bottom"><span><ShieldAlert size={15} />Every run is recorded in your workspace.</span><span>Input → Workflow → Result</span></div></> : <>
      <button className="demo-back" disabled={busy} onClick={() => { selectedId.current = ''; setSelected(undefined); polling.current?.abort(); router.replace('/demos', { scroll: false }); }}><ArrowLeft size={16} />All applications</button><div className="demo-detail-heading"><div><span className="demo-category">{presentation?.category}</span><h1>{selected.name}</h1><p>{selected.description}</p></div>{workflow && <Link className="demo-secondary" href={`/?workflow=${workflow.id}&demo=${selected.id}`}>Reveal workflow <GitBranch size={16} /></Link>}</div><div className="demo-workspace"><section className="demo-form-panel"><div className="demo-panel-heading"><span className={`demo-icon ${presentation?.color}`}><Play size={20} /></span><div><h2>Start with the details</h2><p>Required fields are marked with an asterisk.</p></div></div><form onSubmit={submit}>{selected.inputFields.map((field) => { const multiline = ['customerMessage', 'need', 'comment', 'description', 'impact'].includes(field.name); return <label key={field.name} className="demo-field"><span>{friendlyLabel(field.name)}{field.required && <b> *</b>}</span>{multiline ? <textarea required={field.required} disabled={running} value={values[field.name] ?? ''} onChange={(event) => setValues({ ...values, [field.name]: event.target.value })} rows={4} maxLength={10000} /> : <input required={field.required} disabled={running} type={field.type === 'number' ? 'number' : field.name === 'customerEmail' ? 'email' : 'text'} step={field.type === 'number' ? 'any' : undefined} value={values[field.name] ?? ''} onChange={(event) => setValues({ ...values, [field.name]: event.target.value })} maxLength={2000} />}<small>{field.description}</small></label>; })}{selected.requiresAi && <div className="demo-ai-note"><Sparkles size={16} /><span>{aiReady ? 'AI produces suggestions for human review. Check the result before taking action.' : 'AI is not configured. Add GROQ_API_KEY to the API and worker, then restart them. Order validation works without AI.'}</span></div>}<div className="demo-form-actions"><button type="button" className="demo-secondary" disabled={running} onClick={() => sample(selected)}><RefreshCw size={14} />Use example</button><button className="demo-primary" disabled={running || (selected.requiresAi && !aiReady)}>{running ? <LoaderCircle size={16} className="spin" /> : <ArrowRight size={16} />}{restoring ? 'Restoring…' : busy ? 'Submitting…' : running ? 'Processing…' : presentation?.verb ?? 'Run workflow'}</button></div></form></section><section className="demo-result-panel" aria-live="polite"><div className="demo-panel-heading"><span className="demo-icon"><Lightbulb size={20} /></span><div><h2>Your result</h2><p>From submitted information to a clear next step.</p></div></div>{error && <div className="demo-error" role="alert">{error}</div>}{!execution && !busy && <div className="demo-result-empty"><GitBranch size={42} /><h3>A little input. A lot of clarity.</h3><p>Complete the form or use the example to see your workflow in action.</p><div className="demo-steps"><span>01 Submit</span><span>02 Process</span><span>03 Review</span></div></div>}{running && <div className="demo-progress"><LoaderCircle className="spin" size={32} /><h3>{execution?.status === 'RUNNING' ? 'Your workflow is running' : 'Preparing your run'}</h3><p>{execution?.events.filter((event) => event.type === 'node.completed').length ?? 0} steps completed · {execution?.status ?? 'SUBMITTING'}</p></div>}{execution && !terminalStatuses.includes(execution.status) && !busy && <button className="demo-secondary" onClick={async () => { try { const cancelled = await api<DemoExecution>(`/executions/${execution.id}/cancel`, { method: 'POST' }); polling.current?.abort(); setExecution(cancelled); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to cancel'); } }}>Cancel run</button>}{execution && !terminalStatuses.includes(execution.status) && !recovering && !busy && <button className="demo-secondary" onClick={() => void poll(execution.id)}>Resume checking</button>}{execution?.status === 'FAILED' && <div className="demo-failed"><XCircle size={28} /><h3>This run needs attention</h3><p>{execution.error ?? 'A workflow step failed. Review the timeline for details.'}</p><p>Update the input or configuration and submit again.</p></div>}{execution?.status === 'CANCELLED' && <p>This execution was cancelled. You can submit a new run.</p>}{result && <div className="demo-result"><div className="demo-success"><CheckCircle2 size={19} /><span>Workflow completed</span>{execution?.completedAt && <small>{new Date(execution.completedAt).toLocaleTimeString()}</small>}</div>{result.route && <div className="demo-route"><span>OUTCOME / ROUTE</span><h3>{result.route}</h3><p>{result.message}</p></div>}<dl>{Object.entries(result.fields).map(([key, value]) => <div className={`demo-result-field ${['summary', 'fitSummary', 'suggestedReply', 'recommendedAction'].includes(key) ? 'wide' : ''}`} key={key}><dt>{friendlyLabel(key)}</dt><dd>{renderValue(value)}</dd></div>)}</dl>{selected.requiresAi && <p className="demo-review-note">AI suggestions need human review. No email or external notification was sent.</p>}</div>}{execution && <><div className="demo-run-reference"><Clock3 size={14} />Run <code>{execution.id}</code><Link href="/executions">History ↗</Link></div><details className="demo-timeline"><summary>Inspect steps and underlying outputs</summary>{execution.events.filter((event) => event.nodeId).map((event, index) => <div key={index}><strong>{workflow?.nodes.find((node) => node.id === event.nodeId)?.name ?? event.nodeId}</strong><span>{event.status}</span>{event.message && <p>{event.message}</p>}{event.data !== undefined && <pre>{JSON.stringify(event.data, null, 2)}</pre>}</div>)}</details></>}</section></div></>}
  </main><footer className="demo-footer"><span>flowcraft · Ideas into action.</span><span>Built to make the steps visible.</span></footer></div>;
}
