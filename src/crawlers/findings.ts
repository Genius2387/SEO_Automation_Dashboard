import {
  CrawlerFinding,
  PageSpeedResult,
  RobotsTxtInspection,
  SitemapInspection,
  SchemaOrgInspection,
} from "@/types";
import { OnPageExtractionResult } from "./onPage";

export function generateSeoFindings(input: {
  onPage: OnPageExtractionResult;
  technical: {
    httpStatus: number;
    robotsTxt: RobotsTxtInspection;
    sitemap: SitemapInspection;
  };
  schema: SchemaOrgInspection;
  pageSpeedData?: PageSpeedResult | null;
}): CrawlerFinding[] {
  const findings: CrawlerFinding[] = [];
  const { onPage, technical, schema, pageSpeedData } = input;

  // ---------------------------------------------------------------------------
  // 1. On-Page Findings (Title, Meta, Headings, Content)
  // ---------------------------------------------------------------------------
  if (!onPage.title.exists) {
    findings.push({
      code: "MISSING_TITLE",
      category: "OnPage",
      severity: "CRITICAL",
      title: "Page Missing HTML <title> Tag",
      description: "Search engines and browser tabs rely on the title element to determine page topic and display snippet headlines.",
      evidence: "Title tag is absent or blank",
      recommendation: "Add a concise, descriptive title tag (between 30 and 60 characters) communicating the primary subject of the page.",
      source: "OnPageAuditor",
    });
  } else {
    if (onPage.title.multipleCount > 1) {
      findings.push({
        code: "MULTIPLE_TITLES",
        category: "OnPage",
        severity: "HIGH",
        title: `Multiple <title> Tags Detected (${onPage.title.multipleCount})`,
        description: "Declaring multiple title elements causes crawler ambiguity and erratic search engine snippet rendering.",
        evidence: `Found ${onPage.title.multipleCount} title elements`,
        recommendation: "Consolidate into a single definitive <title> element inside the HTML <head>.",
        source: "OnPageAuditor",
      });
    }

    if (onPage.title.status === "TOO_SHORT") {
      findings.push({
        code: "TITLE_TOO_SHORT",
        category: "OnPage",
        severity: "LOW",
        title: "Title Length Under 30 Characters",
        description: `Title length (${onPage.title.length} characters) is short and may miss relevant search queries.`,
        evidence: `Title: "${onPage.title.text}" (${onPage.title.length} chars)`,
        recommendation: "Expand the title with primary brand or service terms up to 50-60 characters.",
        source: "OnPageAuditor",
      });
    } else if (onPage.title.status === "TOO_LONG") {
      findings.push({
        code: "TITLE_TOO_LONG",
        category: "OnPage",
        severity: "LOW",
        title: "Title Length Exceeds 60 Characters",
        description: `Title length (${onPage.title.length} characters) exceeds the conventional ~60 character desktop SERP display limit.`,
        evidence: `Length: ${onPage.title.length} chars`,
        recommendation: "Ensure primary keywords and branding are placed within the first 60 characters to avoid snippet truncation.",
        source: "OnPageAuditor",
      });
    }
  }

  // Meta Description
  if (!onPage.metaDescription.exists) {
    findings.push({
      code: "MISSING_META_DESCRIPTION",
      category: "OnPage",
      severity: "HIGH",
      title: "Missing Meta Description",
      description: "Meta description provides search engines with a primary summary candidate for search snippet results.",
      evidence: 'No meta[name="description"] element found',
      recommendation: "Craft a compelling meta description between 120 and 160 characters summarizing the page value proposition.",
      source: "OnPageAuditor",
    });
  } else if (onPage.metaDescription.status === "TOO_SHORT") {
    findings.push({
      code: "META_DESCRIPTION_TOO_SHORT",
      category: "OnPage",
      severity: "LOW",
      title: "Short Meta Description",
      description: `Meta description is ${onPage.metaDescription.length} characters, which is shorter than the recommended 120-160 character range.`,
      evidence: `Length: ${onPage.metaDescription.length} chars`,
      recommendation: "Expand the description with descriptive details and a call to action.",
      source: "OnPageAuditor",
    });
  } else if (onPage.metaDescription.status === "TOO_LONG") {
    findings.push({
      code: "META_DESCRIPTION_TOO_LONG",
      category: "OnPage",
      severity: "LOW",
      title: "Long Meta Description",
      description: `Meta description is ${onPage.metaDescription.length} characters and may be truncated in search results.`,
      evidence: `Length: ${onPage.metaDescription.length} chars`,
      recommendation: "Keep the summary concise and focused under 160 characters.",
      source: "OnPageAuditor",
    });
  }

  // Headings
  if (onPage.headings.h1Count === 0) {
    findings.push({
      code: "MISSING_H1",
      category: "OnPage",
      severity: "HIGH",
      title: "Missing Main <h1> Heading",
      description: "An <h1> heading is a primary topical signal for screen readers, users, and search crawlers.",
      evidence: "0 <h1> elements found",
      recommendation: "Include a single, prominent <h1> tag reflecting the page's core theme.",
      source: "OnPageAuditor",
    });
  } else if (onPage.headings.h1Count > 1) {
    findings.push({
      code: "MULTIPLE_H1",
      category: "OnPage",
      severity: "MEDIUM",
      title: `Multiple <h1> Headings Found (${onPage.headings.h1Count})`,
      description: "While modern HTML5 supports multiple H1s, best practice favors one primary <h1> per document for clear hierarchy.",
      evidence: onPage.headings.h1,
      recommendation: "Reserve <h1> for the main page subject and use <h2>/<h3> for secondary sub-topics.",
      source: "OnPageAuditor",
    });
  }

  // Images
  if (onPage.images.missingAltCount > 0) {
    findings.push({
      code: "IMAGES_MISSING_ALT",
      category: "OnPage",
      severity: "MEDIUM",
      title: `${onPage.images.missingAltCount} Images Missing Alt Text`,
      description: "Images without an alt attribute hinder accessibility and prevent search engines from indexing visual content.",
      evidence: `${onPage.images.missingAltCount} of ${onPage.images.totalCount} images lack an alt attribute`,
      recommendation: "Add descriptive alt attributes to informative images, or use alt=\"\" for purely decorative graphics.",
      source: "OnPageAuditor",
    });
  }

  // Word count / Thin content
  if (onPage.metadata.wordCount < 300) {
    findings.push({
      code: "THIN_CONTENT",
      category: "Content",
      severity: "MEDIUM",
      title: "Low Text Content Volume (<300 words)",
      description: `Page text contains approximately ${onPage.metadata.wordCount} words. Informational pages generally rank better with substantial depth.`,
      evidence: `Word count: ${onPage.metadata.wordCount}`,
      recommendation: "Expand the page with comprehensive, helpful text addressing search intent.",
      source: "OnPageAuditor",
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Technical SEO Findings (Canonical, Robots, Sitemap, Viewport)
  // ---------------------------------------------------------------------------
  if (onPage.canonical.count === 0) {
    findings.push({
      code: "MISSING_CANONICAL",
      category: "Technical",
      severity: "MEDIUM",
      title: "Missing Canonical URL Declaration",
      description: "Self-referencing canonical tags prevent duplicate content issues caused by URL query parameters or alternate protocols.",
      evidence: "No link[rel='canonical'] tag found",
      recommendation: "Add a canonical link tag matching the authoritative version of this URL.",
      source: "TechnicalAuditor",
    });
  } else if (onPage.canonical.count > 1) {
    findings.push({
      code: "MULTIPLE_CANONICALS",
      category: "Technical",
      severity: "HIGH",
      title: `Multiple Canonical Tags Found (${onPage.canonical.count})`,
      description: "Declaring contradictory canonical tags can lead search engines to ignore all canonical signals.",
      evidence: `Found ${onPage.canonical.count} canonical declarations`,
      recommendation: "Keep exactly one canonical link element in the document head.",
      source: "TechnicalAuditor",
    });
  }

  if (!onPage.metadata.viewport) {
    findings.push({
      code: "MISSING_VIEWPORT",
      category: "Technical",
      severity: "HIGH",
      title: "Missing Viewport Tag",
      description: "Without a meta viewport tag, mobile browsers will render the desktop version, degrading mobile usability.",
      evidence: "No meta[name='viewport'] detected",
      recommendation: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
      source: "TechnicalAuditor",
    });
  }

  if (!onPage.metadata.lang) {
    findings.push({
      code: "MISSING_HTML_LANG",
      category: "Technical",
      severity: "LOW",
      title: "Missing HTML lang Attribute",
      description: "Declaring the document language assists search engines and screen readers with localization.",
      evidence: "<html lang> attribute is absent",
      recommendation: 'Specify the primary document language (e.g., <html lang="en">).',
      source: "TechnicalAuditor",
    });
  }

  // Robots.txt
  if (technical.robotsTxt.checked) {
    if (technical.robotsTxt.isTargetDisallowed) {
      findings.push({
        code: "ROBOTS_TXT_DISALLOWED",
        category: "Technical",
        severity: "CRITICAL",
        title: "Target URL Disallowed by robots.txt",
        description: `Target path matches disallow directive in site's robots.txt: ${technical.robotsTxt.matchedRule || "Disallowed"}`,
        evidence: technical.robotsTxt.matchedRule || "Disallow rule active",
        recommendation: "Review robots.txt directives if this page is intended to be indexed and crawled by search engines.",
        source: "TechnicalAuditor",
      });
    }

    if (technical.robotsTxt.exists && technical.robotsTxt.sitemaps.length === 0) {
      findings.push({
        code: "NO_SITEMAP_IN_ROBOTS",
        category: "Technical",
        severity: "LOW",
        title: "No Sitemap Directive in robots.txt",
        description: "Specifying the XML sitemap in robots.txt facilitates search crawler discovery.",
        evidence: "0 Sitemap directives in robots.txt",
        recommendation: "Add 'Sitemap: https://yourdomain.com/sitemap.xml' to robots.txt.",
        source: "TechnicalAuditor",
      });
    }
  }

  // Sitemap.xml
  if (technical.sitemap.checked && !technical.sitemap.exists) {
    findings.push({
      code: "SITEMAP_NOT_FOUND",
      category: "Technical",
      severity: "LOW",
      title: "XML Sitemap Not Discoverable",
      description: "Neither robots.txt nor /sitemap.xml exposed a valid XML sitemap.",
      evidence: technical.sitemap.error || "HTTP 404 at sitemap location",
      recommendation: "Generate and publish an XML sitemap at /sitemap.xml and submit it to Google Search Console.",
      source: "TechnicalAuditor",
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Schema Structured-Data Findings
  // ---------------------------------------------------------------------------
  if (schema.findings && schema.findings.length > 0) {
    findings.push(...schema.findings);
  }

  // ---------------------------------------------------------------------------
  // 4. Core Web Vitals (CWV) Findings from PageSpeed (if available)
  // ---------------------------------------------------------------------------
  if (pageSpeedData && pageSpeedData.audits) {
    const lcp = pageSpeedData.audits["largest-contentful-paint"];
    if (lcp && lcp.score < 0.5) {
      findings.push({
        code: "CWV_POOR_LCP",
        category: "CWV",
        severity: "HIGH",
        title: `Poor Largest Contentful Paint: ${lcp.displayValue || "Slow"}`,
        description: `LCP measurement (${lcp.displayValue}) exceeds the 2.5s good threshold, indicating delayed primary content rendering.`,
        evidence: lcp.displayValue,
        recommendation: "Optimize critical rendering path, preload hero imagery, and compress server response times.",
        source: "PageSpeedAuditor",
      });
    }

    const cls = pageSpeedData.audits["cumulative-layout-shift"];
    if (cls && cls.score < 0.7) {
      findings.push({
        code: "CWV_HIGH_CLS",
        category: "CWV",
        severity: "MEDIUM",
        title: `High Cumulative Layout Shift: ${cls.displayValue || "Shifting"}`,
        description: "Visual elements shifting during load causes frustrating user experiences and impacts Google page experience scores.",
        evidence: cls.displayValue,
        recommendation: "Set explicit width and height dimensions on images, videos, and embedded iframe elements.",
        source: "PageSpeedAuditor",
      });
    }

    const rbr = pageSpeedData.audits["render-blocking-resources"];
    if (rbr && rbr.score < 0.7) {
      findings.push({
        code: "RENDER_BLOCKING_RESOURCES",
        category: "CWV",
        severity: "MEDIUM",
        title: `Render-Blocking Resources Detected (${rbr.description || ""})`,
        description: "Synchronous CSS or scripts in the HTML head delay first paint.",
        evidence: rbr.description,
        recommendation: "Defer non-critical JavaScript, inline critical CSS, and load third-party scripts asynchronously.",
        source: "PageSpeedAuditor",
      });
    }
  }

  return findings;
}
