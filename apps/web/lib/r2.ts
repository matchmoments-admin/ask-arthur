import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { logger } from "@askarthur/utils/logger";

// Lazy singleton S3-compatible client for Cloudflare R2
let _r2Client: S3Client | null = null;

function getR2Client(): S3Client | null {
  if (_r2Client) return _r2Client;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    if (process.env.NODE_ENV === "production") {
      logger.error("R2 credentials not configured in production");
    }
    return null;
  }

  _r2Client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  return _r2Client;
}

function getBucket(): string {
  return process.env.R2_BUCKET_NAME || "askarthur-screenshots";
}

/**
 * Upload a screenshot to R2.
 * Returns the R2 object key, or null if upload fails / R2 not configured.
 */
export async function uploadScreenshot(
  buffer: Buffer,
  contentType: string
): Promise<string | null> {
  const client = getR2Client();
  if (!client) return null;

  const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const uuid = crypto.randomUUID();
  const ext = contentType.includes("png") ? "png" : contentType.includes("gif") ? "gif" : contentType.includes("webp") ? "webp" : "jpg";
  const key = `screenshots/${date}/${uuid}.${ext}`;

  await client.send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );

  return key;
}

/**
 * Get a presigned URL for a screenshot (1 hour expiry).
 */
export async function getScreenshotUrl(key: string): Promise<string | null> {
  const client = getR2Client();
  if (!client) return null;

  const url = await getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: getBucket(),
      Key: key,
    }),
    { expiresIn: 3600 }
  );

  return url;
}

// ── Media Analysis (Phase 1) ──

const ACCEPTED_AUDIO_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
  "audio/flac",
]);

/** Validate a MIME type against accepted audio formats. */
export function isAcceptedAudioType(contentType: string): boolean {
  return ACCEPTED_AUDIO_TYPES.has(contentType.toLowerCase());
}

/** Map MIME type to file extension for R2 key. */
function audioExtension(contentType: string): string {
  const map: Record<string, string> = {
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "m4a",
    "audio/m4a": "m4a",
    "audio/x-m4a": "m4a",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/x-wav": "wav",
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/flac": "flac",
  };
  return map[contentType.toLowerCase()] || "bin";
}

/**
 * Create a presigned PUT URL for client-side media upload (10 min expiry).
 * Returns { uploadUrl, r2Key } or null if R2 is not configured.
 */
export async function createPresignedUploadUrl(
  contentType: string,
  jobId: string
): Promise<{ uploadUrl: string; r2Key: string } | null> {
  const client = getR2Client();
  if (!client) return null;

  const date = new Date().toISOString().split("T")[0];
  const ext = audioExtension(contentType);
  const r2Key = `media/${date}/${jobId}.${ext}`;

  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: r2Key,
      ContentType: contentType,
    }),
    { expiresIn: 600 }
  );

  return { uploadUrl, r2Key };
}

/**
 * Download a media file from R2 as a Buffer (for Whisper transcription).
 * Returns null if R2 is not configured or the file doesn't exist.
 */
export async function downloadMediaBuffer(key: string): Promise<Buffer | null> {
  const client = getR2Client();
  if (!client) return null;

  const response = await client.send(
    new GetObjectCommand({
      Bucket: getBucket(),
      Key: key,
    })
  );

  if (!response.Body) return null;

  const bytes = await response.Body.transformToByteArray();
  return Buffer.from(bytes);
}
