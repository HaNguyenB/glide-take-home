import crypto from "crypto";
import type { CreateNextContextOptions } from "@trpc/server/adapters/next";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { createContext } from "./trpc";

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
    ...overrides?.req,
  } as any;

  const defaultRes = {
    setHeader: () => {},
    ...overrides?.res,
  } as any;

  return createContext({
    req: defaultReq,
    res: defaultRes,
  } as CreateNextContextOptions);
}

/**
 * Generate test user data with unique email
 * This ensures tests don't conflict with each other
 */
export function createTestUserData(overrides?: Partial<ReturnType<typeof createTestUserData>>) {
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

