import crypto from 'crypto';
import { describe, it, expect } from 'vitest';
import { authRouter } from './auth';
import { 
  createTestContext, 
  createTestUserData,
  createAuthenticatedContext,
  getUserSessions,
  getTokenFromContext,
} from '../test-utils';
import { db } from '@/lib/db';
import { users, sessions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

describe("auth.signup - Input Validation Issues (VAL-201, VAL-202, VAL-203, VAL-204, VAL-208)", () => {
  it("notifies users when their email is normalized to lowercase", async () => {
    const baseData = createTestUserData();
    const upperEmail = baseData.email.toUpperCase();
    const testData = {
      ...baseData,
      email: upperEmail,
    };
    const ctx = await createTestContext();
    const caller = authRouter.createCaller(ctx);

    const result = await caller.signup(testData);
    const response = result as any;

    expect(response.user.email).toBe(upperEmail.toLowerCase());
    expect(response.notifications?.emailNormalization).toBe(
      "Email was converted to lowercase for consistency"
    );
  });

  it("rejects email addresses with common typo TLDs like .con", async () => {
    const typoEmail = `user-${crypto.randomUUID()}@example.con`;
    const ctx = await createTestContext();
    const caller = authRouter.createCaller(ctx);

    await expect(
      caller.signup(
        createTestUserData({
          email: typoEmail,
        })
      )
    ).rejects.toThrow(/invalid email/i);
  });

  it("rejects signup attempts when user is younger than 18", async () => {
    const currentYear = new Date().getFullYear();
    const minorDob = `${currentYear - 10}-01-01`;
    const ctx = await createTestContext();
    const caller = authRouter.createCaller(ctx);

    await expect(
      caller.signup(
        createTestUserData({
          dateOfBirth: minorDob,
        })
      )
    ).rejects.toThrow(/must be at least 18/i);
  });

  it("allows signup when user is 18 or older", async () => {
    const currentYear = new Date().getFullYear();
    const adultDob = `${currentYear - 25}-01-01`;
    const ctx = await createTestContext();
    const caller = authRouter.createCaller(ctx);

    const result = await caller.signup(
      createTestUserData({
        dateOfBirth: adultDob,
      })
    );

    expect(result.user.dateOfBirth).toBe(adultDob);
  });

  it("rejects invalid state codes that are not in the USPS list", async () => {
    const ctx = await createTestContext();
    const caller = authRouter.createCaller(ctx);

    await expect(
      caller.signup(
        createTestUserData({
          state: "XX",
        })
      )
    ).rejects.toThrow(/state code/i);
  });

  it("accepts valid USPS state abbreviations", async () => {
    const ctx = await createTestContext();
    const caller = authRouter.createCaller(ctx);

    const result = await caller.signup(
      createTestUserData({
        state: "CA",
      })
    );

    expect(result.user.state).toBe("CA");
  });

  it("rejects phone numbers that are not in E.164 format", async () => {
    const ctx = await createTestContext();
    const caller = authRouter.createCaller(ctx);

    await expect(
      caller.signup(
        createTestUserData({
          phoneNumber: "4155551234",
        })
      )
    ).rejects.toThrow(/phone number/i);
  });

  it("accepts phone numbers in strict E.164 format", async () => {
    const ctx = await createTestContext();
    const caller = authRouter.createCaller(ctx);

    const result = await caller.signup(
      createTestUserData({
        phoneNumber: "+14155551234",
      })
    );

    expect(result.user.phoneNumber).toBe("+14155551234");
  });

  it("rejects passwords that are too short", async () => {
    const ctx = await createTestContext();
    const caller = authRouter.createCaller(ctx);

    await expect(async () => {
      try {
        await caller.signup(
          createTestUserData({
            password: "Aa1!",
          })
        );
      } catch (error: any) {
        const passwordErrors = error?.data?.zodError?.fieldErrors?.password ?? [];
        expect(passwordErrors).toEqual(
          expect.arrayContaining([expect.stringContaining("at least 8 characters")])
        );
        throw error;
      }
    }).rejects.toThrow();
  });

  it("rejects passwords missing required character classes", async () => {
    const ctx = await createTestContext();
    const caller = authRouter.createCaller(ctx);

    await expect(async () => {
      try {
        await caller.signup(
          createTestUserData({
            password: "AAAAAAAAAAAA", // missing lowercase, digits, symbols
          })
        );
      } catch (error: any) {
        const passwordErrors = error?.data?.zodError?.fieldErrors?.password ?? [];
        expect(passwordErrors).toEqual(
          expect.arrayContaining([
            expect.stringContaining("lowercase"),
            expect.stringContaining("digit"),
            expect.stringContaining("symbol"),
          ])
        );
        throw error;
      }
    }).rejects.toThrow();
  });

  it("accepts strong passwords meeting the complexity requirements", async () => {
    const strongPassword = "Str0ng!Passw0rd";
    const ctx = await createTestContext();
    const caller = authRouter.createCaller(ctx);

    const result = await caller.signup(
      createTestUserData({
        password: strongPassword,
      })
    );

    expect(result.user.email).toBeDefined();
  });
});

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

describe("auth.logout - Logout Issues (PERF-402)", () => {
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

describe("auth.login - Prevent duplicate sessions when user has active session (SEC-302)", () => {
  it("should reject login when user with active session tries to login with same credentials", async () => {
    // 1. Create user A with active session
    const userAData = createTestUserData();
    const ctxA = await createAuthenticatedContext(userAData);
    const userA = ctxA.user!;
    
    // Verify initial state: one session exists
    const sessionsBefore = await getUserSessions(userA.id);
    expect(sessionsBefore).toHaveLength(1);
    
    // 2. Try to login with same credentials while having active session (using authenticated context)
    const caller = authRouter.createCaller(ctxA);
    
    // 3. Login should fail/error because user already has active session
    await expect(
      caller.login({
        email: userAData.email,
        password: userAData.password,
      })
    ).rejects.toThrow();
    
    // 4. Verify no new session was created
    const sessionsAfter = await getUserSessions(userA.id);
    expect(sessionsAfter).toHaveLength(1);
    expect(sessionsAfter[0]!.token).toBe(sessionsBefore[0]!.token);
  });

  it("should reject login when user with active session tries to login with different credentials", async () => {
    // 1. Create user A with active session
    const userAData = createTestUserData();
    const ctxA = await createAuthenticatedContext(userAData);
    const userA = ctxA.user!;
    const userAToken = getTokenFromContext(ctxA);
    
    // Verify user A has one session
    const userASessionsBefore = await getUserSessions(userA.id);
    expect(userASessionsBefore).toHaveLength(1);
    
    // 2. Create user B (different user) - but don't create session for user B
    const userBData = createTestUserData();
    const ctxB = await createTestContext();
    const callerB = authRouter.createCaller(ctxB);
    await callerB.signup(userBData);
    
    // Get user B from database
    const userB = await db
      .select()
      .from(users)
      .where(eq(users.email, userBData.email))
      .get();
    expect(userB).toBeDefined();
    
    // 3. User A (with active session) tries to login as user B (different credentials)
    // This should fail because user A already has an active session
    const callerA = authRouter.createCaller(ctxA);
    await expect(
      callerA.login({
        email: userBData.email,
        password: userBData.password,
      })
    ).rejects.toThrow();
    
    // 4. Verify user A's session is still intact (not affected)
    const userASessionsAfter = await getUserSessions(userA.id);
    expect(userASessionsAfter).toHaveLength(1);
    expect(userASessionsAfter[0]!.token).toBe(userAToken);
  });

  it("should reject signup when user with active session tries to signup", async () => {
    // 1. Create user A with active session
    const userAData = createTestUserData();
    const ctxA = await createAuthenticatedContext(userAData);
    const userA = ctxA.user!;
    
    // Verify initial state: one session exists
    const sessionsBefore = await getUserSessions(userA.id);
    expect(sessionsBefore).toHaveLength(1);
    
    // 2. Try to signup with different email while having active session
    const newUserData = createTestUserData();
    const caller = authRouter.createCaller(ctxA);
    
    // 3. Signup should fail/error because user already has active session
    await expect(
      caller.signup(newUserData)
    ).rejects.toThrow();
    
    // 4. Verify no new session was created for user A
    const sessionsAfter = await getUserSessions(userA.id);
    expect(sessionsAfter).toHaveLength(1);
    expect(sessionsAfter[0]!.token).toBe(sessionsBefore[0]!.token);
    
    // 5. Verify new user was not created
    const newUser = await db
      .select()
      .from(users)
      .where(eq(users.email, newUserData.email))
      .get();
    expect(newUser).toBeUndefined();
  });
});


