import { ClaudeAuditResult, Issue, Recommendation } from "@/ai/schemas";

export interface AuditReportData {
  auditId: string;
  targetUrl: string;
  businessType?: string | null;
  city?: string | null;
  state?: string | null;
  score: number | null;
  createdAt: Date | string;
  completedAt?: Date | string | null;
  aiAnalysis: ClaudeAuditResult;
  rawCrawlSummary?: {
    statusCode?: number;
    responseTimeMs?: number;
    title?: string;
    wordCount?: number;
    h1Count?: number;
    imagesCount?: number;
    hasRobotsTxt?: boolean;
    hasSitemap?: boolean;
    schemaTypes?: string[];
  } | null;
}

/**
 * Robust HTML entity escaper to neutralize XSS and script injection from crawled text or AI responses
 */
export function escapeHtml(input: unknown): string {
  if (input === null || input === undefined) return "";
  const str = typeof input === "string" ? input : String(input);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "N/A";
  try {
    const d = new Date(date);
    return isNaN(d.getTime()) ? "N/A" : d.toUTCString();
  } catch {
    return "N/A";
  }
}

function getScoreColor(score: number): { bg: string; text: string; border: string; hex: string } {
  if (score >= 80) return { bg: "#ecfdf5", text: "#065f46", border: "#10b981", hex: "#10b981" };
  if (score >= 60) return { bg: "#fffbeb", text: "#92400e", border: "#f59e0b", hex: "#f59e0b" };
  return { bg: "#fef2f2", text: "#991b1b", border: "#ef4444", hex: "#ef4444" };
}

function getSeverityBadge(severity: string): string {
  const sev = (severity || "").toUpperCase();
  let bg = "#f3f4f6";
  let text = "#374151";
  let border = "#d1d5db";

  if (sev === "CRITICAL") {
    bg = "#fee2e2";
    text = "#991b1b";
    border = "#f87171";
  } else if (sev === "HIGH") {
    bg = "#ffedd5";
    text = "#9a3412";
    border = "#fb923c";
  } else if (sev === "MEDIUM") {
    bg = "#fef3c7";
    text = "#92400e";
    border = "#fcd34d";
  } else if (sev === "LOW") {
    bg = "#f0fdf4";
    text = "#166534";
    border = "#86efac";
  }

  return `<span style="display:inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; background-color: ${bg}; color: ${text}; border: 1px solid ${border}; text-transform: uppercase;">${escapeHtml(sev)}</span>`;
}

function renderIssueCard(issue: Issue, index: number): string {
  return `
    <div style="border: 1px solid #e5e7eb; border-left: 4px solid #ef4444; border-radius: 6px; padding: 12px 16px; margin-bottom: 12px; background: #ffffff; page-break-inside: avoid;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <div style="font-weight: 700; font-size: 14px; color: #111827;">
          <span style="color: #6b7280; margin-right: 6px;">#${index + 1}</span> ${escapeHtml(issue.title)}
        </div>
        <div>
          ${getSeverityBadge(issue.severity)}
          <span style="display:inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; background: #f3f4f6; color: #4b5563; margin-left: 4px;">${escapeHtml(issue.category)}</span>
        </div>
      </div>
      <p style="margin: 0 0 8px 0; font-size: 12px; color: #374151; line-height: 1.5;">
        ${escapeHtml(issue.description)}
      </p>
      ${
        issue.evidence
          ? `<div style="background: #f9fafb; border: 1px solid #f3f4f6; border-radius: 4px; padding: 6px 10px; font-size: 11px; font-family: monospace; color: #4b5563; margin-bottom: 8px; word-break: break-all;">
              <strong>Evidence:</strong> ${escapeHtml(issue.evidence)}
            </div>`
          : ""
      }
      <div style="background: #ecfdf5; border-radius: 4px; padding: 6px 10px; font-size: 11px; color: #065f46;">
        <strong>Recommended Fix:</strong> ${escapeHtml(issue.recommendation)}
      </div>
    </div>
  `;
}

function renderRecommendationRow(rec: Recommendation, index: number): string {
  const impactColor = rec.estimated_impact === "HIGH" ? "#065f46" : rec.estimated_impact === "MEDIUM" ? "#92400e" : "#4b5563";
  const effortColor = rec.effort === "LOW" ? "#065f46" : rec.effort === "MEDIUM" ? "#92400e" : "#991b1b";

  return `
    <tr style="border-bottom: 1px solid #e5e7eb; page-break-inside: avoid;">
      <td style="padding: 10px 8px; font-size: 12px; vertical-align: top; width: 40px; text-align: center; color: #6b7280; font-weight: 600;">
        ${index + 1}
      </td>
      <td style="padding: 10px 8px; font-size: 12px; vertical-align: top; width: 100px;">
        ${getSeverityBadge(rec.priority)}
        <div style="font-size: 10px; color: #6b7280; margin-top: 4px; font-weight: 500;">${escapeHtml(rec.category)}</div>
      </td>
      <td style="padding: 10px 10px; font-size: 12px; vertical-align: top;">
        <div style="font-weight: 600; color: #111827; margin-bottom: 4px;">${escapeHtml(rec.finding)}</div>
        <div style="color: #374151; margin-bottom: 6px; font-size: 11px; line-height: 1.4;">${escapeHtml(rec.fix)}</div>
        ${
          rec.falsifiability_check
            ? `<div style="font-size: 10px; color: #4b5563; background: #f9fafb; padding: 4px 6px; border-radius: 3px; border-left: 2px solid #3b82f6;">
                <strong>Verification Test:</strong> ${escapeHtml(rec.falsifiability_check)}
              </div>`
            : ""
        }
      </td>
      <td style="padding: 10px 8px; font-size: 11px; vertical-align: top; width: 70px; text-align: center; font-weight: 600; color: ${impactColor};">
        ${escapeHtml(rec.estimated_impact)}
      </td>
      <td style="padding: 10px 8px; font-size: 11px; vertical-align: top; width: 70px; text-align: center; font-weight: 600; color: ${effortColor};">
        ${escapeHtml(rec.effort)}
      </td>
    </tr>
  `;
}

/**
 * Compiles the complete, secure, printable HTML report string
 */
export function buildAuditReportHtml(data: AuditReportData): string {
  const generatedAt = new Date().toUTCString();
  const overallScore = data.score ?? data.aiAnalysis.overall_score ?? 0;
  const scoreColors = getScoreColor(overallScore);
  const breakdown = data.aiAnalysis.score_breakdown;

  const isCwvMock = Boolean(
    (data as { crawlData?: { pageSpeed?: { status?: string } } }).crawlData?.pageSpeed?.status === "mock" ||
    process.env.SEO_PROVIDER_USE_MOCKS === "true" ||
    process.env.USE_MOCKS === "true"
  );
  const categories = [
    { name: "Technical SEO", weight: "25%", score: breakdown.technical, desc: "Robots.txt, sitemaps, indexing prerequisites, canonicals" },
    { name: "On-Page SEO", weight: "25%", score: breakdown.on_page, desc: "Title tags, meta descriptions, headings, images, link topology" },
    { name: "Content Quality", weight: "20%", score: breakdown.content, desc: "Visible text depth, word volume, readability, thin content defense" },
    { name: isCwvMock ? "Core Web Vitals (Provider Mock)" : "Core Web Vitals", weight: "15%", score: breakdown.core_web_vitals, desc: isCwvMock ? "Performance baseline (mock provider fixture; live PageSpeed not queried)" : "Page performance, render-blocking resources, mobile layout stability" },
    { name: "Schema & Metadata", weight: "15%", score: breakdown.schema, desc: "Structured data, Schema.org entities, JSON-LD validity" },
  ];

  const criticalIssues = data.aiAnalysis.critical_issues || [];
  const importantIssues = data.aiAnalysis.important_issues || [];
  const quickWins = data.aiAnalysis.quick_wins || [];
  const recommendations = data.aiAnalysis.recommendations || [];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SEO Audit Report - ${escapeHtml(data.targetUrl)}</title>
  <style>
    @page {
      size: A4;
      margin: 14mm 16mm 16mm 16mm;
      @bottom-left {
        content: "Edgelink Technology • Confidential SEO Audit Report";
        font-size: 8px;
        color: #9ca3af;
      }
      @bottom-right {
        content: "Page " counter(page) " of " counter(pages);
        font-size: 8px;
        color: #9ca3af;
      }
    }

    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 0;
      color: #1f2937;
      background: #ffffff;
      font-size: 12px;
      line-height: 1.5;
    }

    .report-container {
      width: 100%;
      max-width: 800px;
      margin: 0 auto;
    }

    /* Header */
    .header {
      border-bottom: 2px solid #1e293b;
      padding-bottom: 12px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }

    .brand-title {
      font-size: 18px;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.5px;
      margin: 0 0 4px 0;
    }

    .brand-subtitle {
      font-size: 11px;
      color: #64748b;
      font-weight: 500;
      margin: 0;
    }

    .header-meta {
      text-align: right;
      font-size: 10px;
      color: #64748b;
      line-height: 1.4;
    }

    /* Target URL Bar */
    .target-bar {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 10px 14px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .target-url {
      font-family: monospace;
      font-weight: 700;
      font-size: 14px;
      color: #0284c7;
      word-break: break-all;
    }

    .target-location {
      font-size: 11px;
      color: #64748b;
      text-align: right;
    }

    /* Executive Summary Block */
    .summary-section {
      display: flex;
      gap: 16px;
      margin-bottom: 24px;
      page-break-inside: avoid;
    }

    .score-badge-card {
      width: 160px;
      background: ${scoreColors.bg};
      border: 2px solid ${scoreColors.border};
      border-radius: 8px;
      padding: 16px;
      text-align: center;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
    }

    .score-number {
      font-size: 44px;
      font-weight: 900;
      color: ${scoreColors.text};
      line-height: 1;
      margin-bottom: 4px;
    }

    .score-label {
      font-size: 11px;
      font-weight: 700;
      color: ${scoreColors.text};
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .score-scale {
      font-size: 9px;
      color: #64748b;
      margin-top: 2px;
    }

    .summary-text-card {
      flex: 1;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 14px 18px;
    }

    .section-title {
      font-size: 14px;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 8px 0;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .summary-text {
      font-size: 12px;
      color: #334155;
      line-height: 1.6;
      margin: 0 0 8px 0;
    }

    .disclaimer-callout {
      font-size: 10px;
      color: #64748b;
      background: #f8fafc;
      border-left: 3px solid #94a3b8;
      padding: 6px 10px;
      border-radius: 0 4px 4px 0;
      margin-top: 8px;
    }

    /* Score Breakdown Table */
    .breakdown-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 24px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      overflow: hidden;
      page-break-inside: avoid;
    }

    .breakdown-table th {
      background: #f1f5f9;
      padding: 8px 12px;
      font-size: 11px;
      font-weight: 700;
      text-align: left;
      color: #475569;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      border-bottom: 1px solid #cbd5e1;
    }

    .breakdown-table td {
      padding: 10px 12px;
      border-bottom: 1px solid #f1f5f9;
      font-size: 12px;
    }

    .progress-bar-bg {
      height: 8px;
      background: #e2e8f0;
      border-radius: 4px;
      overflow: hidden;
      width: 120px;
      display: inline-block;
      vertical-align: middle;
      margin-right: 8px;
    }

    .progress-bar-fill {
      height: 100%;
      border-radius: 4px;
    }

    /* Table styling */
    .data-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 24px;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      overflow: hidden;
    }

    .data-table th {
      background: #f8fafc;
      padding: 8px 10px;
      font-size: 11px;
      font-weight: 700;
      text-align: left;
      color: #475569;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      border-bottom: 1px solid #cbd5e1;
    }

    /* Quick wins */
    .quick-win-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 24px;
      page-break-inside: avoid;
    }

    .quick-win-item {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 6px;
      padding: 10px 12px;
    }

    .quick-win-title {
      font-size: 12px;
      font-weight: 700;
      color: #166534;
      margin-bottom: 4px;
    }

    .quick-win-desc {
      font-size: 11px;
      color: #14532d;
      line-height: 1.4;
    }

    /* Limitations & Footer */
    .limitations-box {
      background: #f8fafc;
      border: 1px dashed #cbd5e1;
      border-radius: 6px;
      padding: 12px 14px;
      margin-top: 20px;
      margin-bottom: 20px;
      page-break-inside: avoid;
    }

    .limitations-title {
      font-size: 11px;
      font-weight: 700;
      color: #475569;
      text-transform: uppercase;
      margin: 0 0 6px 0;
    }

    .limitations-list {
      margin: 0;
      padding-left: 18px;
      font-size: 10px;
      color: #64748b;
      line-height: 1.5;
    }

    .footer {
      border-top: 1px solid #e2e8f0;
      padding-top: 12px;
      text-align: center;
      font-size: 9px;
      color: #94a3b8;
      page-break-inside: avoid;
    }

    .page-break {
      page-break-before: always;
    }
  </style>
</head>
<body>
  <div class="report-container">
    <!-- Header -->
    <div class="header">
      <div>
        <div class="brand-title">EDGELINK TECHNOLOGY</div>
        <div class="brand-subtitle">Automated SEO Intelligence &amp; Performance Audit</div>
      </div>
      <div class="header-meta">
        <div><strong>Audit ID:</strong> ${escapeHtml(data.auditId)}</div>
        <div><strong>Generated:</strong> ${escapeHtml(generatedAt)}</div>
        ${data.completedAt ? `<div><strong>Completed:</strong> ${escapeHtml(formatDate(data.completedAt))}</div>` : ""}
        <div><strong>AI Synthesis:</strong> ${data.aiAnalysis?.audit_version?.includes("mock") ? "MOCK Claude (Offline Engine)" : `REAL Claude (${escapeHtml(data.aiAnalysis?.audit_version || "Live API")})`}</div>
      </div>
    </div>

    <!-- Target URL Bar -->
    <div class="target-bar">
      <div>
        <div style="font-size: 10px; color: #64748b; text-transform: uppercase; font-weight: 600;">Audited Web Property</div>
        <div class="target-url">${escapeHtml(data.targetUrl)}</div>
      </div>
      ${
        data.businessType || data.city
          ? `<div class="target-location">
              <div><strong>Target Market:</strong> ${escapeHtml(data.businessType || "Website")}</div>
              <div><strong>Location:</strong> ${escapeHtml([data.city, data.state].filter(Boolean).join(", ") || "Global / Unspecified")}</div>
            </div>`
          : `<div class="target-location">
              <span style="display:inline-block; padding: 3px 8px; border-radius: 4px; background: #e0f2fe; color: #0369a1; font-weight: 600;">Automated Audit</span>
            </div>`
      }
    </div>

    <!-- Executive Summary Block -->
    <div class="summary-section">
      <div class="score-badge-card">
        <div class="score-number">${overallScore}</div>
        <div class="score-label">Overall Score</div>
        <div class="score-scale">out of 100</div>
      </div>
      <div class="summary-text-card">
        <div class="section-title">Executive Evaluation</div>
        <div class="summary-text">
          ${escapeHtml(data.aiAnalysis.executive_summary)}
        </div>
        <div class="disclaimer-callout">
          <strong>Analytical Notice:</strong> The Overall SEO Score is Edgelink Technology's analytical assessment based on automated crawl and heuristic signals. It reflects technical health and best-practice adherence, and does not guarantee search engine ranking positions or organic search traffic.
        </div>
      </div>
    </div>

    <!-- Category Health Breakdown -->
    <div class="section-title">Weighted Category Score Breakdown</div>
    <table class="breakdown-table">
      <thead>
        <tr>
          <th>Category</th>
          <th style="width: 70px; text-align: center;">Weight</th>
          <th style="width: 180px;">Score &amp; Progress</th>
          <th>Description &amp; Key Signals</th>
        </tr>
      </thead>
      <tbody>
        ${categories
          .map((cat) => {
            const catColors = getScoreColor(cat.score);
            return `
            <tr>
              <td style="font-weight: 700; color: #0f172a;">${escapeHtml(cat.name)}</td>
              <td style="text-align: center; color: #64748b; font-weight: 600;">${cat.weight}</td>
              <td>
                <div class="progress-bar-bg">
                  <div class="progress-bar-fill" style="width: ${cat.score}%; background: ${catColors.hex};"></div>
                </div>
                <strong style="color: ${catColors.text}; font-size: 13px;">${cat.score}</strong><span style="font-size: 10px; color: #64748b;">/100</span>
              </td>
              <td style="font-size: 11px; color: #64748b;">${escapeHtml(cat.desc)}</td>
            </tr>
          `;
          })
          .join("")}
      </tbody>
    </table>

    <!-- Quick Wins -->
    ${
      quickWins.length > 0
        ? `
        <div class="section-title" style="margin-top: 20px;">High-Impact Quick Wins</div>
        <div class="quick-win-grid">
          ${quickWins
            .slice(0, 4)
            .map(
              (qw) => `
            <div class="quick-win-item">
              <div class="quick-win-title">⚡ ${escapeHtml(qw.finding)}</div>
              <div class="quick-win-desc">${escapeHtml(qw.fix)}</div>
              ${
                qw.falsifiability_check
                  ? `<div style="font-size: 9px; color: #166534; margin-top: 4px; font-weight: 600;">Check: ${escapeHtml(qw.falsifiability_check)}</div>`
                  : ""
              }
            </div>
          `
            )
            .join("")}
        </div>
      `
        : ""
    }

    <!-- Critical & Important Findings -->
    ${
      criticalIssues.length > 0 || importantIssues.length > 0
        ? `
        <div class="page-break"></div>
        <div class="section-title">Identified Critical &amp; Important Findings</div>
        <div style="margin-bottom: 20px;">
          ${criticalIssues.map((issue, idx) => renderIssueCard(issue, idx)).join("")}
          ${importantIssues.map((issue, idx) => renderIssueCard(issue, criticalIssues.length + idx)).join("")}
        </div>
      `
        : ""
    }

    <!-- Strategic Roadmap Recommendations -->
    ${
      recommendations.length > 0
        ? `
        <div class="section-title" style="margin-top: 24px;">Strategic SEO Recommendations Roadmap</div>
        <table class="data-table">
          <thead>
            <tr>
              <th style="width: 30px;">#</th>
              <th>Priority</th>
              <th>Finding &amp; Recommended Action</th>
              <th style="text-align: center;">Impact</th>
              <th style="text-align: center;">Effort</th>
            </tr>
          </thead>
          <tbody>
            ${recommendations.map((rec, idx) => renderRecommendationRow(rec, idx)).join("")}
          </tbody>
        </table>
      `
        : ""
    }

    <!-- Report Limitations & Provider Notice -->
    <div class="limitations-box">
      <div class="limitations-title">Report Methodology &amp; Analytical Limitations</div>
      <ul class="limitations-list">
        <li><strong>Crawl Scope:</strong> This report represents single-page HTML metadata extraction and heuristic technical analysis captured via Cheerio at the time of the audit. Dynamic client-side single page apps (SPA) rendered exclusively in browser JavaScript may require secondary DOM inspection.</li>
        <li><strong>Deterministic Weighting:</strong> Category scores are computed deterministically (Technical 25%, On-Page 25%, Content 20%, Core Web Vitals 15%, Schema 15%) per Edgelink platform specifications. No scores are fabricated or randomly generated.</li>
        <li><strong>External Providers:</strong> Core Web Vitals and Search Console metrics reflect data available at audit time. Where provider keys are unconfigured or unavailable, proxy crawl heuristics are applied without fabricating fictitious external provider metrics.</li>
      </ul>
    </div>

    <!-- Footer -->
    <div class="footer">
      <div>Generated by <strong>Edgelink Technology SEO Automation Dashboard</strong> • Version 1.0</div>
      <div style="margin-top: 4px;">This automated document is intended solely for the authorized account holder. Unauthorized distribution is prohibited.</div>
    </div>
  </div>
</body>
</html>`;
}
