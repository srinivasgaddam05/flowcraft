import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Injectable } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { evaluateExpression, readPath, resolveTemplates, validateExpression } from './expressions';
import { NodeRegistry, type NodeContext, type WorkflowNodeExecutor } from '@flowcraft/engine';
import { createWebScrapeExecutor } from './web-scrape';
import { createApifyExecutors } from './apify';

const simple = (type: string, label: string, category: 'trigger' | 'action', run: WorkflowNodeExecutor['execute']): WorkflowNodeExecutor => ({ type, label, category, validate: () => [], execute: async (context, config) => run(context, await resolveTemplates(config, context.input, context.variables) as Record<string, unknown>) });

function publicAddress(address: string): boolean {
  const value = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (value.startsWith('::ffff:')) return publicAddress(value.slice(7));
  if (isIP(value) === 4) {
    const [a, b] = value.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)));
  }
  return isIP(value) === 6 && /^[23]/.test(value) && !value.startsWith('2001:db8:');
}
async function assertSafeUrl(value: string): Promise<URL> {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use a public HTTP(S) URL without embedded credentials');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new Error('HTTP Request cannot access local or private network addresses');
  return url;
}

const defaultTriageInstructions = [
  'You are a careful customer-support triage assistant.',
  'Use only facts present in the supplied ticket data. Do not invent policies, order details, or product facts.',
  'Return one JSON object with these keys: category, urgency (low|normal|high), sentiment, summary, suggestedReply, needsHumanReview (boolean), and evidence (array of short facts copied or paraphrased from the input).',
  'Set needsHumanReview to true if the ticket is ambiguous, asks for a refund/exception, or lacks enough information.',
].join(' ');

@Injectable()
export class NodeService {
  readonly registry = new NodeRegistry();
  constructor() {
    this.registry.register(createWebScrapeExecutor());
    for (const executor of createApifyExecutors()) this.registry.register(executor);
    this.registry.register(simple('manualTrigger', 'Manual Trigger', 'trigger', async (context) => ({ data: context.input === undefined ? {} : context.input })));
    this.registry.register(simple('webhookTrigger', 'Webhook Trigger', 'trigger', async (context) => ({ data: context.input === undefined ? {} : context.input })));
    this.registry.register(simple('scheduleTrigger', 'Schedule Trigger', 'trigger', async (context) => ({ data: context.input ?? { scheduled: true } })));
    this.registry.register(simple('logger', 'Logger', 'action', async (context, config) => ({ data: { input: context.input, message: config.message ?? 'Event logged' } })));
    this.registry.register(simple('transform', 'Transform Data', 'action', async (context, config) => ({ data: { ...(typeof context.input === 'object' && context.input ? context.input : {}), ...(config.fields as object ?? {}) } })));
    this.registry.register({ type: 'condition', label: 'Condition', category: 'action', validate: () => [], execute: async (context, config) => { const input = typeof context.input === 'object' && context.input ? context.input as Record<string, unknown> : {}; const left = config.field ? readPath(input, String(config.field)) : context.input; const right = config.value; const operator = String(config.operator ?? 'equals'); const result = operator === 'notEquals' ? left !== right : operator === 'exists' ? left !== undefined && left !== null && (typeof left !== 'string' || left.trim().length > 0) : operator === 'contains' ? String(left).includes(String(right)) : operator === 'greaterThan' ? Number(left) > Number(right) : operator === 'lessThan' ? Number(left) < Number(right) : left === right; return { data: { ...input, input: context.input, result }, branch: result ? 'true' : 'false' }; } });
    this.registry.register(simple('delay', 'Delay', 'action', async (context, config) => { await new Promise((resolve) => setTimeout(resolve, Math.min(Number(config.milliseconds ?? 0), 5000))); return { data: context.input }; }));
    this.registry.register(simple('httpRequest', 'HTTP Request', 'action', async (context, config) => {
      const url = await assertSafeUrl(String(config.url));
      const method = String(config.method ?? 'GET').toUpperCase();
      const timeoutMs = Number(config.timeoutMs ?? 15000);
      if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new Error('HTTP timeout must be between 100 and 30000 ms');
      const response = await fetch(url, { method, redirect: 'error', headers: { ...(!['GET', 'HEAD'].includes(method) ? { 'content-type': 'application/json' } : {}), ...((config.headers as Record<string, string>) ?? {}) }, body: ['GET', 'HEAD'].includes(method) ? undefined : JSON.stringify(config.body === undefined ? context.input : config.body), signal: AbortSignal.timeout(timeoutMs) });
      const content = await response.text();
      if (content.length > 1000000) throw new Error('HTTP response exceeds 1 MB');
      let body: unknown = content;
      try { body = JSON.parse(content); } catch { /* Preserve non-JSON responses as text. */ }
      if (!response.ok && config.continueOnError !== true) throw new Error(`HTTP request failed with status ${response.status}: ${content.slice(0, 250)}`);
      return { data: { status: response.status, headers: Object.fromEntries(response.headers.entries()), body } };
    }));
    this.registry.register({ type: 'expression', label: 'Code / Expression', category: 'action', validate: (config) => validateExpression(config.expression), execute: async (context, config) => ({ data: await evaluateExpression(String(config.expression), context.input, context.variables) }) });
    this.registry.register(simple('filter', 'Filter Items', 'action', async (context, config) => {
      const items = config.field ? readPath(context.input, String(config.field)) : context.input;
      if (!Array.isArray(items)) throw new Error('Filter Items requires an array; set the array field path or pass an array as input');
      const matches = await evaluateExpression(`$filter($, function($item) { ${String(config.predicate ?? 'true')} })`, items, context.variables);
      return { data: Array.isArray(matches) ? matches : matches === null || matches === undefined ? [] : [matches] };
    }));
    this.registry.register(simple('aggregate', 'Summarize Items', 'action', async (context, config) => {
      const items = config.field ? readPath(context.input, String(config.field)) : context.input;
      if (!Array.isArray(items)) throw new Error('Summarize Items requires an array');
      const values = items.map((item) => config.valueField ? readPath(item, String(config.valueField)) : item).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      const total = values.reduce((sum, value) => sum + value, 0);
      return { data: { count: items.length, numericCount: values.length, total, average: values.length ? total / values.length : null, minimum: values.length ? Math.min(...values) : null, maximum: values.length ? Math.max(...values) : null, items } };
    }));
    this.registry.register(simple('result', 'Workflow Result', 'action', async (context, config) => ({ data: { title: config.title ?? 'Workflow complete', summary: config.summary ?? 'Your data has been processed.', data: context.input } })));
    this.registry.register(simple('webhookResponse', 'Webhook Response', 'action', async (context) => ({ data: context.input })));
    this.registry.register(simple('groqChat', 'AI Support Triage', 'action', async (context, config) => {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) throw new Error('AI Support Triage is not configured. Set GROQ_API_KEY for the API and worker.');

      const model = String(config.model ?? 'openai/gpt-oss-20b').trim();
      const instructions = String(config.instructions ?? defaultTriageInstructions).trim();
      if (!model) throw new Error('AI model is required');
      if (!instructions) throw new Error('AI instructions are required');

      const input = JSON.stringify(context.input === undefined ? {} : context.input);
      if (input.length > 30_000) throw new Error('AI input exceeds the 30000-character limit');

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 1000,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: `${instructions}\nReturn valid JSON only.` },
            { role: 'user', content: `Analyze this workflow input:\n${input}` },
          ],
        }),
        signal: AbortSignal.timeout(45_000),
      });

      if (!response.ok) {
        const body = (await response.text()).slice(0, 500);
        throw new Error(`Groq AI request failed (${response.status}): ${body}`);
      }

      const result = await response.json() as {
        choices?: Array<{ message?: { content?: string | null } }>;
        model?: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const content = result.choices?.[0]?.message?.content;
      if (!content) throw new Error('Groq AI returned an empty response');

      let analysis: unknown;
      try {
        analysis = JSON.parse(content);
      } catch {
        throw new Error('Groq AI returned invalid JSON');
      }
      if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) {
        throw new Error('Groq AI response must be a JSON object');
      }

      return {
        data: {
          ...(analysis as Record<string, unknown>),
          _ai: { provider: 'groq', model: result.model ?? model, usage: result.usage },
        },
      };
    }));
    for (const executor of this.registry.list()) {
      const original = executor.validate;
      executor.validate = (config) => {
        const errors = original(config);
        if (executor.type === 'httpRequest') {
          if (typeof config.url !== 'string' || !config.url.trim()) errors.push('Request URL is required');
          else if (!config.url.includes('{{')) { try { const url = new URL(config.url); if (!['http:', 'https:'].includes(url.protocol)) errors.push('Request URL must use HTTP or HTTPS'); } catch { errors.push('Request URL is invalid'); } }
          if (config.headers !== undefined && (!config.headers || typeof config.headers !== 'object' || Array.isArray(config.headers))) errors.push('Request headers must be a JSON object');
        }
        if (executor.type === 'filter') errors.push(...validateExpression(`$filter($, function($item) { ${String(config.predicate ?? 'true')} })`));
        if (executor.type === 'transform' && config.fields !== undefined && (!config.fields || typeof config.fields !== 'object' || Array.isArray(config.fields))) errors.push('Set Fields requires a JSON object');
        if (executor.type === 'delay' && (!Number.isFinite(Number(config.milliseconds ?? 0)) || Number(config.milliseconds ?? 0) < 0 || Number(config.milliseconds ?? 0) > 5000)) errors.push('Delay must be between 0 and 5000 ms');
        if (executor.type === 'scheduleTrigger' && (!Number.isFinite(Number(config.intervalMs)) || Number(config.intervalMs) < 1000)) errors.push('Schedule interval must be at least 1000 ms');
        return errors;
      };
    }
  }
  async preview(type: string, config: Record<string, unknown>, input: unknown, variables: Record<string, unknown> = {}): Promise<unknown> {
    if (!['expression', 'transform', 'condition', 'filter', 'aggregate', 'result', 'logger'].includes(type)) throw new BadRequestException('Preview supports data and logic nodes. Use Run workflow for triggers, HTTP, delays, and AI.');
    if (!variables || typeof variables !== 'object' || Array.isArray(variables) || ![Object.prototype, null].includes(Object.getPrototypeOf(variables))) throw new BadRequestException('Preview node context must be a JSON object keyed by node ID');
    try {
      const executor = this.registry.get(type);
      const errors = executor.validate(config);
      if (errors.length) throw new Error(errors.join('; '));
      return await executor.execute({ executionId: 'preview', workflowId: 'preview', input, variables }, config);
    } catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'Node preview failed'); }
  }
  list(): Array<{ type: string; label: string; category: string }> { return this.registry.list().map(({ type, label, category }) => ({ type, label, category })); }
}
