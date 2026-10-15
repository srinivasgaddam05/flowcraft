import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { NodeService } from './nodes';

const originalApiKey = process.env.GROQ_API_KEY;
const originalFetch = globalThis.fetch;

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = originalApiKey;
  globalThis.fetch = originalFetch;
});

test('Groq support triage returns parsed structured JSON and provider metadata', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      model: 'openai/gpt-oss-20b',
      choices: [{ message: { content: JSON.stringify({ category: 'shipping', urgency: 'normal', needsHumanReview: false }) } }],
      usage: { total_tokens: 42 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await new NodeService().registry.get('groqChat').execute(
    { executionId: 'execution-1', workflowId: 'workflow-1', input: { message: 'Where is my order?' }, variables: {} },
    {},
  );

  assert.deepEqual(result.data, {
    category: 'shipping',
    urgency: 'normal',
    needsHumanReview: false,
    _ai: { provider: 'groq', model: 'openai/gpt-oss-20b', usage: { total_tokens: 42 } },
  });
  assert.equal(requestBody?.model, 'openai/gpt-oss-20b');
  assert.deepEqual(requestBody?.response_format, { type: 'json_object' });
});

test('Groq support triage reports missing server key explicitly', async () => {
  delete process.env.GROQ_API_KEY;
  await assert.rejects(
    new NodeService().registry.get('groqChat').execute(
      { executionId: 'execution-1', workflowId: 'workflow-1', input: {}, variables: {} },
      {},
    ),
    /Set GROQ_API_KEY for the API and worker/,
  );
});

test('Groq support triage rejects invalid provider JSON', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: 'not json' } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  await assert.rejects(
    new NodeService().registry.get('groqChat').execute(
      { executionId: 'execution-1', workflowId: 'workflow-1', input: {}, variables: {} },
      {},
    ),
    /Groq AI returned invalid JSON/,
  );
});
