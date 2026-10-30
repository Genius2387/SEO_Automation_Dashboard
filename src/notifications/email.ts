import { EmailPayload, NotificationResult } from "./types";
import { escapeHtml } from "@/reports/templates/auditReportTemplate";
import { ProviderNotConfiguredError, isMockActive } from "@/services/providers";

/**
 * Validates an email address format
 */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== "string") return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email.trim());
}

/**
 * Generates clean, responsive HTML email markup
 */
export function buildAuditEmailHtml(payload: EmailPayload): string {
  const score = payload.score;
  const scoreColor = score >= 80 ? "#10b981" : score >= 60 ? "#f59e0b" : "#ef4444";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your SEO Audit Report is Ready</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 30px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <!-- Header -->
          <tr>
            <td style="background-color: #0f172a; padding: 24px 30px; text-align: left;">
              <h1 style="margin: 0; color: #ffffff; font-size: 20px; font-weight: 800; letter-spacing: -0.5px;">EDGELINK TECHNOLOGY</h1>
              <p style="margin: 4px 0 0 0; color: #94a3b8; font-size: 12px;">Automated SEO Intelligence &amp; Performance Audit</p>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 30px;">
              <h2 style="margin: 0 0 12px 0; font-size: 18px; color: #0f172a;">Your SEO Audit Report is Ready</h2>
              <p style="margin: 0 0 20px 0; font-size: 14px; color: #475569; line-height: 1.5;">
                We have completed the technical and on-page SEO assessment for:
                <br>
                <strong style="color: #0284c7; word-break: break-all;">${escapeHtml(payload.targetUrl)}</strong>
              </p>

              <!-- Score Card -->
              <table role="presentation" width="100%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 24px; padding: 20px;">
                <tr>
                  <td align="center">
                    <div style="font-size: 48px; font-weight: 900; color: ${scoreColor}; line-height: 1;">
                      ${score}
                    </div>
                    <div style="font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-top: 4px;">
                      Overall SEO Health Score (out of 100)
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Executive Summary -->
              <div style="margin-bottom: 24px;">
                <h3 style="margin: 0 0 8px 0; font-size: 13px; font-weight: 700; color: #0f172a; text-transform: uppercase;">Executive Evaluation</h3>
                <p style="margin: 0; font-size: 13px; color: #334155; line-height: 1.6; background-color: #f8fafc; padding: 14px; border-radius: 6px; border-left: 3px solid #0284c7;">
                  ${escapeHtml(payload.summary)}
                </p>
              </div>

              <!-- Action Button -->
              <table role="presentation" width="100%" style="margin-bottom: 24px;">
                <tr>
                  <td align="center">
                    <a href="${escapeHtml(payload.reportUrl)}" style="display: inline-block; background-color: #0284c7; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700; padding: 12px 28px; border-radius: 6px; text-align: center;">
                      Download Full PDF Report
                    </a>
                  </td>
                </tr>
              </table>

              ${
                payload.dashboardUrl
                  ? `<p style="margin: 0; font-size: 12px; text-align: center; color: #64748b;">
                      You can also review the interactive audit breakdown directly in your 
                      <a href="${escapeHtml(payload.dashboardUrl)}" style="color: #0284c7; text-decoration: underline;">Client Dashboard</a>.
                    </p>`
                  : ""
              }
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 16px 30px; text-align: center;">
              <p style="margin: 0 0 4px 0; font-size: 11px; color: #94a3b8;">
                This automated notification was generated by Edgelink Technology SEO Automation Dashboard.
              </p>
              <p style="margin: 0; font-size: 10px; color: #94a3b8;">
                The Overall SEO Score is an analytical assessment and does not guarantee search engine ranking positions.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Dispatches an email notification for an audit report
 */
export async function sendEmailNotification(
  payload: EmailPayload,
  options?: { useMocks?: boolean }
): Promise<NotificationResult> {
  // 1. Recipient validation
  if (!isValidEmail(payload.recipientEmail)) {
    throw new Error(`Invalid recipient email address: '${payload.recipientEmail}'`);
  }

  // 2. Mock mode handling
  if (isMockActive(options?.useMocks)) {
    const mockProviderId = `MOCK_EMAIL_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    console.log(`[MOCK EMAIL] → Recipient: ${payload.recipientEmail}`);
    console.log(`[MOCK EMAIL] → Target:    ${payload.targetUrl}`);
    console.log(`[MOCK EMAIL] → Score:     ${payload.score}/100`);
    console.log(`[MOCK EMAIL] → Download:  ${payload.reportUrl}`);

    return {
      channel: "EMAIL",
      recipient: payload.recipientEmail,
      status: "SENT",
      providerId: mockProviderId,
      attemptCount: 1,
      simulated: true,
    };
  }

  // 3. Live mode configuration check
  const resendApiKey = process.env.RESEND_API_KEY;
  const sendgridApiKey = process.env.SENDGRID_API_KEY;
  const smtpHost = process.env.SMTP_HOST;

  const hasLiveEmailConfig = Boolean(
    (resendApiKey && !resendApiKey.startsWith("mock-")) ||
    (sendgridApiKey && !sendgridApiKey.startsWith("mock-")) ||
    (smtpHost && !smtpHost.startsWith("mock-"))
  );

  if (!hasLiveEmailConfig) {
    throw new ProviderNotConfiguredError(
      "Email Delivery",
      "Live email provider is not configured. Set USE_MOCKS=\"true\" for mock delivery or provide RESEND_API_KEY / SENDGRID_API_KEY."
    );
  }

  // Live provider execution placeholder
  throw new ProviderNotConfiguredError(
    "Email Delivery",
    "Live email provider integration requires verified SMTP/Resend domain configuration."
  );
}
