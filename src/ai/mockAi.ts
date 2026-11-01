import { NormalizedAuditData } from "@/types";
import { ClaudeAuditResult, ClaudeAuditResultSchema, Issue, Recommendation } from "./schemas";
import { enforceDeterministicScoring } from "./scoring";
import { PROMPT_VERSION } from "./prompts";

/**
 * Returns a deterministic, fully schema-valid Claude AI analysis result for mock/testing mode.
 * Dynamically computes evidence-based category scores and recommendations from NormalizedAuditData.
 */
export function getDeterministicMockAiResult(
  data?: Partial<NormalizedAuditData>
): ClaudeAuditResult {
  const targetUrl = data?.target?.finalUrl || data?.target?.originalUrl || data?.url || "https://example.com";
  const findings = data?.findings || [];
  const onPage = data?.onPage;
  const technical = data?.technical;
  const schema = data?.schema;
  const statusCode = data?.statusCode ?? 200;

  // ---------------------------------------------------------------------------
  // 1. Technical SEO Score (0-100, Weight: 25%)
  // ---------------------------------------------------------------------------
  let technicalScore = 100;
  if (statusCode >= 400 || statusCode === 0) {
    technicalScore -= 50;
  }
  const isHttps = (data?.target?.finalUrl ?? data?.target?.originalUrl ?? targetUrl).startsWith("https://");
  if (!isHttps) {
    technicalScore -= 15;
  }
  if (technical?.robotsTxt?.isTargetDisallowed) {
    technicalScore -= 30;
  } else if (technical?.robotsTxt?.checked && !technical.robotsTxt.exists) {
    technicalScore -= 10;
  }
  if (technical?.sitemap?.checked && (!technical.sitemap.exists || (technical.sitemap.urlCount ?? 0) === 0)) {
    technicalScore -= 15;
  }
  if (onPage?.canonical && (!onPage.canonical.isValid || onPage.canonical.count > 1)) {
    technicalScore -= 10;
  }
  // Deductions from technical findings
  for (const f of findings.filter((f) => f.category === "Technical")) {
    if (f.severity === "CRITICAL") technicalScore -= 15;
    else if (f.severity === "HIGH") technicalScore -= 10;
    else if (f.severity === "MEDIUM") technicalScore -= 5;
    else if (f.severity === "LOW") technicalScore -= 2;
  }
  technicalScore = Math.max(statusCode >= 400 ? 10 : 25, Math.min(100, technicalScore));

  // ---------------------------------------------------------------------------
  // 2. On-Page SEO Score (0-100, Weight: 25%)
  // ---------------------------------------------------------------------------
  let onPageScore = 100;
  const titleExists = Boolean(onPage?.title?.exists && onPage.title.text?.trim().length > 0);
  if (!titleExists) {
    onPageScore -= 25;
  } else {
    if (onPage?.title?.status === "TOO_SHORT" || onPage?.title?.status === "TOO_LONG") {
      onPageScore -= 5;
    }
    if (findings.some((f) => f.code === "TITLE_MULTIPLE" || f.code === "ONPAGE_MULTIPLE_TITLES")) {
      onPageScore -= 10;
    }
  }

  const metaDescExists = Boolean(onPage?.metaDescription?.exists && onPage.metaDescription.text?.trim().length > 0);
  if (!metaDescExists) {
    onPageScore -= 20;
  } else if (onPage?.metaDescription?.status === "TOO_SHORT" || onPage?.metaDescription?.status === "TOO_LONG") {
    onPageScore -= 5;
  }

  const h1Count = onPage?.headings?.h1Count ?? (onPage?.headings?.h1?.length ?? 0);
  if (h1Count === 0) {
    onPageScore -= 15;
  } else if (h1Count > 1) {
    onPageScore -= 10;
  }

  const totalImages = onPage?.images?.totalCount ?? 0;
  const missingAlt = onPage?.images?.missingAltCount ?? 0;
  if (totalImages > 0 && missingAlt > 0) {
    const missingRatio = missingAlt / totalImages;
    onPageScore -= Math.round(missingRatio * 20);
  }

  if (onPage?.metadata && !onPage.metadata.viewport) {
    onPageScore -= 10;
  }

  for (const f of findings.filter((f) => f.category === "OnPage")) {
    if (f.severity === "CRITICAL") onPageScore -= 15;
    else if (f.severity === "HIGH") onPageScore -= 10;
    else if (f.severity === "MEDIUM") onPageScore -= 5;
  }
  onPageScore = Math.max(20, Math.min(100, onPageScore));

  // ---------------------------------------------------------------------------
  // 3. Content Quality Score (0-100, Weight: 20%)
  // ---------------------------------------------------------------------------
  const wordCount = onPage?.metadata?.wordCount ?? 0;
  let contentScore = 50;
  if (wordCount >= 1200) {
    contentScore = 95;
  } else if (wordCount >= 600) {
    contentScore = 85;
  } else if (wordCount >= 300) {
    contentScore = 75;
  } else if (wordCount >= 100) {
    contentScore = 60;
  } else if (wordCount > 0) {
    contentScore = 45;
  } else {
    contentScore = 25;
  }

  const h2Count = onPage?.headings?.h2Count ?? (onPage?.headings?.h2?.length ?? 0);
  if (h2Count >= 3) {
    contentScore = Math.min(100, contentScore + 5);
  } else if (h2Count === 0 && wordCount > 0) {
    contentScore = Math.max(20, contentScore - 10);
  }

  for (const f of findings.filter((f) => f.category === "Content")) {
    if (f.severity === "CRITICAL") contentScore -= 15;
    else if (f.severity === "HIGH") contentScore -= 10;
    else if (f.severity === "MEDIUM") contentScore -= 5;
  }
  contentScore = Math.max(20, Math.min(100, contentScore));

  // ---------------------------------------------------------------------------
  // 4. Structured Data / Schema Score (0-100, Weight: 15%)
  // ---------------------------------------------------------------------------
  const jsonLdCount = schema?.jsonLdBlocksCount ?? (schema?.jsonLdBlocks?.length ?? 0);
  const hasMicrodata = Boolean(schema?.hasMicrodata);
  let schemaScore = 40;
  if (jsonLdCount >= 2) {
    schemaScore = 95;
  } else if (jsonLdCount === 1) {
    schemaScore = 85;
  } else if (hasMicrodata) {
    schemaScore = 70;
  } else {
    schemaScore = 40;
  }

  for (const f of findings.filter((f) => f.category === "Schema")) {
    if (f.severity === "CRITICAL") schemaScore -= 20;
    else if (f.severity === "HIGH") schemaScore -= 10;
  }
  schemaScore = Math.max(20, Math.min(100, schemaScore));

  // ---------------------------------------------------------------------------
  // 5. Core Web Vitals Score (0-100, Weight: 15%)
  // ---------------------------------------------------------------------------
  let cwvScore = 70;
  if (data?.pageSpeed?.status === "mock" || data?.pageSpeed?.source === "mock") {
    cwvScore = 70;
  } else if (data?.pageSpeed?.data?.categories?.performance?.score != null) {
    cwvScore = Math.round(data.pageSpeed.data.categories.performance.score * 100);
  }
  cwvScore = Math.max(20, Math.min(100, cwvScore));

  // ---------------------------------------------------------------------------
  // 6. Build Evidence-Grounded Issues and Recommendations
  // ---------------------------------------------------------------------------
  const criticalIssues: Issue[] = [];
  const importantIssues: Issue[] = [];

  for (const f of findings) {
    const issueObj: Issue = {
      code: f.code || "SEO-ISSUE",
      title: f.title || "Identified SEO Issue",
      severity: f.severity,
      category: f.category || "General",
      description: f.description || "Identified optimization opportunity.",
      evidence: f.evidence !== undefined && f.evidence !== null ? (typeof f.evidence === "string" ? f.evidence : JSON.stringify(f.evidence)) : "Detected during automated crawl analysis.",
      recommendation: f.recommendation || "Review and update according to SEO best practices.",
    };

    if (f.severity === "CRITICAL" && criticalIssues.length < 10) {
      criticalIssues.push(issueObj);
    } else if ((f.severity === "HIGH" || f.severity === "MEDIUM") && importantIssues.length < 20) {
      importantIssues.push(issueObj);
    }
  }

  // Fallback critical issue if site has a fundamental failure (e.g. 404 or missing title)
  if (criticalIssues.length === 0 && !titleExists) {
    criticalIssues.push({
      code: "ONPAGE-001",
      title: "Missing HTML <title> Tag",
      severity: "CRITICAL",
      category: "OnPage",
      description: "No HTML title element was discovered in the document head.",
      evidence: `Target URL: ${targetUrl}`,
      recommendation: "Deploy a unique, descriptive <title> tag between 30 and 60 characters.",
    });
  }

  // Fallback important issue if meta description is missing
  if (importantIssues.length === 0 && !metaDescExists) {
    importantIssues.push({
      code: "ONPAGE-002",
      title: "Missing Meta Description Tag",
      severity: "HIGH",
      category: "OnPage",
      description: "The document lacks a meta description tag for search engine snippet generation.",
      evidence: `Current length: 0 characters.`,
      recommendation: "Craft an engaging meta description between 120 and 158 characters including the primary target keyword.",
    });
  }

  // Default maintenance items if page has 0 detected issues
  if (criticalIssues.length === 0 && importantIssues.length === 0) {
    importantIssues.push({
      code: "AUDIT-001",
      title: "Routine SEO Health Monitoring",
      severity: "LOW" as const,
      category: "General",
      description: "No high-severity structural defects detected on this page.",
      evidence: `HTTP Status ${statusCode}, ${wordCount} words detected.`,
      recommendation: "Maintain scheduled monitoring and periodic content refreshes.",
    });
  }

  // ---------------------------------------------------------------------------
  // 7. Quick Wins and Strategic Recommendations
  // ---------------------------------------------------------------------------
  const quickWins: Recommendation[] = [];
  const recommendations: Recommendation[] = [];

  if (missingAlt > 0) {
    quickWins.push({
      priority: "HIGH",
      category: "OnPage",
      finding: `${missingAlt} image(s) detected without descriptive alt attributes.`,
      fix: "Add concise, contextual alt attributes to all content images describing their visual subject.",
      estimated_impact: "HIGH",
      effort: "LOW",
      falsifiability_check: "Inspect HTML elements: querySelectorAll('img:not([alt])').length === 0.",
    });
  }

  if (jsonLdCount === 0) {
    quickWins.push({
      priority: "MEDIUM",
      category: "Schema",
      finding: "No Schema.org JSON-LD structured data detected on target page.",
      fix: "Inject a JSON-LD structured data block with appropriate Organization or WebSite schema.",
      estimated_impact: "MEDIUM",
      effort: "LOW",
      falsifiability_check: "Test URL against Schema.org validator or Google Rich Results Test API.",
    });
  }

  if (!metaDescExists || (onPage?.metaDescription?.length ?? 0) < 100) {
    quickWins.push({
      priority: "HIGH",
      category: "OnPage",
      finding: "Meta description is missing or suboptimal in length.",
      fix: "Craft a targeted meta description between 120 and 158 characters.",
      estimated_impact: "MEDIUM",
      effort: "LOW",
      falsifiability_check: "Verify document.querySelector('meta[name=\"description\"]').content.length >= 120.",
    });
  }

  // Ensure at least 1 quick win exists for contract compliance
  if (quickWins.length === 0) {
    quickWins.push({
      priority: "LOW",
      category: "OnPage",
      finding: "Existing on-page metadata meets standard baseline guidelines.",
      fix: "Review keyword placement across H2 headings for continued organic visibility.",
      estimated_impact: "LOW",
      effort: "LOW",
      falsifiability_check: "Audit internal heading relevance against primary target queries.",
    });
  }

  // Strategic Recommendations
  if (technical?.sitemap?.checked && (!technical.sitemap.exists || (technical.sitemap.urlCount ?? 0) === 0)) {
    recommendations.push({
      priority: "CRITICAL",
      category: "Technical",
      finding: "Robots and indexation instructions lack automated sitemap discovery.",
      fix: `Deploy XML sitemap and reference via 'Sitemap: ${targetUrl.replace(/\/$/, "")}/sitemap.xml' in robots.txt.`,
      estimated_impact: "HIGH",
      effort: "LOW",
      falsifiability_check: "Verify curl -s robots.txt contains a valid Sitemap directive.",
    });
  }

  if (wordCount < 600) {
    recommendations.push({
      priority: "HIGH",
      category: "Content",
      finding: `Main body content depth (${wordCount} words) is below recommended depth for competitive indexing.`,
      fix: "Expand core content sections with structured explanations, FAQs, and product/service details.",
      estimated_impact: "HIGH",
      effort: "MEDIUM",
      falsifiability_check: "Measure body word count exceeding 600 words via document text node extraction.",
    });
  }

  if (h1Count !== 1) {
    recommendations.push({
      priority: "MEDIUM",
      category: "OnPage",
      finding: `Found ${h1Count} H1 heading(s). Exactly one definitive H1 is recommended per page.`,
      fix: "Ensure exactly one H1 element exists communicating the primary topic of the page.",
      estimated_impact: "MEDIUM",
      effort: "LOW",
      falsifiability_check: "Verify document.querySelectorAll('h1').length === 1.",
    });
  }

  // Ensure at least 1 recommendation exists for contract compliance
  if (recommendations.length === 0) {
    recommendations.push({
      priority: "LOW",
      category: "Technical",
      finding: "Core technical SEO infrastructure meets baseline standards.",
      fix: "Continue monitoring crawl frequency and server response times in Google Search Console.",
      estimated_impact: "LOW",
      effort: "LOW",
      falsifiability_check: "Review weekly crawl stats in search engine webmaster portals.",
    });
  }

  // ---------------------------------------------------------------------------
  // 8. Dynamic Evidence-Grounded Executive Summary
  // ---------------------------------------------------------------------------
  const titleDisplay = onPage?.title?.text ? `"${onPage.title.text.slice(0, 50)}"` : "None";
  const schemaTypesDisplay = schema?.discoveredTypes?.length ? schema.discoveredTypes.join(", ") : "None";
  const cwvLabel = data?.pageSpeed?.status === "mock" ? "Provider Mock" : (data?.pageSpeed?.status || "Unavailable");

  const executiveSummary =
    `Deterministic mock AI analysis for ${targetUrl}. HTTP Status: ${statusCode}. ` +
    `Title: ${titleDisplay} (${onPage?.title?.length ?? 0} chars). ` +
    `Word Count: ${wordCount} words. ` +
    `Headings: ${h1Count} H1, ${h2Count} H2. ` +
    `Images: ${totalImages} (${missingAlt} missing alt). ` +
    `Schema: [${schemaTypesDisplay}]. ` +
    `Performance: ${cwvLabel} (${cwvScore}/100). ` +
    `All category sub-scores are calculated directly from verified crawl findings adhering to the Phase 6 contract.`;

  const rawResult: ClaudeAuditResult = {
    audit_version: `${PROMPT_VERSION}-mock`,
    overall_score: 0, // Recalculated by enforceDeterministicScoring
    score_breakdown: {
      technical: technicalScore,
      on_page: onPageScore,
      content: contentScore,
      core_web_vitals: cwvScore,
      schema: schemaScore,
    },
    critical_issues: criticalIssues,
    important_issues: importantIssues,
    quick_wins: quickWins,
    recommendations: recommendations,
    executive_summary: executiveSummary,
  };

  return enforceDeterministicScoring(ClaudeAuditResultSchema.parse(rawResult));
}
