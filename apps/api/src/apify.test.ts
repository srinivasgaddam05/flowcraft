import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NodeContext } from '@flowcraft/engine';
import { ApifyClient, checkApifyConnection, createApifyExecutors, validateApifyActor, validateApifyDataset } from './apify';

const secret = 'apify_api_test-secret-never-expose';
const context: NodeContext = { executionId: 'test', workflowId: 'test', input: {}, variables: {} };
const response = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const actor = { actorId: 'apify/website-content-crawler', input: { startUrls: [{ url: 'https://example.com' }], maxCrawlPages: 2 } };
const run = (status: string, extra: Record<string, unknown> = {}) => ({ data: { id: 'run123', actId: 'actor123', status, defaultDatasetId: 'dataset123', startedAt: '2026-10-15T00:00:00.000Z', finishedAt: status === 'SUCCEEDED' ? '2026-10-15T00:00:05.000Z' : null, ...extra } });

test('Apify starts exactly one real Actor request with bounded options, polls to success, and normalizes output', async () => {
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const progress: Array<{ message: string; data?: unknown }> = [];
  let clock = 0;
  const client = new ApifyClient({ getToken: () => secret, now: () => clock, sleep: async (ms) => { clock += ms; }, fetch: async (input, init) => {
    calls.push({ url: new URL(String(input)), init });
    return calls.length === 1 ? response(run('READY'), 201) : calls.length === 2 ? response(run('RUNNING')) : response(run('SUCCEEDED'));
  } });
  const result = await client.runActor({ ...context, reportProgress: async (update) => { progress.push(update); } }, actor);
  assert.deepEqual(result, { runId: 'run123', actorId: 'actor123', status: 'SUCCEEDED', defaultDatasetId: 'dataset123', consoleUrl: 'https://console.apify.com/actors/runs/run123', startedAt: '2026-10-15T00:00:00.000Z', finishedAt: '2026-10-15T00:00:05.000Z' });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url.pathname, '/v2/actors/apify~website-content-crawler/runs');
  assert.equal(calls[0].url.searchParams.get('timeout'), '120');
  assert.equal(calls[0].url.searchParams.get('maxItems'), '20');
  assert.equal(calls[0].url.searchParams.get('maxTotalChargeUsd'), '0.1');
  assert.equal(calls[0].url.searchParams.get('restartOnError'), 'false');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), actor.input);
  assert.equal(calls.filter(({ init }) => init?.method === 'POST').length, 1);
  assert.equal(calls[1].url.searchParams.get('waitForFinish'), '5');
  assert.deepEqual(progress.map((update) => (update.data as { status: string }).status), ['READY', 'RUNNING', 'SUCCEEDED']);
  assert.equal((progress[0].data as { consoleUrl: string }).consoleUrl, 'https://console.apify.com/actors/runs/run123');
  assert.equal(JSON.stringify(progress).includes(secret), false);
  for (const call of calls) {
    assert.equal(call.url.origin, 'https://api.apify.com');
    assert.equal(new Headers(call.init?.headers).get('authorization'), `Bearer ${secret}`);
    assert.equal(call.url.toString().includes(secret), false);
    assert.equal(call.init?.redirect, 'error');
  }
});

test('Apify credentials missing is explicit, never requests or simulates run/data results', async () => {
  let called = false;
  const options = { getToken: () => undefined, fetch: async () => { called = true; throw new Error('Unexpected request'); } };
  const client = new ApifyClient(options);
  await assert.rejects(client.runActor(context, actor), /Set APIFY_API_TOKEN for the API and worker/);
  await assert.rejects(client.dataset(context, { datasetId: 'dataset123' }), /Set APIFY_API_TOKEN/);
  const status = await checkApifyConnection(options);
  assert.equal(status.configured, false);
  assert.equal(status.connected, false);
  assert.equal(called, false);
});

test('Apify configuration validates spend, duration, pagination and forbids node credentials', () => {
  assert.deepEqual(validateApifyActor(actor), []);
  assert.deepEqual(validateApifyDataset({ datasetId: '{{ $json.defaultDatasetId }}', fields: '' }), []);
  for (const change of [{ maxItems: 0 }, { maxItems: 201 }, { timeoutSecs: 301 }, { timeoutSecs: 0 }, { maxTotalChargeUsd: 0 }, { maxTotalChargeUsd: 6 }, { input: [] }, { actorId: 'https://api.apify.com/actor' }, { token: secret }]) assert.ok(validateApifyActor({ ...actor, ...change }).length);
  for (const change of [{ limit: 201 }, { limit: 0 }, { offset: -1 }, { offset: 1.5 }, { apiKey: secret }, { datasetId: '../users/me' }, { fields: [] }]) assert.ok(validateApifyDataset({ datasetId: 'dataset123', ...change }).length);
});

test('Apify Dataset supports native template mapping, field selection and clean-page pagination', async () => {
  let requestUrl: URL | undefined;
  const dataset = createApifyExecutors({ getToken: () => secret, fetch: async (input) => {
    requestUrl = new URL(String(input));
    return response([{ url: 'https://example.com', title: 'Example' }], 200, { 'x-apify-pagination-total': '30' });
  } }).find((executor) => executor.type === 'apifyDataset')!;
  const result = await dataset.execute({ ...context, input: { defaultDatasetId: 'dataset123', limit: 10 } }, { datasetId: '{{ $json.defaultDatasetId }}', limit: '{{ $json.limit }}', offset: 10, fields: 'url,title' });
  assert.equal(requestUrl?.pathname, '/v2/datasets/dataset123/items');
  assert.equal(requestUrl?.searchParams.get('clean'), 'true');
  assert.equal(requestUrl?.searchParams.get('format'), 'json');
  assert.equal(requestUrl?.searchParams.get('fields'), 'url,title');
  assert.equal(requestUrl?.searchParams.get('limit'), '10');
  assert.deepEqual(result.data, { datasetId: 'dataset123', count: 1, items: [{ url: 'https://example.com', title: 'Example' }], offset: 10, total: 30, hasMore: true, nextOffset: 20 });
});

test('Apify Dataset preserves empty arrays and omits unknown pagination totals and empty fields', async () => {
  const client = new ApifyClient({ getToken: () => secret, fetch: async (input) => {
    assert.equal(new URL(String(input)).searchParams.has('fields'), false);
    return response([]);
  } });
  assert.deepEqual(await client.dataset(context, { datasetId: 'dataset123', fields: '' }), { datasetId: 'dataset123', count: 0, items: [], offset: 0 });
});

test('Apify reports failed Actor terminal status with run link and never treats failure as scraped output', async () => {
  let calls = 0;
  const client = new ApifyClient({ getToken: () => secret, fetch: async () => { calls++; return response(run('FAILED', { statusMessage: secret }), 201); } });
  await assert.rejects(client.runActor(context, actor), (error: Error) => {
    assert.match(error.message, /status FAILED/);
    assert.match(error.message, /console.apify.com\/actors\/runs\/run123/);
    assert.equal(error.message.includes(secret), false);
    return true;
  });
  assert.equal(calls, 1);
});

test('Apify aborts a known remote Actor when workflow is cancelled', async () => {
  const paths: string[] = [];
  let started = false;
  const client = new ApifyClient({ getToken: () => secret, fetch: async (input) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    started = true;
    return response(run(path.endsWith('/abort') ? 'ABORTED' : 'RUNNING'));
  } });
  await assert.rejects(client.runActor({ ...context, checkCancelled: async () => { if (started) throw new Error('Execution cancelled'); } }, actor), /Execution cancelled/);
  assert.deepEqual(paths, ['/v2/actors/apify~website-content-crawler/runs', '/v2/actor-runs/run123/abort']);
});

test('Apify interrupts a pending status request and aborts the remote Actor on cancellation', async () => {
  const paths: string[] = [];
  let polling = false;
  const client = new ApifyClient({ getToken: () => secret, fetch: async (input, init) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    if (path === '/v2/actor-runs/run123') {
      polling = true;
      return await new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    }
    return response(run(path.endsWith('/abort') ? 'ABORTED' : 'RUNNING'));
  } });
  await assert.rejects(client.runActor({ ...context, checkCancelled: async () => { if (polling) throw new Error('Execution cancelled'); } }, actor), /Execution cancelled/);
  assert.equal(paths.at(-1), '/v2/actor-runs/run123/abort');
});

test('Apify aborts timed-out remote runs and reports remote cleanup outcome', async () => {
  const paths: string[] = [];
  let clock = 0;
  const client = new ApifyClient({ getToken: () => secret, now: () => clock, sleep: async (ms) => { clock += ms; }, fetch: async (input) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    if (path === '/v2/actor-runs/run123') clock += 10_000;
    return response(run(path.endsWith('/abort') ? 'ABORTED' : 'RUNNING'));
  } });
  await assert.rejects(client.runActor(context, { ...actor, timeoutSecs: 1 }), /exceeded the workflow wait limit.*remote abort was requested/);
  assert.equal(paths.at(-1), '/v2/actor-runs/run123/abort');
  assert.equal(paths.filter((path) => path.endsWith('/runs')).length, 1);
});

test('Apify polling errors abort remote runs and sanitize reflected provider errors and secrets', async () => {
  for (const status of [400, 401, 402, 403, 404, 429, 500]) {
    const paths: string[] = [];
    const client = new ApifyClient({ getToken: () => secret, fetch: async (input) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      return paths.length === 1 ? response(run('RUNNING')) : path.endsWith('/abort') ? response(run('ABORTED')) : response({ error: { message: `Authorization Bearer ${secret}`, type: secret } }, status);
    } });
    await assert.rejects(client.runActor(context, actor), (error: Error) => {
      assert.match(error.message, new RegExp(`HTTP ${status}`));
      assert.equal(error.message.includes(secret), false);
      return true;
    });
    assert.equal(paths.at(-1), '/v2/actor-runs/run123/abort');
  }
});

test('Apify never retries an ambiguous Actor start network failure or persists raw fetch errors', async () => {
  let calls = 0;
  const client = new ApifyClient({ getToken: () => secret, fetch: async () => { calls++; throw new Error(`fetch failed token=${secret}`); } });
  await assert.rejects(client.runActor(context, actor), (error: Error) => {
    assert.match(error.message, /Actor may already have started/);
    assert.equal(error.message.includes(secret), false);
    return true;
  });
  assert.equal(calls, 1);
});

test('Apify connection check makes a read-only authenticated request and strips private account data', async () => {
  const status = await checkApifyConnection({ getToken: () => secret, fetch: async (input, init) => {
    assert.equal(String(input), 'https://api.apify.com/v2/users/me');
    assert.equal(init?.method, 'GET');
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${secret}`);
    return response({ data: { id: 'user123', username: 'test-user', email: 'private@example.com', proxy: { password: 'private' }, token: secret } });
  } });
  assert.deepEqual(status, { configured: true, connected: true, username: 'test-user', message: 'Apify connection verified. Actor runs use your Apify account and configured limits.' });
  const rejected = await checkApifyConnection({ getToken: () => secret, fetch: async () => response({ error: { message: secret } }, 401) });
  assert.equal(rejected.configured, true);
  assert.equal(rejected.connected, false);
  assert.match(rejected.message, /token is invalid or expired/);
  assert.equal(JSON.stringify(rejected).includes(secret), false);
});

test('Apify enforces streamed response bounds before persisting dataset data', async () => {
  let cancelled = false;
  const client = new ApifyClient({ getToken: () => secret, fetch: async () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(600_000)); }, cancel() { cancelled = true; } })) });
  await assert.rejects(client.dataset(context, { datasetId: 'dataset123' }), /response exceeds 1 MB/);
  assert.equal(cancelled, true);
});

test('Apify interrupts in-flight dataset reads when workflow cancellation is detected', async () => {
  let cancelled = false;
  const client = new ApifyClient({ getToken: () => secret, fetch: async (_input, init) => {
    cancelled = true;
    return await new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
  } });
  await assert.rejects(client.dataset({ ...context, checkCancelled: async () => { if (cancelled) throw new Error('Execution cancelled'); } }, { datasetId: 'dataset123' }), /Execution cancelled/);
});
