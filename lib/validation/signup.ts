import tlds from "tlds";
import validator from "validator";
import { z } from "zod";

export const emailFieldSchema = z
  .string({ required_error: "Email is required" })
  .trim()
  .min(1, "Email is required")
  .refine((value) => validator.isEmail(value, { allow_utf8_local_part: false, require_tld: true }), {
    message: "Invalid email address",
  })
  .refine((value) => {
    const domainPart = value.split("@")[1]?.toLowerCase();
    if (!domainPart) {
      return false;
    }
    const segments = domainPart.split(".");
    const tld = segments[segments.length - 1];
    return Boolean(tld && tlds.includes(tld));
  }, "Invalid email domain");

export const passwordFieldSchema = z.string().min(8);

export const signupInputSchema = z.object({
  email: emailFieldSchema,
  password: passwordFieldSchema,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phoneNumber: z.string().regex(/^\+?\d{10,15}$/),
  dateOfBirth: z.string(),
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

