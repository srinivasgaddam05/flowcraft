import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const API = 'http://localhost:4000';
let token: string;
let accountEmail: string;
let accountPassword: string;
const workflowIds: string[] = [];
test.beforeAll(async ({ request }) => {
  accountEmail = `qa-${randomUUID()}@flowcraft.test`; accountPassword = `QA-${randomUUID()}`;
  const response = await request.post(`${API}/auth/register`, { data: { name: 'Flowcraft QA', email: accountEmail, password: accountPassword } });
  expect(response.ok()).toBeTruthy(); token = (await response.json()).accessToken;
});
test.afterEach(async () => { await new Promise((resolve) => setTimeout(resolve, 12000)); });
test.afterAll(async ({ request }) => {
  for (const id of workflowIds) await request.delete(`${API}/workflows/${id}`, { headers: { authorization: `Bearer ${token}` } });
});
const headers = () => ({ authorization: `Bearer ${token}` });
test('registration and sign-in lead to all five applications', async ({ page }) => {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(accountEmail);
  await page.getByPlaceholder('At least 8 characters').fill(accountPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/demos$/);
  await expect(page.locator('.demo-card')).toHaveCount(5);
  await page.screenshot({ path: 'artifacts/demo-gallery.png', fullPage: true });
});
for (const [templateId, verb, heading] of [
  ['order-intake-validation', 'Validate order', 'Order Intake Validation'],
  ['support-ticket-triage', 'Triage ticket', 'Customer Support Triage'],
  ['lead-qualification', 'Qualify lead', 'Lead Qualification'],
  ['feedback-insights', 'Analyze feedback', 'Customer Feedback Insights'],
  ['it-incident-prioritization', 'Prioritize incident', 'IT Incident Prioritization'],
]) {
  test(`${heading}: form → queue → result → editor → restored result`, async ({ page, request }) => {
    const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript((accessToken) => localStorage.setItem('flowcraft.accessToken', accessToken), token);
    await page.goto(`/demos?demo=${templateId}`);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    const capabilities = await request.get(`${API}/capabilities`, { headers: headers() });
    if (templateId !== 'order-intake-validation' && !(await capabilities.json()).aiConfigured) { test.skip(true, 'Live Groq key is not configured'); return; }
    await page.getByRole('button', { name: verb, exact: true }).click();
    await expect(page.getByText('Workflow completed', { exact: true })).toBeVisible({ timeout: 100000 });
    await expect(page.locator('.demo-result-field')).not.toHaveCount(0);
    const workflowUrl = await page.getByRole('link', { name: 'Reveal workflow' }).getAttribute('href');
    const workflowId = new URL(workflowUrl!, 'http://localhost:3000').searchParams.get('workflow')!; workflowIds.push(workflowId);
    const before = await request.get(`${API}/workflows`, { headers: headers() });
    const countBefore = (await before.json()).length;
    await page.screenshot({ path: `artifacts/${templateId}.png`, fullPage: true });
    await page.getByRole('link', { name: 'Reveal workflow' }).click();
    await expect(page.getByRole('textbox', { name: 'Workflow name' })).toHaveValue(heading);
    await expect(page.locator('.react-flow__node')).not.toHaveCount(0);
    await page.getByRole('button', { name: 'Validate workflow' }).click();
    await expect(page.getByRole('status')).toContainText('Workflow is valid');
    await page.getByRole('link', { name: 'Back to application' }).click();
    await expect(page.getByText('Workflow completed', { exact: true })).toBeVisible();
    const after = await request.get(`${API}/workflows`, { headers: headers() });
    expect((await after.json()).length).toBe(countBefore);
    expect(errors).toEqual([]);
  });
}
test('order routes cover unpaid and invalid totals; saves retain node types and past outputs', async ({ page, request }) => {
  await page.addInitScript((accessToken) => localStorage.setItem('flowcraft.accessToken', accessToken), token);
  await page.goto('/demos?demo=order-intake-validation');
  await page.getByRole('button', { name: 'Validate order', exact: true }).click();
  await expect(page.getByText('Workflow completed', { exact: true })).toBeVisible({ timeout: 20000 });
  const runId = await page.locator('.demo-run-reference code').innerText();
  const link = await page.getByRole('link', { name: 'Reveal workflow' }).getAttribute('href');
  const id = new URL(link!, 'http://localhost:3000').searchParams.get('workflow')!; workflowIds.push(id);
  await page.getByLabel('Payment status').fill('pending');
  await page.getByRole('button', { name: 'Validate order', exact: true }).click();
  await expect(page.locator('.demo-route h3')).toHaveText('Review Payment Status');
  await page.getByLabel(/^Total/).fill('0');
  await page.getByRole('button', { name: 'Validate order', exact: true }).click();
  await expect(page.locator('.demo-route h3')).toHaveText('Review Invalid Total');
  await page.getByRole('link', { name: 'Reveal workflow' }).click();
  await expect(page.getByRole('textbox', { name: 'Workflow name' })).toHaveValue('Order Intake Validation');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Workflow saved');
  const detail = await request.get(`${API}/executions/${runId}`, { headers: headers() });
  expect((await detail.json()).events.some((event: { type: string }) => event.type === 'node.completed')).toBeTruthy();
  const saved = await request.get(`${API}/workflows/${id}`, { headers: headers() });
  expect((await saved.json()).nodes[0].type).toBe('webhookTrigger');
});
test('mobile gallery and form do not overflow the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((accessToken) => localStorage.setItem('flowcraft.accessToken', accessToken), token);
  await page.goto('/demos');
  await expect(page.locator('.demo-card')).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.getByRole('button', { name: /Get every order/ }).click();
  await expect(page.getByRole('heading', { name: 'Order Intake Validation', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'artifacts/demo-mobile.png', fullPage: true });
});
