// Object storage for CMS-uploaded images, via Cloudflare R2 (S3-compatible,
// free egress). Configured from env vars that already existed as unused
// placeholders in .env — this is the first thing that actually wires them
// up. Degrades gracefully like the rest of this app's optional integrations
// (ANTHROPIC_API_KEY, WhatsApp creds): if unconfigured, isStorageConfigured()
// is false and callers surface a clear error instead of crashing.

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";

function config() {
  const endpoint = process.env.STORAGE_ENDPOINT;
  const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY;
  const bucket = process.env.STORAGE_BUCKET;
  const publicBaseUrl = process.env.STORAGE_PUBLIC_BASE_URL;
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) return null;
  return { endpoint, accessKeyId, secretAccessKey, bucket, publicBaseUrl };
}

export function isStorageConfigured() {
  return config() !== null;
}

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]);
const MAX_BYTES = 8 * 1024 * 1024; // 8MB — marketing images, not raw camera uploads

export async function uploadCmsImage(file: File): Promise<string> {
  const cfg = config();
  if (!cfg) throw new Error("Image storage is not configured yet — set STORAGE_ENDPOINT/STORAGE_ACCESS_KEY_ID/STORAGE_SECRET_ACCESS_KEY/STORAGE_BUCKET/STORAGE_PUBLIC_BASE_URL in .env.");

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
