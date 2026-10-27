'use client';

import { cloneElement, isValidElement, useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, CheckCircle2, Cloud, Database, ExternalLink, Globe, KeyRound, LoaderCircle, Plus, ScanSearch, Trash2, X } from 'lucide-react';
import { api } from '../../lib/api';

type Config = Record<string, unknown>;
type Update = (key: string, value: unknown) => void;
type ExtractionField = { name: string; selector: string; attribute?: string; type?: string };
export type IntegrationCapabilities = { aiConfigured: boolean; webScrapingAvailable: boolean; apifyConfigured: boolean };
type ConnectionStatus = { configured: boolean; connected: boolean; username?: string; message: string };

export function IntegrationRunProgress({ message, data }: { message?: string; data?: unknown }) {
  const progress = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const consoleUrl = typeof progress.consoleUrl === 'string' && /^https:\/\/console\.apify\.com\/actors\/runs\/[a-zA-Z0-9_-]+$/.test(progress.consoleUrl) ? progress.consoleUrl : undefined;
  return <div className="studio-live-progress" aria-live="polite"><span><LoaderCircle size={14} className="studio-spin" />{message ?? 'Collecting data…'}</span>{consoleUrl && <a href={consoleUrl} target="_blank" rel="noreferrer">Open live Apify run <ExternalLink size={12} /></a>}</div>;
}

function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  const control = isValidElement<{ 'aria-label'?: string }>(children) ? cloneElement(children, { 'aria-label': label }) : children;
  return <label className="studio-field"><span>{label}</span>{control}{help && <small>{help}</small>}</label>;
}

export function ScraperParameters({ config, update }: { config: Config; update: Update }) {
  const fields = Array.isArray(config.fields) ? config.fields as ExtractionField[] : [];
  const changeField = (index: number, key: keyof ExtractionField, value: string) => update('fields', fields.map((field, position) => position === index ? { ...field, [key]: value } : field));
  const addField = () => {
    const names = new Set(fields.map((field) => field.name)); let index = 1;
    while (names.has(`field${index}`)) index++;
    update('fields', [...fields, { name: `field${index}`, selector: '', attribute: 'text', type: 'text' }]);
  };
  return <>
    <div className="studio-service-note teal"><ScanSearch size={18} /><div><strong>Live website → structured data</strong><span>Fetches public HTML and follows next-page links. No API key required.</span></div></div>
    <Field label="Website URL" help="Map the URL from your trigger with {{ $json.url }}."><input value={String(config.url ?? '')} placeholder="https://books.toscrape.com/" onChange={(event) => update('url', event.target.value)} /></Field>
    <Field label="Item CSS selector" help="One matching element becomes one record."><input value={String(config.itemSelector ?? '')} placeholder="article.product_pod" onChange={(event) => update('itemSelector', event.target.value)} /></Field>
    <div className="studio-extraction-heading"><div><h3>Fields to extract</h3><p>Selectors are relative to each item.</p></div><span>{fields.length} fields</span></div>
    <div className="studio-extraction-fields">{fields.map((field, index) => <div className="studio-extraction-field" key={index}>
      <div className="studio-extraction-field-heading"><span>FIELD {String(index + 1).padStart(2, '0')}</span><button aria-label={`Remove extraction field ${index + 1}`} title="Remove field" onClick={() => update('fields', fields.filter((_, position) => position !== index))}><Trash2 size={13} /></button></div>
      <Field label={`Field ${index + 1} name`}><input value={field.name} placeholder="title" onChange={(event) => changeField(index, 'name', event.target.value)} /></Field>
      <Field label={`Field ${index + 1} selector`}><input value={field.selector} placeholder="h3 a" onChange={(event) => changeField(index, 'selector', event.target.value)} /></Field>
      <div className="studio-field-pair"><Field label={`Field ${index + 1} attribute`} help="text, href, title, src…"><input value={field.attribute ?? 'text'} onChange={(event) => changeField(index, 'attribute', event.target.value)} /></Field><Field label={`Field ${index + 1} type`}><select value={field.type ?? 'text'} onChange={(event) => changeField(index, 'type', event.target.value)}><option value="text">Text</option><option value="number">Number</option><option value="url">Absolute URL</option></select></Field></div>
    </div>)}</div>
    <button className="studio-button full" disabled={fields.length >= 30} onClick={addField}><Plus size={14} />Add extraction field</button>
    <details className="studio-service-advanced" open><summary>Pagination & limits</summary>
      <Field label="Next page CSS selector" help="Leave blank for a single page. Links stay on the starting website."><input value={String(config.paginationSelector ?? '')} placeholder=".next a" onChange={(event) => update('paginationSelector', event.target.value)} /></Field>
      <div className="studio-field-pair"><Field label="Maximum pages" help="1–5, or a data mapping."><input value={String(config.maxPages ?? 1)} onChange={(event) => update('maxPages', event.target.value)} /></Field><Field label="Maximum records" help="1–200 total."><input type="number" min={1} max={200} value={Number(config.maxItems ?? 100)} onChange={(event) => update('maxItems', Number(event.target.value))} /></Field></div>
      <div className="studio-field-pair"><Field label="Page delay (ms)" help="200–2000 ms."><input type="number" min={200} max={2000} value={Number(config.delayMs ?? 500)} onChange={(event) => update('delayMs', Number(event.target.value))} /></Field><Field label="Request timeout (ms)"><input type="number" min={100} max={30000} value={Number(config.timeoutMs ?? 15000)} onChange={(event) => update('timeoutMs', Number(event.target.value))} /></Field></div>
    </details>
    <p className="studio-explanation">Reads server-rendered HTML and respects robots.txt. For JavaScript-rendered websites, use an Apify browser Actor. Missing values become null; a selector with no matches returns an empty dataset.</p>
  </>;
}

export function ApifyParameters({ type, config, update, inputEditor, configured, onConnections }: { type: string; config: Config; update: Update; inputEditor: ReactNode; configured?: boolean; onConnections: () => void }) {
  return <>
    <div className={`studio-service-note ${configured ? 'teal' : ''}`}><Cloud size={18} /><div><strong>{configured === undefined ? 'Apify cloud integration' : configured ? 'Server token configured' : 'Connect your Apify account'}</strong><span>Credentials stay on the server.</span><button onClick={onConnections}>{configured ? 'Test connection' : 'Connection setup'} <ArrowRight size={11} /></button></div></div>
    {type === 'apifyActor' ? <>
      <Field label="Actor ID or owner/name" help="Choose any Actor compatible with your input JSON."><input value={String(config.actorId ?? '')} placeholder="apify/website-content-crawler" onChange={(event) => update('actorId', event.target.value)} /></Field>
      {inputEditor}
      <p className="studio-explanation">Starts the Actor and waits for a successful run. Connect Apify Dataset next, using <code>{'{{ $json.defaultDatasetId }}'}</code>.</p>
      <Field label="Actor timeout (seconds)" help="1–300 seconds. Cancellation requests an abort in Apify."><input type="number" min={1} max={300} value={Number(config.timeoutSecs ?? 120)} onChange={(event) => update('timeoutSecs', Number(event.target.value))} /></Field>
      <Field label="Maximum charge (USD)" help="Real runs may use Apify credits. This limit is sent to Apify for each run."><input type="number" min={0.01} max={5} step={0.01} value={Number(config.maxTotalChargeUsd ?? 0.1)} onChange={(event) => update('maxTotalChargeUsd', Number(event.target.value))} /></Field>
      <Field label="Maximum billable items" help="1–200. This is a billing limit for pay-per-result Actors. Set the Actor’s own page limit in Input JSON as well."><input type="number" min={1} max={200} value={Number(config.maxItems ?? 20)} onChange={(event) => update('maxItems', Number(event.target.value))} /></Field>
      <a className="studio-docs-link" href="https://apify.com/apify/website-content-crawler/input-schema" target="_blank" rel="noreferrer">Website Content Crawler input reference <ExternalLink size={12} /></a>
    </> : <>
      <Field label="Dataset ID" help="Map from a preceding Actor or enter an existing dataset ID."><input value={String(config.datasetId ?? '')} placeholder="{{ $json.defaultDatasetId }}" onChange={(event) => update('datasetId', event.target.value)} /></Field>
      <div className="studio-field-pair"><Field label="Record limit" help="1–200 per read."><input type="number" min={1} max={200} value={Number(config.limit ?? 100)} onChange={(event) => update('limit', Number(event.target.value))} /></Field><Field label="Offset" help="Skip records for pagination."><input type="number" min={0} value={Number(config.offset ?? 0)} onChange={(event) => update('offset', Number(event.target.value))} /></Field></div>
      <Field label="Fields to include" help="Optional comma-separated names. Leave blank for every field."><input value={String(config.fields ?? '')} placeholder="url,title,text" onChange={(event) => update('fields', event.target.value)} /></Field>
      <p className="studio-explanation">Returns an <code>items</code> array, record count, and dataset metadata. Connect Filter Items, Code / Expression, AI Analysis, or Workflow Result.</p>
    </>}
  </>;
}

export function IntegrationCenter({ onClose, onRecipe, onCapabilities }: { onClose: () => void; onRecipe: (id: string) => void; onCapabilities: (capabilities: IntegrationCapabilities) => void }) {
  const [capabilities, setCapabilities] = useState<IntegrationCapabilities>();
  const [connection, setConnection] = useState<ConnectionStatus>();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    api<IntegrationCapabilities>('/capabilities').then((value) => { if (alive) { setCapabilities(value); onCapabilities(value); } }).catch((err: Error) => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, [onCapabilities]);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [onClose]);
  async function testConnection() {
    setChecking(true); setError('');
    try { const value = await api<ConnectionStatus>('/integrations/apify/status'); setConnection(value); setCapabilities((current) => current ? { ...current, apifyConfigured: value.configured } : current); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to check Apify'); }
    finally { setChecking(false); }
  }
  return <div className="studio-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="studio-modal studio-integrations" role="dialog" aria-modal="true" aria-label="Integrations">
    <header><div><span className="studio-section-label">CONNECTED TO THE REAL WORLD</span><h2>Give your workflow a wider world.</h2></div><button title="Close integrations" aria-label="Close integrations" onClick={onClose}><X size={21} /></button></header>
    <p>Collect from websites, run cloud scrapers, and turn the results into something useful.</p>
    <div className="studio-integration-grid">
      <article className="studio-integration-card"><span className="studio-integration-icon"><ScanSearch size={25} /></span><span className="studio-connection-status ready"><CheckCircle2 size={12} />Ready to run</span><h3>Native web scraping</h3><p>Extract text, numbers, and links with CSS selectors. Follow pagination and build a clean dataset without an external account.</p><div className="studio-integration-tags"><span>HTML extraction</span><span>Pagination</span><span>No key</span></div><button className="studio-button primary" onClick={() => onRecipe('scrape')}>Try live price research <ArrowRight size={14} /></button></article>
      <article className="studio-integration-card"><span className="studio-integration-icon"><Cloud size={25} /></span><span className={`studio-connection-status ${connection?.connected ? 'ready' : 'pending'}`}>{checking ? <LoaderCircle size={12} className="studio-spin" /> : <KeyRound size={12} />}{connection?.connected ? `Connected${connection.username ? ` · ${connection.username}` : ''}` : capabilities === undefined ? 'Checking setup…' : capabilities.apifyConfigured ? 'Token configured · Test connection' : 'Account connection needed'}</span><h3>Apify cloud Actors</h3><p>Run specialized scrapers, including browser Actors for dynamic pages. Read the resulting dataset into the next step of your workflow.</p><div className="studio-integration-tags"><span>Cloud runs</span><span>Dataset API</span><span>Cost limit</span></div><div className="studio-integration-actions"><button className="studio-button" disabled={checking} onClick={() => void testConnection()}>{checking ? <LoaderCircle size={13} className="studio-spin" /> : <CheckCircle2 size={13} />}Test Apify connection</button><button className="studio-button" onClick={() => onRecipe('apify')}>Open recipe <ArrowRight size={13} /></button></div>{connection && <p className={`studio-connection-message ${connection.connected ? 'connected' : ''}`} role="status">{connection.message}</p>}</article>
    </div>
    <div className="studio-integration-setup"><KeyRound size={20} /><div><h3>Connect Apify once on your server</h3><p>Create an API token in Apify Console → Settings → Integrations. Add it to the project’s <code>.env</code>, then restart the API and worker:</p><pre>APIFY_API_TOKEN=your_apify_token</pre><p>Docker: <code>docker compose up -d --force-recreate api worker</code></p><p>The token is never included in the editor, exported workflows, or execution outputs. Apify charges depend on the Actor; this recipe starts with a $0.10 run limit.</p><a href="https://console.apify.com/settings/integrations" target="_blank" rel="noreferrer">Open Apify token settings <ExternalLink size={12} /></a></div></div>
    <div className="studio-integration-footer"><Globe size={16} /><p>The live price recipe fetches <a href="https://books.toscrape.com/" target="_blank" rel="noreferrer">Books to Scrape</a>, a public scraping practice catalogue. Its product prices are fictional; the extraction and processing run live.</p><Database size={17} /></div>
    {error && <p className="studio-inspector-error" role="alert">{error}</p>}
  </section></div>;
}
