import { z } from "zod";

export const crawlerInputSchema = z.object({
  targetUrl: z
    .string()
    .min(1, "Target URL is required")
    .refine(
      (val) => {
        try {
          const parsed = new URL(val);
          return parsed.protocol === "http:" || parsed.protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "Must be a valid URL with http: or https: protocol" }
    ),
  businessType: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  keyword: z.string().optional().nullable(),
  useMocks: z.boolean().optional(),
  timeoutMs: z.number().positive().max(60000).optional(),
});

export type CrawlerInput = z.infer<typeof crawlerInputSchema>;

export const crawlerFindingSchema = z.object({
  code: z.string(),
  category: z.enum(["Technical", "OnPage", "Content", "Schema", "CWV"]),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
  title: z.string(),
  description: z.string(),
  evidence: z.any().optional(),
  recommendation: z.string(),
  source: z.string(),
});

export const normalizedAuditDataSchema = z.object({
  // Legacy CrawlResult compatibility fields
  url: z.string(),
  statusCode: z.number(),
  responseTimeMs: z.number(),
  title: z.string(),
  metaDescription: z.string(),
  h1: z.array(z.string()),
  h2: z.array(z.string()),
  canonicalUrl: z.string().optional(),
  robotsTag: z.string().optional(),
  wordCount: z.number(),
  images: z.array(
    z.object({
      src: z.string(),
      alt: z.string(),
      hasAlt: z.boolean(),
    })
  ),
  links: z.array(
    z.object({
      href: z.string(),
      text: z.string(),
      isInternal: z.boolean(),
    })
  ),
  issues: z.array(
    z.object({
      type: z.enum(["error", "warning", "notice"]),
      code: z.string(),
      message: z.string(),
      target: z.string().optional(),
    })
  ),

  // Phase 4 Normalized Audit Data Sections
  target: z.object({
    originalUrl: z.string(),
    normalizedUrl: z.string(),
    finalUrl: z.string(),
    businessType: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
  }),
  crawl: z.object({
    status: z.enum([
      "SUCCESS",
      "FAILED",
      "REDIRECT_ERROR",
      "SECURITY_BLOCKED",
      "TIMEOUT",
    ]),
    httpStatus: z.number(),
    contentType: z.string(),
    durationMs: z.number(),
    fetchedAt: z.string(),
    redirectCount: z.number(),
    redirectTrail: z.array(z.string()),
    errors: z.array(z.string()),
  }),
  onPage: z.object({
    title: z.object({
      text: z.string(),
      exists: z.boolean(),
      length: z.number(),
      status: z.enum(["OPTIMAL", "TOO_SHORT", "TOO_LONG", "MISSING"]),
    }),
    metaDescription: z.object({
      text: z.string(),
      exists: z.boolean(),
      length: z.number(),
      status: z.enum(["OPTIMAL", "TOO_SHORT", "TOO_LONG", "MISSING"]),
    }),
    canonical: z.object({
      url: z.string().nullable(),
      count: z.number(),
      isValid: z.boolean(),
      matchesFinalUrl: z.boolean(),
    }),
    headings: z.object({
      h1: z.array(z.string()),
      h2: z.array(z.string()),
      h3: z.array(z.string()),
      h1Count: z.number(),
      h2Count: z.number(),
      h3Count: z.number(),
    }),
    images: z.object({
      totalCount: z.number(),
      withAltCount: z.number(),
      missingAltCount: z.number(),
      decorativeCount: z.number(),
      sample: z.array(
        z.object({
          src: z.string(),
          alt: z.string(),
          hasAlt: z.boolean(),
          isDecorative: z.boolean(),
        })
      ),
    }),
    links: z.object({
      totalInternal: z.number(),
      totalExternal: z.number(),
      emptyHrefCount: z.number(),
      sampleInternal: z.array(z.string()),
      sampleExternal: z.array(z.string()),
    }),
    metadata: z.object({
      metaRobots: z.string().nullable(),
      xRobotsTag: z.string().nullable(),
      lang: z.string().nullable(),
      favicon: z.string().nullable(),
      viewport: z.string().nullable(),
      openGraph: z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        image: z.string().optional(),
      }),
      wordCount: z.number(),
    }),
  }),
  technical: z.object({
    robotsTxt: z.object({
      checked: z.boolean(),
      url: z.string(),
      exists: z.boolean(),
      statusCode: z.number().nullable(),
      isAccessible: z.boolean(),
      sitemaps: z.array(z.string()),
      isTargetDisallowed: z.boolean(),
      matchedRule: z.string().optional(),
      rawContent: z.string().optional(),
      error: z.string().optional(),
    }),
    sitemap: z.object({
      checked: z.boolean(),
      discoveredUrls: z.array(z.string()),
      primaryUrl: z.string().nullable(),
      exists: z.boolean(),
      statusCode: z.number().nullable(),
      isXml: z.boolean(),
      isSitemapIndex: z.boolean(),
      urlCount: z.number(),
      sampleUrls: z.array(z.string()),
      error: z.string().optional(),
    }),
    indexabilitySignals: z.object({
      isIndexable: z.boolean(),
      reasons: z.array(z.string()),
    }),
    findings: z.array(crawlerFindingSchema),
  }),
  schema: z.object({
    jsonLdBlocksCount: z.number(),
    jsonLdBlocks: z.array(
      z.object({
        valid: z.boolean(),
        raw: z.string(),
        parsed: z.any().optional(),
        types: z.array(z.string()),
        error: z.string().optional(),
      })
    ),
    discoveredTypes: z.array(z.string()),
    hasMicrodata: z.boolean(),
    microdataTypes: z.array(z.string()),
    findings: z.array(crawlerFindingSchema),
  }),
  pageSpeed: z.object({
    status: z.enum(["available", "unavailable", "mock", "error"]),
    source: z.enum(["mock", "live", "none"]),
    data: z.any().nullable(),
    error: z.string().optional(),
  }),
  searchConsole: z.object({
    status: z.enum(["available", "unavailable", "mock", "error"]),
    source: z.enum(["mock", "live", "none"]),
    data: z.any().nullable(),
    error: z.string().optional(),
  }),
  rankings: z.object({
    status: z.enum(["available", "unavailable", "mock", "error"]),
    source: z.enum(["mock", "live", "none"]),
    data: z.any().nullable(),
    error: z.string().optional(),
  }),
  findings: z.array(crawlerFindingSchema),
});
