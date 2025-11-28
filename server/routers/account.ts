import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../trpc";
import { db } from "@/lib/db";
import { accounts, transactions } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";

type AccountRecord = typeof accounts.$inferSelect;
type TransactionRecord = typeof transactions.$inferSelect;

const centsFromDollars = (amount: number) => Math.round(amount * 100);
const dollarsFromCents = (cents: number) => cents / 100;

const serializeAccount = (account: AccountRecord) => ({
  ...account,
  balance: dollarsFromCents(account.balance),
});

const serializeTransaction = (transaction: TransactionRecord) => ({
  ...transaction,
  amount: dollarsFromCents(transaction.amount),
});

function generateAccountNumber(): string {
  return Math.floor(Math.random() * 1000000000)
    .toString()
    .padStart(10, "0");
}

export const accountRouter = router({
  createAccount: protectedProcedure
    .input(
      z.object({
        accountType: z.enum(["checking", "savings"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Check if user already has an account of this type
      const existingAccount = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.userId, ctx.user.id), eq(accounts.accountType, input.accountType)))
        .get();

      if (existingAccount) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `You already have a ${input.accountType} account`,
        });
      }

      let accountNumber;
      let isUnique = false;

      // Generate unique account number
      while (!isUnique) {
        accountNumber = generateAccountNumber();
        const existing = await db.select().from(accounts).where(eq(accounts.accountNumber, accountNumber)).get();
        isUnique = !existing;
      }

      await db.insert(accounts).values({
        userId: ctx.user.id,
        accountNumber: accountNumber!,
        accountType: input.accountType,
        balance: 0,
        status: "active",
      });

      // Fetch the created account
      const account = await db.select().from(accounts).where(eq(accounts.accountNumber, accountNumber!)).get();

      if (!account) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create account",
        });
      }

      return serializeAccount(account);
    }),

  getAccounts: protectedProcedure.query(async ({ ctx }) => {
    const userAccounts = await db.select().from(accounts).where(eq(accounts.userId, ctx.user.id));

    return userAccounts.map(serializeAccount);
  }),
  // ISSUE: VAL-206. System accepts invalid card numbers because backend never re-validates card numbers.
  fundAccount: protectedProcedure
    .input(
      z.object({
        accountId: z.number(),
        amount: z.number().positive(),
        fundingSource: z.object({
          type: z.enum(["card", "bank"]),
          accountNumber: z.string(),
          routingNumber: z.string().optional(), // ISSUE: VAL-207. Routing number is optional, so users can submit bank transfers without routing info.
        }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const amountCents = centsFromDollars(input.amount);

      // Verify account belongs to user
      const account = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.id, input.accountId), eq(accounts.userId, ctx.user.id)))
        .get();

      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Account not found",
        });
      }

      if (account.status !== "active") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Account is not active",
        });
      }

      // Create transaction
      const insertedTransaction = await db
        .insert(transactions)
        .values({
          accountId: input.accountId,
          type: "deposit",
          amount: amountCents,
          description: `Funding from ${input.fundingSource.type}`,
          status: "completed",
          processedAt: new Date().toISOString(),
        })
        .returning()
        .get();

      if (!insertedTransaction) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to record transaction",
        });
      }

      const updatedAccount = await db
        .update(accounts)
        .set({
          balance: account.balance + amountCents,
        })
        .where(eq(accounts.id, input.accountId))
        .returning()
        .get();

      if (!updatedAccount) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update account balance",
        });
      }

      return {
        transaction: serializeTransaction(insertedTransaction),
        newBalance: dollarsFromCents(updatedAccount.balance),
      };
    }),

  getTransactions: protectedProcedure
    .input(
      z.object({
        accountId: z.number(),
      })
    )
    .query(async ({ input, ctx }) => {
      // Verify account belongs to user
      const account = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.id, input.accountId), eq(accounts.userId, ctx.user.id)))
        .get();

      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Account not found",
        });
      }
      // PERF-404: Transaction Ordering. No deterministic sorting of transactions.
      const accountTransactions = await db
        .select()
        .from(transactions)
        .where(eq(transactions.accountId, input.accountId))
        .orderBy(desc(transactions.createdAt));

      const enrichedTransactions = [];
      for (const transaction of accountTransactions) {
        const accountDetails = await db.select().from(accounts).where(eq(accounts.id, transaction.accountId)).get();

        enrichedTransactions.push({
          ...transaction,
          accountType: accountDetails?.accountType,
        });
      }

      return enrichedTransactions.map((transaction) => ({
        ...serializeTransaction(transaction),
        accountType: transaction.accountType,
      }));
    }),
});
