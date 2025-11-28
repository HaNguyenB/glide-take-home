import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../trpc";
import { db } from "@/lib/db";
import { users, sessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { encryptSSN } from "@/lib/encryption";
import { getSessionTokenFromContext } from "../utils/session-token";
import {
  emailValidationSchema,
  signupInputSchema,
  validateEmailField,
} from "@/lib/validation/signup";

export const authRouter = router({
  validateEmail: publicProcedure
    .input(emailValidationSchema)
    .mutation(async ({ input }) => {
      const validationResult = validateEmailField(input.email);
      const existingUser = await db
        .select()
        .from(users)
        .where(eq(users.email, validationResult.normalizedEmail))
        .get();

      if (existingUser) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account with this email already exists",
        });
      }

      return validationResult;
    }),
  signup: publicProcedure
    .input(signupInputSchema)
    // Handle user signup, preventing duplicate accounts and active-session signups.
    .mutation(async ({ input, ctx }) => {
      const { normalizedEmail, notifications } = validateEmailField(input.email);
      const notificationBag: Record<string, string> = { ...notifications };

      // Check if user already has active session
      if (ctx.user) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot signup while already logged in. Please logout first.",
        });
      }
      // Check if user already exists
      const existingUser = await db
        .select()
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .get();

      if (existingUser) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "User already exists",
        });
      }

      const hashedPassword = await bcrypt.hash(input.password, 10);
      // Encrypt the SSN before storing it so it is not kept in plain text in the database.
      const encryptedSSN = encryptSSN(input.ssn);

      await db.insert(users).values({
        ...input,
        email: normalizedEmail,
        ssn: encryptedSSN,
        password: hashedPassword,
      });

      // Fetch the created user
      const user = await db
        .select()
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .get();

      if (!user) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create user",
        });
      }

      // Create session
      const token = createSessionToken(user.id);

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      await db.insert(sessions).values({
        userId: user.id,
        token,
        expiresAt: expiresAt.toISOString(),
      });

      // Set cookie
      if ("setHeader" in ctx.res) {
        ctx.res.setHeader(
          "Set-Cookie",
          `session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`
        );
      } else {
        (ctx.res as Headers).set(
          "Set-Cookie",
          `session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`
        );
      }
      const response: {
        user: ReturnType<typeof sanitizeUser>;
        token: string;
        notifications?: Record<string, string>;
      } = { user: sanitizeUser(user), token };

      if (Object.keys(notificationBag).length > 0) {
        response.notifications = notificationBag;
      }

      return response;
    }),

    

  // Log a user in by validating credentials and creating a new session.
  login: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Check if user already has active session
      if (ctx.user) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot login while already logged in. Please logout first.",
        });
      }
      // Check if user exists
      const user = await db
        .select()
        .from(users)
        .where(eq(users.email, input.email))
        .get();

      if (!user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid credentials",
        });
      }

      const validPassword = await bcrypt.compare(input.password, user.password);

      if (!validPassword) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid credentials",
        });
      }

      // Create a new session token for this user and persist it with an expiry.
      const token = createSessionToken(user.id);

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      await db.insert(sessions).values({
        userId: user.id,
        token,
        expiresAt: expiresAt.toISOString(),
      });

      if ("setHeader" in ctx.res) {
        ctx.res.setHeader(
          "Set-Cookie",
          `session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`
        );
      } else {
        (ctx.res as Headers).set(
          "Set-Cookie",
          `session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`
        );
      }
      return { user: sanitizeUser(user), token };
    }),
  // Get the current authenticated user.
  me: publicProcedure.query(async ({ ctx }) => {
    // Returns the sanitized user if authenticated, or null when there is no active session.
    return ctx.user ? sanitizeUser(ctx.user) : null;
  }),

  // Log the user out by deleting the current session and clearing the cookie.
  logout: publicProcedure.mutation(async ({ ctx }) => {
    if (ctx.user) {
      // Delete session from database using shared token extraction
      const token = getSessionTokenFromContext(ctx);
      
      if (token) {
        await db.delete(sessions).where(eq(sessions.token, token));
      }
    }

    if ("setHeader" in ctx.res) {
      ctx.res.setHeader(
        "Set-Cookie",
        `session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`
      );
    } else {
      (ctx.res as Headers).set(
        "Set-Cookie",
        `session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`
      );
    }

    return {
      success: true,
      message: ctx.user ? "Logged out successfully" : "No active session",
    };
  }),
});

function sanitizeUser(user: typeof users.$inferSelect) {
  // 11/27/25: strip sensitive fields from responses (SEC-301).
  const { password, ssn, ...rest } = user;
  return rest;
}

function createSessionToken(userId: number) {
  return jwt.sign(
    { userId, sessionId: crypto.randomUUID() },
    process.env.JWT_SECRET || "temporary-secret-for-interview",
    {
      expiresIn: "7d",
    }
  );
}
