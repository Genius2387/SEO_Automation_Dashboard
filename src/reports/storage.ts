import fs from "fs";
import path from "path";
import os from "os";
import prisma from "@/lib/prisma";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface StoredReportResult {
  storageType: "postgres" | "cloudflare_r2" | "local_disk";
  key: string;
  reportUrl: string;
  sizeBytes: number;
}

const isServerless = process.env.VERCEL === "1" || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
const STORAGE_DIR = isServerless
  ? path.join(os.tmpdir(), "edgelink-reports")
  : path.resolve(process.cwd(), "storage", "reports");

/**
 * Ensures the local storage directory exists safely (no-op if read-only)
 */
function ensureStorageDirectory(): string | null {
  try {
    if (!fs.existsSync(STORAGE_DIR)) {
      fs.mkdirSync(STORAGE_DIR, { recursive: true });
    }
    return STORAGE_DIR;
  } catch {
    // Read-only filesystem (e.g. Vercel Lambda root)
    return null;
  }
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
 * with support for PostgreSQL (default shared storage), local disk, and Cloudflare R2.
 */
export class ReportStorageService {
  /**
   * Returns the currently configured active storage provider name
   */
  static getProviderName(): "postgres" | "cloudflare_r2" | "local_disk" {
    const configuredProvider = process.env.REPORT_STORAGE_PROVIDER?.trim().toLowerCase();

    if (configuredProvider === "local") {
      return "local_disk";
    }

    const r2Client = getR2Client();
    const r2BucketName = process.env.R2_BUCKET_NAME?.trim();
    if ((configuredProvider === "r2" || !configuredProvider) && r2Client && r2BucketName) {
      return "cloudflare_r2";
    }

    // Default: PostgreSQL persistent database storage shared between Vercel and Railway
    return "postgres";
  }

  /**
   * Persists a generated PDF buffer to durable shared storage.
   * By default, stores in PostgreSQL `audit_report_files` table, shared between
   * Railway worker and Vercel web application. Also supports Cloudflare R2 and local disk.
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
    const provider = this.getProviderName();

    // 1. Primary PostgreSQL database storage (ensures Railway -> Vercel cross-service availability)
    try {
      await prisma.auditReportFile.upsert({
        where: { auditId: sanitizedAuditId },
        create: {
          auditId: sanitizedAuditId,
          filename,
          mimeType: "application/pdf",
          sizeBytes: pdfBuffer.length,
          data: pdfBuffer,
        },
        update: {
          filename,
          mimeType: "application/pdf",
          sizeBytes: pdfBuffer.length,
          data: pdfBuffer,
          updatedAt: new Date(),
        },
      });
    } catch (dbErr) {
      console.warn(`[Report Storage] Warning: Could not persist PDF to PostgreSQL for #${sanitizedAuditId}:`, dbErr);
    }

    // 2. Safe local disk cache write (only if directory is writable)
    try {
      const dir = ensureStorageDirectory();
      if (dir) {
        const localPath = path.join(dir, filename);
        fs.writeFileSync(localPath, pdfBuffer);
      }
    } catch {
      // Non-fatal if filesystem is read-only (e.g. Vercel)
    }

    // 3. Cloudflare R2 object store if configured
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
        console.warn("[Report Storage] Cloudflare R2 upload failed, falling back to PostgreSQL storage:", err);
      }
    }

    if (provider === "local_disk") {
      return {
        storageType: "local_disk",
        key: filename,
        reportUrl: canonicalApiUrl,
        sizeBytes: pdfBuffer.length,
      };
    }

    return {
      storageType: "postgres",
      key: filename,
      reportUrl: canonicalApiUrl,
      sizeBytes: pdfBuffer.length,
    };
  }

  /**
   * Retrieves the raw PDF Buffer for a given audit ID.
   * Order:
   * 1. Local disk cache (if present and readable)
   * 2. PostgreSQL database storage (shared between Vercel and Railway)
   * 3. Cloudflare R2 object storage (if configured)
   */
  static async getReportPdf(auditId: string): Promise<Buffer | null> {
    if (!auditId) return null;
    const sanitizedAuditId = auditId.replace(/[^a-zA-Z0-9_-]/g, "");
    const filename = `${sanitizedAuditId}.pdf`;
    const filePath = path.join(STORAGE_DIR, filename);

    // 1. Check local disk cache first (fastest for worker or local development)
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath);
      }
    } catch {
      // Local file read failed or not permitted, continue to DB
    }

    // 2. Retrieve from PostgreSQL database storage
    try {
      const record = await prisma.auditReportFile.findUnique({
        where: { auditId: sanitizedAuditId },
      });

      if (record && record.data) {
        const buffer = Buffer.from(record.data);

        // Attempt to cache locally in tmpdir if possible
        try {
          const dir = ensureStorageDirectory();
          if (dir) {
            fs.writeFileSync(path.join(dir, filename), buffer);
          }
        } catch {
          // Ignore cache write error in read-only environment
        }

        return buffer;
      }
    } catch (dbErr) {
      console.warn(`[Report Storage] Database lookup failed for PDF #${sanitizedAuditId}:`, dbErr);
    }

    // 3. Fetch from Cloudflare R2 if configured
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

          // Cache locally if writable
          try {
            const dir = ensureStorageDirectory();
            if (dir) {
              fs.writeFileSync(path.join(dir, filename), buffer);
            }
          } catch {
            // Ignore
          }

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
   * Checks whether a report PDF exists in storage (locally, in PostgreSQL, or in R2)
   */
  static async hasReportPdf(auditId: string): Promise<boolean> {
    if (!auditId) return false;
    const sanitizedAuditId = auditId.replace(/[^a-zA-Z0-9_-]/g, "");
    const filename = `${sanitizedAuditId}.pdf`;
    const filePath = path.join(STORAGE_DIR, filename);

    // 1. Local disk check
    try {
      if (fs.existsSync(filePath)) return true;
    } catch {
      // continue
    }

    // 2. PostgreSQL check
    try {
      const count = await prisma.auditReportFile.count({
        where: { auditId: sanitizedAuditId },
      });
      if (count > 0) return true;
    } catch {
      // continue
    }

    // 3. R2 check
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
   * Deletes a report PDF from PostgreSQL, local disk, and R2
   */
  static async deleteReportPdf(auditId: string): Promise<boolean> {
    if (!auditId) return false;
    const sanitizedAuditId = auditId.replace(/[^a-zA-Z0-9_-]/g, "");
    const filename = `${sanitizedAuditId}.pdf`;
    const filePath = path.join(STORAGE_DIR, filename);
    let deleted = false;

    // 1. Delete from PostgreSQL
    try {
      const res = await prisma.auditReportFile.deleteMany({
        where: { auditId: sanitizedAuditId },
      });
      if (res.count > 0) deleted = true;
    } catch {
      // ignore
    }

    // 2. Delete from local disk
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        deleted = true;
      }
    } catch {
      // ignore
    }

    // 3. Delete from R2
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
