/**
 * Encryption at rest for user-supplied Telegram bot tokens.
 *
 * Tokens are the credential that lets someone fully control a Telegram
 * bot (send/read messages, manage chats), so they're never written to the
 * database in plaintext. Each token is encrypted with AES-256-GCM using a
 * server-held key (`ENCRYPTION_KEY`, never stored in the DB) — the
 * ciphertext, IV, and auth tag are what actually get persisted
 * (see bot_instances in sql/migrations/0003_web_multiuser.sql).
 *
 * `ENCRYPTION_KEY` must be 32 raw bytes, given as base64. Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */
import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recommended IV length for GCM

function loadKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "Please specify ENCRYPTION_KEY in your environment variables (32 bytes, base64). " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length}). ` +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }
  return key;
}

// Loaded lazily (not at module scope) so importing this file doesn't
// itself throw for code paths that never actually encrypt/decrypt — same
// deferred-construction reasoning already used for the Shoti client
// pattern elsewhere in this codebase, just applied to key loading.
let cachedKey: Buffer | null = null;
function getKey(): Buffer {
  if (!cachedKey) cachedKey = loadKey();
  return cachedKey;
}

export type EncryptedSecret = {
  ciphertext: string; // base64
  iv: string; // base64
  tag: string; // base64
};

export function encryptSecret(plaintext: string): EncryptedSecret {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptSecret(secret: EncryptedSecret): string {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(secret.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
