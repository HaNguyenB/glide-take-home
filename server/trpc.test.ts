import { describe, it, expect, beforeEach } from 'vitest';
import { createContext } from "./trpc";
import { createTestUserData, createTestContext } from "./test-utils";
import { authRouter } from "./routers/auth";
import { db } from '@/lib/db';
import { users, sessions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { cleanDatabase } from '@/tests/setup';

describe('createContext - SSN Security (SEC-301)', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  it('should exclude sensitive fields (SSN and password) from context user object', async () => {
    const testData = createTestUserData();
    const ctx = await createTestContext();
    const caller = authRouter.createCaller(ctx);
    await caller.signup(testData);

    const user = await db.select().from(users).where(eq(users.email, testData.email)).get();
    const token = jwt.sign(
      { userId: user!.id },
      process.env.JWT_SECRET || 'test-jwt-secret-for-testing-only',
      { expiresIn: '7d' }
    );

    await db.insert(sessions).values({
      userId: user!.id,
      token,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const testCtx = await createTestContext({
      // 11/27/2025: set cookie via shared helper to avoid missing fields that broke this test.
      req: {
        headers: {
          cookie: `session=${token}`,
          get: (key: string) => (key === "cookie" ? `session=${token}` : undefined),
        },
      } as any,
    });

    expect(testCtx.user?.ssn).toBeUndefined();
    expect(testCtx.user?.password).toBeUndefined();
    expect(testCtx.user?.email).toBe(testData.email);
  });
});
