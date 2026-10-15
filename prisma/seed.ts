import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
const prisma = new PrismaClient();
async function main() {
  const password = process.env.DEMO_USER_PASSWORD;
  if (!password || password.length < 12) throw new Error('Set DEMO_USER_PASSWORD to a value with at least 12 characters before seeding.');
  const user = await prisma.user.upsert({ where: { email: 'demo@workflow.local' }, update: {}, create: { email: 'demo@workflow.local', name: 'Demo Operator', passwordHash: await hash(password, 12) } });
  const workflow = await prisma.workflow.upsert({ where: { id: 'demo-http-health' }, update: {}, create: { id: 'demo-http-health', name: 'HTTP health check', description: 'A deterministic starter workflow', ownerId: user.id, nodes: { create: [{ id: 'demo-trigger', type: 'manualTrigger', name: 'Manual Trigger', position: { x: 80, y: 160 }, config: {} }, { id: 'demo-log', type: 'logger', name: 'Logger', position: { x: 360, y: 160 }, config: { message: 'Workflow completed' } }] }, edges: { create: [{ id: 'demo-trigger-log', sourceNodeId: 'demo-trigger', targetNodeId: 'demo-log' }] } } });
  console.log(`Seeded ${workflow.name} for ${user.email}`);
}
main().finally(() => prisma.$disconnect());