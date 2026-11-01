/* eslint-disable @typescript-eslint/no-require-imports */
import "dotenv/config";
import { crawlWebsite } from "../src/crawlers";
import { analyzeSeoAudit } from "../src/ai";

async function verifyWebsites() {
  console.log("==================================================================");
  console.log("EDGELINK SEO DASHBOARD - LIVE WEBSITE VERIFICATION (OPTION A)");
  console.log("==================================================================");

  const targets = ["https://in.tommy.com/", "https://louisphilippe.abfrl.in/"];

  for (const url of targets) {
    console.log(`\n------------------------------------------------------------------`);
    console.log(`TARGET: ${url}`);
    console.log(`------------------------------------------------------------------`);

    try {
      console.log(`[Crawler] Executing real HTTP fetch & Cheerio extraction for ${url}...`);
      const crawl = await crawlWebsite(url, {
        useMocks: false, // Explicitly ensure real crawl
        timeoutMs: 25000,
      });

      console.log("\n[Extracted Signals]");
      console.log(`• HTTP Status:       ${crawl.statusCode}`);
      console.log(`• Page Title:        "${crawl.onPage.title.text || "(None)"}" (length: ${crawl.onPage.title.length})`);
      console.log(`• Meta Description:  "${crawl.onPage.metaDescription.text || "(None)"}" (length: ${crawl.onPage.metaDescription.length})`);
      console.log(`• Canonical URL:     ${crawl.onPage.canonical.url || "(None)"}`);
      console.log(`• Word Count:        ${crawl.onPage.metadata.wordCount}`);
      console.log(`• Headings:          H1: ${crawl.onPage.headings.h1Count} (${crawl.onPage.headings.h1.slice(0, 2).join(", ") || "None"}), H2: ${crawl.onPage.headings.h2Count}, H3: ${crawl.onPage.headings.h3Count}`);
      console.log(`• Images:            Total: ${crawl.onPage.images.totalCount}, Missing Alt: ${crawl.onPage.images.missingAltCount}, With Alt: ${crawl.onPage.images.withAltCount}`);
      console.log(`• Links:             Internal: ${crawl.onPage.links.totalInternal}, External: ${crawl.onPage.links.totalExternal}`);
      console.log(`• Structured Data:   JSON-LD Blocks: ${crawl.schema.jsonLdBlocksCount}, Discovered Types: [${crawl.schema.discoveredTypes.join(", ") || "None"}]`);
      console.log(`• Technical Checks:  Robots.txt: ${crawl.technical.robotsTxt.exists ? "Exists (Status " + crawl.technical.robotsTxt.statusCode + ")" : "Not Found"}, Sitemap: ${crawl.technical.sitemap.exists ? "Exists (" + crawl.technical.sitemap.urlCount + " URLs)" : "Not Found"}`);
      console.log(`• Total Findings:    ${crawl.findings.length} findings generated`);

      console.log("\n[AI Synthesis (Mock Claude Engine)]");
      const ai = await analyzeSeoAudit(crawl, { useMocks: true });

      console.log(`• Overall Score:     ${ai.overall_score}/100`);
      console.log(`• Score Breakdown:`);
      console.log(`  - Technical SEO:   ${ai.score_breakdown.technical}/100 (Weight: 25%)`);
      console.log(`  - On-Page SEO:     ${ai.score_breakdown.on_page}/100 (Weight: 25%)`);
      console.log(`  - Content Quality: ${ai.score_breakdown.content}/100 (Weight: 20%)`);
      console.log(`  - Core Web Vitals: ${ai.score_breakdown.core_web_vitals}/100 (Weight: 15% - Provider Mock)`);
      console.log(`  - Schema Markup:   ${ai.score_breakdown.schema}/100 (Weight: 15%)`);

      console.log("\n• Critical Issues:");
      if (ai.critical_issues.length === 0) {
        console.log("  (None detected)");
      } else {
        ai.critical_issues.forEach((i, idx) => {
          console.log(`  ${idx + 1}. [${i.code}] ${i.title}: ${i.description}`);
        });
      }

      console.log("\n• Quick Wins:");
      ai.quick_wins.forEach((q, idx) => {
        console.log(`  ${idx + 1}. [${q.category}] ${q.finding} -> Fix: ${q.fix}`);
      });

      console.log("\n• Top Recommendations:");
      ai.recommendations.slice(0, 3).forEach((r, idx) => {
        console.log(`  ${idx + 1}. [${r.priority}] ${r.finding} -> Fix: ${r.fix}`);
      });

      console.log(`\n• Executive Summary:\n  "${ai.executive_summary}"`);
    } catch (err: unknown) {
      console.error(`❌ Failed to audit ${url}:`, (err as Error).message);
    }
  }
}

verifyWebsites().catch(console.error);

