import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const API = 'http://localhost:4000';
test.setTimeout(45000);
let token: string;
const workflows = new Set<string>();
test.beforeAll(async ({ request }) => {
  const response = await request.post(`${API}/auth/register`, { data: { name: 'Studio QA', email: `studio-${randomUUID()}@flowcraft.test`, password: `Studio-${randomUUID()}` } });
  expect(response.ok()).toBeTruthy(); token = (await response.json()).accessToken;
});
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.addInitScript((accessToken) => localStorage.setItem('flowcraft.accessToken', accessToken), token);
});
test.afterEach(async ({ page }) => { const id = new URL(page.url()).searchParams.get('workflow'); if (id) workflows.add(id); await new Promise((resolve) => setTimeout(resolve, 5000)); });
test.afterAll(async ({ request }) => { for (const id of workflows) await request.delete(`${API}/workflows/${id}`, { headers: { authorization: `Bearer ${token}` } }); });
async function inputCode(page: import('@playwright/test').Page, label: string, value: string) { await page.locator(`[data-code-editor="${label}"] .cm-content`).fill(value); }

test('revenue workflow runs real expression, filter, aggregation, branching and report steps', async ({ page, request }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?recipe=revenue');
  await expect(page.locator('.studio-node')).toHaveCount(8);
  await page.screenshot({ path: 'artifacts/editor-studio.png', fullPage: true });
  await page.getByRole('button', { name: 'Run workflow', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Your fulfillment brief is ready' })).toBeVisible({ timeout: 40000 });
  await expect(page.locator('.studio-report')).toContainText('3 paid orders worth 533 USD');
  await expect(page.locator('.studio-report')).toContainText('Priority fulfillment');
  await page.screenshot({ path: 'artifacts/editor-revenue-report.png', fullPage: true });
  const id = new URL(page.url()).searchParams.get('workflow')!; workflows.add(id);
  const runs = await request.get(`${API}/executions?workflowId=${id}`, { headers: { authorization: `Bearer ${token}` } });
  const execution = await request.get(`${API}/executions/${(await runs.json())[0].id}`, { headers: { authorization: `Bearer ${token}` } }); const detail = await execution.json();
  expect(detail.workflow.nodes).toHaveLength(8); expect(detail.input.orders).toHaveLength(4);
  expect(detail.events.some((event: { type: string; data?: { orders?: unknown[] } }) => event.type === 'node.started' && event.data?.orders?.length === 4)).toBeTruthy();
  await page.getByRole('button', { name: /Calculate order totals SUCCESS/ }).click();
  await expect(page.locator('.studio-run-output')).toContainText('batch-1042');
  await page.screenshot({ path: 'artifacts/editor-step-inspector.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('build, configure, preview, duplicate, delete, undo, redo and run a workflow from scratch', async ({ page }) => {
  await page.goto('/?recipe=blank');
  await expect(page.locator('.studio-node')).toHaveCount(1);
  await page.locator('.studio-node').click();
  await page.getByTestId('add-expression').click();
  await expect(page.locator('.studio-node')).toHaveCount(2);
  await inputCode(page, 'Expression code', '{ "customer": $json.customer, "total": $json.total * 2 }');
  await page.getByText('Test this node independently', { exact: true }).click();
  await inputCode(page, 'Node test input', '{ "customer": "Maya", "total": 125 }');
  await page.getByRole('button', { name: 'Test node', exact: true }).click();
  await expect(page.locator('.studio-inspector-body')).toContainText('250');
  await page.getByRole('button', { name: 'Duplicate node', exact: true }).click();
  await expect(page.locator('.studio-node')).toHaveCount(3);
  await page.getByRole('button', { name: 'Delete node', exact: true }).click();
  await expect(page.locator('.studio-node')).toHaveCount(2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(page.locator('.studio-node')).toHaveCount(3);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(page.locator('.studio-node')).toHaveCount(2);
  await page.locator('.studio-node').filter({ hasText: 'Code / Expression' }).click();
  await page.getByTestId('add-result').click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await page.getByRole('button', { name: 'Run workflow', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Workflow complete', exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.studio-report')).toContainText('298');
});

test('connections can be deleted and recreated and cycle-producing links are excluded', async ({ page }) => {
  await page.goto('/?recipe=blank');
  await page.locator('.studio-node').click(); await page.getByTestId('add-transform').click(); await page.getByTestId('add-result').click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await page.getByRole('button', { name: 'Fit canvas', exact: true }).click();
  const edgePoint = await page.locator('.react-flow__edge-path').first().evaluate((element) => { const path = element as SVGPathElement; const point = path.getPointAtLength(path.getTotalLength() / 2); const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!); return { x: screen.x, y: screen.y }; }); await page.mouse.click(edgePoint.x, edgePoint.y);
  await page.getByRole('button', { name: 'Delete connection', exact: true }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await page.locator('.studio-node').filter({ hasText: 'Manual Trigger' }).click();
  await page.getByLabel('Connect to node').selectOption({ label: 'Set Fields' });
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await page.locator('.studio-node').filter({ hasText: 'Workflow Result' }).click();
  await expect(page.getByLabel('Connect to node').locator('option')).toHaveCount(1);
  await page.getByRole('button', { name: 'Fit canvas', exact: true }).click(); await page.waitForTimeout(450);
  const pathPoint = await page.locator('.react-flow__edge-path').first().evaluate((element) => { const path = element as SVGPathElement; const point = path.getPointAtLength(path.getTotalLength() / 2); const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!); return { x: screen.x, y: screen.y }; }); await page.mouse.click(pathPoint.x, pathPoint.y);
  await page.getByRole('button', { name: 'Delete connection', exact: true }).click(); await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  const sourceHandle = page.locator('.react-flow__node').filter({ hasText: 'Set Fields' }).locator('.react-flow__handle-right');
  const targetHandle = page.locator('.react-flow__node').filter({ hasText: 'Workflow Result' }).locator('.react-flow__handle-left');
  const sourceBox = await sourceHandle.boundingBox(); const targetBox = await targetHandle.boundingBox(); expect(sourceBox).not.toBeNull(); expect(targetBox).not.toBeNull();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2); await page.mouse.down(); await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 18 }); await page.mouse.up(); await expect(page.locator('.react-flow__edge')).toHaveCount(2);
});

test('real GitHub API response is transformed into an inspectable report', async ({ page }) => {
  await page.goto('/?recipe=api');
  await expect(page.locator('.studio-node')).toHaveCount(4);
  await page.getByRole('button', { name: 'Run workflow', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Live repository pulse', exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.locator('.studio-report')).toContainText('nodejs/node');
  await expect(page.locator('.studio-report')).toContainText('stars');
  await page.screenshot({ path: 'artifacts/editor-live-api.png', fullPage: true });
});

test('import, export, validation, search, history, layout and draft recovery work', async ({ page, request }) => {
  await page.goto('/?recipe=blank');
  await page.getByLabel('Search blocks').fill('http'); await expect(page.locator('.studio-block')).toHaveCount(2); await page.getByLabel('Search blocks').fill('');
  await page.getByRole('button', { name: 'Import workflow', exact: true }).click();
  const source = { name: 'Imported flow', nodes: [{ id: 's', type: 'manualTrigger', name: 'Start', position: { x: 0, y: 0 }, config: { sampleData: { value: 42 } } }, { id: 'r', type: 'result', name: 'Report', position: { x: 320, y: 0 }, config: { title: 'Imported report' } }], edges: [{ id: 'e', source: 's', target: 'r' }] };
  await inputCode(page, 'Workflow import JSON', JSON.stringify(source));
  await page.getByRole('button', { name: 'Import workflow', exact: true }).last().click();
  await expect(page.getByRole('textbox', { name: 'Workflow name' })).toHaveValue('Imported flow');
  await page.getByRole('button', { name: 'Auto layout', exact: true }).click();
  await page.getByRole('button', { name: 'Validate workflow', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Workflow is valid');
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export workflow', exact: true }).click(); const download = await downloadPromise; expect(download.suggestedFilename()).toContain('imported-flow');
  await page.getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.getByRole('status')).toContainText('Workflow saved');
  await page.getByRole('textbox', { name: 'Workflow name' }).fill('Imported flow draft');
  await page.waitForTimeout(600); page.once('dialog', (dialog) => dialog.accept()); await page.reload();
  await expect(page.getByRole('textbox', { name: 'Workflow name' })).toHaveValue('Imported flow draft');
  await page.getByRole('button', { name: 'Run workflow', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Imported report', exact: true })).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Run history', exact: true }).last().click(); await expect(page.locator('.studio-history-row')).toHaveCount(1);
});

test('editor remains usable at a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?recipe=blank'); await expect(page.locator('.studio-node')).toHaveCount(1);
  await page.getByRole('button', { name: 'Toggle block library', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'artifacts/editor-mobile.png', fullPage: true });
});

test('a single paid order follows the standard branch and zero paid orders remain valid data', async ({ page }) => {
  await page.goto('/?recipe=revenue');
  await expect(page.locator('.studio-node')).toHaveCount(8);
  const smallBatch = { batchId: 'small-batch', currency: 'USD', orders: [{ orderId: 'ORD-QA', customer: 'Taylor', paymentStatus: 'paid', items: [{ quantity: 1, unitPrice: 50 }] }] };
  await inputCode(page, 'Workflow run input', JSON.stringify(smallBatch));
  await page.getByRole('button', { name: 'Run workflow', exact: true }).first().click();
  await expect(page.locator('.studio-report')).toContainText('1 paid order worth 50 USD', { timeout: 30000 });
  await expect(page.locator('.studio-report')).toContainText('Standard fulfillment');
  await page.getByRole('button', { name: 'Run input', exact: true }).first().click();
  smallBatch.orders[0].paymentStatus = 'pending';
  await inputCode(page, 'Workflow run input', JSON.stringify(smallBatch));
  await page.getByRole('button', { name: 'Run workflow', exact: true }).first().click();
  await expect(page.locator('.studio-report')).toContainText('0 paid orders worth 0 USD', { timeout: 30000 });
});

test('the AI analyst recipe generates a real Groq report', async ({ page, request }) => {
  const capabilities = await request.get(`${API}/capabilities`, { headers: { authorization: `Bearer ${token}` } });
  test.skip(!(await capabilities.json()).aiConfigured, 'Groq key is not configured');
  await page.goto('/?recipe=ai'); await expect(page.locator('.studio-node')).toHaveCount(3);
  await page.getByRole('button', { name: 'Run workflow', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Customer voice · Insights & actions', exact: true })).toBeVisible({ timeout: 35000 });
  await expect(page.locator('.studio-report')).toContainText('summary');
});

test('activation enables a real webhook and its saved run can be inspected in the editor', async ({ page, request }) => {
  await page.goto('/?recipe=blank'); await expect(page.locator('.studio-node')).toHaveCount(1);
  await page.getByTestId('add-webhookTrigger').click(); await page.getByTestId('add-result').click();
  await page.getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.getByRole('status')).toContainText('Workflow saved');
  const id = new URL(page.url()).searchParams.get('workflow')!; workflows.add(id);
  await page.getByRole('button', { name: 'Toggle workflow activation' }).click();
  await expect(page.getByRole('button', { name: 'Toggle workflow activation' })).toContainText('Active');
  const saved = await request.get(`${API}/workflows/${id}`, { headers: { authorization: `Bearer ${token}` } });
  const trigger = (await saved.json()).nodes.find((node: { type: string }) => node.type === 'webhookTrigger');
  const queued = await request.post(`${API}/webhooks/${id}/${trigger.id}`, { data: { event: 'live-webhook-payload', amount: 92 } }); expect(queued.ok()).toBeTruthy(); const executionId = (await queued.json()).executionId;
  await expect.poll(async () => (await (await request.get(`${API}/executions/${executionId}`, { headers: { authorization: `Bearer ${token}` } })).json()).status).toBe('SUCCESS');
  await page.getByRole('button', { name: 'Run history', exact: true }).last().click(); await expect(page.locator('.studio-history-row')).toHaveCount(1);
  await page.locator('.studio-history-row').click(); await expect(page.locator('.studio-report')).toContainText('live-webhook-payload');
  await page.getByRole('button', { name: 'Toggle workflow activation' }).click(); await expect(page.getByRole('button', { name: 'Toggle workflow activation' })).toContainText('Inactive');
  const inactive = await request.post(`${API}/webhooks/${id}/${trigger.id}`, { data: {} }); expect(inactive.status()).toBe(409);
});
