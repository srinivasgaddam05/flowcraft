import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Response, type fetch } from 'undici';
import { createWebScrapeExecutor, robotsAllows, validateWebScrapeConfig } from './web-scrape';
import { isPublicAddress, publicUrl, safeFetchText, type SafeTextOptions, type SafeTextResponse } from './safe-http';

const context = { executionId: 'scrape-test', workflowId: 'scrape-test', input: {}, variables: {} };
const config = {
  url: 'https://shop.example/catalogue/page-1.html', itemSelector: 'article.product',
  fields: [
    { name: 'title', selector: 'h3 a', attribute: 'title' },
    { name: 'price', selector: '.price', type: 'number' },
    { name: 'availability', selector: '.availability' },
    { name: 'url', selector: 'h3 a', attribute: 'href' },
    { name: 'missing', selector: '.absent' },
  ],
  paginationSelector: '.next a', maxPages: 2, maxItems: 3, delayMs: 200,
};
function htmlResponse(url: string, text: string, status = 200): SafeTextResponse {
  return { url, status, headers: { 'content-type': 'text/html; charset=utf-8' }, text };
}
function product(title: string, price: string, href: string): string {
  return `<article class="product"><h3><a href="${href}" title="${title}">${title}</a></h3><p class="price">${price}</p><p class="availability"> In stock\n now </p></article>`;
}

test('web scraper fetches real response HTML, follows bounded pagination, and returns typed absolute data', async () => {
  const calls: string[] = [];
  const waits: number[] = [];
  let checkpoints = 0;
  const fetchText = async (value: string | URL, options?: SafeTextOptions) => {
    const url = String(value);
    calls.push(url);
    await options?.beforeRequest?.(new URL(url));
    if (url.endsWith('/robots.txt')) return htmlResponse(url, 'User-agent: *\nDisallow: /private/');
    if (url.endsWith('page-1.html')) return htmlResponse(url, product('First book', '£51.77', '../first/index.html') + product('Second book', '€1.234,50', '/second') + '<li class="next"><a href="page-2.html">next</a></li>');
    return htmlResponse(url, product('Third book', '$1,025.75', '/third') + product('Fourth book', '£9.99', '/fourth'));
  };
  const node = createWebScrapeExecutor({ fetchText, sleep: async (milliseconds) => { waits.push(milliseconds); }, now: () => new Date('2026-10-15T12:00:00Z') });
  const result = await node.execute({ ...context, checkCancelled: async () => { checkpoints++; }, input: { url: config.url, pages: 2 } }, { ...config, url: '{{ $json.url }}', maxPages: '{{ $json.pages }}' });
  const data = result.data as { count: number; items: unknown[]; pages: unknown[]; scrapedAt: string };
  assert.deepEqual(data, {
    sourceUrl: config.url,
    pages: [{ url: config.url, itemCount: 2 }, { url: 'https://shop.example/catalogue/page-2.html', itemCount: 1 }], count: 3,
    items: [
      { title: 'First book', price: 51.77, availability: 'In stock now', url: 'https://shop.example/first/index.html', missing: null },
      { title: 'Second book', price: 1234.5, availability: 'In stock now', url: 'https://shop.example/second', missing: null },
      { title: 'Third book', price: 1025.75, availability: 'In stock now', url: 'https://shop.example/third', missing: null },
    ], scrapedAt: '2026-10-15T12:00:00.000Z',
  });
  assert.equal(calls.filter((url) => url.endsWith('/robots.txt')).length, 1);
  assert.deepEqual(waits, [200]);
  assert.ok(checkpoints >= 5);
});

test('web scraper returns explicit empty items and stops pagination loops', async () => {
  let requests = 0;
  const node = createWebScrapeExecutor({ fetchText: async (value) => {
    const url = String(value);
    if (url.endsWith('/robots.txt')) return htmlResponse(url, '', 404);
    requests++;
    return htmlResponse(url, '<a class="next" href="page-1.html">again</a>');
  } });
  const { data } = await node.execute(context, { ...config, paginationSelector: 'a.next', maxPages: 5 });
  assert.equal((data as { count: number }).count, 0);
  assert.deepEqual((data as { items: unknown[] }).items, []);
  assert.equal(requests, 1);
});

test('web scraper validates selectors, duplicate unsafe fields, limits, and resolved templates', async () => {
  assert.deepEqual(validateWebScrapeConfig({ ...config, maxPages: '{{ $json.pages }}' }), []);
  assert.match(validateWebScrapeConfig({ ...config, itemSelector: '[' }).join(';'), /valid CSS/);
  assert.match(validateWebScrapeConfig({ ...config, fields: [{ name: '__proto__', selector: '' }] }).join(';'), /safe name/);
  assert.match(validateWebScrapeConfig({ ...config, fields: [config.fields[0], config.fields[0]] }).join(';'), /duplicated/);
  assert.match(validateWebScrapeConfig({ ...config, maxPages: 100 }).join(';'), /maxPages/);
  let called = false;
  const node = createWebScrapeExecutor({ fetchText: async () => { called = true; throw new Error('unexpected network'); } });
  await assert.rejects(node.execute({ ...context, input: { pages: 100 } }, { ...config, maxPages: '{{ $json.pages }}' }), /maxPages/);
  assert.equal(called, false);
});

test('robots rules honor specific user agents, wildcard/end anchors, encoding, merged groups and Allow ties', () => {
  const rules = 'User-agent: *\nDisallow: /\n\nUser-agent: FlowcraftBot\nDisallow: /private\nAllow: /private/public\nDisallow: /*.pdf$\nDisallow: /%7Esecret\n\nUser-agent: FlowcraftBot\nAllow: /tie\nDisallow: /tie';
  for (const [path, allowed] of [['/catalogue', true], ['/private', false], ['/private/public/books', true], ['/file.pdf', false], ['/file.pdf?download=yes', true], ['/~secret', false], ['/tie', true]] as const) {
    assert.equal(robotsAllows(rules, new URL(path, 'https://shop.example')), allowed, path);
  }
  assert.equal(robotsAllows('User-agent: *\nDisallow:\n', new URL('https://shop.example')), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /x%2Fy', new URL('https://shop.example/x/y')), true);
});

test('robots denial and unavailable robots stop scraping before extracting a page', async () => {
  for (const [status, text, expected] of [[200, 'User-agent: FlowcraftBot\nDisallow: /catalogue', /robots.txt disallows/], [503, '', /Cannot verify robots.txt/]] as const) {
    const requests: string[] = [];
    const node = createWebScrapeExecutor({ fetchText: async (value) => { requests.push(String(value)); return htmlResponse(String(value), text, status); } });
    await assert.rejects(node.execute(context, config), expected);
    assert.deepEqual(requests, ['https://shop.example/robots.txt']);
  }
});

test('web scraper checks robots on redirected targets and rejects external pagination and non-HTML responses', async () => {
  const redirected = createWebScrapeExecutor({ fetchText: async (value, options) => {
    const url = String(value);
    if (url.endsWith('/robots.txt')) return htmlResponse(url, 'User-agent: *\nDisallow: /private');
    await options?.beforeRequest?.(new URL('https://shop.example/private'));
    return htmlResponse('https://shop.example/private', product('Hidden', '1', '/hidden'));
  } });
  await assert.rejects(redirected.execute(context, config), /robots.txt disallows/);
  const external = createWebScrapeExecutor({ fetchText: async (value) => String(value).endsWith('/robots.txt') ? htmlResponse(String(value), '', 404) : htmlResponse(String(value), '<a class="next" href="https://elsewhere.example/">next</a>') });
  await assert.rejects(external.execute(context, { ...config, paginationSelector: 'a.next' }), /same website origin/);
  const json = createWebScrapeExecutor({ fetchText: async (value) => String(value).endsWith('/robots.txt') ? htmlResponse(String(value), '', 404) : { ...htmlResponse(String(value), '{}'), headers: { 'content-type': 'application/json' } } });
  await assert.rejects(json.execute(context, config), /requires HTML/);
});

test('scraper cancellation is checked before any network request', async () => {
  let called = false;
  const node = createWebScrapeExecutor({ fetchText: async () => { called = true; throw new Error('network'); } });
  await assert.rejects(node.execute({ ...context, checkCancelled: () => { throw new Error('Execution cancelled'); } }, config), /cancelled/);
  assert.equal(called, false);
});

test('public URL policy rejects private, encoded private, mapped IPv6, documentation and tunnel addresses', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.0.1', '100.64.0.1', '198.18.0.1', '192.0.2.1', '203.0.113.3', '::1', '::ffff:127.0.0.1', 'fc00::1', '2001:db8::1', '2002:7f00:1::']) assert.equal(isPublicAddress(address), false, address);
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888']) assert.equal(isPublicAddress(address), true, address);
  for (const url of ['http://2130706433', 'http://0177.0.0.1', 'http://0x7f000001', 'http://[::1]', 'http://local.internal', 'https://user:secret@shop.example', 'file:///etc/passwd']) assert.throws(() => publicUrl(url), /private|HTTP/);
});

test('safe HTTP checks every DNS answer and redirect before opening the destination', async () => {
  let called = 0;
  const request = (async () => { called++; return new Response(''); }) as typeof fetch;
  await assert.rejects(safeFetchText('https://mixed.example', {}, { resolve: async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }], request }), /private/);
  assert.equal(called, 0);
  const redirected = (async () => { called++; return new Response('', { status: 302, headers: { location: 'http://169.254.169.254/latest' } }); }) as typeof fetch;
  await assert.rejects(safeFetchText('https://public.example', {}, { resolve: async () => [{ address: '8.8.8.8', family: 4 }], request: redirected }), /private/);
  assert.equal(called, 1);
});

test('safe HTTP pins DNS for each public hop, preserves host, and applies redirect policy hooks', async () => {
  const lookups: string[] = [];
  const hooks: string[] = [];
  const requests: string[] = [];
  const request = (async (value, init) => {
    const url = String(value);
    requests.push(url);
    assert.ok(init?.dispatcher);
    assert.equal(init?.redirect, 'manual');
    assert.equal((init?.headers as Record<string, string>)['user-agent'], 'FlowcraftBot/1.0');
    return url.includes('first.example') ? new Response('', { status: 302, headers: { location: 'https://second.example/page' } }) : new Response('<html>done</html>', { headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  const result = await safeFetchText('https://first.example', { beforeRequest: async (url) => { hooks.push(url.hostname); } }, { resolve: async (hostname) => { lookups.push(hostname); return [{ address: '8.8.8.8', family: 4 }]; }, request });
  assert.deepEqual(lookups, ['first.example', 'second.example']);
  assert.deepEqual(hooks, lookups);
  assert.deepEqual(requests, ['https://first.example/', 'https://second.example/page']);
  assert.equal(result.url, 'https://second.example/page');
  assert.equal(result.text, '<html>done</html>');
});

test('safe HTTP bounds streamed data before full buffering and cancels stalled reads', async () => {
  const resolve = async () => [{ address: '8.8.8.8', family: 4 }];
  const oversized = (async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(11)); controller.close(); } }))) as typeof fetch;
  await assert.rejects(safeFetchText('https://public.example', { maxBytes: 10 }, { resolve, request: oversized }), /byte limit/);
  let timer: ReturnType<typeof setTimeout>;
  let cancelled = false;
  const stalled = (async () => new Response(new ReadableStream({ start(controller) { timer = setTimeout(() => controller.close(), 1000); }, cancel() { cancelled = true; clearTimeout(timer); } }))) as typeof fetch;
  await assert.rejects(safeFetchText('https://public.example', { timeoutMs: 100 }, { resolve, request: stalled }), /timeout|aborted/i);
  assert.equal(cancelled, true);
});
