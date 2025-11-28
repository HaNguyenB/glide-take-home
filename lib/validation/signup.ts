import { Temporal } from "@js-temporal/polyfill";
import tlds from "tlds";
import validator from "validator";
import { z } from "zod";

export const emailFieldSchema = z
  .string({ required_error: "Email is required" })
  .trim()
  .min(1, "Email is required")
  .refine(
    (value) => validator.isEmail(value, { allow_utf8_local_part: false, require_tld: true }),
    { message: "Invalid email address" }
  )
  .refine(
    (value) => {
      const tld = value.split("@")[1]?.split(".").pop()?.toLowerCase();
      return tld && tlds.includes(tld);
    },
    { message: "Invalid email domain" }
  );

export const passwordFieldSchema = z.string().min(8);

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

export const signupInputSchema = z.object({
  email: emailFieldSchema,
  password: passwordFieldSchema,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phoneNumber: z.string().regex(/^\+?\d{10,15}$/),
  dateOfBirth: z.string().transform((value, ctx) => {
    try {
      return parseAdultDob(value);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : "Invalid date of birth",
        path: ["dateOfBirth"],
      });
      return z.NEVER;
    }
  }),
  ssn: z.string().regex(/^\d{9}$/),
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().length(2),
  zipCode: z.string().regex(/^\d{5}$/),
});

export const emailValidationSchema = z.object({
  email: emailFieldSchema,
});

export type SignupInput = z.infer<typeof signupInputSchema>;

export function normalizeEmail(email: string) {
  const normalized = validator.normalizeEmail(email, {
    gmail_remove_dots: false,
    gmail_remove_subaddress: false,
    outlookdotcom_remove_subaddress: false,
    yahoo_remove_subaddress: false,
    icloud_remove_subaddress: false,
  });
  const safeEmail = typeof normalized === "string" ? normalized : email;
  return safeEmail.toLowerCase();
}

export function validateEmailField(email: string) {
  const trimmedEmail = email.trim();
  const parsedEmail = emailFieldSchema.parse(trimmedEmail);
  const normalizedEmail = normalizeEmail(parsedEmail);
  const notifications: Record<string, string> = {};

  if (normalizedEmail !== parsedEmail) {
    notifications.emailNormalization = "Email was converted to lowercase for consistency";
  }

  return {
    normalizedEmail,
    notifications,
  };
}