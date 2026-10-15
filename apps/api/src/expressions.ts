import jsonata from 'jsonata';
import { Worker } from 'node:worker_threads';

export function validateExpression(expression: unknown): string[] {
  if (typeof expression !== 'string' || !expression.trim()) return ['Expression code is required'];
  if (expression.length > 20000) return ['Expression code exceeds 20000 characters'];
  try { jsonata(expression); return []; } catch (error) { return [`Expression: ${(error as { message?: string }).message ?? 'Invalid syntax'}`]; }
}

// JSONata is evaluated away from the API/worker event loop. No host functions are exposed.
export async function evaluateExpression(expression: string, input: unknown, variables: Record<string, unknown> = {}): Promise<unknown> {
  const errors = validateExpression(expression);
  if (errors.length) throw new Error(errors.join('; '));
  return new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const jsonata = require(workerData.modulePath);
      (async () => {
        try {
          const value = await jsonata(workerData.expression).evaluate(workerData.input, { json: workerData.input, nodes: workerData.variables });
          const serialized = JSON.stringify(value === undefined ? null : value);
          if (serialized.length > 1000000) throw new Error('Expression output exceeds 1 MB');
          parentPort.postMessage({ value: JSON.parse(serialized) });
        } catch (error) { parentPort.postMessage({ error: error.message || 'Expression evaluation failed' }); }
      })();
    `, { eval: true, workerData: { modulePath: require.resolve('jsonata'), expression, input, variables }, resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } });
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error('Expression exceeded its 3-second execution limit')); }, 3000);
    worker.once('message', (result: { value?: unknown; error?: string }) => { clearTimeout(timer); void worker.terminate(); if (result.error) reject(new Error(result.error)); else resolve(result.value); });
    worker.once('error', (error) => { clearTimeout(timer); reject(new Error(`Expression failed: ${error.message}`)); });
    worker.once('exit', (code) => { clearTimeout(timer); if (code !== 0) reject(new Error('Expression worker stopped before completing')); });
  });
}
export async function resolveTemplates(value: unknown, input: unknown, variables: Record<string, unknown> = {}): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map((item) => resolveTemplates(item, input, variables)));
  if (value && typeof value === 'object') {
    const entries = await Promise.all(Object.entries(value).map(async ([key, item]) => [key, key === 'expression' ? item : await resolveTemplates(item, input, variables)]));
    return Object.fromEntries(entries);
  }
  if (typeof value !== 'string' || !value.includes('{{')) return value;
  const exact = value.match(/^\s*\{\{\s*([\s\S]*?)\s*\}\}\s*$/);
  if (exact) return evaluateExpression(exact[1], input, variables);
  const matches = [...value.matchAll(/\{\{\s*([\s\S]*?)\s*\}\}/g)];
  let output = value;
  for (const match of matches) {
    const result = await evaluateExpression(match[1], input, variables);
    output = output.replace(match[0], typeof result === 'object' ? JSON.stringify(result) : String(result ?? ''));
  }
  return output;
}
export function readPath(input: unknown, path: string): unknown {
  return path.split('.').filter(Boolean).reduce<unknown>((value, key) => {
    if (['__proto__', 'prototype', 'constructor'].includes(key) || value === null || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[key];
  }, input);
}
