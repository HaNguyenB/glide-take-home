import { describe, it, expect } from 'vitest';
import { createTestUserData, createTestContext } from "./test-utils";
import { authRouter } from "./routers/auth";
import { db } from '@/lib/db';
import { users, sessions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import jwt from 'jsonwebtoken';

describe('createContext - SSN Security (SEC-301)', () => {
  
  it('should exclude sensitive fields (SSN and password) from context user object', async () => {
    // Step 1: Create user via signup
    const testData = createTestUserData();
    const ctx = await createTestContext();
    const caller = authRouter.createCaller(ctx);
    
    const signupResult = await caller.signup(testData);
    // console.log('1. Signup result:', signupResult);

    // Step 2: Fetch the user from database
    const user = await db
      .select()
      .from(users)
      .where(eq(users.email, testData.email))
      .get();
    
    // console.log('2. User from DB:', user);
    
    // ✅ Verify user exists before proceeding
    expect(user).toBeDefined();
    expect(user?.id).toBeDefined();

    // Step 3: Verify user actually exists in the database
    const userExists = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, user!.id))
      .get();
    
    // console.log('3. User exists check:', userExists);
    expect(userExists).toBeDefined();

    // Step 4: Create JWT token
    const token = jwt.sign(
      { userId: user!.id },
      process.env.JWT_SECRET || 'test-jwt-secret-for-testing-only',
      { expiresIn: '7d' }
    );
    
    // console.log('4. JWT token created:', token.substring(0, 20) + '...');

    // Step 5: Insert session with proper error handling
    try {
      const sessionData = {
        userId: user!.id,
        token,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      };
      
      // console.log('5. Inserting session:', sessionData);
      
      await db.insert(sessions).values(sessionData);
      
      // console.log('6. Session inserted successfully');
    } catch (error) {
      // console.error('Session insert failed:', error);
      
      // Debug: Check what's in the users table
      const allUsers = await db.select().from(users).all();
      // console.error('All users in DB:', allUsers);
      
      // Debug: Check what's in the sessions table
      const allSessions = await db.select().from(sessions).all();
      // console.error('All sessions in DB:', allSessions);
      
      throw error;
    }

    // Step 6: Create test context with cookie
    const testCtx = await createTestContext({
      req: {
        headers: {
          cookie: `session=${token}`,
          get: (key: string) => (key === "cookie" ? `session=${token}` : undefined),
        },
      } as any,
    });

    // console.log('7. Test context created:', {
    //   hasUser: !!testCtx.user,
    //   userEmail: testCtx.user?.email,
    //   hasSsn: 'ssn' in (testCtx.user || {}),
    //   hasPassword: 'password' in (testCtx.user || {}),
    // });

    // Assertions
    expect(testCtx.user).toBeDefined();
    expect(testCtx.user?.ssn).toBeUndefined();
    expect(testCtx.user?.password).toBeUndefined();
    expect(testCtx.user?.email).toBe(testData.email);
  });
});

describe('createContext - Session Expiry Timing Bug (PERF-403)', () => {

  it('should reject expired sessions using consistent timestamp', async () => {
    // Create user and session
    const testData = createTestUserData();
    const ctx = await createTestContext();
    const caller = authRouter.createCaller(ctx);
    await caller.signup(testData);
    
    const user = await db
      .select()
      .from(users)
      .where(eq(users.email, testData.email))
      .get();
    
    expect(user).toBeDefined();
    
    // Create a JWT token
    const token = jwt.sign(
      { userId: user!.id },
      process.env.JWT_SECRET || 'temporary-secret-for-interview',
      { expiresIn: '7d' }
    );
    
    // Create a session that expired 1 second ago
    const expiredAt = new Date(Date.now() - 1000);
    await db.insert(sessions).values({
      userId: user!.id,
      token,
      expiresAt: expiredAt.toISOString(),
    });
    
    // Create context with the expired session token
    // PERF-403 fix: Uses consistent timestamp, so expired session should be rejected
    const testCtx = await createTestContext(`session=${token}`);
    
    // Session should be rejected (user should be null)
    expect(testCtx.user).toBeNull();
  });

  it('should handle sessions expiring at boundary time with consistent timestamp', async () => {
    // Create user and session
    const testData = createTestUserData();
    const ctx = await createTestContext();
    const caller = authRouter.createCaller(ctx);
    await caller.signup(testData);
    
    const user = await db
      .select()
      .from(users)
      .where(eq(users.email, testData.email))
      .get();
    
    expect(user).toBeDefined();
    
    // Create a JWT token
    const token = jwt.sign(
      { userId: user!.id },
      process.env.JWT_SECRET || 'temporary-secret-for-interview',
      { expiresIn: '7d' }
    );
    
    // Create a session that expires exactly at current time (boundary case)
    // PERF-403 fix ensures consistent timestamp comparison
    const now = Date.now();
    const expiresAt = new Date(now); // Expires exactly now
    
    await db.insert(sessions).values({
      userId: user!.id,
      token,
      expiresAt: expiresAt.toISOString(),
    });
    
    // Small delay to ensure we're past the expiry time
    await new Promise(resolve => setTimeout(resolve, 10));
    
    // Create context - should reject expired session
    const testCtx = await createTestContext(`session=${token}`);
    
    // Session expired at boundary, should be rejected
    expect(testCtx.user).toBeNull();
  });

});