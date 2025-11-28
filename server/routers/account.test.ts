import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    
    expect(account).toBeTruthy();
    expect(account.id).toBeDefined();
    expect(account.id).toBeGreaterThan(0);
    
    const dbAccount = await db.select().from(accounts).where(eq(accounts.id, account.id)).get();
    expect(dbAccount).toBeTruthy();
    expect(dbAccount?.id).toBe(account.id);

    // Insert a transaction with XSS payload directly into database
    // This simulates what would happen if malicious data got into the DB
    const xssPayload = '<img src=x onerror="alert(\'XSS\')">';
    await db.insert(transactions).values({
      accountId: account.id,
      type: 'deposit',
      amount: 10_000,
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

    expect(account).toBeTruthy();
    expect(account.id).toBeDefined();
    expect(account.id).toBeGreaterThan(0);
    
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

    for (const payload of xssPayloads) {
      await db.insert(transactions).values({
        accountId: account.id,
        type: 'deposit',
        amount: 10_000,
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

describe('account.createAccount - Error Handling (PERF-401)', () => {
  let ctx: Awaited<ReturnType<typeof createAuthenticatedContext>>;
  let accountCaller: ReturnType<typeof accountRouter.createCaller>;

  beforeEach(async () => {
    ctx = await createAuthenticatedContext();
    accountCaller = accountRouter.createCaller(ctx);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should throw error when account fetch fails after insert', async () => {
    const originalSelect = db.select;
    const originalInsert = db.insert;
    let insertCompleted = false;
    
    // Mock insert to track when it completes
    vi.spyOn(db, 'insert').mockImplementation(function(this: typeof db, table: Parameters<typeof db.insert>[0]) {
      const insertBuilder = originalInsert.call(this, table);
      const originalValues = insertBuilder.values;
      
      insertBuilder.values = function(vals: any) {
        insertCompleted = true;
        return originalValues.call(this, vals);
      };
      
      return insertBuilder;
    });
    
    // Mock select to fail ONLY after insert completes
    vi.spyOn(db, 'select').mockImplementation(function(this: typeof db) {
      const queryBuilder = (originalSelect as any).call(this);
      
      if (insertCompleted) {
        const originalFrom = queryBuilder.from;
        queryBuilder.from = function(table: any) {
          const fromBuilder = originalFrom.call(this, table);
          const originalWhere = fromBuilder.where;
          
          fromBuilder.where = function(condition: any) {
            const whereBuilder = originalWhere.call(this, condition);
            whereBuilder.get = () => null;
            return whereBuilder;
          };
          
          return fromBuilder;
        };
      }
      
      return queryBuilder;
    });

    await expect(
      accountCaller.createAccount({ accountType: 'checking' })
    ).rejects.toThrow();
  });

  it('should throw error when database insert fails', async () => {
    vi.spyOn(db, 'insert').mockImplementation(() => {
      throw new Error('Database connection failed');
    });

    await expect(
      accountCaller.createAccount({ accountType: 'checking' })
    ).rejects.toThrow('Database connection failed');

    const dbAccounts = await db.select()
      .from(accounts)
      .where(eq(accounts.userId, ctx.user!.id))
      .all();
    expect(dbAccounts).toHaveLength(0);
  });
});

describe('account.fundAccount - Balance Precision (PERF-406)', () => {
  let ctx: Awaited<ReturnType<typeof createAuthenticatedContext>>;
  let accountCaller: ReturnType<typeof accountRouter.createCaller>;

  beforeEach(async () => {
    ctx = await createAuthenticatedContext();
    accountCaller = accountRouter.createCaller(ctx);
  });

  it('should persist exact balances after many micro deposits', async () => {
    const account = await accountCaller.createAccount({ accountType: 'checking' });

    const deposits = 500;
    const depositAmount = 0.01;

    for (let i = 0; i < deposits; i++) {
      await accountCaller.fundAccount({
        accountId: account.id,
        amount: depositAmount,
        fundingSource: {
          type: 'card',
          accountNumber: '4111111111111111',
        },
      });
    }

    const dbAccount = await db.select().from(accounts).where(eq(accounts.id, account.id)).get();

    const expectedCents = deposits * Math.round(depositAmount * 100);

    expect(dbAccount).toBeTruthy();
    expect(dbAccount?.balance).toBe(expectedCents);
  });

  it('should return the same balance that is stored in the database', async () => {
    const account = await accountCaller.createAccount({ accountType: 'checking' });

    const result = await accountCaller.fundAccount({
      accountId: account.id,
      amount: 0.1,
      fundingSource: {
        type: 'card',
        accountNumber: '4111111111111111',
      },
    });

    const dbAccount = await db.select().from(accounts).where(eq(accounts.id, account.id)).get();

    expect(dbAccount).toBeTruthy();
    expect(result.newBalance).toBe(dbAccount!.balance / 100);
  });
});