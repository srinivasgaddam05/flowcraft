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

test('expression code calculates live values and preserves native template types', async () => {
  const nodes = new NodeService();
  const result = await nodes.registry.get('expression').execute({ executionId: 'test', workflowId: 'test', input: { orders: [{ total: 10 }, { total: 25 }] }, variables: {} }, { expression: '{ "total": $sum($json.orders.total), "count": $count(orders) }' });
  assert.deepEqual(result.data, { total: 35, count: 2 });
  const mapped = await nodes.registry.get('transform').execute({ executionId: 'test', workflowId: 'test', input: result.data, variables: {} }, { fields: { amount: '{{ $json.total }}', note: 'Processed {{ $string($json.count) }} orders' } });
  assert.deepEqual(mapped.data, { total: 35, count: 2, amount: 35, note: 'Processed 2 orders' });
});

test('filter and aggregation return computed metrics, including empty arrays', async () => {
  const nodes = new NodeService();
  const context = { executionId: 'test', workflowId: 'test', variables: {} };
  const filtered = await nodes.registry.get('filter').execute({ ...context, input: [{ paid: true, total: 10 }, { paid: false, total: 20 }, { paid: true, total: 30 }] }, { predicate: '$item.paid = true' });
  const metrics = await nodes.registry.get('aggregate').execute({ ...context, input: filtered.data }, { valueField: 'total' });
  assert.deepEqual(metrics.data, { count: 2, numericCount: 2, total: 40, average: 20, minimum: 10, maximum: 30, items: [{ paid: true, total: 10 }, { paid: true, total: 30 }] });
  const empty = await nodes.registry.get('aggregate').execute({ ...context, input: [] }, { valueField: 'total' });
  assert.equal((empty.data as { count: number }).count, 0);
  const none = await nodes.registry.get('filter').execute({ ...context, input: [{ paid: false }] }, { predicate: '$item.paid = true' });
  assert.deepEqual(none.data, []);
  const single = await nodes.registry.get('filter').execute({ ...context, input: [{ paid: true, total: 15 }, { paid: false, total: 30 }] }, { predicate: '$item.paid = true' });
  assert.deepEqual(single.data, [{ paid: true, total: 15 }]);
});

test('nested conditions and report output use the actual preceding data', async () => {
  const nodes = new NodeService();
  const context = { executionId: 'test', workflowId: 'test', variables: {}, input: { customer: { tier: 'pro' }, total: 75 } };
  const route = await nodes.registry.get('condition').execute(context, { field: 'customer.tier', operator: 'equals', value: 'pro' });
  assert.equal(route.branch, 'true');
  const report = await nodes.registry.get('result').execute(context, { title: 'Customer {{ $json.customer.tier }}', summary: 'Amount {{ $string($json.total) }}' });
  assert.deepEqual(report.data, { title: 'Customer pro', summary: 'Amount 75', data: context.input });
});

test('node preview rejects external actions and malformed expression code', async () => {
  const nodes = new NodeService();
  await assert.rejects(nodes.preview('httpRequest', {}, {}), /Preview supports/);
  await assert.rejects(nodes.preview('expression', { expression: '{' }, {}), /Expression/);
  assert.ok(nodes.registry.get('delay').validate({ milliseconds: -1 }).length);
  assert.ok(nodes.registry.get('scheduleTrigger').validate({ intervalMs: 10 }).length);
});

test('node previews use upstream trigger and scraped outputs for filters and buying briefs', async () => {
  const nodes = new NodeService();
  const variables = {
    trigger: { maxPrice: 25 },
    scrape: { count: 2, pages: [{ url: 'https://books.toscrape.com/' }], sourceUrl: 'https://books.toscrape.com/', scrapedAt: '2026-10-15T00:00:00.000Z' },
  };
  const filtered = await nodes.preview('filter', { predicate: '$item.price <= $nodes.*.maxPrice' }, [{ title: 'Within budget', price: 10 }, { title: 'Over budget', price: 30 }], variables) as { data: unknown };
  assert.deepEqual(filtered.data, [{ title: 'Within budget', price: 10 }]);
  const metrics = await nodes.preview('aggregate', { valueField: 'price' }, filtered.data, variables) as { data: unknown };
  const brief = await nodes.preview('expression', { expression: '($source := $single($nodes.*, function($v) { $exists($v.scrapedAt) }); $brief := $single($nodes.*, function($v) { $exists($v.maxPrice) }); { "productsCollected": $source.count, "matches": count, "budgetGBP": $brief.maxPrice, "averagePriceGBP": average, "pagesScraped": $count($source.pages), "sourceUrl": $source.sourceUrl, "items": items })' }, metrics.data, variables) as { data: unknown };
  assert.deepEqual(brief.data, { productsCollected: 2, matches: 1, budgetGBP: 25, averagePriceGBP: 10, pagesScraped: 1, sourceUrl: 'https://books.toscrape.com/', items: [{ title: 'Within budget', price: 10 }] });
});

test('preview node context accepts JSON objects and rejects arrays, null, and non-object values', async () => {
  const nodes = new NodeService();
  for (const variables of [null, [], 'invalid', 42, new Date()]) await assert.rejects(nodes.preview('expression', { expression: '$json' }, {}, variables as never), /node context must be a JSON object/);
  assert.deepEqual(await nodes.preview('expression', { expression: '$json' }, { value: 1 }), { data: { value: 1 } });
});

test('HTTP nodes cannot reach private IPv4, IPv6, or embedded credentials', async () => {
  const executor = new NodeService().registry.get('httpRequest');
  for (const url of ['http://127.0.0.1', 'http://[::1]', 'http://169.254.169.254/latest', 'https://user:password@example.com']) {
    await assert.rejects(executor.execute({ executionId: 'test', workflowId: 'test', input: {}, variables: {} }, { url }), /private|credentials/);
  }
});

test('expression code that never completes is terminated without blocking the API', async () => {
  await assert.rejects(new NodeService().preview('expression', { expression: '($loop := function(){ $loop() }; $loop())' }, {}), /execution limit|stopped|memory|Expression failed/);
});

test('manual triggers preserve explicit null, numbers, and array inputs', async () => {
  const node = new NodeService().registry.get('manualTrigger');
  for (const input of [null, 0, [], { value: false }]) {
    const result = await node.execute({ executionId: 'test', workflowId: 'test', input, variables: {} }, {});
    assert.deepEqual(result.data, input);
  }
});
