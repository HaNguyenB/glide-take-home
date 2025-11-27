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

  it("should encrypt SSN before storing in database", async () => {
    const testData = createTestUserData();
    const plaintextSSN = testData.ssn;

    const ctx = await createTestContext();
    const caller = authRouter.createCaller(ctx);
    await caller.signup(testData);

    const storedUser = await db
      .select()
      .from(users)
      .where(eq(users.email, testData.email))
      .get();

    expect(storedUser?.ssn).not.toBe(plaintextSSN);
    expect(storedUser?.ssn).toMatch(/^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/i);
    expect(storedUser?.ssn.length).toBeGreaterThan(plaintextSSN.length);
  });

  it("should exclude SSN from signup response", async () => {
    const testData = createTestUserData();
    const ctx = await createTestContext();
    const caller = authRouter.createCaller(ctx);

    const result = await caller.signup(testData);

    const user = result.user as any;
    expect(user.ssn).toBeUndefined();
    expect(user.password).toBeUndefined();
    expect(result.user.email).toBe(testData.email);
  });

  it("should exclude SSN from login response", async () => {
    const testData = createTestUserData();
    const ctx = await createTestContext();
    const caller = authRouter.createCaller(ctx);

    await caller.signup(testData);
    const result = await caller.login({
      email: testData.email,
      password: testData.password,
    });

    const user = result.user as any;
    expect(user.ssn).toBeUndefined();
    expect(user.password).toBeUndefined();
    expect(user.email).toBe(testData.email);
  });
});
