import { z } from "zod";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../trpc";
import { db } from "@/lib/db";
import { users, sessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { encryptSSN } from "@/lib/encryption";
import { getSessionTokenFromContext } from "../utils/session-token";

export const authRouter = router({
  signup: publicProcedure
    .input(
      z.object({
        email: z.string().email().toLowerCase(),
        password: z.string().min(8),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        phoneNumber: z.string().regex(/^\+?\d{10,15}$/),
        dateOfBirth: z.string(),
        ssn: z.string().regex(/^\d{9}$/),
        address: z.string().min(1),
        city: z.string().min(1),
        state: z.string().length(2).toUpperCase(),
        zipCode: z.string().regex(/^\d{5}$/),
      })
    )
    // ISSUE: Signup doesn't check for existing sessions.
    .mutation(async ({ input, ctx }) => {
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
        .where(eq(users.email, input.email))
        .get();

      if (existingUser) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "User already exists",
        });
      }

      const hashedPassword = await bcrypt.hash(input.password, 10);
      // 11/27/25: encrypt SSN before persisting (SEC-301).
      const encryptedSSN = encryptSSN(input.ssn);

      await db.insert(users).values({
        ...input,
        ssn: encryptedSSN,
        password: hashedPassword,
      });

      // Fetch the created user
      const user = await db
        .select()
        .from(users)
        .where(eq(users.email, input.email))
        .get();

      if (!user) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create user",
        });
      }

      // Create session
      // ISSUE: Multiple sessions created without invalidaing previous sessions
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
      return { user: sanitizeUser(user), token };
    }),

    

  login: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string(),
      })
    )
    // ISSUE: Login doesn't check for existing sessions.
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

      // ISSUE: Each login/signup adds a new session. 
      // IMPACT: A user can accumuate multiple sessions.
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
  // ISSUE: Logout deletes only the session token from the current request's cookie.
  // IMPACT: Other sessions remain valid.
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
