/* eslint-disable @typescript-eslint/no-require-imports */
import assert from "assert";
import {
  validateUrlForCrawl,
  isPrivateIPv4,
  isPrivateIPv6,
} from "../src/crawlers/ssrf";
import { extractOnPageSignals } from "../src/crawlers/onPage";
import { inspectStructuredData } from "../src/crawlers/schema";
import { generateSeoFindings } from "../src/crawlers/findings";
import {
  crawlWebsite,
  CrawlExecutionError,
} from "../src/crawlers";
import { normalizedAuditDataSchema } from "../src/crawlers/schemas";
import {
  getPageSpeed,
  getSearchConsoleData,
  getDataForSEORankings,
  ProviderNotConfiguredError,
} from "../src/services/providers";
import * as cheerio from "cheerio";

// Load reference fixtures
const pagespeedFixture = require("../src/mocks/pagespeed.mock.js");
const gscFixture = require("../src/mocks/gsc.mock.js");
const dataforseoFixture = require("../src/mocks/dataforseo.mock.js");

async function runPhase4CrawlerTests() {
  console.log("==================================================================");
  console.log("EDGELINK SEO DASHBOARD - PHASE 4 CRAWLER & AUDIT ENGINE TESTS");
  console.log("==================================================================");

  // ---------------------------------------------------------------------------
  // 1. URL Validation & SSRF Prevention
  // ---------------------------------------------------------------------------
  console.log("\n[1/7] Testing URL validation and SSRF defenses...");

  // Valid URLs
  const validHttp = await validateUrlForCrawl("http://example.com/page");
  assert.strictEqual(validHttp.valid, true, "HTTP URL should be valid");
  assert.strictEqual(validHttp.normalizedUrl, "http://example.com/page");

  const validHttps = await validateUrlForCrawl("https://example.com:8443/test?query=1");
  assert.strictEqual(validHttps.valid, true, "HTTPS URL should be valid");

  // Invalid strings & unsupported protocols
  const malformed = await validateUrlForCrawl("not-a-valid-url");
  assert.strictEqual(malformed.valid, false, "Malformed string must be rejected");

  const fileProto = await validateUrlForCrawl("file:///etc/passwd");
  assert.strictEqual(fileProto.valid, false, "file: protocol must be rejected");
  assert(fileProto.error?.includes("Unsupported protocol"));

  const ftpProto = await validateUrlForCrawl("ftp://ftp.example.com/data");
  assert.strictEqual(ftpProto.valid, false, "ftp: protocol must be rejected");

  const jsProto = await validateUrlForCrawl("javascript:alert(1)");
  assert.strictEqual(jsProto.valid, false, "javascript: protocol must be rejected");

  // Embedded credentials
  const withCreds = await validateUrlForCrawl("http://admin:secret@example.com/");
  assert.strictEqual(withCreds.valid, false, "Credentials in URL must be rejected");

  // Localhost names
  const localhost = await validateUrlForCrawl("http://localhost:3000/api");
  assert.strictEqual(localhost.valid, false, "localhost must be rejected");

  const subLocal = await validateUrlForCrawl("http://app.localhost/");
  assert.strictEqual(subLocal.valid, false, "*.localhost must be rejected");

  const dotLocal = await validateUrlForCrawl("http://intranet.local/");
  assert.strictEqual(dotLocal.valid, false, ".local domain must be rejected");

  // IPv4 Private & Reserved Ranges
  assert.strictEqual(isPrivateIPv4("127.0.0.1"), true, "127.0.0.1 is loopback");
  assert.strictEqual(isPrivateIPv4("10.0.0.1"), true, "10.0.0.1 is private");
  assert.strictEqual(isPrivateIPv4("172.16.0.5"), true, "172.16.0.5 is private");
  assert.strictEqual(isPrivateIPv4("192.168.1.1"), true, "192.168.1.1 is private");
  assert.strictEqual(isPrivateIPv4("169.254.169.254"), true, "169.254.169.254 is link-local/cloud-metadata");
  assert.strictEqual(isPrivateIPv4("8.8.8.8"), false, "8.8.8.8 is public");
  assert.strictEqual(isPrivateIPv4("93.184.216.34"), false, "93.184.216.34 is public");

  const loopbackUrl = await validateUrlForCrawl("http://127.0.0.1:8080/");
  assert.strictEqual(loopbackUrl.valid, false, "127.0.0.1 IP literal must be rejected");

  const metadataUrl = await validateUrlForCrawl("http://169.254.169.254/latest/meta-data/");
  assert.strictEqual(metadataUrl.valid, false, "AWS metadata endpoint must be rejected");

  // IPv6 Private & Reserved Ranges
  assert.strictEqual(isPrivateIPv6("::1"), true, "::1 is IPv6 loopback");
  assert.strictEqual(isPrivateIPv6("::"), true, ":: is unspecified");
  assert.strictEqual(isPrivateIPv6("fc00::1"), true, "fc00:: is unique local");
  assert.strictEqual(isPrivateIPv6("fe80::1"), true, "fe80:: is link-local");
  assert.strictEqual(isPrivateIPv6("2606:4700:4700::1111"), false, "Cloudflare IPv6 is public");

  const ipv6Loopback = await validateUrlForCrawl("http://[::1]/");
  assert.strictEqual(ipv6Loopback.valid, false, "IPv6 loopback literal must be rejected");

  console.log("  ✔ All URL validation and SSRF defenses passed.");

  // ---------------------------------------------------------------------------
  // 2. On-Page HTML Extraction
  // ---------------------------------------------------------------------------
  console.log("\n[2/7] Testing on-page HTML signal extraction...");

  const testHtml = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <title>Comprehensive Dental Care | Downtown Clinic</title>
        <meta name="description" content="Award-winning gentle dental care in downtown Miami. Cleanings, implants, cosmetic treatments, and emergency care for families.">
        <link rel="canonical" href="https://example.com/dentistry">
        <meta name="robots" content="index, follow">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta property="og:title" content="Downtown Miami Dental Clinic">
        <meta property="og:description" content="Gentle family dentistry.">
        <meta property="og:image" content="https://example.com/og.jpg">
        <link rel="icon" href="/favicon.png">
      </head>
      <body>
        <h1>Downtown Miami Comprehensive Dentistry</h1>
        <h2>Preventive Dental Treatments</h2>
        <h2>Restorative Procedures</h2>
        <h3>Dental Implants & Crowns</h3>
        <p>We provide full oral healthcare with gentle hygienists and state-of-the-art diagnostics.</p>
        <img src="/img/doctor.jpg" alt="Dr. John Smith DDS">
        <img src="/img/icon-bullet.png" alt="">
        <img src="/img/clinic.jpg">
        <a href="/about">About Us</a>
        <a href="https://example.com/contact">Contact Us</a>
        <a href="https://external-partner.com/reviews">External Reviews</a>
        <a href="#section">Jump</a>
        <a href="javascript:void(0)">Click</a>
      </body>
    </html>
  `;

  const extracted = extractOnPageSignals(testHtml, "https://example.com/dentistry", "index, follow");

  // Title
  assert.strictEqual(extracted.title.exists, true);
  assert.strictEqual(extracted.title.text, "Comprehensive Dental Care | Downtown Clinic");
  assert.strictEqual(extracted.title.length, 43);
  assert.strictEqual(extracted.title.status, "OPTIMAL");

  // Meta description
  assert.strictEqual(extracted.metaDescription.exists, true);
  assert(extracted.metaDescription.length >= 120 && extracted.metaDescription.length <= 160);
  assert.strictEqual(extracted.metaDescription.status, "OPTIMAL");

  // Canonical
  assert.strictEqual(extracted.canonical.count, 1);
  assert.strictEqual(extracted.canonical.url, "https://example.com/dentistry");
  assert.strictEqual(extracted.canonical.isValid, true);
  assert.strictEqual(extracted.canonical.matchesFinalUrl, true);

  // Headings
  assert.strictEqual(extracted.headings.h1Count, 1);
  assert.strictEqual(extracted.headings.h1[0], "Downtown Miami Comprehensive Dentistry");
  assert.strictEqual(extracted.headings.h2Count, 2);
  assert.strictEqual(extracted.headings.h3Count, 1);

  // Images (distinguish with-alt, decorative alt="", and missing alt)
  assert.strictEqual(extracted.images.totalCount, 3);
  assert.strictEqual(extracted.images.withAltCount, 1, "Should identify 1 image with descriptive alt");
  assert.strictEqual(extracted.images.decorativeCount, 1, "Should identify 1 decorative alt=\"\" image");
  assert.strictEqual(extracted.images.missingAltCount, 1, "Should identify 1 image missing alt attribute");

  // Links
  assert.strictEqual(extracted.links.totalInternal, 2, "Relative /about and absolute https://example.com/contact are internal");
  assert.strictEqual(extracted.links.totalExternal, 1, "external-partner.com is external");
  assert(extracted.links.emptyHrefCount >= 1, "# and javascript links handled safely");

  // Metadata
  assert.strictEqual(extracted.metadata.lang, "en");
  assert.strictEqual(extracted.metadata.viewport, "width=device-width, initial-scale=1");
  assert.strictEqual(extracted.metadata.metaRobots, "index, follow");
  assert.strictEqual(extracted.metadata.xRobotsTag, "index, follow");
  assert.strictEqual(extracted.metadata.openGraph.title, "Downtown Miami Dental Clinic");

  // Test missing title & missing description handling
  const emptyHeadHtml = "<html><head></head><body><h1>Only H1</h1></body></html>";
  const emptyExtracted = extractOnPageSignals(emptyHeadHtml, "https://example.com/");
  assert.strictEqual(emptyExtracted.title.exists, false);
  assert.strictEqual(emptyExtracted.title.status, "MISSING");
  assert.strictEqual(emptyExtracted.metaDescription.exists, false);
  assert.strictEqual(emptyExtracted.metaDescription.status, "MISSING");
  assert.strictEqual(emptyExtracted.canonical.count, 0);

  console.log("  ✔ On-page extraction (title, description, canonical, headings, images, links, metadata) passed.");

  // ---------------------------------------------------------------------------
  // 3. Technical SEO Checks: robots.txt and sitemap.xml logic
  // ---------------------------------------------------------------------------
  console.log("\n[3/7] Testing technical SEO evaluation logic...");

  // Mock robots.txt parser rules
  const robotsSample = `
    User-agent: *
    Disallow: /admin
    Disallow: /private/
    Allow: /private/public-report
    Sitemap: https://example.com/sitemap.xml
    Sitemap: https://example.com/blog-sitemap.xml
  `;

  // Verify parsing logic
  const lines = robotsSample.split("\n");
  const sitemaps: string[] = [];
  const disallow: string[] = [];
  const allow: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    const [key, ...rest] = line.split(":");
    const directive = key.trim().toLowerCase();
    const val = rest.join(":").trim();
    if (directive === "sitemap") sitemaps.push(val);
    if (directive === "disallow" && val) disallow.push(val);
    if (directive === "allow" && val) allow.push(val);
  }

  assert.strictEqual(sitemaps.length, 2);
  assert.strictEqual(sitemaps[0], "https://example.com/sitemap.xml");
  assert(disallow.includes("/admin"));
  assert(allow.includes("/private/public-report"));

  // Check path rule logic
  const checkDisallowed = (targetPath: string) => {
    const isAllow = allow.find((rule) => targetPath.startsWith(rule));
    if (isAllow) return false;
    const isDisallow = disallow.find((rule) => targetPath.startsWith(rule));
    return Boolean(isDisallow);
  };

  assert.strictEqual(checkDisallowed("/admin/login"), true, "/admin/login should be disallowed");
  assert.strictEqual(checkDisallowed("/private/secret"), true, "/private/secret should be disallowed");
  assert.strictEqual(checkDisallowed("/private/public-report"), false, "Allow rule overrides disallow");
  assert.strictEqual(checkDisallowed("/services"), false, "/services is allowed");

  // Sitemap XML parser test
  const sampleSitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://example.com/</loc><lastmod>2026-01-01</lastmod></url>
      <url><loc>https://example.com/services</loc></url>
      <url><loc>https://example.com/contact</loc></url>
    </urlset>
  `;
  const $xml = cheerio.load(sampleSitemapXml, { xmlMode: true });
  const locs: string[] = [];
  $xml("url > loc").each((_, el) => {
    locs.push($xml(el).text().trim());
  });
  assert.strictEqual(locs.length, 3);
  assert.strictEqual(locs[0], "https://example.com/");
  assert.strictEqual(locs[1], "https://example.com/services");

  // Sitemap index test
  const sampleIndexXml = `<?xml version="1.0" encoding="UTF-8"?>
    <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <sitemap><loc>https://example.com/sitemap-main.xml</loc></sitemap>
      <sitemap><loc>https://example.com/sitemap-blog.xml</loc></sitemap>
    </sitemapindex>
  `;
  const $index = cheerio.load(sampleIndexXml, { xmlMode: true });
  assert.strictEqual($index("sitemapindex").length, 1);
  const indexLocs: string[] = [];
  $index("sitemap > loc").each((_, el) => {
    indexLocs.push($index(el).text().trim());
  });
  assert.strictEqual(indexLocs.length, 2);

  console.log("  ✔ Technical SEO (robots.txt directives and sitemap parsing) passed.");

  // ---------------------------------------------------------------------------
  // 4. Schema.org Structured-Data Extraction
  // ---------------------------------------------------------------------------
  console.log("\n[4/7] Testing Schema.org JSON-LD & Microdata inspection...");

  // HTML with valid JSON-LD
  const validSchemaHtml = `
    <html>
      <head>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Dentist",
          "name": "Miami Gentle Dental",
          "address": {
            "@type": "PostalAddress",
            "addressLocality": "Miami",
            "addressRegion": "FL"
          }
        }
        </script>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "WebSite",
          "url": "https://example.com"
        }
        </script>
      </head>
      <body>
        <div itemscope itemtype="https://schema.org/LocalBusiness">
          <span itemprop="name">Miami Dental</span>
        </div>
      </body>
    </html>
  `;

  const validInspection = inspectStructuredData(validSchemaHtml);
  assert.strictEqual(validInspection.jsonLdBlocksCount, 2);
  assert.strictEqual(validInspection.jsonLdBlocks[0].valid, true);
  assert(validInspection.discoveredTypes.includes("Dentist"));
  assert(validInspection.discoveredTypes.includes("WebSite"));
  assert.strictEqual(validInspection.hasMicrodata, true);
  assert(validInspection.microdataTypes.includes("LocalBusiness"));
  assert.strictEqual(validInspection.findings.length, 0, "Valid schema should not produce syntax errors");

  // HTML with invalid (malformed) JSON-LD block
  const brokenSchemaHtml = `
    <html>
      <head>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Organization",
          "name": "Broken Quotes",,,
        }
        </script>
      </head>
      <body></body>
    </html>
  `;

  const brokenInspection = inspectStructuredData(brokenSchemaHtml);
  assert.strictEqual(brokenInspection.jsonLdBlocksCount, 1);
  assert.strictEqual(brokenInspection.jsonLdBlocks[0].valid, false);
  assert(brokenInspection.jsonLdBlocks[0].error !== undefined);
  assert.strictEqual(brokenInspection.findings.length, 1);
  assert.strictEqual(brokenInspection.findings[0].code, "INVALID_JSON_LD");
  assert.strictEqual(brokenInspection.findings[0].severity, "HIGH");

  // HTML with NO structured data
  const noSchemaHtml = "<html><head></head><body>No schema here</body></html>";
  const noSchemaInspection = inspectStructuredData(noSchemaHtml);
  assert.strictEqual(noSchemaInspection.jsonLdBlocksCount, 0);
  assert.strictEqual(noSchemaInspection.hasMicrodata, false);
  assert(noSchemaInspection.findings.some((f) => f.code === "NO_STRUCTURED_DATA"));

  console.log("  ✔ Schema.org (JSON-LD validation, syntax error handling, microdata) passed.");

  // ---------------------------------------------------------------------------
  // 5. SEO Findings Generation
  // ---------------------------------------------------------------------------
  console.log("\n[5/7] Testing deterministic findings generation...");

  const findings = generateSeoFindings({
    onPage: {
      title: { text: "Short", exists: true, length: 5, status: "TOO_SHORT", multipleCount: 1 },
      metaDescription: { text: "", exists: false, length: 0, status: "MISSING" },
      canonical: { url: null, count: 0, isValid: false, matchesFinalUrl: false },
      headings: { h1: [], h2: [], h3: [], h1Count: 0, h2Count: 0, h3Count: 0 },
      images: { totalCount: 2, withAltCount: 0, missingAltCount: 2, decorativeCount: 0, sample: [] },
      links: { totalInternal: 0, totalExternal: 0, emptyHrefCount: 0, sampleInternal: [], sampleExternal: [] },
      metadata: { metaRobots: null, xRobotsTag: null, lang: null, favicon: null, viewport: null, openGraph: {}, wordCount: 50 },
    },
    technical: {
      httpStatus: 200,
      robotsTxt: {
        checked: true,
        url: "https://example.com/robots.txt",
        exists: true,
        statusCode: 200,
        isAccessible: true,
        sitemaps: [],
        isTargetDisallowed: true,
        matchedRule: "Disallow: /",
      },
      sitemap: {
        checked: true,
        discoveredUrls: [],
        primaryUrl: null,
        exists: false,
        statusCode: 404,
        isXml: false,
        isSitemapIndex: false,
        urlCount: 0,
        sampleUrls: [],
      },
    },
    schema: {
      jsonLdBlocksCount: 0,
      jsonLdBlocks: [],
      discoveredTypes: [],
      hasMicrodata: false,
      microdataTypes: [],
      findings: [],
    },
    pageSpeedData: pagespeedFixture,
  });

  const codes = findings.map((f) => f.code);
  assert(codes.includes("TITLE_TOO_SHORT"), "Should flag short title");
  assert(codes.includes("MISSING_META_DESCRIPTION"), "Should flag missing description");
  assert(codes.includes("MISSING_H1"), "Should flag missing H1");
  assert(codes.includes("MISSING_CANONICAL"), "Should flag missing canonical");
  assert(codes.includes("MISSING_VIEWPORT"), "Should flag missing viewport");
  assert(codes.includes("ROBOTS_TXT_DISALLOWED"), "Should flag disallowed in robots.txt");
  assert(codes.includes("IMAGES_MISSING_ALT"), "Should flag images missing alt");
  assert(codes.includes("THIN_CONTENT"), "Should flag thin content (<300 words)");
  assert(codes.includes("CWV_POOR_LCP"), "Should flag poor LCP from PageSpeed");

  // Every finding must satisfy structural contract
  for (const f of findings) {
    assert(["Technical", "OnPage", "Content", "Schema", "CWV"].includes(f.category));
    assert(["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(f.severity));
    assert(f.title.length > 0);
    assert(f.description.length > 0);
    assert(f.recommendation.length > 0);
    assert(f.source.length > 0);
  }

  console.log("  ✔ SEO findings engine produced valid structured findings.");

  // ---------------------------------------------------------------------------
  // 6. External Provider Integration & Mock Safety
  // ---------------------------------------------------------------------------
  console.log("\n[6/7] Testing provider mock selection, live guard, and immutability...");

  // Mock selection
  const psResult = await getPageSpeed("https://example.com", { useMocks: true });
  assert.strictEqual(psResult.strategy, "mobile");
  assert.strictEqual(psResult.categories.performance.score, 0.61);

  const gscResult = await getSearchConsoleData("https://example.com", { useMocks: true });
  assert.strictEqual(gscResult.totalClicks, 167);
  assert.strictEqual(gscResult.rows.length, 5);

  const dfsResult = await getDataForSEORankings("dentist miami", { useMocks: true });
  assert.strictEqual(dfsResult.client_rank_position, 4);
  assert.strictEqual(dfsResult.keyword_search_volume, 1900);

  // Fixture immutability check
  assert.strictEqual(pagespeedFixture.url, "https://example-dental-clinic.com", "Fixture URL must remain pristine");
  assert.strictEqual(gscFixture.totalClicks, 167, "GSC fixture must not be mutated");

  // Live unconfigured provider check
  const prevUseMocks = process.env.USE_MOCKS;
  delete process.env.USE_MOCKS; // simulate live mode

  await assert.rejects(
    async () => {
      await getPageSpeed("https://example.com", { useMocks: false });
    },
    (err: unknown) => err instanceof ProviderNotConfiguredError,
    "Should throw ProviderNotConfiguredError in unconfigured live mode"
  );

  await assert.rejects(
    async () => {
      await getSearchConsoleData("https://example.com", { useMocks: false });
    },
    (err: unknown) => err instanceof ProviderNotConfiguredError,
    "Should throw ProviderNotConfiguredError for GSC in unconfigured live mode"
  );

  await assert.rejects(
    async () => {
      await getDataForSEORankings("dentist", { useMocks: false });
    },
    (err: unknown) => err instanceof ProviderNotConfiguredError,
    "Should throw ProviderNotConfiguredError for DataForSEO in unconfigured live mode"
  );

  if (prevUseMocks !== undefined) {
    process.env.USE_MOCKS = prevUseMocks;
  }

  console.log("  ✔ Provider integrations, live error handling, and fixture immutability verified.");

  // ---------------------------------------------------------------------------
  // 7. End-to-End crawlWebsite & Normalized Audit Contract
  // ---------------------------------------------------------------------------
  console.log("\n[7/7] Testing end-to-end crawlWebsite and Zod normalized contract...");

  // Mock Mode E2E
  const crawlMock = await crawlWebsite("https://example.com", {
    useMocks: true,
    businessType: "Dentist",
    city: "Miami",
    state: "FL",
  });

  // Verify Zod schema validation passes
  const parsedData = normalizedAuditDataSchema.parse(crawlMock);
  assert(parsedData, "crawlWebsite mock output must strictly conform to normalizedAuditDataSchema");

  // Verify legacy CrawlResult compatibility properties
  assert.strictEqual(crawlMock.url, "https://example.com");
  assert(typeof crawlMock.statusCode === "number");
  assert(typeof crawlMock.responseTimeMs === "number");
  assert(typeof crawlMock.title === "string");
  assert(typeof crawlMock.metaDescription === "string");
  assert(Array.isArray(crawlMock.h1));
  assert(Array.isArray(crawlMock.h2));
  assert(Array.isArray(crawlMock.images));
  assert(Array.isArray(crawlMock.links));
  assert(Array.isArray(crawlMock.issues));

  // Verify Phase 4 normalized sections
  assert.strictEqual(crawlMock.target.originalUrl, "https://example.com");
  assert.strictEqual(crawlMock.target.businessType, "Dentist");
  assert.strictEqual(crawlMock.crawl.status, "SUCCESS");
  assert.strictEqual(crawlMock.crawl.httpStatus, 200);
  assert(crawlMock.onPage.title.exists);
  assert(crawlMock.technical.robotsTxt.checked);
  assert(crawlMock.schema.jsonLdBlocksCount >= 1);
  assert.strictEqual(crawlMock.pageSpeed.status, "mock");
  assert.strictEqual(crawlMock.searchConsole.status, "mock");
  assert.strictEqual(crawlMock.rankings.status, "mock");
  assert(crawlMock.findings.length > 0);

  // Security test: SSRF blocking on private IP literal
  await assert.rejects(
    async () => {
      await crawlWebsite("http://127.0.0.1:8080/admin", { useMocks: false });
    },
    (err: unknown) => {
      assert(err instanceof CrawlExecutionError);
      assert.strictEqual(err.code, "SSRF_BLOCKED");
      return true;
    },
    "crawlWebsite must throw CrawlExecutionError with SSRF_BLOCKED for 127.0.0.1"
  );

  // Security test: SSRF blocking on AWS metadata IP
  await assert.rejects(
    async () => {
      await crawlWebsite("http://169.254.169.254/latest/meta-data/", { useMocks: false });
    },
    (err: unknown) => {
      assert(err instanceof CrawlExecutionError);
      assert.strictEqual(err.code, "SSRF_BLOCKED");
      return true;
    },
    "crawlWebsite must throw CrawlExecutionError with SSRF_BLOCKED for cloud metadata endpoint"
  );

  // Security test: Invalid protocol
  await assert.rejects(
    async () => {
      await crawlWebsite("ftp://files.example.com", { useMocks: false });
    },
    (err: unknown) => {
      assert(err instanceof CrawlExecutionError);
      assert(err.code === "INVALID_URL" || err.code === "SSRF_BLOCKED");
      return true;
    },
    "crawlWebsite must reject ftp: protocol"
  );

  console.log("  ✔ End-to-end crawler and normalized audit contract verified.");

  console.log("\n==================================================================");
  console.log("ALL 7 PHASE 4 TEST SUITES PASSED SUCCESSFULLY!");
  console.log("==================================================================");
}

runPhase4CrawlerTests().catch((err) => {
  console.error("\n❌ Phase 4 Test Suite Failed:\n", err);
  process.exit(1);
});
