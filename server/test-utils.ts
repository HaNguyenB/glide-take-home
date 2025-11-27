import crypto from "crypto";
import type { CreateNextContextOptions } from "@trpc/server/adapters/next";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { createContext, type Context } from "./trpc";
import { authRouter } from "./routers/auth";

/**
 * Create a test context for tRPC procedures
 * This simulates the request/response objects that tRPC needs
 */
export async function createTestContext(
  overrides?: Partial<CreateNextContextOptions | FetchCreateContextFnOptions>
) {
  const defaultReq = {
    headers: {
      cookie: '',
      get: (key: string) => {
        if (key === 'cookie') return '';
        return undefined;
      },
    },
    ...(overrides && 'req' in overrides ? overrides.req : {}),
  } as any;

  const defaultRes = {
    setHeader: () => {},
    ...(overrides && 'res' in overrides ? overrides.res : {}),
  } as any;

  return createContext({
    req: defaultReq,
    res: defaultRes,
  } as CreateNextContextOptions);
}

/**
 * Test user data type
 */
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

/**
 * Generate test user data with unique email
 * This ensures tests don't conflict with each other
 */
export function createTestUserData(overrides?: Partial<TestUserData>): TestUserData {
  const unique = crypto.randomUUID();
  return {
    email: `test-${unique}@example.com`,
    password: 'password123',
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
  };
}

/**
 * Create an authenticated test context by signing up a user
 * This helper eliminates the need to manually create sessions in tests
 * 
 * @param userData - Optional user data. If not provided, uses createTestUserData()
 * @returns An authenticated context with ctx.user populated
 * 
 * @example
 * ```typescript
 * const ctx = await createAuthenticatedContext();
 * const accountCaller = accountRouter.createCaller(ctx);
 * // ctx.user is now available for protectedProcedure calls
 * ```
 */
export async function createAuthenticatedContext(
  userData?: TestUserData
): Promise<Context> {
  const testData = userData || createTestUserData();
  
  // Create unauthenticated context for signup
  const unauthenticatedCtx = await createTestContext();
  const authCaller = authRouter.createCaller(unauthenticatedCtx);
  
  // Sign up the user (this creates the session and returns the token)
  const signupResult = await authCaller.signup(testData);
  
  // Create authenticated context with the session token
  const authenticatedCtx = await createTestContext({
    req: {
      headers: {
        cookie: `session=${signupResult.token}`,
        get: (key: string) => (key === "cookie" ? `session=${signupResult.token}` : undefined),
      },
    } as any,
  });
  
  return authenticatedCtx;
}

