import fs from "fs";
import path from "path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface StoredReportResult {
  storageType: "local_disk" | "cloudflare_r2";
  key: string;
  reportUrl: string;
  sizeBytes: number;
}

const STORAGE_DIR = path.resolve(process.cwd(), "storage", "reports");

/**
 * Ensures the local storage directory exists
 */
function ensureStorageDirectory(): string {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
  return STORAGE_DIR;
}

let r2ClientInstance: S3Client | null = null;

/**
 * Returns an S3 client configured for Cloudflare R2 if environment credentials are provided
 */
export function getR2Client(): S3Client | null {
  const r2AccountId = process.env.R2_ACCOUNT_ID?.trim();
  const r2AccessKey = process.env.R2_ACCESS_KEY_ID?.trim();
  const r2SecretKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const r2BucketName = process.env.R2_BUCKET_NAME?.trim();

  if (!r2AccountId || !r2AccessKey || !r2SecretKey || !r2BucketName) {
    return null;
  }

  if (!r2ClientInstance) {
    r2ClientInstance = new S3Client({
      region: "auto",
      endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: r2AccessKey,
        secretAccessKey: r2SecretKey,
      },
    });
  }

  return r2ClientInstance;
}

/**
 * Reset client instance (useful for test mocks)
 */
export function setR2ClientForTesting(mockClient: S3Client | null): void {
  r2ClientInstance = mockClient;
}

/**
 * Storage Service for persisting and retrieving generated audit PDF reports
 * with support for both local disk and Cloudflare R2 object storage.
 */
export class ReportStorageService {
  /**
   * Returns the currently configured active storage provider name
   */
  static getProviderName(): "cloudflare_r2" | "local_disk" {
    const r2Client = getR2Client();
    const r2BucketName = process.env.R2_BUCKET_NAME?.trim();
    if (r2Client && r2BucketName) {
      return "cloudflare_r2";
    }
    return "local_disk";
  }

  /**
   * Persists a generated PDF buffer to durable storage.
   * Uses Cloudflare R2 if configured via environment credentials or STORAGE_PROVIDER="r2",
   * otherwise falls back to local disk storage.
   * Persisted URL is always the secure authorized endpoint: `/api/audits/${auditId}/report`
   */
  static async saveReportPdf(auditId: string, pdfBuffer: Buffer): Promise<StoredReportResult> {
    if (!auditId || typeof auditId !== "string" || auditId.trim().length === 0) {
      throw new Error("Invalid audit ID provided for report storage");
    }

    if (!pdfBuffer || !(pdfBuffer instanceof Buffer) || pdfBuffer.length === 0) {
      throw new Error("Invalid or empty PDF buffer provided for report storage");
    }

    const sanitizedAuditId = auditId.replace(/[^a-zA-Z0-9_-]/g, "");
    const filename = `${sanitizedAuditId}.pdf`;
    const canonicalApiUrl = `/api/audits/${sanitizedAuditId}/report`;
    const objectKey = `reports/${filename}`;

    // Always ensure local file is written as cache / fallback
    ensureStorageDirectory();
    const localPath = path.join(STORAGE_DIR, filename);
    fs.writeFileSync(localPath, pdfBuffer);

    // Check if Cloudflare R2 storage is active
    const r2Client = getR2Client();
    const r2BucketName = process.env.R2_BUCKET_NAME?.trim();

    if (r2Client && r2BucketName) {
      try {
        await r2Client.send(
          new PutObjectCommand({
            Bucket: r2BucketName,
            Key: objectKey,
            Body: pdfBuffer,
            ContentType: "application/pdf",
            Metadata: {
              auditId: sanitizedAuditId,
              generatedAt: new Date().toISOString(),
            },
          })
        );

        return {
          storageType: "cloudflare_r2",
          key: objectKey,
          reportUrl: canonicalApiUrl,
          sizeBytes: pdfBuffer.length,
        };
      } catch (err) {
        console.warn("[Report Storage] Cloudflare R2 upload failed, retained local disk copy:", err);
      }
    }

    // Default Local Disk Storage
    return {
      storageType: "local_disk",
      key: filename,
      reportUrl: canonicalApiUrl,
      sizeBytes: pdfBuffer.length,
    };
  }

  /**
   * Retrieves the raw PDF Buffer for a given audit ID.
   * Checks local disk cache first; if missing, pulls from Cloudflare R2.
   */
  static async getReportPdf(auditId: string): Promise<Buffer | null> {
    if (!auditId) return null;
    const sanitizedAuditId = auditId.replace(/[^a-zA-Z0-9_-]/g, "");
    const filename = `${sanitizedAuditId}.pdf`;
    const filePath = path.join(STORAGE_DIR, filename);

    // 1. Check local disk cache
    if (fs.existsSync(filePath)) {
      try {
        return fs.readFileSync(filePath);
      } catch (err) {
        console.error(`[Report Storage] Error reading local PDF for #${sanitizedAuditId}:`, err);
      }
    }

    // 2. Fetch from Cloudflare R2 if configured
    const r2Client = getR2Client();
    const r2BucketName = process.env.R2_BUCKET_NAME?.trim();

    if (r2Client && r2BucketName) {
      try {
        const response = await r2Client.send(
          new GetObjectCommand({
            Bucket: r2BucketName,
            Key: `reports/${filename}`,
          })
        );

        if (response.Body) {
          const stream = response.Body as unknown as NodeJS.ReadableStream;
          const chunks: Buffer[] = [];
          for await (const chunk of stream) {
            chunks.push(Buffer.from(chunk));
          }
          const buffer = Buffer.concat(chunks);

          // Cache locally for subsequent fast reads
          ensureStorageDirectory();
          fs.writeFileSync(filePath, buffer);

          return buffer;
        }
      } catch (err) {
        console.warn(`[Report Storage] Could not retrieve PDF from R2 for #${sanitizedAuditId}:`, err);
      }
    }

    return null;
  }

  /**
   * Generates a short-lived signed download URL (default 15 minutes) for Cloudflare R2 object
   */
  static async getSignedDownloadUrl(auditId: string, expiresInSeconds = 900): Promise<string | null> {
    const r2Client = getR2Client();
    const r2BucketName = process.env.R2_BUCKET_NAME?.trim();

    if (!r2Client || !r2BucketName || !auditId) {
      return null;
    }

    const sanitizedAuditId = auditId.replace(/[^a-zA-Z0-9_-]/g, "");
    const objectKey = `reports/${sanitizedAuditId}.pdf`;

    try {
      const command = new GetObjectCommand({
        Bucket: r2BucketName,
        Key: objectKey,
        ResponseContentDisposition: `attachment; filename="seo-audit-${sanitizedAuditId}.pdf"`,
      });

      return await getSignedUrl(r2Client, command, { expiresIn: expiresInSeconds });
    } catch (err) {
      console.error("[Report Storage] Error generating presigned download URL:", err);
      return null;
    }
  }

  /**
   * Checks whether a report PDF exists in storage (locally or in R2)
   */
  static async hasReportPdf(auditId: string): Promise<boolean> {
    if (!auditId) return false;
    const sanitizedAuditId = auditId.replace(/[^a-zA-Z0-9_-]/g, "");
    const filename = `${sanitizedAuditId}.pdf`;
    const filePath = path.join(STORAGE_DIR, filename);

    if (fs.existsSync(filePath)) return true;

    const r2Client = getR2Client();
    const r2BucketName = process.env.R2_BUCKET_NAME?.trim();
    if (r2Client && r2BucketName) {
      try {
        await r2Client.send(
          new HeadObjectCommand({
            Bucket: r2BucketName,
            Key: `reports/${filename}`,
          })
        );
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * Deletes a report PDF from both local disk and R2
   */
  static async deleteReportPdf(auditId: string): Promise<boolean> {
    if (!auditId) return false;
    const sanitizedAuditId = auditId.replace(/[^a-zA-Z0-9_-]/g, "");
    const filename = `${sanitizedAuditId}.pdf`;
    const filePath = path.join(STORAGE_DIR, filename);
    let deleted = false;

    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        deleted = true;
      } catch {
        // ignore
      }
    }

    const r2Client = getR2Client();
    const r2BucketName = process.env.R2_BUCKET_NAME?.trim();
    if (r2Client && r2BucketName) {
      try {
        await r2Client.send(
          new DeleteObjectCommand({
            Bucket: r2BucketName,
            Key: `reports/${filename}`,
          })
        );
        deleted = true;
      } catch {
        // ignore
      }
    }

    return deleted;
  }
}
