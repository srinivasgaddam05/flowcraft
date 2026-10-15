import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthService } from './auth.service';

function createService(): AuthService {
  return new AuthService({} as never);
}

test('registers users with hashed passwords and issues verifiable JWTs', async () => {
  const auth = createService();
  const result = await auth.register('operator@example.com', 'correct-horse-42', 'Operator');

  assert.equal(result.user.email, 'operator@example.com');
  assert.equal(auth.verify(result.accessToken).id, result.user.id);
  assert.equal(auth.verify(result.accessToken).name, 'Operator');
});

test('logs in with normalized email and rejects invalid credentials', async () => {
  const auth = createService();
  await auth.register('operator@example.com', 'correct-horse-42', 'Operator');

  const result = await auth.login(' OPERATOR@example.com ', 'correct-horse-42');
  assert.equal(result.user.name, 'Operator');
  await assert.rejects(auth.login('operator@example.com', 'incorrect-password'), /Invalid email or password/);
});

test('rejects duplicate registration and malformed registration data', async () => {
  const auth = createService();
  await auth.register('operator@example.com', 'correct-horse-42', 'Operator');

  await assert.rejects(auth.register('OPERATOR@example.com', 'correct-horse-42', 'Another'), /Email is already registered/);
  await assert.rejects(auth.register('not-an-email', 'short', 'A'), /required/);
});