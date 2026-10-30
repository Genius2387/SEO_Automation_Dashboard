export type Role = "ADMIN" | "CLIENT";

export type AuditStatus =
  | "PENDING"
  | "QUEUED"
  | "CRAWLING"
  | "ANALYZING"
  | "COMPLETED"
  | "FAILED";

export interface CrawlIssue {
  type: "error" | "warning" | "notice";
  code: string;
  message: string;
  target?: string;
}

export interface CrawlResult {
  url: string;
  statusCode: number;
  responseTimeMs: number;
  title: string;
  metaDescription: string;
  h1: string[];
  h2: string[];
  canonicalUrl?: string;
  robotsTag?: string;
  wordCount: number;
  images: {
    src: string;
    alt: string;
    hasAlt: boolean;
  }[];
  links: {
    href: string;
    text: string;
    isInternal: boolean;
  }[];
  issues: CrawlIssue[];
}

export interface AIRecommendation {
  priority: "high" | "medium" | "low";
  category: "technical" | "content" | "on-page" | "performance";
  title: string;
  explanation: string;
  actionableSteps: string[];
}

export interface AIAnalysisResult {
  overallScore: number;
  categoryScores: {
    technical: number;
    content: number;
    userExperience: number;
  };
  summary: string;
  strengths: string[];
  weaknesses: string[];
  recommendations: AIRecommendation[];
  generatedAt: string;
}

export interface AuditJobData {
  auditId: string;
  targetUrl: string;
  businessType?: string | null;
  city?: string | null;
  state?: string | null;
  userId?: string | null;
  useMocks?: boolean;
}

export interface AuditRecord {
  id: string;
  targetUrl: string;
  businessType?: string | null;
  city?: string | null;
  state?: string | null;
  status: AuditStatus;
  score?: number | null;
  rawCrawlData?: CrawlResult | unknown;
  aiAnalysisData?: AIAnalysisResult | unknown;
  pdfReportUrl?: string | null;
  errorMessage?: string | null;
  completedAt?: Date | string | null;
  userId?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  persisted: boolean;
  storage: "database" | "in-memory-mock";
  deduplicated?: boolean;
}

export interface AuditInput {
  targetUrl: string;
  businessType?: string;
  city?: string;
  state?: string;
  userId?: string;
  useMocks?: boolean;
}

// -----------------------------------------------------------------------------
// Phase 3: External Integration Contracts & Mock Types
// -----------------------------------------------------------------------------

export interface PageSpeedCategories {
  performance: { score: number };
  seo: { score: number };
  accessibility: { score: number };
}

export interface PageSpeedAuditMetric {
  score: number;
  displayValue?: string;
  description?: string;
}

export interface PageSpeedResult {
  url: string;
  strategy: "mobile" | "desktop" | string;
  categories: PageSpeedCategories;
  audits: {
    "largest-contentful-paint": PageSpeedAuditMetric;
    "cumulative-layout-shift": PageSpeedAuditMetric;
    "interaction-to-next-paint": PageSpeedAuditMetric;
    "render-blocking-resources": PageSpeedAuditMetric;
    "unused-javascript": PageSpeedAuditMetric;
    [key: string]: PageSpeedAuditMetric;
  };
}

export interface GSCRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GSCResult {
  rows: GSCRow[];
  totalClicks: number;
  totalImpressions: number;
  indexCoverageErrors: number;
}

export interface DataForSEORankItem {
  type: string;
  rank_group: number;
  rank_absolute: number;
  domain: string;
}

export interface DataForSEOTask {
  result: {
    keyword: string;
    items: DataForSEORankItem[];
  }[];
}

export interface DataForSEOResult {
  tasks: DataForSEOTask[];
  client_rank_position: number;
  keyword_search_volume: number;
}

export interface WhatsAppSendResult {
  status: string;
  sid: string;
}

export interface ProviderOptions {
  useMocks?: boolean;
}

// -----------------------------------------------------------------------------
// Phase 4: Crawler, Technical Checks, and Normalized Audit Contract
// -----------------------------------------------------------------------------

export interface CrawlerFinding {
  code: string;
  category: "Technical" | "OnPage" | "Content" | "Schema" | "CWV";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  title: string;
  description: string;
  evidence?: string | number | boolean | Record<string, unknown> | unknown[];
  recommendation: string;
  source: string;
}

export interface RobotsTxtInspection {
  checked: boolean;
  url: string;
  exists: boolean;
  statusCode: number | null;
  isAccessible: boolean;
  sitemaps: string[];
  isTargetDisallowed: boolean;
  matchedRule?: string;
  rawContent?: string;
  error?: string;
}

export interface SitemapInspection {
  checked: boolean;
  discoveredUrls: string[];
  primaryUrl: string | null;
  exists: boolean;
  statusCode: number | null;
  isXml: boolean;
  isSitemapIndex: boolean;
  urlCount: number;
  sampleUrls: string[];
  error?: string;
}

export interface JsonLdBlock {
  valid: boolean;
  raw: string;
  parsed?: Record<string, unknown> | Record<string, unknown>[];
  types: string[];
  error?: string;
}

export interface SchemaOrgInspection {
  jsonLdBlocksCount: number;
  jsonLdBlocks: JsonLdBlock[];
  discoveredTypes: string[];
  hasMicrodata: boolean;
  microdataTypes: string[];
  findings: CrawlerFinding[];
}

export interface NormalizedAuditData extends CrawlResult {
  target: {
    originalUrl: string;
    normalizedUrl: string;
    finalUrl: string;
    businessType?: string | null;
    city?: string | null;
    state?: string | null;
  };
  crawl: {
    status: "SUCCESS" | "FAILED" | "REDIRECT_ERROR" | "SECURITY_BLOCKED" | "TIMEOUT";
    httpStatus: number;
    contentType: string;
    durationMs: number;
    fetchedAt: string;
    redirectCount: number;
    redirectTrail: string[];
    errors: string[];
  };
  onPage: {
    title: {
      text: string;
      exists: boolean;
      length: number;
      status: "OPTIMAL" | "TOO_SHORT" | "TOO_LONG" | "MISSING";
    };
    metaDescription: {
      text: string;
      exists: boolean;
      length: number;
      status: "OPTIMAL" | "TOO_SHORT" | "TOO_LONG" | "MISSING";
    };
    canonical: {
      url: string | null;
      count: number;
      isValid: boolean;
      matchesFinalUrl: boolean;
    };
    headings: {
      h1: string[];
      h2: string[];
      h3: string[];
      h1Count: number;
      h2Count: number;
      h3Count: number;
    };
    images: {
      totalCount: number;
      withAltCount: number;
      missingAltCount: number;
      decorativeCount: number;
      sample: {
        src: string;
        alt: string;
        hasAlt: boolean;
        isDecorative: boolean;
      }[];
    };
    links: {
      totalInternal: number;
      totalExternal: number;
      emptyHrefCount: number;
      sampleInternal: string[];
      sampleExternal: string[];
    };
    metadata: {
      metaRobots: string | null;
      xRobotsTag: string | null;
      lang: string | null;
      favicon: string | null;
      viewport: string | null;
      openGraph: {
        title?: string;
        description?: string;
        image?: string;
      };
      wordCount: number;
    };
  };
  technical: {
    robotsTxt: RobotsTxtInspection;
    sitemap: SitemapInspection;
    indexabilitySignals: {
      isIndexable: boolean;
      reasons: string[];
    };
    findings: CrawlerFinding[];
  };
  schema: SchemaOrgInspection;
  pageSpeed: {
    status: "available" | "unavailable" | "mock" | "error";
    source: "mock" | "live" | "none";
    data: PageSpeedResult | null;
    error?: string;
  };
  searchConsole: {
    status: "available" | "unavailable" | "mock" | "error";
    source: "mock" | "live" | "none";
    data: GSCResult | null;
    error?: string;
  };
  rankings: {
    status: "available" | "unavailable" | "mock" | "error";
    source: "mock" | "live" | "none";
    data: DataForSEOResult | null;
    error?: string;
  };
  findings: CrawlerFinding[];
}
