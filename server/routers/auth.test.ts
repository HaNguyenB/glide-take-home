import { describe, it, expect } from 'vitest';
import { authRouter } from './auth';
import { 
  createTestContext, 
  createTestUserData,
  createAuthenticatedContext,
  getUserSessions,
  getTokenFromContext,
  createContextWithToken,
  createMultipleSessions
} from '../test-utils';
import { db } from '@/lib/db';
import { users, sessions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

describe('auth.signup - SSN Security (SEC-301)', () => {

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

describe("auth.logout - Session Management (SEC-304)", () => {
  // This test passes in test environment but fails in UI
  // Test environment manually sets cookie, so token extraction works
  // TO BE DELETED WHEN BUG IS FIXED
  it.skip("extracts token from cookie and deletes session", async () => {
    const ctx = await createAuthenticatedContext();
    const token = getTokenFromContext(ctx);
    
    // Verify session exists
    const sessionBefore = await db.select()
      .from(sessions)
      .where(eq(sessions.token, token!))
      .get();
    expect(sessionBefore).toBeDefined();
    
    // Logout
    await authRouter.createCaller(ctx).logout();
    
    // Verify session is deleted (proves token extraction worked)
    const sessionAfter = await db.select()
      .from(sessions)
      .where(eq(sessions.token, token!))
      .get();
    expect(sessionAfter).toBeUndefined();
  });

  // This test reflects the actual bug: token extraction fails, session not deleted
  // Simulates UI behavior where ctx.req.cookies exists but cookies.session is undefined
  // This test FAILS when the bug exists (session not deleted) and PASSES when bug is fixed
  it("fails to delete session when token extraction fails (BUG)", async () => {
    const ctx = await createAuthenticatedContext();
    const token = getTokenFromContext(ctx);
    
    // Verify session exists
    const sessionBefore = await db.select()
      .from(sessions)
      .where(eq(sessions.token, token!))
      .get();
    expect(sessionBefore).toBeDefined();
    
    // Simulate the bug: create context where cookies property exists but is empty
    // This mimics what happens in UI where ctx.req.cookies exists but session is undefined
    const buggyCtx = await createTestContext({
      req: {
        cookies: {}, // cookies property exists but is empty (like in UI)
        headers: {
          cookie: `session=${token}`, // Cookie is in headers, not in cookies.session
          get: (key: string) => key === "cookie" ? `session=${token}` : undefined,
        },
      } as any,
    });
    
    // Logout with buggy context (simulates UI behavior)
    await authRouter.createCaller(buggyCtx).logout();
    
    // BUG: Session should be deleted but isn't because token extraction failed
    // When bug exists: session still exists -> test FAILS (as expected)
    // When bug is fixed: session deleted -> test PASSES
    const sessionAfter = await db.select()
      .from(sessions)
      .where(eq(sessions.token, token!))
      .get();
    
    // Expect session to be deleted - test fails when bug exists, passes when fixed
    expect(sessionAfter).toBeUndefined();
  });
});


