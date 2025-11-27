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
    .mutation(async ({ input, ctx }) => {
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
    .mutation(async ({ input, ctx }) => {
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

  logout: publicProcedure.mutation(async ({ ctx }) => {
    if (ctx.user) {
      // Delete session from database
      let token: string | undefined;
      if ("cookies" in ctx.req) {
        token = (ctx.req as any).cookies.session;
      } else {
        const cookieHeader =
          ctx.req.headers.get?.("cookie") || (ctx.req.headers as any).cookie;
        token = cookieHeader
          ?.split("; ")
          .find((c: string) => c.startsWith("session="))
          ?.split("=")[1];
      }
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
