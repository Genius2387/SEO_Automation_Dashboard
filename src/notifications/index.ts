import prisma from "@/lib/prisma";
import { NotificationChannel, NotificationResult, DispatchNotificationOptions } from "./types";
import { sendEmailNotification } from "./email";
import { sendWhatsAppNotification, redactPhoneNumber } from "./whatsapp";
import { AuditReportService } from "@/reports";
import { ClaudeAuditResultSchema } from "@/ai/schemas";

/**
 * Dispatches configured notifications (Email and/or WhatsApp) for a completed audit.
 * Enforces delivery tracking, duplicate prevention, and clean fault isolation.
 */
export async function dispatchAuditNotifications(
  auditId: string,
  options: DispatchNotificationOptions = {}
): Promise<NotificationResult[]> {
  if (!auditId || typeof auditId !== "string" || auditId.trim().length === 0) {
    throw new Error("Invalid audit ID for notification dispatch");
  }

  const cleanId = auditId.trim();
  const results: NotificationResult[] = [];

  // Fast-path for mock audits that aren't stored in PostgreSQL
  if (cleanId.startsWith("mock-")) {
    const channels = options.channels || (options.emailRecipient ? ["EMAIL"] : ["EMAIL", "WHATSAPP"]);
    for (const ch of channels) {
      if (ch === "EMAIL" && (options.emailRecipient || options.useMocks)) {
        const res = await sendEmailNotification(
          {
            auditId: cleanId,
            recipientEmail: options.emailRecipient || "client@example.com",
            targetUrl: "https://example.com",
            score: 85,
            summary: "Comprehensive SEO audit completed for mock property.",
            reportUrl: `/api/audits/${cleanId}/report`,
          },
          { useMocks: true }
        );
        results.push(res);
      }
      if (ch === "WHATSAPP" && (options.whatsappRecipient || options.useMocks)) {
        const res = await sendWhatsAppNotification(
          {
            auditId: cleanId,
            recipientPhone: options.whatsappRecipient || "+14155552671",
            targetUrl: "https://example.com",
            score: 85,
            reportUrl: `/api/audits/${cleanId}/report`,
          },
          { useMocks: true }
        );
        results.push(res);
      }
    }
    return results;
  }

  // 1. Load authoritative audit from PostgreSQL
  const audit = await prisma.audit.findUnique({
    where: { id: cleanId },
    include: { user: true },
  });

  if (!audit) {
    throw new Error(`Audit with ID '${cleanId}' not found.`);
  }

  if (audit.status !== "COMPLETED") {
    throw new Error(`Cannot send notifications for audit '${cleanId}' with status '${audit.status}'. Audit must be COMPLETED.`);
  }

  // 2. Ensure PDF report exists
  let reportUrl = audit.pdfReportUrl;
  if (!reportUrl) {
    try {
      const generated = await AuditReportService.generateAuditPdf(cleanId, {
        useMocks: options.useMocks,
      });
      reportUrl = generated.pdfUrl;
    } catch (reportErr) {
      console.warn(`[Notifications] Could not auto-generate PDF report before notification for #${cleanId}:`, reportErr);
      reportUrl = `/api/audits/${cleanId}/report`;
    }
  }

  // 3. Extract audit summary and score
  let summaryText = "SEO assessment completed.";
  if (audit.aiAnalysisData) {
    const parsed = ClaudeAuditResultSchema.safeParse(audit.aiAnalysisData);
    if (parsed.success) {
      summaryText = parsed.data.executive_summary;
    }
  }
  const score = audit.score ?? 0;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const fullReportDownloadUrl = reportUrl.startsWith("http") ? reportUrl : `${appUrl}${reportUrl}`;
  const dashboardUrl = `${appUrl}/client`;

  // 4. Determine intended channels and recipients
  const emailRecipient = options.emailRecipient || audit.user?.email || null;
  const whatsappRecipient = options.whatsappRecipient || null;

  const targetChannels: { channel: NotificationChannel; recipient: string }[] = [];

  const requestedChannels = options.channels || ["EMAIL", "WHATSAPP"];

  if (requestedChannels.includes("EMAIL") && emailRecipient) {
    targetChannels.push({ channel: "EMAIL", recipient: emailRecipient });
  }

  if (requestedChannels.includes("WHATSAPP") && whatsappRecipient) {
    targetChannels.push({ channel: "WHATSAPP", recipient: whatsappRecipient });
  }

  // 5. Process each target notification channel
  for (const target of targetChannels) {
    const { channel, recipient } = target;

    // Idempotency check: Don't resend if already marked SENT or DELIVERED for this audit & channel
    if (!options.force) {
      try {
        const existingSuccess = await prisma.notificationDelivery.findFirst({
          where: {
            auditId: cleanId,
            channel,
            status: { in: ["SENT", "DELIVERED"] },
          },
        });

        if (existingSuccess) {
          console.log(`[Notifications] ℹ️ Skipping duplicate notification for audit #${cleanId} on channel ${channel} (already delivered).`);
          results.push({
            channel,
            recipient,
            status: "SKIPPED",
            providerId: existingSuccess.providerId ?? undefined,
            attemptCount: existingSuccess.attemptCount,
            simulated: false,
          });
          continue;
        }
      } catch {
        // Continue if DB check fails
      }
    }

    // Create or find existing delivery record
    let deliveryRecord = null;
    try {
      deliveryRecord = await prisma.notificationDelivery.create({
        data: {
          auditId: cleanId,
          channel,
          recipient: channel === "WHATSAPP" ? redactPhoneNumber(recipient) : recipient,
          status: "PENDING",
        },
      });
    } catch {
      // Non-fatal if tracking table insert fails
    }

    // Execute dispatch with strict fault isolation
    try {
      let dispatchResult: NotificationResult;

      if (channel === "EMAIL") {
        dispatchResult = await sendEmailNotification(
          {
            auditId: cleanId,
            recipientEmail: recipient,
            targetUrl: audit.targetUrl,
            score,
            summary: summaryText,
            reportUrl: fullReportDownloadUrl,
            dashboardUrl,
          },
          { useMocks: options.useMocks }
        );
      } else {
        dispatchResult = await sendWhatsAppNotification(
          {
            auditId: cleanId,
            recipientPhone: recipient,
            targetUrl: audit.targetUrl,
            score,
            reportUrl: fullReportDownloadUrl,
          },
          { useMocks: options.useMocks }
        );
      }

      // Update record to SENT
      if (deliveryRecord) {
        try {
          await prisma.notificationDelivery.update({
            where: { id: deliveryRecord.id },
            data: {
              status: "SENT",
              providerId: dispatchResult.providerId || null,
              errorMessage: null,
            },
          });
        } catch {
          // Ignore tracking update failure
        }
      }

      results.push(dispatchResult);
    } catch (dispatchErr: unknown) {
      const errorMsg = dispatchErr instanceof Error ? dispatchErr.message : String(dispatchErr);
      const sanitizedError = errorMsg
        .replace(/:[^:@]+@/, ":***@")
        .replace(/key=[^&]+/i, "key=***")
        .replace(/sk-ant-[a-zA-Z0-9_-]+/g, "sk-ant-***")
        .slice(0, 300);

      console.error(`[Notifications] ❌ Failed to dispatch ${channel} for audit #${cleanId}: ${sanitizedError}`);

      // Update delivery record to FAILED
      if (deliveryRecord) {
        try {
          await prisma.notificationDelivery.update({
            where: { id: deliveryRecord.id },
            data: {
              status: "FAILED",
              errorMessage: sanitizedError,
            },
          });
        } catch {
          // Ignore tracking update failure
        }
      }

      results.push({
        channel,
        recipient,
        status: "FAILED",
        attemptCount: deliveryRecord?.attemptCount ?? 1,
        errorMessage: sanitizedError,
        simulated: false,
      });
    }
  }

  return results;
}

/**
 * Retrieves historical notification delivery records for an audit
 */
export async function getAuditNotificationHistory(auditId: string) {
  if (!auditId) return [];
  try {
    return await prisma.notificationDelivery.findMany({
      where: { auditId },
      orderBy: { createdAt: "desc" },
    });
  } catch (err) {
    console.error(`[Notifications] Failed to load notification history for #${auditId}:`, err);
    return [];
  }
}

export * from "./types";
export * from "./email";
export * from "./whatsapp";
