import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const API = 'http://localhost:4000';
test('database worker cancellation and account-scoped WebSocket events', async ({ request, page }) => {
  const createAccount = async () => {
    const response = await request.post(`${API}/auth/register`, { data: { name: 'Flowcraft QA', email: `qa-${randomUUID()}@flowcraft.test`, password: `QA-${randomUUID()}` } });
    expect(response.ok()).toBeTruthy(); return (await response.json()).accessToken as string;
  };
  const owner = await createAccount(); const outsider = await createAccount();
  const headers = { authorization: `Bearer ${owner}` };
  const trigger = randomUUID(); const delay = randomUUID(); const logger = randomUUID();
  const save = await request.post(`${API}/workflows`, { headers, data: {
    name: 'QA cancellation workflow', nodes: [
      { id: trigger, type: 'manualTrigger', name: 'Start', position: { x: 0, y: 0 }, config: {} },
      { id: delay, type: 'delay', name: 'Wait', position: { x: 280, y: 0 }, config: { milliseconds: 5000 } },
      { id: logger, type: 'logger', name: 'Should not run', position: { x: 560, y: 0 }, config: {} },
    ], edges: [{ id: randomUUID(), source: trigger, target: delay }, { id: randomUUID(), source: delay, target: logger }],
  } });
  expect(save.ok()).toBeTruthy(); const workflow = await save.json();
  try {
    const denied = await request.get(`${API}/workflows/${workflow.id}`, { headers: { authorization: `Bearer ${outsider}` } }); expect(denied.status()).toBe(404);
    const unauthenticated = await request.get(`${API}/executions`); expect(unauthenticated.status()).toBe(401);
    await page.goto('http://localhost:3000/login');
    await page.evaluate(async ({ ownerToken, outsiderToken }) => {
      const state = window as unknown as { qaOwnerEvents: { executionId: string }[]; qaOutsiderEvents: { executionId: string }[]; qaSockets: WebSocket[] };
      state.qaOwnerEvents = []; state.qaOutsiderEvents = []; state.qaSockets = [];
      await Promise.all([ownerToken, outsiderToken].map((token, index) => new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(`ws://localhost:4000?token=${encodeURIComponent(token)}`); state.qaSockets.push(socket);
        socket.onopen = () => resolve(); socket.onerror = () => reject(new Error('Unable to connect to authenticated event stream'));
        socket.onmessage = (event) => (index === 0 ? state.qaOwnerEvents : state.qaOutsiderEvents).push(JSON.parse(event.data));
      })));
    }, { ownerToken: owner, outsiderToken: outsider });
    const queued = await request.post(`${API}/workflows/${workflow.id}/execute`, { headers }); const executionId = (await queued.json()).executionId;
    await expect.poll(async () => {
      const response = await request.get(`${API}/executions/${executionId}`, { headers });
      return (await response.json()).events.some((event: { type: string; nodeId: string }) => event.type === 'node.started' && event.nodeId === delay);
    }).toBeTruthy();
    const cancelled = await request.post(`${API}/executions/${executionId}/cancel`, { headers }); expect((await cancelled.json()).status).toBe('CANCELLED');
    await new Promise((resolve) => setTimeout(resolve, 5500));
    const detail = await request.get(`${API}/executions/${executionId}`, { headers }); const run = await detail.json();
    expect(run.status).toBe('CANCELLED'); expect(run.events.some((event: { nodeId: string; type: string }) => event.nodeId === logger && event.type === 'node.completed')).toBe(false);
    const forbiddenRun = await request.get(`${API}/executions/${executionId}`, { headers: { authorization: `Bearer ${outsider}` } }); expect(forbiddenRun.status()).toBe(404);
    const notifications = await page.evaluate(() => {
      const state = window as unknown as { qaOwnerEvents: { executionId: string }[]; qaOutsiderEvents: { executionId: string }[]; qaSockets: WebSocket[] };
      state.qaSockets.forEach((socket) => socket.close()); return { owner: state.qaOwnerEvents, outsider: state.qaOutsiderEvents };
    });
    expect(notifications.owner.some((event) => event.executionId === executionId)).toBeTruthy();
    expect(notifications.outsider.some((event) => event.executionId === executionId)).toBe(false);
  } finally { await request.delete(`${API}/workflows/${workflow.id}`, { headers }); }
});
