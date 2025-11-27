import { beforeAll, afterEach } from 'vitest';
import { db } from '@/lib/db';
import { users, sessions, accounts, transactions } from '@/lib/db/schema';

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

beforeAll(async () => {
  // Prevent Vite from processing PostCSS config during tests
  process.env.VITE_CSS = 'false';
  
  // Set test environment variables
  // These are required for the application to work in test environment
  if (!process.env.ENCRYPTION_KEY) {
    // Generate a test encryption key (64 hex chars = 32 bytes)
    // In production, this should be a secure random key stored in secrets manager
    process.env.ENCRYPTION_KEY = 'test-encryption-key-32-bytes-long-for-testing-only!!'.repeat(2).slice(0, 64);
  }
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test-jwt-secret-for-testing-only';
  }
});

afterEach(async () => {
  // Clean up after each test to ensure isolation
  // This prevents tests from affecting each other
  await cleanDatabase();
});

