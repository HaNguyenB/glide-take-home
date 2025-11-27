import { describe, it, expect, beforeEach } from 'vitest';
import { authRouter } from './auth';
import { createTestContext, createTestUserData } from '../test-utils';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { cleanDatabase } from '@/tests/setup';

describe('auth.signup - SSN Security (SEC-301)', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  it('should encrypt SSN before storing in database', async () => {
    const testData = createTestUserData();
    const plaintextSSN = testData.ssn;

    const ctx = await createTestContext();
    await authRouter.signup.mutate(testData, ctx);

    const storedUser = await db
      .select()
      .from(users)
      .where(eq(users.email, testData.email))
      .get();

    expect(storedUser?.ssn).not.toBe(plaintextSSN);
    expect(storedUser?.ssn).toMatch(/^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/i);
    expect(storedUser?.ssn.length).toBeGreaterThan(plaintextSSN.length);
  });

  it.each([
    ['signup', (ctx: any) => authRouter.signup.mutate(createTestUserData(), ctx)],
    ['login', async (ctx: any) => {
      const testData = createTestUserData();
      await authRouter.signup.mutate(testData, ctx);
      return authRouter.login.mutate({ email: testData.email, password: testData.password }, ctx);
    }],
  ])('should exclude SSN from %s response', async (_, getResult) => {
    const ctx = await createTestContext();
    const result = await getResult(ctx);

    expect(result.user.ssn).toBeUndefined();
    expect(result.user.password).toBeUndefined();
    expect(result.user.email).toBeDefined();
  });
});
