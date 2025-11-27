import { initTRPC, TRPCError } from "@trpc/server";
import { CreateNextContextOptions } from "@trpc/server/adapters/next";
import { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import jwt from "jsonwebtoken";
import { db } from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionToken } from "./utils/session-token";

export async function createContext(opts: CreateNextContextOptions | FetchCreateContextFnOptions) {
  // Handle different adapter types
  let req: any;
  let res: any;

  if ("req" in opts && "res" in opts) {
    // Next.js adapter
    req = opts.req;
    res = opts.res;
  } else {
    // Fetch adapter
    req = opts.req;
    res = opts.resHeaders;
  }

  // Get the session token using shared utility
  const token = getSessionToken(req);

  let user = null;
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "temporary-secret-for-interview") as {
        userId: number;
      };

      const session = await db.select().from(sessions).where(eq(sessions.token, token)).get();

      if (session && new Date(session.expiresAt) > new Date()) {
        const dbUser = await db.select().from(users).where(eq(users.id, decoded.userId)).get();
        if (dbUser) {
          const { password, ssn, ...safeUser } = dbUser;
          // 11/27/25: prevent SSN/password from leaking via context (SEC-301).
          user = safeUser as typeof dbUser;
        }
        const expiresIn = new Date(session.expiresAt).getTime() - new Date().getTime();
        if (expiresIn < 60000) {
          console.warn("Session about to expire");
        }
      }
    } catch (error) {
      // Invalid token
    }
  }

  return {
    user,
    req,
    res,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});
