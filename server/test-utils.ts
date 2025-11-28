import crypto from "crypto";
import type { CreateNextContextOptions } from "@trpc/server/adapters/next";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { createContext, type Context } from "./trpc";
import { authRouter } from "./routers/auth";
import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { getSessionTokenFromContext } from "./utils/session-token";

// Create test context
// Accepts either: string (cookie) or object
export async function createTestContext(
  cookieOrOverrides?: string | Partial<CreateNextContextOptions | FetchCreateContextFnOptions>
): Promise<Context> {
  // If it's a string, treat it as a cookie value (new simplified API)
  if (typeof cookieOrOverrides === 'string' || cookieOrOverrides === undefined) {
    const cookie = cookieOrOverrides || '';
    const headers = {
      cookie, // Direct property access
      get: (key: string) => key === 'cookie' ? cookie : undefined, // Function access
    };

    return createContext({
      req: { headers } as any,
      res: { setHeader: () => {} } as any,
    } as CreateNextContextOptions);
  }

  // Otherwise, it's the old override pattern (object)
  const defaultReq = {
    headers: {
      cookie: '',
      get: (key: string) => {
        if (key === 'cookie') return '';
        return undefined;
      },
    },
    ...(cookieOrOverrides && 'req' in cookieOrOverrides ? cookieOrOverrides.req : {}),
  } as any;

  const defaultRes = {
    setHeader: () => {},
    ...(cookieOrOverrides && 'res' in cookieOrOverrides ? cookieOrOverrides.res : {}),
  } as any;

  return createContext({
    req: defaultReq,
    res: defaultRes,
  } as CreateNextContextOptions);
}

// Test user data type
export type TestUserData = {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  dateOfBirth: string;
  ssn: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
};

// Generate unique test user data
export const createTestUserData = (overrides?: Partial<TestUserData>): TestUserData => ({
  email: `test-${crypto.randomUUID()}@example.com`,
  password: 'Password123!',
  firstName: 'Test',
  lastName: 'User',
  phoneNumber: '+1234567890',
  dateOfBirth: '1990-01-01',
  ssn: '123456789',
  address: '123 Main St',
  city: 'City',
  state: 'NY',
  zipCode: '12345',
  ...overrides,
});

// Create authenticated context (signs up user)
export async function createAuthenticatedContext(
  userData?: TestUserData
): Promise<Context> {
  const testData = userData || createTestUserData();
  
  const ctx = await createTestContext();
  const authCaller = authRouter.createCaller(ctx);
  const { token } = await authCaller.signup(testData);
  
  return createContextWithToken(token);
}

// Get all sessions for a user
export const getUserSessions = async (userId: number) =>
  await db.select().from(sessions).where(eq(sessions.userId, userId)).all();

// Create context with specific token
export const createContextWithToken = async (token: string) =>
  await createTestContext(`session=${token}`);

// Create multiple sessions for a user
export async function createMultipleSessions(
  userId: number,
  count: number
): Promise<string[]> {
  const tokens: string[] = [];
  const JWT_SECRET = process.env.JWT_SECRET || "temporary-secret-for-interview";

  for (let i = 0; i < count; i++) {
    const token = jwt.sign(
      { userId, sessionId: crypto.randomUUID() },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await db.insert(sessions).values({
      userId,
      token,
      expiresAt: expiresAt.toISOString(),
    });

    tokens.push(token);
  }

  return tokens;
}

// Extract token from context (uses shared utility)
export function getTokenFromContext(ctx: Context): string | undefined {
  return getSessionTokenFromContext(ctx);
}