'use client';
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Braces, CheckCircle2, Copy, Download, FileSpreadsheet, Globe, Search, Table2 } from 'lucide-react';
import { datasetColumns, datasetCsv, downloadData } from '../../lib/dataset';

function printable(value: unknown) { return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '—'); }
function publicLink(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; } catch { return; }
}
function cell(row: unknown, column: string): unknown { return row && typeof row === 'object' ? (row as Record<string, unknown>)[column] : row; }

export function OutputView({ value, label = 'Output', onMessage }: { value: unknown; label?: string; onMessage: (message: string) => void }) {
  const [mode, setMode] = useState<'json' | 'table'>(() => Array.isArray(value) || (value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items)) ? 'table' : 'json');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ column: string; ascending: boolean }>();
  const serialized = JSON.stringify(value ?? null, null, 2);
  const rows: unknown[] | null = Array.isArray(value) ? value : value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items) ? (value as { items: unknown[] }).items : null;
  const columns = rows ? datasetColumns(rows).slice(0, 12) : [];
  const visible = useMemo(() => {
    const found = rows ? rows.filter((row) => !query || printable(row).toLowerCase().includes(query.toLowerCase())) : [];
    if (sort) found.sort((a, b) => { const left = cell(a, sort.column); const right = cell(b, sort.column); const comparison = typeof left === 'number' && typeof right === 'number' ? left - right : printable(left).localeCompare(printable(right)); return sort.ascending ? comparison : -comparison; });
    return found;
  }, [rows, query, sort]);
  const fileBase = `flowcraft-${label.toLowerCase().replaceAll(' ', '-')}`;
  return <div className="studio-output-view">
    <div className="studio-output-toolbar"><span>{label}</span><div>
      <button aria-label={`Show ${label} as JSON`} className={mode === 'json' ? 'on' : ''} onClick={() => setMode('json')}><Braces size={13} />JSON</button>
      {rows && <button aria-label={`Show ${label} as table`} className={mode === 'table' ? 'on' : ''} onClick={() => setMode('table')}><Table2 size={13} />Table</button>}
      {rows && <button className="studio-csv" aria-label={`Export ${label} as CSV`} title="Export all records as CSV" onClick={() => { downloadData(datasetCsv(rows), `${fileBase}.csv`, 'text/csv;charset=utf-8'); onMessage(`All ${rows.length} records exported as CSV`); }}><FileSpreadsheet size={13} />CSV</button>}
      <button title={`Copy ${label}`} aria-label={`Copy ${label}`} onClick={async () => { try { await navigator.clipboard.writeText(serialized); onMessage(`${label} copied`); } catch { onMessage('Clipboard is unavailable. Select and copy the JSON directly.'); } }}><Copy size={13} /></button>
      <button title={`Download ${label}`} aria-label={`Download ${label}`} onClick={() => { downloadData(serialized, `${fileBase}.json`, 'application/json'); onMessage(`${label} downloaded`); }}><Download size={13} /></button>
    </div></div>
    {mode === 'table' && rows ? <>
      <div className="studio-dataset-tools"><label><Search size={12} /><input aria-label={`Search ${label} records`} placeholder="Search records…" value={query} onChange={(event) => setQuery(event.target.value)} /></label><span>{query ? `${visible.length} matches · ` : ''}{rows.length} records{visible.length > 100 ? ' · First 100 shown' : ''}</span></div>
      {visible.length ? <div className="studio-data-table"><table><thead><tr>{columns.map((column) => <th key={column} aria-sort={sort?.column === column ? sort.ascending ? 'ascending' : 'descending' : 'none'}><button aria-label={`Sort ${label} by ${column}`} onClick={() => setSort({ column, ascending: sort?.column === column ? !sort.ascending : true })}>{column}{sort?.column === column && (sort.ascending ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}</button></th>)}</tr></thead><tbody>{visible.slice(0, 100).map((row, index) => <tr key={index}>{columns.map((column) => { const value = cell(row, column); const url = publicLink(value); return <td key={column}>{url ? <a href={url} target="_blank" rel="noreferrer">{printable(value)}</a> : printable(value)}</td>; })}</tr>)}</tbody></table></div> : <div className="studio-data-empty">{query ? 'No records match your search.' : 'This step returned an empty dataset.'}</div>}
    </> : <pre tabIndex={0}>{serialized}</pre>}
  </div>;
}

export function ResultReport({ value, onMessage }: { value: unknown; onMessage: (message: string) => void }) {
  const envelope = value && typeof value === 'object' ? value as { title?: string; summary?: string; data?: unknown } : {};
  const data = envelope.data ?? value;
  const record = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};
  const metricOrder = ['productsCollected', 'matches', 'budgetGBP', 'averagePriceGBP', 'lowestPriceGBP', 'pagesScraped', 'pagesCollected', 'count', 'total', 'average', 'minimum', 'maximum'];
  const fields = Object.entries(record).filter(([key, entry]) => !['_ai', 'input', 'sourceUrl', 'scrapedAt'].includes(key) && !Array.isArray(entry) && (typeof entry !== 'object' || entry === null)).sort(([a], [b]) => (metricOrder.includes(a) ? metricOrder.indexOf(a) : 100) - (metricOrder.includes(b) ? metricOrder.indexOf(b) : 100));
  const source = publicLink(record.sourceUrl);
  return <div className="studio-report"><div className="studio-report-title"><CheckCircle2 size={23} /><div><span>WORKFLOW OUTPUT</span><h3>{envelope.title ?? 'Your workflow completed'}</h3></div></div>{envelope.summary && <p>{envelope.summary}</p>}{fields.length > 0 && <div className="studio-report-metrics">{fields.slice(0, 8).map(([key, entry]) => <div key={key}><span>{key.replace(/([a-z])([A-Z])/g, '$1 $2')}</span><strong>{typeof entry === 'number' ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(entry) : typeof entry === 'boolean' ? entry ? 'Yes' : 'No' : String(entry ?? '—')}</strong></div>)}</div>}{source && <div className="studio-source-note"><Globe size={14} /><div>Live source: <a href={source} target="_blank" rel="noreferrer">{new URL(source).hostname}</a>{typeof record.scrapedAt === 'string' && <span> · Retrieved {new Date(record.scrapedAt).toLocaleString()}</span>}</div></div>}<OutputView key={JSON.stringify(data)} value={data} label="Result data" onMessage={onMessage} /></div>;
}
