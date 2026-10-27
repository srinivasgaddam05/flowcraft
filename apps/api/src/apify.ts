import type { NodeContext, WorkflowNodeExecutor } from '@flowcraft/engine';
import { resolveTemplates } from './expressions';

const APIFY_ORIGIN = 'https://api.apify.com';
const RESPONSE_BYTES = 1_000_000;
const terminalStatuses = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);
const activeStatuses = new Set(['READY', 'RUNNING', 'TIMING-OUT', 'ABORTING']);
const missingTokenMessage = 'Apify is not configured. Set APIFY_API_TOKEN for the API and worker, then recreate both services. No Actor was started.';
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isTemplate = (value: unknown): boolean => typeof value === 'string' && value.includes('{{');

export interface ApifyClientOptions {
  fetch?: typeof globalThis.fetch;
  getToken?: () => string | undefined;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface ApifyConnectionStatus {
  configured: boolean;
  connected: boolean;
  username?: string;
  message: string;
}

class ApifyError extends Error {}

function identifier(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().replace('/', '~');
  return /^[a-zA-Z0-9_-]+(?:~[a-zA-Z0-9_-]+)?$/.test(normalized) && normalized.length <= 200 ? normalized : undefined;
}

function numberError(value: unknown, fallback: number, minimum: number, maximum: number, label: string, integer = true): string[] {
  if (isTemplate(value)) return [];
  const parsed = value === undefined ? fallback : Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum && (!integer || Number.isInteger(parsed)) ? [] : [`${label} must be ${integer ? 'an integer' : 'a number'} between ${minimum} and ${maximum}`];
}

function credentialErrors(config: Record<string, unknown>): string[] {
  return Object.keys(config).some((key) => /^(token|apitoken|apikey|apify_api_token|authorization|headers)$/i.test(key))
    ? ['Apify credentials belong in server APIFY_API_TOKEN, never in node configuration'] : [];
}

export function validateApifyActor(config: Record<string, unknown>): string[] {
  const errors = credentialErrors(config);
  if (!isTemplate(config.actorId) && !identifier(config.actorId)) errors.push('Actor ID is required: use owner/actor-name or an Apify Actor ID');
  if (config.input !== undefined && !isTemplate(config.input) && !isObject(config.input)) errors.push('Actor input must be a JSON object');
  errors.push(...numberError(config.timeoutSecs, 120, 1, 300, 'Actor timeout'));
  errors.push(...numberError(config.maxItems, 20, 1, 200, 'Maximum billable items'));
  if (!isTemplate(config.maxTotalChargeUsd)) {
    const charge = Number(config.maxTotalChargeUsd ?? 0.1);
    if (!Number.isFinite(charge) || charge <= 0 || charge > 5) errors.push('Maximum run charge must be greater than 0 and at most 5 USD');
  }
  return errors;
}

export function validateApifyDataset(config: Record<string, unknown>): string[] {
  const errors = credentialErrors(config);
  if (!isTemplate(config.datasetId) && !identifier(config.datasetId)) errors.push('Dataset ID is required; map the previous Actor defaultDatasetId');
  errors.push(...numberError(config.limit, 100, 1, 200, 'Dataset page size'));
  errors.push(...numberError(config.offset, 0, 0, Number.MAX_SAFE_INTEGER, 'Dataset offset'));
  if (config.fields !== undefined && (typeof config.fields !== 'string' || config.fields.length > 2000)) errors.push('Dataset fields must be a comma-separated string of up to 2000 characters');
  return errors;
}

function apiError(status: number, action: string): ApifyError {
  const reason = status === 401 ? 'the token is invalid or expired; update server APIFY_API_TOKEN'
    : status === 403 ? 'the token lacks access; check its permissions and Actor access'
      : status === 402 ? 'the account needs credits or an Actor subscription; check Apify billing'
        : status === 404 ? 'the Actor, run, or dataset was not found; check its ID and access'
          : status === 429 ? 'the Apify rate or concurrency limit was reached; wait before trying again'
            : status === 400 ? 'the input or run limits were rejected; check the Actor input schema, minimum charge, and account limits in Apify Console'
              : status >= 500 ? 'Apify is temporarily unavailable; check Apify Console before retrying'
                : 'the request was rejected; check Apify Console';
  return new ApifyError(`Apify ${action} failed (HTTP ${status}): ${reason}.`);
}

async function readJson(response: Response): Promise<unknown> {
  const declaredSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new ApifyError('Apify response exceeds 1 MB. Reduce the dataset page size or select fewer fields.');
  }
  if (!response.body) throw new ApifyError('Apify returned an empty response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > RESPONSE_BYTES) {
        await reader.cancel();
        throw new ApifyError('Apify response exceeds 1 MB. Reduce the dataset page size or select fewer fields.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApifyError('Apify returned invalid JSON. Check the run in Apify Console.'); }
}

function runData(value: unknown): Record<string, unknown> {
  if (!isObject(value) || !isObject(value.data) || !identifier(value.data.id) || typeof value.data.status !== 'string') throw new ApifyError('Apify returned an invalid run response. Check Apify Console before retrying.');
  if (!terminalStatuses.has(value.data.status) && !activeStatuses.has(value.data.status)) throw new ApifyError('Apify returned an unknown run status. Check Apify Console before retrying.');
  return value.data;
}

export class ApifyClient {
  private readonly fetch: typeof globalThis.fetch;
  private readonly getToken: () => string | undefined;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(options: ApifyClientOptions = {}) {
    this.fetch = options.fetch ?? ((...args) => globalThis.fetch(...args));
    this.getToken = options.getToken ?? (() => process.env.APIFY_API_TOKEN);
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  private token(): string {
    const token = this.getToken()?.trim();
    if (!token) throw new ApifyError(missingTokenMessage);
    return token;
  }

  private async request(path: string, token: string, action: string, options: { method?: string; body?: string; timeoutMs?: number; context?: NodeContext } = {}): Promise<{ json: unknown; headers: Headers }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
    timeout.unref();
    let cancelled: unknown;
    let checking = false;
    const check = options.context?.checkCancelled;
    const cancellationTimer = check ? setInterval(async () => {
      if (checking || cancelled) return;
      checking = true;
      try { await check(); }
      catch (error) { cancelled = error; controller.abort(); }
      finally { checking = false; }
    }, 500) : undefined;
    cancellationTimer?.unref();
    try {
      const response = await this.fetch(`${APIFY_ORIGIN}/v2${path}`, {
        method: options.method ?? 'GET',
        headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: options.body,
        signal: controller.signal,
        redirect: 'error',
      });
      if (cancelled) throw cancelled;
      if (!response.ok) {
        await response.body?.cancel();
        throw apiError(response.status, action);
      }
      const json = await readJson(response);
      if (cancelled) throw cancelled;
      return { json, headers: response.headers };
    } catch (error) {
      if (cancelled) throw cancelled;
      if (error instanceof ApifyError) throw error;
      // Network errors and provider bodies can contain request credentials. Never persist them.
      throw new ApifyError(`Apify ${action} could not be confirmed. Check Apify Console and your connection before retrying; the Actor may already have started.`);
    } finally {
      clearTimeout(timeout);
      if (cancellationTimer) clearInterval(cancellationTimer);
    }
  }

  async connection(): Promise<ApifyConnectionStatus> {
    if (!this.getToken()?.trim()) return { configured: false, connected: false, message: missingTokenMessage };
    try {
      const { json } = await this.request('/users/me', this.token(), 'connection check', { timeoutMs: 10_000 });
      if (!isObject(json) || !isObject(json.data) || typeof json.data.id !== 'string') throw new ApifyError('Apify returned an invalid account response.');
      const username = typeof json.data.username === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(json.data.username) ? json.data.username : undefined;
      return { configured: true, connected: true, ...(username ? { username } : {}), message: 'Apify connection verified. Actor runs use your Apify account and configured limits.' };
    } catch (error) {
      return { configured: true, connected: false, message: error instanceof ApifyError ? error.message : 'Apify connection could not be verified.' };
    }
  }

  async runActor(context: NodeContext, config: Record<string, unknown>): Promise<unknown> {
    const errors = validateApifyActor(config);
    if (errors.length) throw new ApifyError(errors.join('; '));
    const token = this.token();
    const actorId = identifier(config.actorId)!;
    const timeoutSecs = Number(config.timeoutSecs ?? 120);
    const input = JSON.stringify(config.input ?? {});
    if (Buffer.byteLength(input) > 100_000) throw new ApifyError('Apify Actor input exceeds 100 KB. Reduce the input.');
    const query = new URLSearchParams({ timeout: String(timeoutSecs), maxItems: String(config.maxItems ?? 20), maxTotalChargeUsd: String(config.maxTotalChargeUsd ?? 0.1), restartOnError: 'false' });
    await context.checkCancelled?.();
    const deadline = this.now() + timeoutSecs * 1000 + 15_000;
    let run: Record<string, unknown> | undefined;
    const progress = async () => {
      if (!run) return;
      await context.reportProgress?.({ message: `Apify Actor · ${String(run.status)}`, data: {
        runId: run.id, status: run.status,
        consoleUrl: `https://console.apify.com/actors/runs/${encodeURIComponent(String(run.id))}`,
        defaultDatasetId: typeof run.defaultDatasetId === 'string' ? run.defaultDatasetId : null,
      } });
    };
    try {
      // Never retry this POST. A lost response can still mean Apify started a billable run.
      // Let its response arrive before checking cancellation so we can abort a known run ID.
      run = runData((await this.request(`/actors/${encodeURIComponent(actorId)}/runs?${query}`, token, 'Actor start', { method: 'POST', body: input })).json);
      await progress();
      while (!terminalStatuses.has(String(run.status))) {
        await context.checkCancelled?.();
        if (this.now() >= deadline) throw new ApifyError('Apify Actor exceeded the workflow wait limit.');
        const polledAt = this.now();
        const response = await this.request(`/actor-runs/${encodeURIComponent(String(run.id))}?waitForFinish=5`, token, 'run status', { timeoutMs: Math.max(100, Math.min(10_000, deadline - this.now())), context });
        const next = runData(response.json);
        if (next.id !== run.id) throw new ApifyError('Apify returned a mismatched run ID.');
        run = { ...run, ...next };
        await progress();
        // Long polling normally waits five seconds. Avoid a tight loop if an intermediary returns early.
        if (!terminalStatuses.has(String(run.status))) await this.sleep(Math.max(0, 500 - (this.now() - polledAt)));
      }
      await context.checkCancelled?.();
      const consoleUrl = `https://console.apify.com/actors/runs/${encodeURIComponent(String(run.id))}`;
      if (run.status !== 'SUCCEEDED') throw new ApifyError(`Apify Actor finished with status ${run.status}. Open ${consoleUrl} for its log and input details.`);
      const datasetId = typeof run.defaultDatasetId === 'string' && identifier(run.defaultDatasetId) ? run.defaultDatasetId : null;
      return {
        runId: run.id,
        status: run.status,
        actorId: typeof run.actId === 'string' && identifier(run.actId) ? run.actId : actorId,
        defaultDatasetId: datasetId,
        consoleUrl,
        startedAt: typeof run.startedAt === 'string' ? run.startedAt : null,
        finishedAt: typeof run.finishedAt === 'string' ? run.finishedAt : null,
      };
    } catch (error) {
      if (run && !terminalStatuses.has(String(run.status))) {
        let aborted = false;
        try { await this.request(`/actor-runs/${encodeURIComponent(String(run.id))}/abort`, token, 'run abort', { method: 'POST', timeoutMs: 5000 }); aborted = true; }
        catch { /* The original error stays actionable; the remote timeout and cost cap still apply. */ }
        if (error instanceof ApifyError) throw new ApifyError(`${error.message} ${aborted ? 'A remote abort was requested.' : 'Remote abort could not be confirmed; stop the run in Apify Console.'} Run: https://console.apify.com/actors/runs/${encodeURIComponent(String(run.id))}`);
      }
      throw error;
    }
  }

  async dataset(context: NodeContext, config: Record<string, unknown>): Promise<unknown> {
    const errors = validateApifyDataset(config);
    if (errors.length) throw new ApifyError(errors.join('; '));
    const token = this.token();
    const datasetId = identifier(config.datasetId)!;
    const limit = Number(config.limit ?? 100);
    const offset = Number(config.offset ?? 0);
    const query = new URLSearchParams({ clean: 'true', format: 'json', limit: String(limit), offset: String(offset) });
    if (typeof config.fields === 'string' && config.fields.trim()) query.set('fields', config.fields.trim());
    await context.checkCancelled?.();
    const { json, headers } = await this.request(`/datasets/${encodeURIComponent(datasetId)}/items?${query}`, token, 'dataset read', { context });
    await context.checkCancelled?.();
    if (!Array.isArray(json) || json.length > limit) throw new ApifyError('Apify returned an invalid dataset page.');
    const totalHeader = headers.get('x-apify-pagination-total');
    const total = totalHeader === null ? NaN : Number(totalHeader);
    // clean=true can remove empty items, so use the requested page span rather than returned count.
    return { datasetId, count: json.length, items: json, offset, ...(Number.isSafeInteger(total) && total >= 0 ? { total, hasMore: offset + limit < total, nextOffset: offset + limit < total ? offset + limit : null } : {}) };
  }
}

export function checkApifyConnection(options: ApifyClientOptions = {}): Promise<ApifyConnectionStatus> {
  return new ApifyClient(options).connection();
}

export function createApifyExecutors(options: ApifyClientOptions = {}): WorkflowNodeExecutor[] {
  const client = new ApifyClient(options);
  return [
    { type: 'apifyActor', label: 'Apify Actor', category: 'action', validate: validateApifyActor, execute: async (context, config) => ({ data: await client.runActor(context, await resolveTemplates(config, context.input, context.variables) as Record<string, unknown>) }) },
    { type: 'apifyDataset', label: 'Apify Dataset', category: 'action', validate: validateApifyDataset, execute: async (context, config) => ({ data: await client.dataset(context, await resolveTemplates(config, context.input, context.variables) as Record<string, unknown>) }) },
  ];
}
