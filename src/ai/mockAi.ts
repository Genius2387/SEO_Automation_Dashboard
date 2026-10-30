import { NormalizedAuditData } from "@/types";
import { ClaudeAuditResult, ClaudeAuditResultSchema } from "./schemas";
import { enforceDeterministicScoring } from "./scoring";
import { PROMPT_VERSION } from "./prompts";

/**
 * Returns a deterministic, fully schema-valid Claude AI analysis result for mock/testing mode.
 * Dynamically adapts to the target URL and findings present in the NormalizedAuditData.
 */
export function getDeterministicMockAiResult(
  data?: Partial<NormalizedAuditData>
): ClaudeAuditResult {
  const targetUrl = data?.target?.finalUrl || data?.target?.originalUrl || "https://example.com";
  const findings = data?.findings || [];

  // Determine scores based on findings count and severity
  const criticalCount = findings.filter((f) => f.severity === "CRITICAL").length;
  const highCount = findings.filter((f) => f.severity === "HIGH").length;
  const mediumCount = findings.filter((f) => f.severity === "MEDIUM").length;

  const technicalScore = Math.max(30, 95 - criticalCount * 25 - highCount * 10);
  const onPageScore = Math.max(40, 90 - highCount * 12 - mediumCount * 5);
  const contentScore = data?.onPage?.metadata?.wordCount && data.onPage.metadata.wordCount > 300 ? 85 : 65;
  const cwvScore = data?.pageSpeed?.data?.categories?.performance?.score
    ? Math.round(data.pageSpeed.data.categories.performance.score * 100)
    : 78;
  const schemaScore = data?.schema?.jsonLdBlocksCount && data.schema.jsonLdBlocksCount > 0 ? 88 : 55;

  const rawResult: ClaudeAuditResult = {
    audit_version: `${PROMPT_VERSION}-mock`,
    overall_score: 0, // Will be deterministically recalculated by enforceDeterministicScoring
    score_breakdown: {
      technical: technicalScore,
      on_page: onPageScore,
      content: contentScore,
      core_web_vitals: cwvScore,
      schema: schemaScore,
    },
    critical_issues: [
      {
        code: "TECH-001",
        title: "Missing or Inaccessible XML Sitemap",
        severity: "CRITICAL",
        category: "Technical",
        description: "No XML sitemap was discovered at the standard /sitemap.xml endpoint or declared in robots.txt.",
        evidence: `Checked sitemap endpoint returned status ${data?.technical?.sitemap?.statusCode ?? 404}.`,
        recommendation: "Deploy a valid XML sitemap and reference it with a Sitemap directive in robots.txt.",
      },
    ],
    important_issues: [
      {
        code: "ONPAGE-002",
        title: "Suboptimal Meta Description Length",
        severity: "HIGH",
        category: "OnPage",
        description: "The meta description is either missing, truncated, or outside the recommended 120-160 character boundary.",
        evidence: `Current length: ${data?.onPage?.metaDescription?.length ?? 0} characters.`,
        recommendation: "Craft an engaging meta description between 120 and 158 characters including the primary target keyword.",
      },
      {
        code: "PERF-001",
        title: "High Largest Contentful Paint (LCP)",
        severity: "MEDIUM",
        category: "CoreWebVitals",
        description: "The Largest Contentful Paint exceeds the recommended Google threshold of 2.5 seconds.",
        evidence: `LCP measurement: ${data?.pageSpeed?.data?.audits?.["largest-contentful-paint"]?.displayValue ?? "3.8 s"}.`,
        recommendation: "Preload hero image assets and configure edge caching on the primary document response.",
      },
    ],
    quick_wins: [
      {
        priority: "HIGH",
        category: "OnPage",
        finding: "Images detected without descriptive alt attributes.",
        fix: "Add concise, contextual alt attributes to all content images describing their visual subject.",
        estimated_impact: "HIGH",
        effort: "LOW",
        falsifiability_check: "Inspect HTML elements: querySelectorAll('img:not([alt])').length === 0.",
      },
      {
        priority: "MEDIUM",
        category: "Schema",
        finding: "Missing Schema.org LocalBusiness structured data markup.",
        fix: "Inject a JSON-LD structured data block with @type: 'LocalBusiness', name, telephone, and address.",
        estimated_impact: "MEDIUM",
        effort: "LOW",
        falsifiability_check: "Test URL against Schema.org validator or Google Rich Results Test API.",
      },
    ],
    recommendations: [
      {
        priority: "CRITICAL",
        category: "Technical",
        finding: "Robots and indexation instructions lack automated sitemap discovery.",
        fix: "Append 'Sitemap: https://yourdomain.com/sitemap.xml' to robots.txt.",
        estimated_impact: "HIGH",
        effort: "LOW",
        falsifiability_check: "Verify curl -s https://yourdomain.com/robots.txt | grep -i Sitemap.",
      },
      {
        priority: "HIGH",
        category: "OnPage",
        finding: "Heading structure skips semantic hierarchy.",
        fix: "Ensure exactly one H1 element exists followed by sequential H2 and H3 elements.",
        estimated_impact: "HIGH",
        effort: "MEDIUM",
        falsifiability_check: "Verify document.querySelectorAll('h1').length === 1.",
      },
      {
        priority: "MEDIUM",
        category: "Content",
        finding: "Main body content depth is lower than median ranking competitors in this vertical.",
        fix: "Expand core service explanations with dedicated FAQ sections, client testimonials, and technical specifications.",
        estimated_impact: "MEDIUM",
        effort: "MEDIUM",
        falsifiability_check: "Measure body word count exceeding 600 words via document text node extraction.",
      },
    ],
    executive_summary: `This is a deterministic, schema-valid mock audit report for ${targetUrl}. Technical health is sound, but improvements in sitemap declaration, metadata boundaries, and schema markup will unlock immediate search visibility gains. All scores and recommendations adhere strictly to the Phase 6 contract.`,
  };

  return enforceDeterministicScoring(ClaudeAuditResultSchema.parse(rawResult));
}
