import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

const rootEnv = resolve(__dirname, '../../../.env');
if (existsSync(rootEnv)) loadEnvFile(rootEnv);

export const demoMode = process.env.DEMO_MODE === 'true';
export const databaseEnabled = !demoMode && Boolean(process.env.DATABASE_URL);
export const redisEnabled = !demoMode && Boolean(process.env.REDIS_URL);