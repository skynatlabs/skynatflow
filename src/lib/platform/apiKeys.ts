// One registry of every external-service credential this app uses, and
// one function to read any of them — checks the database first
// (PlatformApiKey, settable at /admin/api-keys with no redeploy), falls
// back to the env var of the same name. This is the layer that makes
// "set it in super admin instead of an env var" actually true, without
// every integration file needing its own DB-vs-env logic.

import { prisma } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

export interface ApiKeyMeta {
  key: string;
  label: string;
  group: "AI" | "Auth" | "Communication" | "Payments" | "Storage";
  helpText: string;
}

export const API_KEY_REGISTRY: ApiKeyMeta[] = [
  { key: "ANTHROPIC_API_KEY", label: "Anthropic (Claude)", group: "AI", helpText: "console.anthropic.com" },
  { key: "GOOGLE_GENERATIVE_AI_API_KEY", label: "Google Gemini", group: "AI", helpText: "aistudio.google.com/apikey" },
  { key: "GOOGLE_TTS_API_KEY", label: "Google Cloud Text-to-Speech", group: "AI", helpText: "console.cloud.google.com — enable the Text-to-Speech API, create an API key" },
  { key: "AUTH_GOOGLE_ID", label: "Google OAuth client ID", group: "Auth", helpText: "For \"Sign in with Google\" — console.cloud.google.com OAuth client" },
  { key: "AUTH_GOOGLE_SECRET", label: "Google OAuth client secret", group: "Auth", helpText: "Same OAuth client as above" },
  { key: "RESEND_API_KEY", label: "Resend (email)", group: "Communication", helpText: "resend.com/api-keys" },
  { key: "WHATSAPP_API_KEY", label: "WhatsApp Business API token", group: "Communication", helpText: "developers.facebook.com WhatsApp Business Platform" },
  { key: "WHATSAPP_PHONE_NUMBER_ID", label: "WhatsApp phone number ID", group: "Communication", helpText: "From the same WhatsApp Business app" },
  { key: "STORAGE_ENDPOINT", label: "Cloudflare R2 endpoint", group: "Storage", helpText: "e.g. https://<account-id>.r2.cloudflarestorage.com — for CMS image uploads" },
  { key: "STORAGE_ACCESS_KEY_ID", label: "Cloudflare R2 access key ID", group: "Storage", helpText: "Same R2 bucket credential" },
  { key: "STORAGE_SECRET_ACCESS_KEY", label: "Cloudflare R2 secret access key", group: "Storage", helpText: "Same R2 bucket credential" },
  { key: "STORAGE_BUCKET", label: "Cloudflare R2 bucket name", group: "Storage", helpText: "Same R2 bucket" },
  { key: "STORAGE_PUBLIC_BASE_URL", label: "Cloudflare R2 public base URL", group: "Storage", helpText: "The public URL your bucket serves uploads from" },
];

const REGISTRY_KEYS = new Set(API_KEY_REGISTRY.map((k) => k.key));

export async function getPlatformSecret(key: string): Promise<string | null> {
  const row = await prisma.platformApiKey.findUnique({ where: { key } });
  if (row) return decryptSecret(row.valueEnc);
  return process.env[key] || null;
}

export async function listApiKeyStatus(): Promise<Record<string, { source: "database" | "env" | "none" }>> {
  const rows = await prisma.platformApiKey.findMany({ select: { key: true } });
  const inDb = new Set(rows.map((r) => r.key));
  const status: Record<string, { source: "database" | "env" | "none" }> = {};
  for (const meta of API_KEY_REGISTRY) {
    status[meta.key] = inDb.has(meta.key)
      ? { source: "database" }
      : process.env[meta.key]
        ? { source: "env" }
        : { source: "none" };
  }
  return status;
}

export async function setPlatformSecret(key: string, value: string): Promise<void> {
  if (!REGISTRY_KEYS.has(key)) throw new Error("Unknown key.");
  await prisma.platformApiKey.upsert({
    where: { key },
    create: { key, valueEnc: encryptSecret(value) },
    update: { valueEnc: encryptSecret(value) },
  });
}

export async function clearPlatformSecret(key: string): Promise<void> {
  await prisma.platformApiKey.deleteMany({ where: { key } });
}
