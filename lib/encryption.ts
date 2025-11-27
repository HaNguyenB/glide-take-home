import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // bytes
const IV_LENGTH = 12; // bytes for AES-GCM

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error("ENCRYPTION_KEY environment variable is required");
  }

  const normalized = key.replace(/[^a-fA-F0-9]/g, "");
  if (normalized.length < KEY_LENGTH * 2) {
    throw new Error("ENCRYPTION_KEY must be at least 64 hex characters (32 bytes)");
  }

  return Buffer.from(normalized.slice(0, KEY_LENGTH * 2), "hex");
}

function validateSSN(ssn: string): void {
  if (!/^\d{9}$/.test(ssn)) {
    throw new Error("SSN must be exactly 9 numeric digits");
  }
}

export function encryptSSN(ssn: string): string {
  validateSSN(ssn);

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(ssn, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

function ensureValidHex(part: string, name: string) {
  if (!/^[a-f0-9]+$/i.test(part) || part.length % 2 !== 0) {
    throw new Error(`Invalid ${name} in encrypted SSN`);
  }
}

export function decryptSSN(encryptedSSN: string): string {
  const parts = encryptedSSN.split(":");
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new Error("Invalid encrypted SSN format");
  }

  const [ivHex, tagHex, dataHex] = parts;
  ensureValidHex(ivHex, "IV");
  ensureValidHex(tagHex, "auth tag");
  ensureValidHex(dataHex, "ciphertext");
  const key = getEncryptionKey();

  try {
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(ivHex, "hex")
    );
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]).toString("utf8");

    validateSSN(decrypted);
    return decrypted;
  } catch (error) {
    throw new Error("Failed to decrypt SSN");
  }
}

