import puppeteer, { Browser } from "puppeteer";
import { buildAuditReportHtml, AuditReportData } from "./templates/auditReportTemplate";

export interface GeneratePdfOptions {
  timeoutMs?: number;
}

/**
 * Renders an AuditReportData object into an A4 PDF Buffer using headless Puppeteer
 */
export async function renderAuditReportToPdf(
  data: AuditReportData,
  options: GeneratePdfOptions = {}
): Promise<Buffer> {
  const timeoutMs = options.timeoutMs ?? 30000;
  let browser: Browser | null = null;

  try {
    // 1. Generate sanitized, self-contained HTML
    const html = buildAuditReportHtml(data);

    // 2. Launch headless Chromium with hardened sandbox security flags
    browser = await puppeteer.launch({
      headless: "shell",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-network",
        "--no-zygote",
        "--disable-web-security",
      ],
      timeout: timeoutMs,
    });

    const page = await browser.newPage();

    // 3. Security: Intercept and abort any external network requests (protect against SSRF / data exfiltration)
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      // Allow only data URLs and about:blank
      if (url.startsWith("data:") || url.startsWith("about:") || url === "about:blank") {
        req.continue();
      } else {
        // Block external scripts, stylesheets, fonts, or images
        req.abort("blockedbyclient");
      }
    });

    // 4. Render HTML string directly into page (NEVER navigate to user-submitted target URL)
    await page.setContent(html, {
      waitUntil: "load",
      timeout: timeoutMs,
    });

    // 5. Generate high-quality A4 PDF with exact print background colors
    const pdfUint8 = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "14mm",
        right: "16mm",
        bottom: "16mm",
        left: "16mm",
      },
      preferCSSPageSize: true,
      timeout: timeoutMs,
    });

    const pdfBuffer = Buffer.from(pdfUint8);

    // Sanity check PDF magic bytes (%PDF-)
    if (pdfBuffer.length < 5 || pdfBuffer.toString("ascii", 0, 5) !== "%PDF-") {
      throw new Error("Rendered document does not have valid PDF file signature");
    }

    return pdfBuffer;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[PDF Generator] Failed to render PDF for audit #${data.auditId}:`, msg);
    throw new Error(`PDF generation failed: ${msg}`);
  } finally {
    // 6. Guarantee cleanup of temporary browser resources
    if (browser) {
      try {
        await browser.close();
      } catch (closeErr) {
        console.warn("[PDF Generator] Error closing browser instance:", closeErr);
      }
    }
  }
}
