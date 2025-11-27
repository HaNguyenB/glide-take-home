import type { Context } from "../trpc";

/**
 * Type-safe request object that handles both Next.js and Fetch adapters
 */
type RequestLike = {
  cookies?: {
    session?: string;
    [key: string]: string | undefined;
  };
  headers: {
    cookie?: string;
    get?: (key: string) => string | null;
    [key: string]: unknown;
  };
};

/**
 * Extracts the session token from a request object.
 * Handles multiple cookie formats:
 * - cookies.session (Next.js parsed cookies)
 * - Cookie header (raw header string)
 * - Headers.get("cookie") (Fetch API style)
 * 
 * @param req - Request object from context
 * @returns Session token if found, undefined otherwise
 */
export function getSessionToken(req: RequestLike): string | undefined {
  // First, try to get token from parsed cookies.session
  if (req.cookies?.session) {
    return req.cookies.session;
  }

  // Fall back to parsing Cookie header
  let cookieHeader: string | null | undefined;

  // Try Fetch API style headers.get()
  if (typeof req.headers.get === "function") {
    cookieHeader = req.headers.get("cookie");
  }
  // Try direct header access
  else if (req.headers.cookie) {
    cookieHeader = req.headers.cookie;
  }

  if (!cookieHeader) {
    return undefined;
  }

  // Parse cookie string to find session token
  const sessionCookie = cookieHeader
    .split("; ")
    .find((c: string) => c.startsWith("session="));

  if (!sessionCookie) {
    return undefined;
  }

  return sessionCookie.split("=")[1];
}

/**
 * Extracts the session token from a tRPC context.
 * Convenience wrapper around getSessionToken for Context objects.
 * 
 * @param ctx - tRPC context
 * @returns Session token if found, undefined otherwise
 */
export function getSessionTokenFromContext(ctx: Context): string | undefined {
  return getSessionToken(ctx.req as RequestLike);
}

