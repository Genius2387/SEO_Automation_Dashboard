import { z } from "zod";

/**
 * Standard issue severity levels matching assessment requirements
 */
export const IssueSeverityEnum = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
export type IssueSeverity = z.infer<typeof IssueSeverityEnum>;

/**
 * Recommendation priority levels
 */
export const RecommendationPriorityEnum = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
export type RecommendationPriority = z.infer<typeof RecommendationPriorityEnum>;

/**
 * Valid audit categories
 */
export const RecommendationCategoryEnum = z.enum([
  "Technical",
  "OnPage",
  "Content",
  "CoreWebVitals",
  "Schema",
]);
export type RecommendationCategory = z.infer<typeof RecommendationCategoryEnum>;

/**
 * Estimated business and search visibility impact
 */
export const ImpactEnum = z.enum(["HIGH", "MEDIUM", "LOW"]);
export type Impact = z.infer<typeof ImpactEnum>;

/**
 * Implementation effort required
 */
export const EffortEnum = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type Effort = z.infer<typeof EffortEnum>;

/**
 * Individual SEO Issue structure
 */
export const IssueSchema = z.object({
  code: z.string().min(1, "Issue code is required"),
  title: z.string().min(1, "Issue title is required"),
  severity: IssueSeverityEnum,
  category: z.string().min(1, "Issue category is required"),
  description: z.string().min(1, "Issue description is required"),
  evidence: z.string().optional(),
  recommendation: z.string().min(1, "Issue recommendation is required"),
});
export type Issue = z.infer<typeof IssueSchema>;

/**
 * Individual SEO Actionable Recommendation structure
 */
export const RecommendationSchema = z.object({
  priority: RecommendationPriorityEnum,
  category: RecommendationCategoryEnum,
  finding: z.string().min(1, "Finding summary is required"),
  fix: z.string().min(1, "Specific fix instructions required"),
  estimated_impact: ImpactEnum,
  effort: EffortEnum,
  falsifiability_check: z
    .string()
    .min(1, "Falsifiability test or verification criterion is required"),
});
export type Recommendation = z.infer<typeof RecommendationSchema>;

/**
 * Score breakdown across 5 core technical SEO disciplines (0-100 integers)
 */
export const ScoreBreakdownSchema = z.object({
  technical: z.number().int().min(0).max(100),
  on_page: z.number().int().min(0).max(100),
  content: z.number().int().min(0).max(100),
  core_web_vitals: z.number().int().min(0).max(100),
  schema: z.number().int().min(0).max(100),
});
export type ScoreBreakdown = z.infer<typeof ScoreBreakdownSchema>;

/**
 * Exact Claude AI Analysis Contract required by technical assessment
 */
export const ClaudeAuditResultSchema = z.object({
  audit_version: z.string().min(1, "Audit version is required"),
  overall_score: z.number().int().min(0).max(100),
  score_breakdown: ScoreBreakdownSchema,
  critical_issues: z.array(IssueSchema).max(25),
  important_issues: z.array(IssueSchema).max(35),
  quick_wins: z.array(RecommendationSchema).max(20),
  recommendations: z.array(RecommendationSchema).max(50),
  executive_summary: z.string().min(1, "Executive summary is required"),
});
export type ClaudeAuditResult = z.infer<typeof ClaudeAuditResultSchema>;
