import { Temporal } from "@js-temporal/polyfill";
import tlds from "tlds";
import validator from "validator";
import { z } from "zod";

// ============================================================================
// CONSTANTS
// ============================================================================

export const USPS_STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
] as const;

// ============================================================================
// HELPERS
// ============================================================================

export function parseAdultDob(value: string) {
  let dob: Temporal.PlainDate;
  try {
    dob = Temporal.PlainDate.from(value);
  } catch {
    throw new Error("Invalid date of birth");
  }

  const today = Temporal.Now.plainDateISO();
  const age = dob.until(today, { largestUnit: "years" }).years;

  if (age < 18) {
    throw new Error("You must be at least 18 years old to create an account");
  }

  return dob.toString();
}

export function normalizeEmail(email: string) {
  const normalized = validator.normalizeEmail(email, {
    gmail_remove_dots: false,
    gmail_remove_subaddress: false,
    outlookdotcom_remove_subaddress: false,
    yahoo_remove_subaddress: false,
    icloud_remove_subaddress: false,
  });
  return (normalized || email).toLowerCase();
}

type NotificationBag = Record<string, string>;

export function validateEmailField(email: string) {
  const trimmedEmail = email.trim();
  const parsedEmail = emailFieldSchema.parse(trimmedEmail);
  const normalizedEmail = normalizeEmail(parsedEmail);
  const notifications: NotificationBag = {};

  if (normalizedEmail !== parsedEmail) {
    notifications.emailNormalization = "Email was converted to lowercase for consistency";
  }

  return { normalizedEmail, notifications };
}

// ============================================================================
// FIELD SCHEMAS
// ============================================================================

export const emailFieldSchema = z
  .string({ required_error: "Email is required" })
  .trim()
  .min(1, "Email is required")
  .refine(
    (v) => validator.isEmail(v, { allow_utf8_local_part: false, require_tld: true }),
    "Invalid email address"
  )
  .refine(
    (v) => {
      const tld = v.split("@")[1]?.split(".").pop()?.toLowerCase();
      return tld && tlds.includes(tld);
    },
    "Invalid email domain"
  );

export const passwordFieldSchema = z.string().min(8);

const stateSchema = z
  .string()
  .trim()
  .length(2, "Use 2-letter state code")
  .transform((v) => v.toUpperCase())
  .refine(
    (v) => USPS_STATE_CODES.includes(v as typeof USPS_STATE_CODES[number]),
    "Invalid state code"
  );

const dobSchema = z.string().transform((value, ctx) => {
  try {
    return parseAdultDob(value);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : "Invalid date of birth",
    });
    return z.NEVER;
  }
});

const phoneSchema = z
  .string()
  .refine((value) => /^\+[1-9]\d{9,14}$/.test(value), {
    message: "Phone number must be in E.164 format (e.g., +14155551234)",
  });

// ============================================================================
// MAIN SCHEMAS
// ============================================================================

export const signupInputSchema = z.object({
  email: emailFieldSchema,
  password: passwordFieldSchema,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phoneNumber: phoneSchema,
  dateOfBirth: dobSchema,
  ssn: z.string().regex(/^\d{9}$/),
  address: z.string().min(1),
  city: z.string().min(1),
  state: stateSchema,
  zipCode: z.string().regex(/^\d{5}$/),
});

export const emailValidationSchema = z.object({
  email: emailFieldSchema,
});

export type SignupInput = z.infer<typeof signupInputSchema>;