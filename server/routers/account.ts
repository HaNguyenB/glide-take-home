import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { randomInt } from "crypto";
import { protectedProcedure, router } from "../trpc";
import { db } from "@/lib/db";
import { accounts, transactions } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { validateCardNumber } from "@/lib/validation/payment";

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
// Generate a random 10‑digit account number using a cryptographically secure RNG.
function generateAccountNumber(): string {
  return randomInt(0, 10_000_000_000).toString().padStart(10, "0");
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

      // Keep generating account numbers until we find one that is not already in use.
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

      // Fetch the created account so we can return the saved record with its generated fields.
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
  // Fund an account from either a card or bank source, validating input based on the source type.
  fundAccount: protectedProcedure
    .input(
      z.object({
        accountId: z.number(),
        amount: z.number().positive(),
        // Separated funding source into two types: card and bank because we need to validate different fields for each type.
        fundingSource: z.discriminatedUnion("type", [
          z.object({
            type: z.literal("card"),
            accountNumber: z.string(),
          }),
          z.object({
            type: z.literal("bank"),
            accountNumber: z.string(),
            routingNumber: z.string().regex(/^\d{9}$/, "Routing number must be 9 digits"),
          }),
        ]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const amountCents = centsFromDollars(input.amount);

      if (input.fundingSource.type === "card") {
        const cardValidation = validateCardNumber(input.fundingSource.accountNumber);
        if (!cardValidation.isValid) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: cardValidation.message,
          });
        }
      }

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
      // Return transactions for this account, ordered from newest to oldest.
      const accountTransactions = await db
        .select()
        .from(transactions)
        .where(eq(transactions.accountId, input.accountId))
        .orderBy(desc(transactions.createdAt));

      return accountTransactions.map((transaction) => ({
        ...serializeTransaction(transaction),
        accountType: account.accountType,
      }));
    }),
});
