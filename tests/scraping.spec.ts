import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { WorkflowDocument } from '@workflow/shared-types';

const API = 'http://localhost:4000';
test.setTimeout(90000);
let token: string;
const workflows = new Set<string>();
const headers = () => ({ authorization: `Bearer ${token}` });
type Run = { id: string; status: string; error?: string; events: { type: string; nodeId?: string; data?: unknown }[]; workflow: WorkflowDocument };
type Shortlist = { productsCollected: number; pagesScraped: number; matches: number; budgetGBP: number; sourceUrl: string; items: { title: string; price: number; availability: string; url: string }[] };

test.beforeAll(async ({ request }) => {
  const response = await request.post(`${API}/auth/register`, { data: { name: 'Scraping QA', email: `scraping-${randomUUID()}@flowcraft.test`, password: `Scraping-${randomUUID()}` } });
  expect(response.ok()).toBeTruthy(); token = (await response.json()).accessToken;
});
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.addInitScript((accessToken) => localStorage.setItem('flowcraft.accessToken', accessToken), token);
});
test.afterEach(async ({ page }) => {
  const id = new URL(page.url()).searchParams.get('workflow'); if (id) workflows.add(id);
  await page.waitForTimeout(2000);
});
test.afterAll(async ({ request }) => { for (const id of workflows) await request.delete(`${API}/workflows/${id}`, { headers: headers() }); });

async function inputCode(page: Page, value: unknown) {
  await page.locator('[data-code-editor="Workflow run input"] .cm-content').fill(JSON.stringify(value));
}
async function latestRun(request: APIRequestContext, workflowId: string): Promise<Run> {
  const response = await request.get(`${API}/executions?workflowId=${workflowId}`, { headers: headers() });
  expect(response.ok()).toBeTruthy(); const runs = await response.json(); expect(runs.length).toBeGreaterThan(0);
  return await (await request.get(`${API}/executions/${runs[0].id}`, { headers: headers() })).json();
}
function report(run: Run): Shortlist {
  const resultId = run.workflow.nodes.find((node) => node.type === 'result')!.id;
  return (run.events.find((event) => event.nodeId === resultId && event.type === 'node.completed')!.data as { data: Shortlist }).data;
}
// The download can contain quoted commas, quotes, and newlines from scraped titles.
function parseCsv(content: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let value = ''; let quoted = false;
  const csv = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  for (let index = 0; index < csv.length; index++) {
    const character = csv[index];
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') { value += '"'; index++; } else quoted = !quoted;
    } else if (!quoted && (character === ',' || character === '\n')) {
      row.push(value); value = '';
      if (character === '\n') { rows.push(row); row = []; }
    } else value += character;
  }
  if (value || row.length) rows.push([...row, value]);
  return rows;
}

test('live website pagination produces a budget shortlist with searchable, sortable CSV records', async ({ page, request }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?recipe=scrape'); await expect(page.locator('.studio-node')).toHaveCount(6);
  await page.getByRole('button', { name: 'Run workflow', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Your live buying shortlist', exact: true })).toBeVisible({ timeout: 75000 });
  const id = new URL(page.url()).searchParams.get('workflow')!; workflows.add(id);
  const run = await latestRun(request, id); expect(run.status).toBe('SUCCESS'); const result = report(run);
  expect(result.productsCollected).toBe(40); expect(result.pagesScraped).toBe(2); expect(result.budgetGBP).toBe(25);
  expect(result.matches).toBeGreaterThan(0); expect(result.items).toHaveLength(result.matches);
  expect(result.items.every((item) => item.title && item.price > 0 && item.price <= 25 && item.url.startsWith('https://books.toscrape.com/'))).toBeTruthy();
  const scraperId = run.workflow.nodes.find((node) => node.type === 'webScrape')!.id;
  const extracted = run.events.find((event) => event.type === 'node.completed' && event.nodeId === scraperId)!.data as { count: number; pages: { itemCount: number }[] };
  expect(extracted.count).toBe(40); expect(extracted.pages.map((entry) => entry.itemCount)).toEqual([20, 20]);
  await expect(page.locator('.studio-source-note a')).toHaveAttribute('href', 'https://books.toscrape.com/');
  const rows = page.locator('.studio-report tbody tr'); await expect(rows).toHaveCount(result.matches);
  const priceSort = page.getByRole('button', { name: 'Sort Result data by price', exact: true });
  const priceColumn = await priceSort.locator('..').evaluate((element) => (element as HTMLTableCellElement).cellIndex + 1);
  await priceSort.click(); await expect(priceSort.locator('..')).toHaveAttribute('aria-sort', 'ascending');
  const prices = (await rows.locator(`td:nth-child(${priceColumn})`).allTextContents()).map(Number); expect(prices).toEqual([...prices].sort((a, b) => a - b));
  await priceSort.click(); await expect(priceSort.locator('..')).toHaveAttribute('aria-sort', 'descending');
  const search = page.getByRole('textbox', { name: 'Search Result data records', exact: true });
  await search.fill(result.items[0].title); await expect(rows).toHaveCount(1);
  await search.fill(`no-book-${randomUUID()}`); await expect(page.getByText('No records match your search.', { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Result data as CSV', exact: true }).click();
  const download = await downloadPromise; expect(download.suggestedFilename()).toBe('flowcraft-result-data.csv');
  const csv = parseCsv(await readFile((await download.path())!, 'utf8'));
  expect([...csv[0]].sort()).toEqual(['title', 'price', 'availability', 'url'].sort()); expect(csv.slice(1)).toHaveLength(result.matches);
  const titleIndex = csv[0].indexOf('title'); const priceIndex = csv[0].indexOf('price'); const urlIndex = csv[0].indexOf('url');
  expect(csv.slice(1).map((row) => row[titleIndex])).toEqual(result.items.map((item) => item.title));
  expect(csv.slice(1).every((row) => Number(row[priceIndex]) > 0 && Number(row[priceIndex]) <= 25 && row[urlIndex].startsWith('https://books.toscrape.com/'))).toBeTruthy();
  await search.fill(''); await page.screenshot({ path: 'artifacts/editor-scraping-report.png', fullPage: false });
  expect(errors).toEqual([]);
  await page.getByRole('button', { name: 'Fit canvas', exact: true }).click();
  await page.locator('.studio-node').filter({ hasText: 'Keep books within budget' }).click();
  await page.getByText('Test this node independently', { exact: true }).click();
  await page.getByRole('button', { name: 'Use last input', exact: true }).click();
  await page.getByRole('button', { name: 'Test node', exact: true }).click();
  await expect(page.locator('.studio-statusbar [role="status"]')).toContainText('Node preview complete');
  await expect(page.locator('.studio-inspector-body .studio-output-view').last().locator('tbody tr')).toHaveCount(result.matches);
  expect(errors).toEqual([]);
});

test('extraction field controls persist configuration and reject invalid selectors before saving', async ({ page, request }) => {
  await page.goto('/?recipe=scrape'); await expect(page.locator('.studio-node')).toHaveCount(6);
  await page.locator('.studio-node').filter({ hasText: 'Collect live book listings' }).click();
  await expect(page.locator('.studio-extraction-field')).toHaveCount(4);
  await page.getByRole('button', { name: 'Add extraction field', exact: true }).click();
  await page.getByLabel('Field 5 name', { exact: true }).fill('image');
  await page.getByLabel('Field 5 selector', { exact: true }).fill('img');
  await page.getByLabel('Field 5 attribute').fill('src');
  await page.getByLabel('Field 5 type').selectOption('url');
  await page.getByRole('button', { name: 'Add extraction field', exact: true }).click();
  await expect(page.locator('.studio-extraction-field')).toHaveCount(6);
  await page.getByRole('button', { name: 'Remove extraction field 6', exact: true }).click();
  await expect(page.locator('.studio-extraction-field')).toHaveCount(5);
  const maximumPages = page.getByRole('textbox', { name: 'Maximum pages', exact: true });
  await maximumPages.fill(''); await maximumPages.pressSequentially('{{ $json.maxPages }}');
  await expect(maximumPages).toHaveValue('{{ $json.maxPages }}');
  await page.getByRole('button', { name: 'Validate workflow', exact: true }).click();
  await expect(page.locator('.studio-statusbar [role="status"]')).toContainText('Workflow is valid');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.studio-statusbar [role="status"]')).toContainText('Workflow saved');
  const id = new URL(page.url()).searchParams.get('workflow')!; workflows.add(id);
  await page.reload(); await expect(page.locator('.studio-node')).toHaveCount(6);
  await page.locator('.studio-node').filter({ hasText: 'Collect live book listings' }).click();
  await expect(page.getByLabel('Field 5 name', { exact: true })).toHaveValue('image');
  await expect(page.getByLabel('Field 5 selector', { exact: true })).toHaveValue('img');
  await expect(page.getByLabel('Field 5 type')).toHaveValue('url');
  await page.getByLabel('Field 1 name', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/editor-scraping-fields.png', fullPage: true });
  const saved = await (await request.get(`${API}/workflows/${id}`, { headers: headers() })).json() as WorkflowDocument;
  expect(saved.nodes.find((node) => node.type === 'webScrape')!.config.maxPages).toBe('{{ $json.maxPages }}');
  const invalid = { ...saved, nodes: saved.nodes.map((node) => node.type === 'webScrape' ? { ...node, config: { ...node.config, itemSelector: '[' } } : node) };
  const validation = await request.post(`${API}/workflows/validate`, { data: invalid });
  const checked = await validation.json(); expect(checked.valid).toBe(false); expect(checked.errors.join(' ')).toMatch(/valid CSS selector/i);
  const rejected = await request.post(`${API}/workflows`, { headers: headers(), data: invalid }); expect(rejected.status()).toBe(400);
  const retained = await (await request.get(`${API}/workflows/${id}`, { headers: headers() })).json() as WorkflowDocument;
  expect(retained.nodes.find((node) => node.type === 'webScrape')!.config.itemSelector).toBe('article.product_pod');
  // Removing an earlier field must not cause the next generated name to collide with a survivor.
  await page.getByRole('button', { name: 'Add extraction field', exact: true }).click();
  await expect(page.locator('.studio-extraction-field')).toHaveCount(6);
  await page.getByRole('button', { name: 'Remove extraction field 2', exact: true }).click();
  await page.getByRole('button', { name: 'Add extraction field', exact: true }).click();
  await expect(page.locator('.studio-extraction-field')).toHaveCount(6);
  const names = await page.getByRole('textbox', { name: /^Field \d+ name$/ }).evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  expect(names).toHaveLength(6); expect(new Set(names).size).toBe(names.length);
  await page.getByRole('button', { name: 'Validate workflow', exact: true }).click();
  await expect(page.locator('.studio-statusbar [role="status"]')).toContainText('Workflow is valid');
});

test('zero matching books produce a valid empty report and private addresses fail at execution time', async ({ page, request }) => {
  await page.goto('/?recipe=scrape'); await expect(page.locator('.studio-node')).toHaveCount(6);
  await inputCode(page, { url: 'https://books.toscrape.com/', maxPrice: 0, maxPages: 1 });
  await page.getByRole('button', { name: 'Run workflow', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Your live buying shortlist', exact: true })).toBeVisible({ timeout: 75000 });
  const id = new URL(page.url()).searchParams.get('workflow')!; workflows.add(id);
  const empty = report(await latestRun(request, id)); expect(empty.productsCollected).toBe(20); expect(empty.matches).toBe(0); expect(empty.items).toEqual([]);
  await expect(page.locator('.studio-report')).toContainText('This step returned an empty dataset.');
  await page.getByRole('button', { name: 'Run input', exact: true }).first().click();
  await inputCode(page, { url: 'http://127.0.0.1:4000/health', maxPrice: 25, maxPages: 1 });
  await page.getByRole('button', { name: 'Run workflow', exact: true }).first().click();
  await expect(page.locator('.studio-run-failed')).toContainText('local or private network addresses', { timeout: 20000 });
  // Failed GET-only graphs can retry; allow their bounded queue backoff to finish before cleanup.
  await page.waitForTimeout(3500);
  const failed = await latestRun(request, id); expect(failed.status).toBe('FAILED'); expect(failed.error).toMatch(/local or private/);
  const scraperId = failed.workflow.nodes.find((node) => node.type === 'webScrape')!.id;
  expect(failed.events.some((event) => event.nodeId === scraperId && event.type === 'node.completed')).toBe(false);
});

test('Apify setup checks the real account connection and missing tokens fail without launching an Actor', async ({ page, request }) => {
  const unauthenticated = await request.get(`${API}/integrations/apify/status`); expect(unauthenticated.status()).toBe(401);
  const capabilities = await (await request.get(`${API}/capabilities`, { headers: headers() })).json(); expect(capabilities.webScrapingAvailable).toBe(true);
  await page.goto('/?recipe=apify'); await expect(page.locator('.studio-node')).toHaveCount(5);
  await page.getByRole('button', { name: 'Open integrations', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Integrations', exact: true }); await expect(dialog).toBeVisible();
  const responsePromise = page.waitForResponse((response) => response.url() === `${API}/integrations/apify/status` && response.request().method() === 'GET');
  await dialog.getByRole('button', { name: 'Test Apify connection', exact: true }).click();
  const checked = await responsePromise; expect(checked.ok()).toBeTruthy(); const connection = await checked.json();
  expect(connection).toEqual(expect.objectContaining({ configured: capabilities.apifyConfigured, connected: expect.any(Boolean), message: expect.any(String) }));
  expect(Object.keys(connection).every((key) => ['configured', 'connected', 'username', 'message'].includes(key))).toBeTruthy();
  await expect(dialog.locator('.studio-connection-message')).toHaveText(connection.message);
  await page.screenshot({ path: 'artifacts/editor-integrations.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Close integrations', exact: true }).click();
  if (!capabilities.apifyConfigured) {
    await page.getByRole('button', { name: 'Run workflow', exact: true }).first().click();
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.studio-statusbar [role="status"]')).toContainText('APIFY_API_TOKEN');
    const id = new URL(page.url()).searchParams.get('workflow')!; workflows.add(id);
    await expect.poll(async () => (await latestRun(request, id)).status, { timeout: 15000 }).toBe('FAILED');
    const failed = await latestRun(request, id); expect(failed.error).toContain('APIFY_API_TOKEN'); expect(failed.error).toContain('No Actor was started');
    await dialog.getByRole('button', { name: 'Close integrations', exact: true }).click();
    await expect(page.locator('.studio-run-failed')).toContainText('APIFY_API_TOKEN');
  }
});

test('integration setup and the live scraping recipe remain usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?recipe=blank'); await expect(page.locator('.studio-node')).toHaveCount(1);
  await page.getByRole('button', { name: 'Integrations', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Integrations', exact: true }); await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBeTruthy();
  await expect(dialog.getByRole('button', { name: 'Try live price research', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Try live price research', exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(page.locator('.studio-node')).toHaveCount(6);
  await expect(page.getByRole('textbox', { name: 'Workflow name', exact: true })).toHaveValue('Live price research · Book shortlist');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('an unconnected Apify Actor is skipped while the selected manual workflow runs without integration credentials', async ({ page, request }) => {
  await page.goto('/?recipe=blank'); await expect(page.locator('.studio-node')).toHaveCount(1);
  // Nothing is selected, so this Actor stays outside the manual trigger's execution path.
  await page.getByTestId('add-apifyActor').click(); await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await page.getByRole('button', { name: 'Auto layout', exact: true }).click();
  await page.locator('.studio-node').filter({ hasText: 'Manual Trigger' }).click();
  await page.getByTestId('add-result').click();
  await expect(page.locator('.studio-node')).toHaveCount(3); await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await page.getByRole('button', { name: 'Run workflow', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Workflow complete', exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('dialog', { name: 'Integrations', exact: true })).toHaveCount(0);
  const id = new URL(page.url()).searchParams.get('workflow')!; workflows.add(id);
  const run = await latestRun(request, id); expect(run.status).toBe('SUCCESS');
  const actorId = run.workflow.nodes.find((node) => node.type === 'apifyActor')!.id;
  expect(run.events.some((event) => event.nodeId === actorId && event.type === 'node.skipped')).toBe(true);
  expect(run.events.some((event) => event.nodeId === actorId && ['node.started', 'node.completed'].includes(event.type))).toBe(false);
});
