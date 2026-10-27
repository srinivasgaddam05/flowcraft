import { load } from 'cheerio';
import type { NodeContext, WorkflowNodeExecutor } from '@flowcraft/engine';
import { resolveTemplates } from './expressions';
import { FLOWCRAFT_USER_AGENT, publicUrl, safeFetchText, type SafeTextOptions, type SafeTextResponse } from './safe-http';

interface ScrapeField { name: string; selector: string; attribute?: string; type?: 'text' | 'number' | 'url'; }
interface ScrapeConfig {
  url: string;
  itemSelector: string;
  fields: ScrapeField[];
  paginationSelector?: string;
  maxPages: number;
  maxItems: number;
  delayMs: number;
  timeoutMs: number;
}
type CancellableContext = NodeContext & { signal?: AbortSignal; checkCancelled?: () => void | Promise<void> };
export interface WebScrapeDependencies {
  fetchText?: (url: string | URL, options?: SafeTextOptions) => Promise<SafeTextResponse>;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  now?: () => Date;
}

const templated = (value: unknown) => typeof value === 'string' && value.includes('{{');
const forbiddenNames = new Set(['__proto__', 'prototype', 'constructor']);
const emptyDocument = load('');

function selectorError(selector: unknown, name: string, optional = false): string | undefined {
  if (typeof selector !== 'string' || (!optional && !selector.trim()) || selector.length > 500) return `${name} must be a CSS selector of 1–500 characters`;
  if (!selector.trim() || selector === ':scope' || templated(selector)) return;
  try { emptyDocument(selector); } catch { return `${name} is not a valid CSS selector`; }
}

export function validateWebScrapeConfig(config: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (typeof config.url !== 'string' || !config.url.trim()) errors.push('Website URL is required');
  else if (!templated(config.url)) { try { publicUrl(config.url); } catch (error) { errors.push(error instanceof Error ? error.message : 'Website URL is invalid'); } }
  const itemError = selectorError(config.itemSelector, 'Item selector');
  if (itemError) errors.push(itemError);
  if (config.paginationSelector !== undefined) {
    const error = selectorError(config.paginationSelector, 'Pagination selector', true);
    if (error) errors.push(error);
  }
  if (!Array.isArray(config.fields) || config.fields.length === 0 || config.fields.length > 30) errors.push('Configure between 1 and 30 extraction fields');
  else {
    const names = new Set<string>();
    for (const [index, value] of config.fields.entries()) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) { errors.push(`Field ${index + 1} must be an object`); continue; }
      const field = value as Record<string, unknown>;
      if (typeof field.name !== 'string' || !field.name.trim() || field.name.length > 80 || forbiddenNames.has(field.name)) errors.push(`Field ${index + 1} needs a safe name of 1–80 characters`);
      else if (names.has(field.name)) errors.push(`Extraction field name '${field.name}' is duplicated`);
      else names.add(field.name);
      const error = selectorError(field.selector, `Selector for field ${String(field.name || index + 1)}`, true);
      if (error) errors.push(error);
      if (field.attribute !== undefined && (typeof field.attribute !== 'string' || !/^[\w:-]{1,80}$/.test(field.attribute))) errors.push(`Field ${String(field.name)} has an invalid attribute`);
      if (field.type !== undefined && !['text', 'number', 'url'].includes(String(field.type))) errors.push(`Field ${String(field.name)} type must be text, number, or url`);
    }
  }
  for (const [name, fallback, minimum, maximum] of [['maxPages', 1, 1, 5], ['maxItems', 100, 1, 200], ['delayMs', 500, 200, 2000], ['timeoutMs', 15000, 100, 30000]] as const) {
    const value = config[name] ?? fallback;
    if (!templated(value) && (!Number.isInteger(Number(value)) || Number(value) < minimum || Number(value) > maximum)) errors.push(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return errors;
}

interface RobotRule { allow: boolean; path: string; }
interface RobotGroup { agents: string[]; rules: RobotRule[]; }
function normalizedRobotPath(value: string): string {
  return value.replace(/[^\x00-\x7f]/gu, (character) => encodeURIComponent(character)).replace(/%[\da-f]{2}/gi, (code) => {
    const character = String.fromCharCode(parseInt(code.slice(1), 16));
    return /[a-z\d\-._~]/i.test(character) ? character : code.toUpperCase();
  });
}

function robotPatternMatches(pattern: string, path: string): boolean {
  // Greedy glob matching avoids regular-expression backtracking on untrusted robots files.
  const anchored = pattern.endsWith('$');
  const glob = anchored ? pattern.slice(0, -1) : `${pattern}*`;
  let part = 0;
  let offset = 0;
  let star = -1;
  let retry = 0;
  while (offset < path.length) {
    if (glob[part] === path[offset]) { part++; offset++; }
    else if (glob[part] === '*') { star = part++; retry = offset; }
    else if (star >= 0) { part = star + 1; offset = ++retry; }
    else return false;
  }
  while (glob[part] === '*') part++;
  return part === glob.length;
}

/** RFC 9309 group selection, wildcard paths, longest match, and Allow tie breaking. */
export function robotsAllows(text: string, target: URL, userAgent = FLOWCRAFT_USER_AGENT): boolean {
  const groups: RobotGroup[] = [];
  let current: RobotGroup | undefined;
  let hasDirectives = false;
  for (const original of text.replace(/^\ufeff/, '').split(/\r?\n/)) {
    const line = original.split('#', 1)[0].trim();
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === 'user-agent') {
      if (!current || hasDirectives) { current = { agents: [], rules: [] }; groups.push(current); hasDirectives = false; }
      if (value) current.agents.push(value.toLowerCase());
    } else if (current && (key === 'allow' || key === 'disallow')) {
      hasDirectives = true;
      if (value.length > 8192) throw new Error('robots.txt contains an oversized rule; scraping stopped');
      if (value) current.rules.push({ allow: key === 'allow', path: normalizedRobotPath(value) });
    }
  }
  const matching = groups.map((group) => ({ group, score: Math.max(-1, ...group.agents.map((agent) => agent === '*' ? 0 : userAgent.toLowerCase().includes(agent) ? agent.length : -1)) }));
  const specificity = Math.max(-1, ...matching.map(({ score }) => score));
  if (specificity < 0) return true;
  const path = normalizedRobotPath(`${target.pathname}${target.search}`);
  let best = -1;
  let allowed = true;
  for (const { group, score } of matching) {
    if (score !== specificity) continue;
    for (const rule of group.rules) {
      const prefix = rule.path.endsWith('$') ? rule.path.slice(0, -1) : rule.path;
      if (!robotPatternMatches(rule.path, path)) continue;
      const length = Buffer.byteLength(prefix.replace(/\*/g, '').replace(/%[\dA-F]{2}/g, 'x'));
      if (length > best || (length === best && rule.allow)) { best = length; allowed = rule.allow; }
    }
  }
  return allowed;
}

function numberFromText(value: string): number | null {
  const match = value.replace(/[\u00a0\u202f]/g, '').match(/[-+]?\d+(?:[.,]\d+)*/)?.[0];
  if (!match) return null;
  let cleaned = match;
  if (cleaned.includes(',') && cleaned.includes('.')) cleaned = cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned.replace(/,/g, '');
  else if (cleaned.includes(',')) cleaned = /,\d{3}(?:,\d{3})*$/.test(cleaned) ? cleaned.replace(/,/g, '') : cleaned.replace(',', '.');
  const result = Number(cleaned);
  return Number.isFinite(result) ? result : null;
}

function extractedUrl(value: string, pageUrl: string): string | null {
  try { const url = new URL(value, pageUrl); return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null; } catch { return null; }
}

function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason ?? new Error('Scraping cancelled')); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export function createWebScrapeExecutor(dependencies: WebScrapeDependencies = {}): WorkflowNodeExecutor {
  const fetchText = dependencies.fetchText ?? safeFetchText;
  return {
    type: 'webScrape', label: 'Web Scraper', category: 'action', validate: validateWebScrapeConfig,
    async execute(context: CancellableContext, rawConfig) {
      const resolved = await resolveTemplates(rawConfig, context.input, context.variables) as Record<string, unknown>;
      // Runtime validation also checks template values after resolving against actual input.
      const errors = validateWebScrapeConfig(resolved);
      if (Object.values(resolved).some(templated)) errors.push('Website configuration contains an unresolved template');
      if (errors.length) throw new Error(errors.join('; '));
      const config: ScrapeConfig = { ...resolved, maxPages: Number(resolved.maxPages ?? 1), maxItems: Number(resolved.maxItems ?? 100), delayMs: Number(resolved.delayMs ?? 500), timeoutMs: Number(resolved.timeoutMs ?? 15000) } as unknown as ScrapeConfig;
      const start = publicUrl(config.url);
      const pages: Array<{ url: string; itemCount: number }> = [];
      const items: Record<string, string | number | null>[] = [];
      const visited = new Set<string>();
      const robots = new Map<string, Promise<string>>();
      const checkpoint = async () => { context.signal?.throwIfAborted(); await context.checkCancelled?.(); };
      const robotsFor = (url: URL) => {
        let pending = robots.get(url.origin);
        if (!pending) {
          pending = (async () => {
            await checkpoint();
            const response = await fetchText(new URL('/robots.txt', url), { timeoutMs: config.timeoutMs, maxBytes: 512000, signal: context.signal });
            if ([404, 410].includes(response.status)) return '';
            if (response.status < 200 || response.status >= 300) throw new Error(`Cannot verify robots.txt (${response.status}); scraping stopped`);
            return response.text;
          })();
          robots.set(url.origin, pending);
        }
        return pending;
      };
      const assertAllowed = async (url: URL) => {
        await checkpoint();
        const rules = await robotsFor(url);
        if (!robotsAllows(rules, url)) throw new Error(`robots.txt disallows FlowcraftBot from scraping ${url.pathname}`);
      };
      let next: URL | undefined = start;
      let outputBytes = 0;
      while (next && pages.length < config.maxPages && items.length < config.maxItems) {
        await checkpoint();
        if (visited.has(next.toString())) break;
        if (pages.length > 0) { await (dependencies.sleep ?? sleep)(config.delayMs, context.signal); await checkpoint(); }
        await assertAllowed(next);
        await context.reportProgress?.({ message: `Fetching page ${pages.length + 1} · ${items.length} records collected`, data: { sourceUrl: start.toString(), currentUrl: next.toString(), pagesCompleted: pages.length, itemsCollected: items.length } });
        const response = await fetchText(next, { timeoutMs: config.timeoutMs, maxBytes: 2_000_000, signal: context.signal, beforeRequest: assertAllowed });
        await checkpoint();
        if (response.status < 200 || response.status >= 300) throw new Error(`Website returned HTTP ${response.status}; no items were extracted from this page`);
        const type = response.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
        if (type && !['text/html', 'application/xhtml+xml'].includes(type)) throw new Error(`Web Scraper requires HTML; website returned ${type}`);
        // Recheck the final URL so injected transports and redirects use the same policy.
        const finalUrl = publicUrl(response.url);
        await assertAllowed(finalUrl);
        if (visited.has(finalUrl.toString())) break;
        visited.add(next.toString());
        visited.add(finalUrl.toString());
        const $ = load(response.text, { baseURI: response.url });
        const elements = $(config.itemSelector).toArray();
        let count = 0;
        for (const element of elements) {
          if (items.length >= config.maxItems) break;
          await checkpoint();
          const row: Record<string, string | number | null> = {};
          for (const field of config.fields) {
            const target = !field.selector.trim() || field.selector === ':scope' ? $(element) : $(element).find(field.selector).first();
            const attribute = field.attribute ?? 'text';
            const raw = target.length ? attribute === 'text' ? target.text() : target.attr(attribute) : undefined;
            const value = raw?.replace(/\s+/g, ' ').trim();
            if (value && value.length > 10000) throw new Error(`Extracted field '${field.name}' exceeds 10000 characters; narrow its selector`);
            row[field.name] = value === undefined || value === '' ? null : field.type === 'number' ? numberFromText(value) : field.type === 'url' || ['href', 'src'].includes(attribute) ? extractedUrl(value, response.url) : value;
          }
          outputBytes += Buffer.byteLength(JSON.stringify(row));
          if (outputBytes > 1_000_000) throw new Error('Scraped data exceeds the 1 MB output limit; reduce maxItems or extraction fields');
          items.push(row);
          count++;
        }
        pages.push({ url: response.url, itemCount: count });
        await context.reportProgress?.({ message: `${pages.length} ${pages.length === 1 ? 'page' : 'pages'} collected · ${items.length} records`, data: { sourceUrl: start.toString(), pagesCompleted: pages.length, itemsCollected: items.length } });
        next = undefined;
        if (config.paginationSelector && pages.length < config.maxPages && items.length < config.maxItems) {
          const link = $(config.paginationSelector).first().attr('href');
          if (link) {
            const candidate = publicUrl(new URL(link, response.url));
            if (candidate.origin !== finalUrl.origin) throw new Error('Pagination links must stay on the same website origin');
            if (!visited.has(candidate.toString())) next = candidate;
          }
        }
      }
      await checkpoint();
      return { data: { sourceUrl: start.toString(), pages, count: items.length, items, scrapedAt: (dependencies.now?.() ?? new Date()).toISOString() } };
    },
  };
}
