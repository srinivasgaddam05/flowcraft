import { Injectable } from '@nestjs/common';
import { NodeRegistry, type NodeContext, type WorkflowNodeExecutor } from '@flowcraft/engine';

const simple = (type: string, label: string, category: 'trigger' | 'action', run: WorkflowNodeExecutor['execute']): WorkflowNodeExecutor => ({ type, label, category, validate: () => [], execute: run });

function assertSafeUrl(value: string): URL {
  const url = new URL(value);
  const blocked = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[0-1])\.)/;
  if (!['http:', 'https:'].includes(url.protocol) || blocked.test(url.hostname)) throw new Error('HTTP Request URL is not allowed');
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
    this.registry.register(simple('manualTrigger', 'Manual Trigger', 'trigger', async (context) => ({ data: context.input ?? {} })));
    this.registry.register(simple('webhookTrigger', 'Webhook Trigger', 'trigger', async (context) => ({ data: context.input ?? {} })));
    this.registry.register(simple('scheduleTrigger', 'Schedule Trigger', 'trigger', async (context) => ({ data: context.input ?? { scheduled: true } })));
    this.registry.register(simple('logger', 'Logger', 'action', async (context, config) => ({ data: { input: context.input, message: config.message ?? 'Event logged' } })));
    this.registry.register(simple('transform', 'Transform Data', 'action', async (context, config) => ({ data: { ...(typeof context.input === 'object' && context.input ? context.input : {}), ...(config.fields as object ?? {}) } })));
    this.registry.register({ type: 'condition', label: 'Condition', category: 'action', validate: () => [], execute: async (context, config) => { const input = typeof context.input === 'object' && context.input ? context.input as Record<string, unknown> : {}; const left = config.field ? input[String(config.field)] : context.input; const right = config.value; const operator = String(config.operator ?? 'equals'); const result = operator === 'notEquals' ? left !== right : operator === 'exists' ? left !== undefined && left !== null && (typeof left !== 'string' || left.trim().length > 0) : operator === 'contains' ? String(left).includes(String(right)) : operator === 'greaterThan' ? Number(left) > Number(right) : operator === 'lessThan' ? Number(left) < Number(right) : left === right; return { data: { ...input, input: context.input, result }, branch: result ? 'true' : 'false' }; } });
    this.registry.register(simple('delay', 'Delay', 'action', async (context, config) => { await new Promise((resolve) => setTimeout(resolve, Math.min(Number(config.milliseconds ?? 0), 5000))); return { data: context.input }; }));
    this.registry.register(simple('httpRequest', 'HTTP Request', 'action', async (context, config) => { const url = assertSafeUrl(String(config.url)); const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), Math.min(Number(config.timeoutMs ?? 10000), 30000)); try { const response = await fetch(url, { method: String(config.method ?? 'GET'), headers: (config.headers as Record<string, string> | undefined) ?? {}, body: ['GET', 'HEAD'].includes(String(config.method ?? 'GET').toUpperCase()) ? undefined : JSON.stringify(config.body ?? context.input), signal: controller.signal }); return { data: { status: response.status, body: await response.text() } }; } finally { clearTimeout(timer); } }));
    this.registry.register(simple('webhookResponse', 'Webhook Response', 'action', async (context) => ({ data: context.input })));
    this.registry.register(simple('groqChat', 'AI Support Triage', 'action', async (context, config) => {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) throw new Error('AI Support Triage is not configured. Set GROQ_API_KEY for the API and worker.');

      const model = String(config.model ?? 'openai/gpt-oss-20b').trim();
      const instructions = String(config.instructions ?? defaultTriageInstructions).trim();
      if (!model) throw new Error('AI model is required');
      if (!instructions) throw new Error('AI instructions are required');

      const input = JSON.stringify(context.input ?? {});
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
  }
  list(): Array<{ type: string; label: string; category: string }> { return this.registry.list().map(({ type, label, category }) => ({ type, label, category })); }
}