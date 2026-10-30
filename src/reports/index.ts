import prisma from "@/lib/prisma";
import { ClaudeAuditResultSchema, ClaudeAuditResult } from "@/ai/schemas";
import { renderAuditReportToPdf } from "./pdf";
import { ReportStorageService } from "./storage";
import { AuditReportData } from "./templates/auditReportTemplate";

export class AuditNotFoundError extends Error {
  constructor(auditId: string) {
    super(`Audit record with ID '${auditId}' not found.`);
    this.name = "AuditNotFoundError";
  }
}

export class AuditNotCompletedError extends Error {
  constructor(auditId: string, status: string) {
    super(`Cannot generate PDF report for audit '${auditId}' with status '${status}'. Status must be 'COMPLETED'.`);
    this.name = "AuditNotCompletedError";
  }
}

export class InvalidAuditAnalysisError extends Error {
  constructor(auditId: string, details: string) {
    super(`Persisted AI analysis for audit '${auditId}' is missing or structurally invalid: ${details}`);
    this.name = "InvalidAuditAnalysisError";
  }
}

export class PdfGenerationError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "PdfGenerationError";
  }
}

export interface GenerateAuditPdfResult {
  success: boolean;
  pdfUrl: string;
  auditId: string;
  cached: boolean;
  sizeBytes: number;
}

// In-flight generation promises to prevent duplicate concurrent Puppeteer renders
const inFlightGenerations = new Map<string, Promise<GenerateAuditPdfResult>>();

export class AuditReportService {
  /**
   * Generates and persists a PDF report for a COMPLETED audit.
   * Validates audit status and schema, renders via Puppeteer, persists to storage,
   * updates PostgreSQL `pdfReportUrl`, and returns safe report metadata.
   */
  static async generateAuditPdf(
    auditId: string,
    options: { force?: boolean; useMocks?: boolean } = {}
  ): Promise<GenerateAuditPdfResult> {
    if (!auditId || typeof auditId !== "string" || auditId.trim().length === 0) {
      throw new AuditNotFoundError("Empty or invalid ID");
    }

    const cleanId = auditId.trim();

    // 1. Prevent concurrent duplicate renders for the same auditId
    const existingInFlight = inFlightGenerations.get(cleanId);
    if (existingInFlight && !options.force) {
      return existingInFlight;
    }

    const generationPromise = (async (): Promise<GenerateAuditPdfResult> => {
      // 2. Fast-path check: Return existing report if already persisted and available
      const hasReport = await ReportStorageService.hasReportPdf(cleanId);
      if (hasReport && !options.force) {
        const buffer = await ReportStorageService.getReportPdf(cleanId);
        const sizeBytes = buffer ? buffer.length : 0;
        return {
          success: true,
          pdfUrl: `/api/audits/${cleanId}/report`,
          auditId: cleanId,
          cached: true,
          sizeBytes,
        };
      }

      // 3. Load authoritative audit from PostgreSQL (or mock fallback if ID starts with mock-)
      let auditRecord = null;
      if (!cleanId.startsWith("mock-")) {
        try {
          auditRecord = await prisma.audit.findUnique({
            where: { id: cleanId },
          });
        } catch (dbErr) {
          console.error(`[AuditReportService] Database lookup failed for #${cleanId}:`, dbErr);
          throw dbErr;
        }
      }

      // Check existence
      if (!auditRecord) {
        // If mock ID, create a mock data fixture for testing
        if (cleanId.startsWith("mock-") || options.useMocks) {
          const mockAnalysis: ClaudeAuditResult = {
            audit_version: "1.0.0",
            overall_score: 85,
            score_breakdown: {
              technical: 88,
              on_page: 85,
              content: 85,
              core_web_vitals: 90,
              schema: 80,
            },
            critical_issues: [],
            important_issues: [
              {
                code: "MISSING_H1",
                title: "Missing H1 Heading",
                severity: "HIGH",
                category: "OnPage",
                description: "The audited page does not contain a main H1 heading tag.",
                evidence: "0 H1 elements detected",
                recommendation: "Add a single descriptive H1 heading containing the primary business keyword.",
              },
            ],
            quick_wins: [
              {
                priority: "HIGH",
                category: "OnPage",
                finding: "Missing viewport meta tag",
                fix: "Add <meta name='viewport' content='width=device-width, initial-scale=1.0'>",
                estimated_impact: "HIGH",
                effort: "LOW",
                falsifiability_check: "Inspect page head for viewport meta tag",
              },
            ],
            recommendations: [
              {
                priority: "HIGH",
                category: "Technical",
                finding: "Optimize Core Web Vitals",
                fix: "Preload largest contentful paint banner asset and defer third-party scripts.",
                estimated_impact: "HIGH",
                effort: "MEDIUM",
                falsifiability_check: "PageSpeed LCP score under 2.5s",
              },
            ],
            executive_summary: "Comprehensive SEO audit completed for mock property. Health scores indicate strong technical foundation with optimization opportunities.",
          };

          const reportData: AuditReportData = {
            auditId: cleanId,
            targetUrl: "https://example.com",
            businessType: "Technology",
            city: "San Francisco",
            state: "CA",
            score: 85,
            createdAt: new Date(),
            completedAt: new Date(),
            aiAnalysis: mockAnalysis,
          };

          const pdfBuffer = await renderAuditReportToPdf(reportData);
          const storage = await ReportStorageService.saveReportPdf(cleanId, pdfBuffer);

          return {
            success: true,
            pdfUrl: storage.reportUrl,
            auditId: cleanId,
            cached: false,
            sizeBytes: pdfBuffer.length,
          };
        }

        throw new AuditNotFoundError(cleanId);
      }

      // 4. Validate Audit Status: Must be COMPLETED
      if (auditRecord.status !== "COMPLETED") {
        throw new AuditNotCompletedError(cleanId, auditRecord.status);
      }

      // 5. Validate AI Analysis Data Contract
      if (!auditRecord.aiAnalysisData) {
        throw new InvalidAuditAnalysisError(cleanId, "aiAnalysisData field is null or empty");
      }

      const parseResult = ClaudeAuditResultSchema.safeParse(auditRecord.aiAnalysisData);
      if (!parseResult.success) {
        const errorDetails = parseResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        throw new InvalidAuditAnalysisError(cleanId, errorDetails);
      }

      const aiAnalysis: ClaudeAuditResult = parseResult.data;

      // 6. Build AuditReportData
      const reportData: AuditReportData = {
        auditId: auditRecord.id,
        targetUrl: auditRecord.targetUrl,
        businessType: auditRecord.businessType,
        city: auditRecord.city,
        state: auditRecord.state,
        score: auditRecord.score ?? aiAnalysis.overall_score,
        createdAt: auditRecord.createdAt,
        completedAt: auditRecord.completedAt,
        aiAnalysis,
      };

      // 7. Render PDF via Puppeteer
      let pdfBuffer: Buffer;
      try {
        pdfBuffer = await renderAuditReportToPdf(reportData);
      } catch (renderErr) {
        throw new PdfGenerationError(
          `Failed to render PDF document: ${renderErr instanceof Error ? renderErr.message : String(renderErr)}`,
          renderErr
        );
      }

      // 8. Persist to storage
      const storageResult = await ReportStorageService.saveReportPdf(cleanId, pdfBuffer);

      // 9. Update PostgreSQL Audit record with pdfReportUrl
      try {
        await prisma.audit.update({
          where: { id: cleanId },
          data: {
            pdfReportUrl: storageResult.reportUrl,
          },
        });
      } catch (dbErr) {
        console.warn(`[AuditReportService] Failed to update pdfReportUrl in database for #${cleanId}:`, dbErr);
        // Non-fatal: File is stored, URL is deterministic
      }

      return {
        success: true,
        pdfUrl: storageResult.reportUrl,
        auditId: cleanId,
        cached: false,
        sizeBytes: pdfBuffer.length,
      };
    })();

    // Track in-flight map
    inFlightGenerations.set(cleanId, generationPromise);

    try {
      return await generationPromise;
    } finally {
      inFlightGenerations.delete(cleanId);
    }
  }

  /**
   * Retrieves the raw PDF Buffer for streaming via API download
   */
  static async getAuditPdf(auditId: string): Promise<Buffer | null> {
    return ReportStorageService.getReportPdf(auditId);
  }

  /**
   * Checks if an audit PDF already exists
   */
  static async hasAuditPdf(auditId: string): Promise<boolean> {
    return ReportStorageService.hasReportPdf(auditId);
  }
}

export { renderAuditReportToPdf } from "./pdf";
export { ReportStorageService } from "./storage";
