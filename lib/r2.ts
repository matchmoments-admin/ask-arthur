import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Lazy singleton S3-compatible client for Cloudflare R2
let _r2Client: S3Client | null = null;

function getR2Client(): S3Client | null {
  if (_r2Client) return _r2Client;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    if (process.env.NODE_ENV === "production") {
      console.error("[CRITICAL] R2 credentials not configured in production");
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
