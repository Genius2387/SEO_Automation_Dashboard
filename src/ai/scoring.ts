import { ScoreBreakdown, ClaudeAuditResult, ClaudeAuditResultSchema } from "./schemas";

/**
 * Interpreted category weighting model for deterministic overall score calculation.
 * Total sum of weights equals 1.00 (100%).
 */
export const CATEGORY_WEIGHTS = {
  technical: 0.25,      // Server status, robots.txt, sitemaps, indexability, canonicals, viewport
  on_page: 0.25,        // Title tags, meta descriptions, H1-H3 headings, image alt, internal/external links
  content: 0.20,        // Document depth, visible body word count, readability, thin content prevention
  core_web_vitals: 0.15,// Largest Contentful Paint (LCP), Cumulative Layout Shift (CLS), render-blocking resources
  schema: 0.15,         // Structured data, Schema.org @context/@type, JSON-LD validity, Microdata
} as const;

/**
 * Computes a deterministic overall SEO score (0-100 integer) based on category weights.
 */
export function computeOverallScore(breakdown: ScoreBreakdown): number {
  const weighted =
    breakdown.technical * CATEGORY_WEIGHTS.technical +
    breakdown.on_page * CATEGORY_WEIGHTS.on_page +
    breakdown.content * CATEGORY_WEIGHTS.content +
    breakdown.core_web_vitals * CATEGORY_WEIGHTS.core_web_vitals +
    breakdown.schema * CATEGORY_WEIGHTS.schema;

  return Math.min(100, Math.max(0, Math.round(weighted)));
}

/**
 * Clamps category scores to [0, 100] integers and enforces the deterministic weighted overall score.
 */
export function enforceDeterministicScoring(result: ClaudeAuditResult): ClaudeAuditResult {
  const clampedBreakdown: ScoreBreakdown = {
    technical: Math.min(100, Math.max(0, Math.round(result.score_breakdown.technical))),
    on_page: Math.min(100, Math.max(0, Math.round(result.score_breakdown.on_page))),
    content: Math.min(100, Math.max(0, Math.round(result.score_breakdown.content))),
    core_web_vitals: Math.min(100, Math.max(0, Math.round(result.score_breakdown.core_web_vitals))),
    schema: Math.min(100, Math.max(0, Math.round(result.score_breakdown.schema))),
  };

  const calculatedOverallScore = computeOverallScore(clampedBreakdown);

  const normalized: ClaudeAuditResult = {
    ...result,
    overall_score: calculatedOverallScore,
    score_breakdown: clampedBreakdown,
  };

  return ClaudeAuditResultSchema.parse(normalized);
}
