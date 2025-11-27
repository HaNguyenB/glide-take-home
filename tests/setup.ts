import crypto from "crypto";
import { beforeAll, afterEach } from "vitest";

// Import db - it will read DATABASE_PATH and NODE_ENV from .env file
// (loaded by vitest.config.ts)
import { db } from "@/lib/db";
import { users, sessions, accounts, transactions } from "@/lib/db/schema";

/**
 * Clean all test data from the database
 * This ensures test isolation - each test starts with a clean slate
 */
export async function cleanDatabase() {
  // Delete in order to respect foreign key constraints
  // Add .execute() to ensure the queries actually run
  await db.delete(transactions).execute();
  await db.delete(accounts).execute();
  await db.delete(sessions).execute();
  await db.delete(users).execute();
}

process.env.VITE_CSS = "false";
if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
}
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "test-jwt-secret-for-testing-only";
}

// Only run cleanup hooks when in test environment
// Reads NODE_ENV from .env file
// This prevents cleanup from interfering with manual UI testing
// if (process.env.NODE_ENV === 'test') {
//   beforeAll(async () => {
//     // Clean once at the very start
//     await cleanDatabase();
//   });

//   afterEach(async () => {
//     // Clean up after each test to ensure isolation
//     await cleanDatabase();
//   });
// }