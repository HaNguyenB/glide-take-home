import { describe, it, expect } from 'vitest';
import { accountRouter } from './account';
import { createAuthenticatedContext } from '../test-utils';
import { db } from '@/lib/db';
import { transactions, accounts } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

describe('account.getTransactions - XSS Vulnerability (SEC-303)', () => {

  it('should return transaction descriptions as-is', async () => {
    const ctx = await createAuthenticatedContext();
    const accountCaller = accountRouter.createCaller(ctx);
    const account = await accountCaller.createAccount({ accountType: 'checking' });
    
    // ✅ Verify account was actually created with a valid ID
    expect(account).toBeTruthy();
    expect(account.id).toBeDefined();
    expect(account.id).toBeGreaterThan(0);
    
    // ✅ Verify account exists in database
    const dbAccount = await db.select().from(accounts).where(eq(accounts.id, account.id)).get();
    expect(dbAccount).toBeTruthy();
    expect(dbAccount?.id).toBe(account.id);

    // Insert a transaction with XSS payload directly into database
    // This simulates what would happen if malicious data got into the DB
    const xssPayload = '<img src=x onerror="alert(\'XSS\')">';
    await db.insert(transactions).values({
      accountId: account.id,
      type: 'deposit',
      amount: 100.0,
      description: xssPayload,
      status: 'completed',
      processedAt: new Date().toISOString(),
    });

    // Test: Backend should return the data as-is (backend is not responsible for sanitization)
    const result = await accountCaller.getTransactions({ accountId: account.id });
    
    expect(result).toBeTruthy();
    expect(result.length).toBe(1);
    expect(result[0].description).toBe(xssPayload);
  });

  it('should handle various XSS payload patterns', async () => {
    // Setup: Create authenticated user and account
    const ctx = await createAuthenticatedContext();
    const accountCaller = accountRouter.createCaller(ctx);
    const account = await accountCaller.createAccount({ accountType: 'checking' });

    // ✅ Verify account was actually created with a valid ID
    expect(account).toBeTruthy();
    expect(account.id).toBeDefined();
    expect(account.id).toBeGreaterThan(0);
    
    // ✅ Verify account exists in database
    const dbAccount = await db.select().from(accounts).where(eq(accounts.id, account.id)).get();
    expect(dbAccount).toBeTruthy();
    expect(dbAccount?.id).toBe(account.id);

    // Test various XSS payload patterns
    const xssPayloads = [
      '<script>alert("XSS")</script>',
      '<img src=x onerror="alert(1)">',
      '<svg onload="alert(1)">',
      'javascript:alert(1)',
      '<iframe src="javascript:alert(1)"></iframe>',
    ];

    // ✅ Insert all transactions
    for (const payload of xssPayloads) {
      await db.insert(transactions).values({
        accountId: account.id,
        type: 'deposit',
        amount: 100.0,
        description: payload,
        status: 'completed',
        processedAt: new Date().toISOString(),
      });
    }

    const result = await accountCaller.getTransactions({ accountId: account.id });
    
    expect(result.length).toBe(xssPayloads.length);
    result.forEach((transaction, index) => {
      expect(transaction.description).toBe(xssPayloads[index]);
    });
  });
});