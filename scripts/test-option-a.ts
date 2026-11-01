/* eslint-disable @typescript-eslint/no-require-imports */
import "dotenv/config";
import assert from "assert";
import { crawlWebsite } from "../src/crawlers";
import { analyzeSeoAudit, getDeterministicMockAiResult } from "../src/ai";
import { isCrawlerMockActive, isAiMockActive, isSeoProviderMockActive } from "../src/services/providers";
import { extractOnPageSignals } from "../src/crawlers/onPage";
import { generateSeoFindings } from "../src/crawlers/findings";
import { NormalizedAuditData } from "../src/types";
import prisma from "../src/lib/prisma";
import { AuditService } from "../src/services/auditService";
import { closeRedisConnections } from "../src/queue";

async function runOptionARegressionTests() {
  console.log("==================================================================");
  console.log("EDGELINK SEO DASHBOARD - OPTION A ARCHITECTURE REGRESSION TESTS");
  console.log("==================================================================");

  // ---------------------------------------------------------------------------
  // 1. Crawler Mock Separation: CRAWLER_USE_MOCKS=false activates real crawling
  // ---------------------------------------------------------------------------
  console.log("\n[1/10] Testing CRAWLER_USE_MOCKS=false activates real crawling...");
  assert.strictEqual(
    isCrawlerMockActive(),
    false,
    "When CRAWLER_USE_MOCKS=false, isCrawlerMockActive() must return false"
  );
  assert.strictEqual(
    isAiMockActive(),
    true,
    "When AI_USE_MOCKS=true, isAiMockActive() must return true"
  );
  assert.strictEqual(
    isSeoProviderMockActive(),
    true,
    "When SEO_PROVIDER_USE_MOCKS=true, isSeoProviderMockActive() must return true"
  );
  console.log("  ✔ Granular mock precedence flags verified.");

  // ---------------------------------------------------------------------------
  // 2. AI_USE_MOCKS=true executes deterministic mock AI without Anthropic API key
  // ---------------------------------------------------------------------------
  console.log("\n[2/10] Testing Claude API is NOT called when AI_USE_MOCKS=true...");
  const dummyNormalized: NormalizedAuditData = {
    url: "https://example.com",
    statusCode: 200,
    responseTimeMs: 150,
    title: "Example Title",
    metaDescription: "Example Description",
    h1: ["Heading One"],
    h2: ["Heading Two"],
    wordCount: 450,
    images: [],
    links: [],
    issues: [],
    target: {
      originalUrl: "https://example.com",
      finalUrl: "https://example.com",
      normalizedUrl: "https://example.com",
    },
    crawl: {
      status: "SUCCESS",
      httpStatus: 200,
      contentType: "text/html",
      durationMs: 150,
      fetchedAt: new Date().toISOString(),
      redirectCount: 0,
      redirectTrail: [],
      errors: [],
    },
    onPage: {
      title: { text: "Example Title", exists: true, length: 13, status: "TOO_SHORT" },
      metaDescription: { text: "Example Description", exists: true, length: 19, status: "TOO_SHORT" },
      canonical: { url: "https://example.com", count: 1, isValid: true, matchesFinalUrl: true },
      headings: { h1: ["Heading One"], h2: ["Heading Two"], h3: [], h1Count: 1, h2Count: 1, h3Count: 0 },
      images: { totalCount: 2, withAltCount: 2, missingAltCount: 0, decorativeCount: 0, sample: [] },
      links: { totalInternal: 5, totalExternal: 1, emptyHrefCount: 0, sampleInternal: [], sampleExternal: [] },
      metadata: { metaRobots: "index, follow", xRobotsTag: null, lang: "en", favicon: null, viewport: "width=device-width", openGraph: { title: "Example Title" }, wordCount: 450 },
    },
    technical: {
      robotsTxt: { checked: true, url: "https://example.com/robots.txt", exists: true, statusCode: 200, isAccessible: true, sitemaps: [], isTargetDisallowed: false },
      sitemap: { checked: true, discoveredUrls: [], primaryUrl: null, exists: false, isXml: false, isSitemapIndex: false, statusCode: 404, urlCount: 0, sampleUrls: [] },
      indexabilitySignals: { isIndexable: true, reasons: [] },
      findings: [],
    },
    schema: { jsonLdBlocksCount: 1, jsonLdBlocks: [], discoveredTypes: ["WebPage"], hasMicrodata: false, microdataTypes: [], findings: [] },
    pageSpeed: { status: "mock", source: "mock", data: null },
    searchConsole: { status: "mock", source: "mock", data: null },
    rankings: { status: "mock", source: "mock", data: null },
    findings: [],
  };

  const aiAnalysis = await analyzeSeoAudit(dummyNormalized, { useMocks: true });
  assert.ok(aiAnalysis.overall_score >= 0 && aiAnalysis.overall_score <= 100);
  assert.strictEqual(aiAnalysis.audit_version.includes("mock"), true, "Mock audit version badge must be present");
  console.log(`  ✔ Deterministic AI generated score ${aiAnalysis.overall_score}/100 without Anthropic API key.`);

  // ---------------------------------------------------------------------------
  // 3. Mock AI receives real crawler findings
  // ---------------------------------------------------------------------------
  console.log("\n[3/10] Testing Mock AI dynamically ingests findings from crawler...");
  const findingTest: NormalizedAuditData = {
    ...dummyNormalized,
    findings: [
      {
        code: "MISSING_TITLE",
        category: "OnPage",
        severity: "CRITICAL",
        title: "Page Missing Title",
        description: "Title is missing",
        evidence: "Tag absent",
        recommendation: "Add title",
        source: "OnPageAuditor",
      },
    ],
  };
  const analysisWithFinding = getDeterministicMockAiResult(findingTest);
  assert.ok(
    analysisWithFinding.critical_issues.some((i) => i.code === "MISSING_TITLE"),
    "Mock AI must include the actual crawler finding in critical_issues"
  );
  console.log("  ✔ Mock AI dynamically reflected actual crawler finding.");

  // ---------------------------------------------------------------------------
  // 4. Two different HTML fixtures produce distinct extracted signals
  // ---------------------------------------------------------------------------
  console.log("\n[4/10] Testing distinct HTML documents produce distinct extracted signals...");
  const htmlSiteA = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Brand A - Premium Luxury Fashion Apparel</title>
        <meta name="description" content="Discover exquisite menswear and designer apparel crafted with Italian fabrics and bespoke elegance. Shop online today." />
        <link rel="canonical" href="https://site-a.com" />
      </head>
      <body>
        <h1>Luxury Italian Suits & Menswear</h1>
        <h2>Spring Collection</h2>
        <h2>Bespoke Tailoring</h2>
        <h2>Accessories</h2>
        <p>${"word ".repeat(750)}</p>
        <img src="/img1.jpg" alt="Tailored Navy Suit" />
        <img src="/img2.jpg" alt="Silk Tie" />
      </body>
    </html>
  `;

  const htmlSiteB = `
    <!DOCTYPE html>
    <html>
      <head>
        <!-- No Title -->
        <meta name="description" content="Short" />
      </head>
      <body>
        <p>${"word ".repeat(80)}</p>
        <img src="/logo.png" />
      </body>
    </html>
  `;

  const signalsA = extractOnPageSignals(htmlSiteA, "https://site-a.com");
  const signalsB = extractOnPageSignals(htmlSiteB, "https://site-b.com");

  assert.notStrictEqual(signalsA.title.text, signalsB.title.text, "Titles must differ");
  assert.notStrictEqual(signalsA.metadata.wordCount, signalsB.metadata.wordCount, "Word counts must differ");
  assert.strictEqual(signalsA.images.missingAltCount, 0, "Site A has 0 missing alt tags");
  assert.strictEqual(signalsB.images.missingAltCount, 1, "Site B has 1 missing alt tag");
  console.log("  ✔ Site A and Site B produced distinctly different extracted signals.");

  // ---------------------------------------------------------------------------
  // 5. Different findings produce appropriately different category scores
  // ---------------------------------------------------------------------------
  console.log("\n[5/10] Testing different findings produce different category scores...");
  const findingsA = generateSeoFindings({
    onPage: signalsA,
    technical: { httpStatus: 200, robotsTxt: { checked: true, exists: true, isAccessible: true, isTargetDisallowed: false, sitemaps: [], statusCode: 200, url: "https://site-a.com/robots.txt" }, sitemap: { checked: true, exists: true, primaryUrl: "https://site-a.com/sitemap.xml", isXml: true, isSitemapIndex: false, statusCode: 200, urlCount: 25, discoveredUrls: [], sampleUrls: [] } },
    schema: { jsonLdBlocksCount: 2, jsonLdBlocks: [], discoveredTypes: ["Organization", "Product"], hasMicrodata: false, microdataTypes: [], findings: [] },
  });

  const findingsB = generateSeoFindings({
    onPage: signalsB,
    technical: { httpStatus: 200, robotsTxt: { checked: true, exists: false, isAccessible: false, isTargetDisallowed: false, sitemaps: [], statusCode: 404, url: "https://site-b.com/robots.txt" }, sitemap: { checked: true, exists: false, primaryUrl: null, isXml: false, isSitemapIndex: false, statusCode: 404, urlCount: 0, discoveredUrls: [], sampleUrls: [] } },
    schema: { jsonLdBlocksCount: 0, jsonLdBlocks: [], discoveredTypes: [], hasMicrodata: false, microdataTypes: [], findings: [] },
  });

  const auditDataA: NormalizedAuditData = {
    ...dummyNormalized,
    url: "https://site-a.com",
    onPage: signalsA,
    findings: findingsA,
    schema: { jsonLdBlocksCount: 2, jsonLdBlocks: [], discoveredTypes: ["Organization", "Product"], hasMicrodata: false, microdataTypes: [], findings: [] },
  };

  const auditDataB: NormalizedAuditData = {
    ...dummyNormalized,
    url: "https://site-b.com",
    onPage: signalsB,
    findings: findingsB,
    schema: { jsonLdBlocksCount: 0, jsonLdBlocks: [], discoveredTypes: [], hasMicrodata: false, microdataTypes: [], findings: [] },
  };

  const scoreA = getDeterministicMockAiResult(auditDataA);
  const scoreB = getDeterministicMockAiResult(auditDataB);

  assert.ok(scoreA.overall_score > scoreB.overall_score, `Site A score (${scoreA.overall_score}) must exceed Site B (${scoreB.overall_score})`);
  assert.ok(scoreA.score_breakdown.on_page > scoreB.score_breakdown.on_page, "On-page score must be higher for Site A");
  assert.ok(scoreA.score_breakdown.content > scoreB.score_breakdown.content, "Content score must be higher for Site A");
  assert.ok(scoreA.score_breakdown.schema > scoreB.score_breakdown.schema, "Schema score must be higher for Site A");
  console.log(`  ✔ Site A Score: ${scoreA.overall_score}/100 vs Site B Score: ${scoreB.overall_score}/100 (Difference: ${scoreA.overall_score - scoreB.overall_score} pts).`);

  // ---------------------------------------------------------------------------
  // 6. Identical findings produce identical scores (Mathematical Determinism)
  // ---------------------------------------------------------------------------
  console.log("\n[6/10] Testing identical findings produce 100% identical scores...");
  const repeatA1 = getDeterministicMockAiResult(auditDataA);
  const repeatA2 = getDeterministicMockAiResult(auditDataA);
  assert.strictEqual(repeatA1.overall_score, repeatA2.overall_score, "Overall scores must be identical");
  assert.deepStrictEqual(repeatA1.score_breakdown, repeatA2.score_breakdown, "Breakdown must be identical");
  console.log("  ✔ Deterministic scoring invariance verified.");

  // ---------------------------------------------------------------------------
  // 7. Inaccessible website handled without fabricating successful findings
  // ---------------------------------------------------------------------------
  console.log("\n[7/10] Testing inaccessible website error handling...");
  let caughtError = false;
  try {
    await crawlWebsite("https://this-domain-definitely-does-not-exist-123456789.com", {
      useMocks: false,
      timeoutMs: 5000,
    });
  } catch (err: unknown) {
    caughtError = true;
    console.log(`  ✔ Inaccessible site failed safely with: ${(err as Error).message}`);
  }
  assert.strictEqual(caughtError, true, "Inaccessible domain must throw CrawlExecutionError, not fabricate mock data");

  // ---------------------------------------------------------------------------
  // 8. Third-Party Provider Mocks remain enabled
  // ---------------------------------------------------------------------------
  console.log("\n[8/10] Testing Third-Party Provider mocks remain enabled...");
  assert.strictEqual(isSeoProviderMockActive(), true, "Provider mocks must remain active");
  console.log("  ✔ Third-party provider mocks verified active.");

  // ---------------------------------------------------------------------------
  // 9. Database persistence stores website-specific data
  // ---------------------------------------------------------------------------
  console.log("\n[9/10] Testing Database persistence for queued audit...");
  const queuedAudit = await AuditService.createQueuedAudit({
    targetUrl: "https://example.com/regression-test-option-a",
    useMocks: false,
  });
  assert.ok(queuedAudit.id, "Audit record ID must be generated");
  assert.strictEqual(queuedAudit.status, "QUEUED");
  
  // Cleanup test record
  await prisma.audit.delete({ where: { id: queuedAudit.id } });
  console.log("  ✔ Database persistence and queue integration verified.");

  // ---------------------------------------------------------------------------
  // 10. Core Web Vitals Labeling
  // ---------------------------------------------------------------------------
  console.log("\n[10/13] Testing Core Web Vitals labeling transparency...");
  const auditResultWithMockCwv = getDeterministicMockAiResult({
    ...dummyNormalized,
    pageSpeed: { status: "mock", source: "mock", data: null },
  });
  assert.ok(
    auditResultWithMockCwv.executive_summary.includes("Provider Mock"),
    "Executive summary must clearly state that CWV is Provider Mock"
  );
  console.log("  ✔ Core Web Vitals clearly labeled as Provider Mock.");

  // ---------------------------------------------------------------------------
  // 11. Deterministic Signal Deductions via Controlled Fixtures
  // ---------------------------------------------------------------------------
  console.log("\n[11/13] Testing controlled HTML signal deductions (Title, Meta, H1, Alt)...");
  
  // Baseline clean fixture
  const baseAudit: NormalizedAuditData = {
    ...dummyNormalized,
    onPage: {
      title: { text: "Optimal Brand Title for Search Results", exists: true, length: 42, status: "OPTIMAL" },
      metaDescription: { text: "This is a perfectly crafted meta description between 120 and 160 characters long that describes the website accurately for search snippet results.", exists: true, length: 145, status: "OPTIMAL" },
      canonical: { url: "https://example.com", count: 1, isValid: true, matchesFinalUrl: true },
      headings: { h1: ["Single Primary H1 Heading"], h2: ["Subheading 1", "Subheading 2", "Subheading 3"], h3: [], h1Count: 1, h2Count: 3, h3Count: 0 },
      images: { totalCount: 10, withAltCount: 10, missingAltCount: 0, decorativeCount: 0, sample: [] },
      links: { totalInternal: 10, totalExternal: 2, emptyHrefCount: 0, sampleInternal: [], sampleExternal: [] },
      metadata: { metaRobots: "index, follow", xRobotsTag: null, lang: "en", favicon: null, viewport: "width=device-width", openGraph: { title: "Title" }, wordCount: 1500 },
    },
    findings: [],
  };

  const baseResult = getDeterministicMockAiResult(baseAudit);
  assert.strictEqual(baseResult.score_breakdown.on_page, 100, "Clean baseline on-page score must be 100");

  // Test 11a: Missing Title
  const missingTitleAudit: NormalizedAuditData = {
    ...baseAudit,
    onPage: { ...baseAudit.onPage, title: { text: "", exists: false, length: 0, status: "MISSING" } },
  };
  const missingTitleResult = getDeterministicMockAiResult(missingTitleAudit);
  assert.strictEqual(missingTitleResult.score_breakdown.on_page, 75, "Missing title must reduce on-page by 25 points (100 -> 75)");

  // Test 11b: Missing Meta Description
  const missingMetaAudit: NormalizedAuditData = {
    ...baseAudit,
    onPage: { ...baseAudit.onPage, metaDescription: { text: "", exists: false, length: 0, status: "MISSING" } },
  };
  const missingMetaResult = getDeterministicMockAiResult(missingMetaAudit);
  assert.strictEqual(missingMetaResult.score_breakdown.on_page, 80, "Missing meta description must reduce on-page by 20 points (100 -> 80)");

  // Test 11c: Missing H1
  const missingH1Audit: NormalizedAuditData = {
    ...baseAudit,
    onPage: { ...baseAudit.onPage, headings: { ...baseAudit.onPage.headings, h1: [], h1Count: 0 } },
  };
  const missingH1Result = getDeterministicMockAiResult(missingH1Audit);
  assert.strictEqual(missingH1Result.score_breakdown.on_page, 85, "Missing H1 must reduce on-page by 15 points (100 -> 85)");

  // Test 11d: Multiple H1 Headings
  const multiH1Audit: NormalizedAuditData = {
    ...baseAudit,
    onPage: { ...baseAudit.onPage, headings: { ...baseAudit.onPage.headings, h1: ["H1 One", "H1 Two"], h1Count: 2 } },
  };
  const multiH1Result = getDeterministicMockAiResult(multiH1Audit);
  assert.strictEqual(multiH1Result.score_breakdown.on_page, 90, "Multiple H1 headings must reduce on-page by 10 points (100 -> 90)");

  // Test 11e: Missing Image Alt Attributes
  const missingAltAudit: NormalizedAuditData = {
    ...baseAudit,
    onPage: { ...baseAudit.onPage, images: { totalCount: 10, withAltCount: 5, missingAltCount: 5, decorativeCount: 0, sample: [] } },
  };
  const missingAltResult = getDeterministicMockAiResult(missingAltAudit);
  assert.strictEqual(missingAltResult.score_breakdown.on_page, 90, "50% missing alt tags on 10 images must reduce on-page by 10 points (100 -> 90)");
  console.log("  ✔ All controlled HTML signal deductions (Title: -25, Meta: -20, H1: -15, Multi-H1: -10, Alt: -10) verified.");

  // ---------------------------------------------------------------------------
  // 12. Content Depth Brackets & Schema Scoring Verification
  // ---------------------------------------------------------------------------
  console.log("\n[12/13] Testing Content Depth Brackets, Subheading Bonus, and Schema Structured Data...");
  
  // Word count brackets (with h2Count=0 to isolate pure word count brackets)
  const auditWithWordCount = (words: number, h2s = 0): NormalizedAuditData => ({
    ...baseAudit,
    onPage: {
      ...baseAudit.onPage,
      headings: { ...baseAudit.onPage.headings, h2: Array(h2s).fill("Subheading"), h2Count: h2s },
      metadata: { ...baseAudit.onPage.metadata, wordCount: words },
    },
    findings: [],
  });

  // Base brackets without H2 bonus
  assert.strictEqual(getDeterministicMockAiResult(auditWithWordCount(1500, 1)).score_breakdown.content, 95, ">=1200 words base: 95");
  assert.strictEqual(getDeterministicMockAiResult(auditWithWordCount(800, 1)).score_breakdown.content, 85, "600-1199 words base: 85");
  assert.strictEqual(getDeterministicMockAiResult(auditWithWordCount(450, 1)).score_breakdown.content, 75, "300-599 words base: 75");
  assert.strictEqual(getDeterministicMockAiResult(auditWithWordCount(200, 1)).score_breakdown.content, 60, "100-299 words base: 60");
  assert.strictEqual(getDeterministicMockAiResult(auditWithWordCount(50, 1)).score_breakdown.content, 45, "1-99 words base: 45");
  assert.strictEqual(getDeterministicMockAiResult(auditWithWordCount(0, 0)).score_breakdown.content, 25, "0 words: 25");

  // Subheading Structure Bonus (+5 when h2Count >= 3)
  assert.strictEqual(getDeterministicMockAiResult(auditWithWordCount(800, 4)).score_breakdown.content, 90, "800 words + 4 H2 headings must produce 85 + 5 = 90 (matches Tommy Hilfiger exactly)");

  // Schema blocks
  const auditWithSchema = (jsonLdBlocksCount: number, hasMicrodata = false): NormalizedAuditData => ({
    ...baseAudit,
    schema: { jsonLdBlocksCount, jsonLdBlocks: [], discoveredTypes: [], hasMicrodata, microdataTypes: [], findings: [] },
    findings: [],
  });

  assert.strictEqual(getDeterministicMockAiResult(auditWithSchema(2)).score_breakdown.schema, 95, ">=2 JSON-LD blocks produces 95");
  assert.strictEqual(getDeterministicMockAiResult(auditWithSchema(1)).score_breakdown.schema, 85, "1 JSON-LD block produces 85");
  assert.strictEqual(getDeterministicMockAiResult(auditWithSchema(0, true)).score_breakdown.schema, 70, "Microdata only produces 70");
  assert.strictEqual(getDeterministicMockAiResult(auditWithSchema(0, false)).score_breakdown.schema, 40, "No schema produces 40");
  console.log("  ✔ All Content Depth brackets, H2 subheading bonus, and Schema scoring thresholds verified.");

  // ---------------------------------------------------------------------------
  // 13. Component Precedence & Deterministic Invariance
  // ---------------------------------------------------------------------------
  console.log("\n[13/13] Testing Component Precedence and 100-iteration Scoring Invariance...");
  // Precedence overrides
  assert.strictEqual(isCrawlerMockActive(true), true, "Explicit override takes top precedence for crawler (true)");
  assert.strictEqual(isCrawlerMockActive(false), false, "Explicit override takes top precedence for crawler (false)");
  assert.strictEqual(isAiMockActive(true), true, "Explicit override takes top precedence for AI (true)");
  assert.strictEqual(isAiMockActive(false), false, "Explicit override takes top precedence for AI (false)");
  assert.strictEqual(isSeoProviderMockActive(true), true, "Explicit override takes top precedence for providers (true)");
  assert.strictEqual(isSeoProviderMockActive(false), false, "Explicit override takes top precedence for providers (false)");

  // 100-iteration Determinism Invariance Test (zero randomness check)
  const initialScore = getDeterministicMockAiResult(baseAudit);
  for (let i = 0; i < 100; i++) {
    const iterScore = getDeterministicMockAiResult(baseAudit);
    assert.strictEqual(iterScore.overall_score, initialScore.overall_score, `Iteration ${i} overall score must match`);
    assert.strictEqual(iterScore.score_breakdown.on_page, initialScore.score_breakdown.on_page);
    assert.strictEqual(iterScore.score_breakdown.content, initialScore.score_breakdown.content);
    assert.strictEqual(iterScore.score_breakdown.technical, initialScore.score_breakdown.technical);
    assert.strictEqual(iterScore.score_breakdown.core_web_vitals, initialScore.score_breakdown.core_web_vitals);
    assert.strictEqual(iterScore.score_breakdown.schema, initialScore.score_breakdown.schema);
  }
  console.log("  ✔ 100 consecutive scoring iterations verified 100% deterministic with zero variance.");

  await closeRedisConnections();
  console.log("\n==================================================================");
  console.log("✅ ALL 13 OPTION A REGRESSION & DETERMINISTIC TESTS PASSED!");
  console.log("==================================================================");
}

runOptionARegressionTests().catch(async (e) => {
  console.error("❌ Regression test failed:", e);
  await closeRedisConnections();
  process.exit(1);
});
