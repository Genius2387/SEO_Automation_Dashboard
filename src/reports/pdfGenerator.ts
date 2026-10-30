import puppeteer from "puppeteer";
import { CrawlResult, AIAnalysisResult } from "@/types";

export interface ReportGenerationInput {
  targetUrl: string;
  crawlData: CrawlResult;
  aiAnalysis: AIAnalysisResult;
}

export function generateReportHtml(input: ReportGenerationInput): string {
  const { targetUrl, crawlData, aiAnalysis } = input;
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>SEO Audit Report - ${targetUrl}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 40px; color: #1e293b; }
    h1 { color: #0f172a; border-bottom: 2px solid #3b82f6; padding-bottom: 12px; }
    .score-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .score { font-size: 3rem; font-weight: bold; color: #2563eb; }
    .badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
    .badge-high { background: #fee2e2; color: #991b1b; }
    .badge-medium { background: #fef3c7; color: #92400e; }
    .recommendation { margin-bottom: 16px; padding: 12px; border-left: 4px solid #3b82f6; background: #f8fafc; }
  </style>
</head>
<body>
  <h1>Edgelink SEO Automation Audit Report</h1>
  <p><strong>Audited Target:</strong> ${targetUrl}</p>
  <p><strong>Date:</strong> ${new Date(aiAnalysis.generatedAt).toUTCString()}</p>
  
  <div class="score-card">
    <div>Overall Health Score</div>
    <div class="score">${aiAnalysis.overallScore}/100</div>
    <p>${aiAnalysis.summary}</p>
  </div>

  <h2>Key Findings</h2>
  <ul>
    ${aiAnalysis.strengths.map((s) => `<li><strong>Strength:</strong> ${s}</li>`).join("")}
    ${aiAnalysis.weaknesses.map((w) => `<li><strong>Area to Improve:</strong> ${w}</li>`).join("")}
  </ul>

  <h2>Priority Recommendations</h2>
  ${aiAnalysis.recommendations
    .map(
      (rec) => `
    <div class="recommendation">
      <span class="badge badge-${rec.priority}">${rec.priority.toUpperCase()}</span>
      <strong>${rec.title}</strong>
      <p>${rec.explanation}</p>
      <ol>
        ${rec.actionableSteps.map((step) => `<li>${step}</li>`).join("")}
      </ol>
    </div>
  `
    )
    .join("")}

  <h2>Technical Crawl Details</h2>
  <p>Status: ${crawlData.statusCode} | Response Time: ${crawlData.responseTimeMs}ms | Words: ${crawlData.wordCount}</p>
  <p>Title: ${crawlData.title}</p>
  <p>Meta Description: ${crawlData.metaDescription}</p>
</body>
</html>
  `;
}

export async function generatePdfReport(
  input: ReportGenerationInput
): Promise<Buffer> {
  const html = generateReportHtml(input);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "20mm",
        right: "20mm",
        bottom: "20mm",
        left: "20mm",
      },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}
