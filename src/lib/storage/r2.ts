// Object storage for CMS-uploaded images, via Cloudflare R2 (S3-compatible,
// free egress). Settable at /admin/api-keys (checked first) or as env
// vars (fallback). Degrades gracefully like the rest of this app's
// optional integrations: if unconfigured, isStorageConfigured() is false
// and callers surface a clear error instead of crashing.

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { getPlatformSecret } from "@/lib/platform/apiKeys";

async function config() {
  const [endpoint, accessKeyId, secretAccessKey, bucket, publicBaseUrl] = await Promise.all([
    getPlatformSecret("STORAGE_ENDPOINT"),
    getPlatformSecret("STORAGE_ACCESS_KEY_ID"),
    getPlatformSecret("STORAGE_SECRET_ACCESS_KEY"),
    getPlatformSecret("STORAGE_BUCKET"),
    getPlatformSecret("STORAGE_PUBLIC_BASE_URL"),
  ]);
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) return null;
  return { endpoint, accessKeyId, secretAccessKey, bucket, publicBaseUrl };
}

export async function isStorageConfigured() {
  return (await config()) !== null;
}

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]);
const MAX_BYTES = 8 * 1024 * 1024; // 8MB — marketing images, not raw camera uploads

export async function uploadCmsImage(file: File): Promise<string> {
  const cfg = await config();
  if (!cfg) throw new Error("Image storage is not configured yet — set it up at /admin/api-keys (Storage section).");

  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error(`Unsupported image type: ${file.type}`);
  }
  if (file.size > MAX_BYTES) {
    throw new Error("Image is too large (max 8MB).");
  }

  const client = new S3Client({
    region: "auto",
    endpoint: cfg.endpoint,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });

  const extension = file.type.split("/")[1]?.replace("svg+xml", "svg") ?? "bin";
  const key = `cms/${randomUUID()}.${extension}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: buffer,
      ContentType: file.type,
    })
  );

  return `${cfg.publicBaseUrl.replace(/\/$/, "")}/${key}`;
}
