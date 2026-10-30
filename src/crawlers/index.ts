import {
  CrawlIssue,
  NormalizedAuditData,
  PageSpeedResult,
  GSCResult,
  DataForSEOResult,
} from "@/types";
import { mockCrawlData } from "@/mocks";
import { validateUrlForCrawl } from "./ssrf";
import { extractOnPageSignals } from "./onPage";
import { inspectRobotsTxt, inspectSitemap } from "./technical";
import { inspectStructuredData } from "./schema";
import { generateSeoFindings } from "./findings";
import { crawlerInputSchema, normalizedAuditDataSchema } from "./schemas";
import {
  getPageSpeed,
  getSearchConsoleData,
  getDataForSEORankings,
  isMockActive,
  ProviderNotConfiguredError,
} from "@/services/providers";

// Load mock fixtures for mock-mode fallback
/* eslint-disable @typescript-eslint/no-require-imports */
const pagespeedMock: PageSpeedResult = require("../mocks/pagespeed.mock.js");
const gscMock: GSCResult = require("../mocks/gsc.mock.js");
const dataforseoMock: DataForSEOResult = require("../mocks/dataforseo.mock.js");

export const CRAWLER_USER_AGENT =
  "EdgelinkSEOAuditBot/1.0 (+https://edgelink.tech/bot)";

export interface CrawlerOptions {
  timeoutMs?: number;
  useMocks?: boolean;
  businessType?: string;
  city?: string;
  state?: string;
  keyword?: string;
  maxRedirects?: number;
  maxSizeBytes?: number;
  throwOnError?: boolean;
}

export class CrawlExecutionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "SSRF_BLOCKED"
      | "INVALID_URL"
      | "DNS_FAILURE"
      | "TIMEOUT"
      | "HTTP_ERROR"
      | "OVERSIZED"
      | "REDIRECT_LOOP"
      | "UNSUPPORTED_CONTENT_TYPE"
      | "FETCH_ERROR",
    public readonly statusCode?: number,
    public readonly partialData?: Partial<NormalizedAuditData>
  ) {
    super(message);
    this.name = "CrawlExecutionError";
  }
}

/**
 * Maps high-level CrawlerFindings into legacy CrawlIssue objects
 */
function mapFindingsToLegacyIssues(data: NormalizedAuditData): CrawlIssue[] {
  return data.findings.map((f) => ({
    type:
      f.severity === "CRITICAL" || f.severity === "HIGH"
        ? "error"
        : f.severity === "MEDIUM"
        ? "warning"
        : "notice",
    code: f.code,
    message: `${f.title}: ${f.description}`,
    target: typeof f.evidence === "string" ? f.evidence : undefined,
  }));
}

/**
 * Primary SEO Crawler function.
 * Validates untrusted input, applies SSRF prevention, executes bounded crawl,
 * extracts on-page signals, inspects technical SEO files (robots.txt, sitemap.xml),
 * detects Schema.org structured data, integrates external providers, and returns
 * a strictly normalized audit payload compatible with downstream Claude analysis.
 */
export async function crawlWebsite(
  targetUrl: string,
  options: CrawlerOptions = {}
): Promise<NormalizedAuditData> {
  const throwOnError = options.throwOnError !== false;
  const timeoutMs = options.timeoutMs || 15000;
  const maxRedirects = options.maxRedirects ?? 5;
  const maxSizeBytes = options.maxSizeBytes ?? 5 * 1024 * 1024; // 5 MB

  // 1. Validate input structure with Zod
  const inputValidation = crawlerInputSchema.safeParse({
    targetUrl,
    businessType: options.businessType,
    city: options.city,
    state: options.state,
    keyword: options.keyword,
    useMocks: options.useMocks,
    timeoutMs: options.timeoutMs,
  });

  if (!inputValidation.success) {
    const errorMsg = inputValidation.error.issues.map((e) => e.message).join("; ");
    if (throwOnError) {
      throw new CrawlExecutionError(errorMsg, "INVALID_URL");
    }
  }

  const isMock = isMockActive(options.useMocks);

  // ---------------------------------------------------------------------------
  // 2. Fast Path: Mock Mode Execution
  // ---------------------------------------------------------------------------
  if (isMock) {
    const normalizedUrl = targetUrl;
    const mockOnPage = {
      title: {
        text: mockCrawlData.title,
        exists: Boolean(mockCrawlData.title),
        length: mockCrawlData.title.length,
        status: "OPTIMAL" as const,
      },
      metaDescription: {
        text: mockCrawlData.metaDescription,
        exists: Boolean(mockCrawlData.metaDescription),
        length: mockCrawlData.metaDescription.length,
        status: "OPTIMAL" as const,
      },
      canonical: {
        url: mockCrawlData.canonicalUrl || targetUrl,
        count: 1,
        isValid: true,
        matchesFinalUrl: true,
      },
      headings: {
        h1: mockCrawlData.h1,
        h2: mockCrawlData.h2,
        h3: ["Gentle Pediatric Care", "Emergency Same-Day Appointments"],
        h1Count: mockCrawlData.h1.length,
        h2Count: mockCrawlData.h2.length,
        h3Count: 2,
      },
      images: {
        totalCount: mockCrawlData.images.length,
        withAltCount: mockCrawlData.images.filter((i) => i.hasAlt).length,
        missingAltCount: mockCrawlData.images.filter((i) => !i.hasAlt).length,
        decorativeCount: 0,
        sample: mockCrawlData.images.map((i) => ({
          src: i.src,
          alt: i.alt,
          hasAlt: i.hasAlt,
          isDecorative: false,
        })),
      },
      links: {
        totalInternal: mockCrawlData.links.filter((l) => l.isInternal).length,
        totalExternal: mockCrawlData.links.filter((l) => !l.isInternal).length,
        emptyHrefCount: 0,
        sampleInternal: mockCrawlData.links
          .filter((l) => l.isInternal)
          .map((l) => l.href),
        sampleExternal: mockCrawlData.links
          .filter((l) => !l.isInternal)
          .map((l) => l.href),
      },
      metadata: {
        metaRobots: mockCrawlData.robotsTag || "index, follow",
        xRobotsTag: null,
        lang: "en",
        favicon: "/favicon.ico",
        viewport: "width=device-width, initial-scale=1",
        openGraph: {
          title: mockCrawlData.title,
          description: mockCrawlData.metaDescription,
          image: "https://example-dental-clinic.com/og-image.jpg",
        },
        wordCount: mockCrawlData.wordCount,
      },
    };

    const mockTechnical = {
      robotsTxt: {
        checked: true,
        url: `${targetUrl}/robots.txt`,
        exists: true,
        statusCode: 200,
        isAccessible: true,
        sitemaps: [`${targetUrl}/sitemap.xml`],
        isTargetDisallowed: false,
        rawContent: "User-agent: *\nDisallow: /admin\nSitemap: /sitemap.xml",
      },
      sitemap: {
        checked: true,
        discoveredUrls: [`${targetUrl}/sitemap.xml`],
        primaryUrl: `${targetUrl}/sitemap.xml`,
        exists: true,
        statusCode: 200,
        isXml: true,
        isSitemapIndex: false,
        urlCount: 15,
        sampleUrls: [
          `${targetUrl}/`,
          `${targetUrl}/about`,
          `${targetUrl}/services`,
          `${targetUrl}/contact`,
        ],
      },
      indexabilitySignals: {
        isIndexable: true,
        reasons: [],
      },
      findings: [],
    };

    const mockSchema = {
      jsonLdBlocksCount: 1,
      jsonLdBlocks: [
        {
          valid: true,
          raw: '{"@context":"https://schema.org","@type":"Dentist","name":"Bright Smile Dental"}',
          parsed: {
            "@context": "https://schema.org",
            "@type": "Dentist",
            name: "Bright Smile Dental",
          },
          types: ["Dentist"],
        },
      ],
      discoveredTypes: ["Dentist"],
      hasMicrodata: false,
      microdataTypes: [],
      findings: [],
    };

    const mockNormalized: NormalizedAuditData = {
      // Legacy CrawlResult properties
      url: targetUrl,
      statusCode: mockCrawlData.statusCode,
      responseTimeMs: mockCrawlData.responseTimeMs,
      title: mockCrawlData.title,
      metaDescription: mockCrawlData.metaDescription,
      h1: mockCrawlData.h1,
      h2: mockCrawlData.h2,
      canonicalUrl: mockCrawlData.canonicalUrl,
      robotsTag: mockCrawlData.robotsTag,
      wordCount: mockCrawlData.wordCount,
      images: mockCrawlData.images,
      links: mockCrawlData.links,
      issues: mockCrawlData.issues,

      // Phase 4 Normalized Audit Data Sections
      target: {
        originalUrl: targetUrl,
        normalizedUrl,
        finalUrl: targetUrl,
        businessType: options.businessType || "Dentist",
        city: options.city || "Miami",
        state: options.state || "FL",
      },
      crawl: {
        status: "SUCCESS",
        httpStatus: mockCrawlData.statusCode,
        contentType: "text/html; charset=UTF-8",
        durationMs: mockCrawlData.responseTimeMs,
        fetchedAt: new Date().toISOString(),
        redirectCount: 0,
        redirectTrail: [],
        errors: [],
      },
      onPage: mockOnPage,
      technical: mockTechnical,
      schema: mockSchema,
      pageSpeed: {
        status: "mock",
        source: "mock",
        data: pagespeedMock,
      },
      searchConsole: {
        status: "mock",
        source: "mock",
        data: gscMock,
      },
      rankings: {
        status: "mock",
        source: "mock",
        data: dataforseoMock,
      },
      findings: [],
    };

    // Generate findings using findings engine
    mockNormalized.findings = generateSeoFindings({
      onPage: {
        ...mockOnPage,
        title: { ...mockOnPage.title, multipleCount: 1 },
      },
      technical: {
        httpStatus: mockCrawlData.statusCode,
        robotsTxt: mockTechnical.robotsTxt,
        sitemap: mockTechnical.sitemap,
      },
      schema: mockSchema,
      pageSpeedData: pagespeedMock,
    });
    mockNormalized.issues = mapFindingsToLegacyIssues(mockNormalized);

    return normalizedAuditDataSchema.parse(mockNormalized) as NormalizedAuditData;
  }

  // ---------------------------------------------------------------------------
  // 3. Live Crawl Mode: URL Validation & SSRF Guard (protocols, private IPs, loopback, metadata)
  // ---------------------------------------------------------------------------
  const ssrfValidation = await validateUrlForCrawl(targetUrl);
  if (!ssrfValidation.valid) {
    const errorMsg = ssrfValidation.error || "SSRF policy rejection";
    if (throwOnError) {
      throw new CrawlExecutionError(errorMsg, "SSRF_BLOCKED");
    }
  }

  const normalizedUrl = ssrfValidation.normalizedUrl || targetUrl;

  // ---------------------------------------------------------------------------
  // 4. Live Crawl Mode: HTTP Request with Manual Redirect Validation & SSRF Guard
  // ---------------------------------------------------------------------------
  const startTime = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let currentUrl = normalizedUrl;
  let redirectCount = 0;
  const redirectTrail: string[] = [];

  try {
    let response: Response | null = null;
    let finalHtml = "";
    let contentType = "";
    let statusCode = 0;
    let xRobotsHeader: string | null = null;

    while (redirectCount <= maxRedirects) {
      try {
        response = await fetch(currentUrl, {
          signal: controller.signal,
          redirect: "manual",
          headers: {
            "User-Agent": CRAWLER_USER_AGENT,
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
          },
        });
      } catch (fetchErr: unknown) {
        const isAbort =
          fetchErr instanceof Error && fetchErr.name === "AbortError";
        const code = isAbort ? "TIMEOUT" : "FETCH_ERROR";
        const message = isAbort
          ? `Crawl request timed out after ${timeoutMs}ms.`
          : `Network error connecting to '${currentUrl}': ${
              fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
            }`;
        throw new CrawlExecutionError(message, code);
      }

      statusCode = response.status;
      contentType = response.headers.get("content-type") || "";
      xRobotsHeader = response.headers.get("x-robots-tag");

      // Handle HTTP redirects (301, 302, 303, 307, 308)
      if (
        statusCode === 301 ||
        statusCode === 302 ||
        statusCode === 303 ||
        statusCode === 307 ||
        statusCode === 308
      ) {
        const locationHeader = response.headers.get("location");
        if (!locationHeader) {
          throw new CrawlExecutionError(
            `Received redirect status ${statusCode} with no Location header.`,
            "REDIRECT_LOOP",
            statusCode
          );
        }

        let nextUrl: string;
        try {
          nextUrl = new URL(locationHeader, currentUrl).href;
        } catch {
          throw new CrawlExecutionError(
            `Invalid redirect target URL: '${locationHeader}'`,
            "INVALID_URL",
            statusCode
          );
        }

        // Loop detection
        if (redirectTrail.includes(nextUrl) || nextUrl === currentUrl) {
          throw new CrawlExecutionError(
            `Redirect loop detected: '${nextUrl}' was already visited.`,
            "REDIRECT_LOOP",
            statusCode
          );
        }

        redirectTrail.push(currentUrl);
        redirectCount++;

        if (redirectCount > maxRedirects) {
          throw new CrawlExecutionError(
            `Exceeded maximum permitted redirects limit (${maxRedirects}).`,
            "REDIRECT_LOOP",
            statusCode
          );
        }

        // Revalidate destination URL against SSRF policy before making the next hop
        const redirectSsrf = await validateUrlForCrawl(nextUrl);
        if (!redirectSsrf.valid) {
          throw new CrawlExecutionError(
            `Redirect to '${nextUrl}' rejected by security policy: ${
              redirectSsrf.error || "SSRF protection"
            }`,
            "SSRF_BLOCKED",
            statusCode
          );
        }

        currentUrl = redirectSsrf.normalizedUrl;
        continue;
      }

      // Reached final destination
      break;
    }

    if (!response) {
      throw new CrawlExecutionError("Failed to obtain HTTP response.", "FETCH_ERROR");
    }

    const durationMs = Date.now() - startTime;

    // Check for HTTP 4xx or 5xx error responses
    if (statusCode >= 400) {
      const errorMsg = `Target website returned HTTP status ${statusCode}.`;
      if (throwOnError) {
        throw new CrawlExecutionError(errorMsg, "HTTP_ERROR", statusCode);
      }
    }

    // Verify response content type is HTML
    const isHtml =
      contentType.toLowerCase().includes("text/html") ||
      contentType.toLowerCase().includes("application/xhtml+xml");

    if (!isHtml && statusCode < 400) {
      const errorMsg = `Unsupported Content-Type '${contentType}'. Crawler expects text/html.`;
      if (throwOnError) {
        throw new CrawlExecutionError(
          errorMsg,
          "UNSUPPORTED_CONTENT_TYPE",
          statusCode
        );
      }
    }

    // Read response text with size limit
    const rawText = await response.text();
    if (rawText.length > maxSizeBytes) {
      throw new CrawlExecutionError(
        `Response size (${rawText.length} bytes) exceeds maximum limit of ${maxSizeBytes} bytes.`,
        "OVERSIZED",
        statusCode
      );
    }
    finalHtml = rawText;

    if (!finalHtml.trim() && statusCode < 400) {
      throw new CrawlExecutionError(
        "Target website returned an empty HTML document.",
        "FETCH_ERROR",
        statusCode
      );
    }

    // -------------------------------------------------------------------------
    // 5. On-Page Extraction
    // -------------------------------------------------------------------------
    const onPage = extractOnPageSignals(finalHtml, currentUrl, xRobotsHeader);

    // -------------------------------------------------------------------------
    // 6. Technical Checks: robots.txt and sitemap.xml
    // -------------------------------------------------------------------------
    const robotsTxt = await inspectRobotsTxt(currentUrl, 8000);
    const sitemap = await inspectSitemap(currentUrl, robotsTxt.sitemaps, 8000);

    // Indexability evaluation
    const indexabilityReasons: string[] = [];
    let isIndexable = statusCode === 200;

    if (statusCode !== 200) {
      indexabilityReasons.push(`HTTP status is ${statusCode} instead of 200 OK.`);
    }

    const metaRobotsLower = (onPage.metadata.metaRobots || "").toLowerCase();
    const xRobotsLower = (xRobotsHeader || "").toLowerCase();

    if (
      metaRobotsLower.includes("noindex") ||
      xRobotsLower.includes("noindex")
    ) {
      isIndexable = false;
      indexabilityReasons.push("Page specifies a 'noindex' directive.");
    }

    if (robotsTxt.isTargetDisallowed) {
      isIndexable = false;
      indexabilityReasons.push(
        `robots.txt disallows crawler access: ${
          robotsTxt.matchedRule || "Disallow"
        }`
      );
    }

    const technical = {
      robotsTxt,
      sitemap,
      indexabilitySignals: {
        isIndexable,
        reasons: indexabilityReasons,
      },
      findings: [],
    };

    // -------------------------------------------------------------------------
    // 7. Schema.org Structured Data Inspection
    // -------------------------------------------------------------------------
    const schema = inspectStructuredData(finalHtml);

    // -------------------------------------------------------------------------
    // 8. External Mock Providers Integration
    // -------------------------------------------------------------------------
    // PageSpeed Insights
    let pageSpeedEntry: NormalizedAuditData["pageSpeed"] = {
      status: "unavailable",
      source: "none",
      data: null,
    };
    try {
      const ps = await getPageSpeed(currentUrl, { useMocks: options.useMocks });
      pageSpeedEntry = {
        status: isMock ? "mock" : "available",
        source: isMock ? "mock" : "live",
        data: ps,
      };
    } catch (err: unknown) {
      pageSpeedEntry = {
        status:
          err instanceof ProviderNotConfiguredError ? "unavailable" : "error",
        source: "none",
        data: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // Google Search Console
    let gscEntry: NormalizedAuditData["searchConsole"] = {
      status: "unavailable",
      source: "none",
      data: null,
    };
    try {
      const gsc = await getSearchConsoleData(currentUrl, {
        useMocks: options.useMocks,
      });
      gscEntry = {
        status: isMock ? "mock" : "available",
        source: isMock ? "mock" : "live",
        data: gsc,
      };
    } catch (err: unknown) {
      gscEntry = {
        status:
          err instanceof ProviderNotConfiguredError ? "unavailable" : "error",
        source: "none",
        data: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // DataForSEO Rankings
    const searchKeyword =
      options.keyword ||
      (options.businessType
        ? `${options.businessType} ${options.city || ""}`.trim()
        : "dentist miami");

    let rankingsEntry: NormalizedAuditData["rankings"] = {
      status: "unavailable",
      source: "none",
      data: null,
    };
    try {
      const dfs = await getDataForSEORankings(searchKeyword, {
        useMocks: options.useMocks,
      });
      rankingsEntry = {
        status: isMock ? "mock" : "available",
        source: isMock ? "mock" : "live",
        data: dfs,
      };
    } catch (err: unknown) {
      rankingsEntry = {
        status:
          err instanceof ProviderNotConfiguredError ? "unavailable" : "error",
        source: "none",
        data: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // -------------------------------------------------------------------------
    // 9. Structured Findings Generation
    // -------------------------------------------------------------------------
    const findings = generateSeoFindings({
      onPage,
      technical: {
        httpStatus: statusCode,
        robotsTxt,
        sitemap,
      },
      schema,
      pageSpeedData: pageSpeedEntry.data,
    });

    // -------------------------------------------------------------------------
    // 10. Assemble & Validate Normalized Output Contract
    // -------------------------------------------------------------------------
    const normalizedData: NormalizedAuditData = {
      // Legacy CrawlResult compatibility
      url: currentUrl,
      statusCode,
      responseTimeMs: durationMs,
      title: onPage.title.text,
      metaDescription: onPage.metaDescription.text,
      h1: onPage.headings.h1,
      h2: onPage.headings.h2,
      canonicalUrl: onPage.canonical.url || undefined,
      robotsTag: onPage.metadata.metaRobots || undefined,
      wordCount: onPage.metadata.wordCount,
      images: onPage.images.sample.map((img) => ({
        src: img.src,
        alt: img.alt,
        hasAlt: img.hasAlt,
      })),
      links: onPage.links.sampleInternal
        .map((href) => ({ href, text: "", isInternal: true }))
        .concat(
          onPage.links.sampleExternal.map((href) => ({
            href,
            text: "",
            isInternal: false,
          }))
        ),
      issues: [],

      // Phase 4 Normalized Audit Data Sections
      target: {
        originalUrl: targetUrl,
        normalizedUrl,
        finalUrl: currentUrl,
        businessType: options.businessType || null,
        city: options.city || null,
        state: options.state || null,
      },
      crawl: {
        status: "SUCCESS",
        httpStatus: statusCode,
        contentType,
        durationMs,
        fetchedAt: new Date().toISOString(),
        redirectCount,
        redirectTrail,
        errors: [],
      },
      onPage: {
        title: {
          text: onPage.title.text,
          exists: onPage.title.exists,
          length: onPage.title.length,
          status: onPage.title.status,
        },
        metaDescription: {
          text: onPage.metaDescription.text,
          exists: onPage.metaDescription.exists,
          length: onPage.metaDescription.length,
          status: onPage.metaDescription.status,
        },
        canonical: onPage.canonical,
        headings: onPage.headings,
        images: onPage.images,
        links: onPage.links,
        metadata: onPage.metadata,
      },
      technical,
      schema,
      pageSpeed: pageSpeedEntry,
      searchConsole: gscEntry,
      rankings: rankingsEntry,
      findings,
    };

    normalizedData.issues = mapFindingsToLegacyIssues(normalizedData);

    // Validate against Zod schema at service boundary
    return normalizedAuditDataSchema.parse(
      normalizedData
    ) as NormalizedAuditData;
  } finally {
    clearTimeout(timer);
  }
}

// Re-export submodules for clean modular imports
export * from "./ssrf";
export * from "./onPage";
export * from "./technical";
export * from "./schema";
export * from "./findings";
export * from "./schemas";
