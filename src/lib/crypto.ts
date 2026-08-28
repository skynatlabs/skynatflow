// Symmetric encryption for the one genuinely sensitive user-entered
// secret in this app: an IMAP mail password. Everything else sensitive
// (WhatsApp/Anthropic/R2 keys) lives in env vars, not the database — this
// is different because the *owner* types their own mailbox password in,
// so it needs to be encrypted at rest, not just access-controlled.
//
// Uses AUTH_SECRET (already required, already a real secret — generated
// with `openssl rand -base64 32` per .env.example) as key material via
// AES-256-GCM. This is deliberately simple, not a KMS/HSM setup — good
// enough for "not plaintext in the database," which is the actual bar
// here, not full E2EE (that's its own tracked future project).

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

function getKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET must be set to encrypt/decrypt stored mail credentials.");
  return scryptSync(secret, "flow-mail-credentials", 32);
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":");
}

export function decryptSecret(stored: string): string {
  const [ivHex, tagHex, dataHex] = stored.split(":");
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}
