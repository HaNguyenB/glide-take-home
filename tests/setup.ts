import crypto from "crypto";
import { beforeAll, afterEach } from "vitest";
import { db } from "@/lib/db";
import { users, sessions, accounts, transactions } from "@/lib/db/schema";

/**
 * Clean all test data from the database
 * This ensures test isolation - each test starts with a clean slate
 */
export async function cleanDatabase() {
  // Delete in order to respect foreign key constraints
  await db.delete(transactions);
  await db.delete(accounts);
  await db.delete(sessions);
  await db.delete(users);
}

process.env.VITE_CSS = "false";
if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
}
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "test-jwt-secret-for-testing-only";
}

beforeAll(async () => {
  // Additional global setup can be added here
});

afterEach(async () => {
  // Clean up after each test to ensure isolation
  // This prevents tests from affecting each other
  await cleanDatabase();
});

