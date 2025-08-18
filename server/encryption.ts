import crypto from "crypto";
import { getAppConfig } from "./config.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16; // For GCM, this is always 16 bytes
const SALT_LENGTH = 32; // For PBKDF2 key derivation

export interface EncryptedData {
  encrypted: string;
  iv: string;
  tag: string;
  salt: string;
}

/**
 * Derives an encryption key from the application's webhook secret using PBKDF2
 *
 * This ensures that the same webhook secret used for validating GitHub webhook
 * signatures is also used to encrypt sensitive header data. The key derivation
 * uses a random salt and 100,000 iterations to make brute force attacks infeasible.
 */
function deriveKey(secret: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(secret, salt, 100000, 32, "sha256");
}

/**
 * Encrypts sensitive data using AES-256-GCM
 */
export function encryptData(data: string): EncryptedData {
  const config = getAppConfig();
  const secret = config?.database?.encryption_key;

  if (!secret) {
    throw new Error("Encryption key is required for encryption");
  }

  // Generate random salt and IV
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);

  // Derive key from webhook secret and salt
  const key = deriveKey(secret, salt);

  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from("github-event-router-headers"));

  // Encrypt the data
  let encrypted = cipher.update(data, "utf8", "hex");
  encrypted += cipher.final("hex");

  // Get the authentication tag
  const tag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    salt: salt.toString("hex"),
  };
}

/**
 * Decrypts data that was encrypted with encryptData
 */
export function decryptData(encryptedData: EncryptedData): string {
  const config = getAppConfig();
  const secret = config?.database?.encryption_key;

  if (!secret) {
    throw new Error("Encryption key is required for decryption");
  }

  try {
    // Convert hex strings back to buffers
    const salt = Buffer.from(encryptedData.salt, "hex");
    const iv = Buffer.from(encryptedData.iv, "hex");
    const tag = Buffer.from(encryptedData.tag, "hex");

    // Derive the same key
    const key = deriveKey(secret, salt);

    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(Buffer.from("github-event-router-headers"));
    decipher.setAuthTag(tag);

    // Decrypt the data
    let decrypted = decipher.update(encryptedData.encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (error) {
    throw new Error(
      `Failed to decrypt data: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Encrypts headers data as JSON string
 */
export function encryptHeaders(headers: Record<string, string>): string {
  const headersJson = JSON.stringify(headers);
  const encrypted = encryptData(headersJson);
  return JSON.stringify(encrypted);
}

/**
 * Decrypts headers data back to object
 */
export function decryptHeaders(
  encryptedHeadersString: string
): Record<string, string> {
  try {
    const encryptedData = JSON.parse(encryptedHeadersString) as EncryptedData;
    const headersJson = decryptData(encryptedData);
    return JSON.parse(headersJson);
  } catch (error) {
    throw new Error(
      `Failed to decrypt headers: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
