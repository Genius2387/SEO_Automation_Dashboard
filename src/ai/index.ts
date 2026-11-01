import Anthropic from "@anthropic-ai/sdk";
import { CrawlResult, AIAnalysisResult, NormalizedAuditData } from "@/types";
import { mockAiAnalysis } from "@/mocks";
import {
  ClaudeAuditResult,
  ClaudeAuditResultSchema,
  Issue,
  Recommendation,
  ScoreBreakdown,
  IssueSeverityEnum,
  RecommendationPriorityEnum,
  RecommendationCategoryEnum,
  ImpactEnum,
  EffortEnum,
} from "./schemas";
import { enforceDeterministicScoring, computeOverallScore, CATEGORY_WEIGHTS } from "./scoring";
import { SEO_SYSTEM_PROMPT, buildUserPrompt, PROMPT_VERSION, prepareBoundedCrawlData } from "./prompts";
import { getDeterministicMockAiResult } from "./mockAi";
import { isAiMockActive } from "@/services/providers";

// Re-export public schemas and utilities for external consumers
export {
  ClaudeAuditResultSchema,
  computeOverallScore,
  enforceDeterministicScoring,
  CATEGORY_WEIGHTS,
  PROMPT_VERSION,
  prepareBoundedCrawlData,
  getDeterministicMockAiResult,
  IssueSeverityEnum,
  RecommendationPriorityEnum,
  RecommendationCategoryEnum,
  ImpactEnum,
  EffortEnum,
};
export type { ClaudeAuditResult, Issue, Recommendation, ScoreBreakdown };

export interface AnalyzerOptions {
  useMocks?: boolean;
}

/**
 * Permanent failure: Anthropic credentials are not configured or set to placeholder in live mode.
 */
export class ClaudeNotConfiguredError extends Error {
  constructor(message?: string) {
    super(
      message ||
        "Anthropic API key is not configured or contains placeholder 'mock-*' while in live mode."
    );
    this.name = "ClaudeNotConfiguredError";
  }
}

/**
 * Transient failure: Anthropic rate limit encountered (HTTP 429).
 */
export class ClaudeRateLimitError extends Error {
  constructor(message?: string) {
    super(message || "Anthropic rate limit reached. Retry with exponential backoff.");
    this.name = "ClaudeRateLimitError";
  }
}

/**
 * Transient failure: Request timed out.
 */
export class ClaudeTimeoutError extends Error {
  constructor(message?: string) {
    super(message || "Anthropic request timed out after 60 seconds.");
    this.name = "ClaudeTimeoutError";
  }
}

/**
 * General Claude API failure.
 */
export class ClaudeApiError extends Error {
  public statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "ClaudeApiError";
    this.statusCode = statusCode;
  }
}

/**
 * Core Phase 6 AI Analysis Engine.
 * Analyzes validated NormalizedAuditData from Phase 4 and returns a strictly typed,
 * evidence-grounded, falsifiable ClaudeAuditResult.
 */
export async function analyzeSeoAudit(
  data: NormalizedAuditData,
  options: AnalyzerOptions = {}
): Promise<ClaudeAuditResult> {
  const isMock = isAiMockActive(options.useMocks);
  const apiKey = process.env.ANTHROPIC_API_KEY;

  // 1. Mock mode: return deterministic, schema-valid mock audit result without API consumption
  if (isMock) {
    return getDeterministicMockAiResult(data);
  }

  // 2. Live mode: require valid, non-placeholder API key
  if (!apiKey || apiKey.trim() === "" || apiKey.startsWith("mock-")) {
    throw new ClaudeNotConfiguredError(
      "Live AI analysis requested but ANTHROPIC_API_KEY is missing or contains placeholder."
    );
  }

  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

  const anthropic = new Anthropic({
    apiKey,
    timeout: 60000, // 60s timeout
  });

  const systemPrompt = SEO_SYSTEM_PROMPT;
  const userPrompt = buildUserPrompt(data);

  let responseText: string;

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 3500,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
    });

    const contentBlock = response.content[0];
    if (!contentBlock || contentBlock.type !== "text") {
      throw new ClaudeApiError("Invalid response format received from Anthropic API.");
    }
    responseText = contentBlock.text;
  } catch (err: unknown) {
    const error = err as { status?: number; message?: string; name?: string };
    if (error.status === 429) {
      throw new ClaudeRateLimitError(`Anthropic 429 Rate Limit: ${error.message || "Too many requests"}`);
    }
    if (error.name === "APIConnectionTimeoutError" || error.message?.includes("timeout")) {
      throw new ClaudeTimeoutError("Anthropic API request timed out.");
    }
    if (error.status === 401) {
      throw new ClaudeNotConfiguredError("Anthropic API returned 401 Unauthorized. Invalid API key.");
    }
    throw new ClaudeApiError(error.message || "Failed to communicate with Anthropic API.", error.status);
  }

  // 3. Extract JSON safely
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new ClaudeApiError("Failed to extract valid JSON from Claude AI response.");
  }

  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(jsonMatch[0]);
  } catch (err) {
    throw new ClaudeApiError(
      `Claude AI response contained malformed JSON: ${err instanceof Error ? err.message : "syntax error"}`
    );
  }

  // 4. Validate output contract strictly with Zod schema
  const parseResult = ClaudeAuditResultSchema.safeParse(parsedRaw);
  if (!parseResult.success) {
    const errorIssues = parseResult.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new ClaudeApiError(`Claude AI response failed contract validation: ${errorIssues}`);
  }

  // 5. Enforce deterministic scoring model & weights
  const validatedResult = enforceDeterministicScoring(parseResult.data);

  return validatedResult;
}

/**
 * Backward compatibility wrapper for Phase 1-3 callers.
 */
export async function analyzeWithClaude(
  crawlData: CrawlResult,
  options: AnalyzerOptions = {}
): Promise<AIAnalysisResult> {
  const isMock = isAiMockActive(options.useMocks);
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (isMock || !apiKey || apiKey.startsWith("mock-")) {
    return {
      ...mockAiAnalysis,
      generatedAt: new Date().toISOString(),
    };
  }

  const anthropic = new Anthropic({
    apiKey,
    timeout: 60000,
  });

  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

  const prompt = `You are an SEO auditor. Analyze the following webpage crawl data and return a JSON object evaluating SEO health, technical performance, and prioritized recommendations.

Crawl Data:
${JSON.stringify(crawlData, null, 2)}

Respond with ONLY valid JSON strictly matching this schema:
{
  "overallScore": number (0-100),
  "categoryScores": {
    "technical": number (0-100),
    "content": number (0-100),
    "userExperience": number (0-100)
  },
  "summary": "concise executive summary string",
  "strengths": ["list of strings"],
  "weaknesses": ["list of strings"],
  "recommendations": [
    {
      "priority": "high" | "medium" | "low",
      "category": "technical" | "content" | "on-page" | "performance",
      "title": "string",
      "explanation": "string",
      "actionableSteps": ["string"]
    }
  ]
}`;

  const message = await anthropic.messages.create({
    model,
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const contentBlock = message.content[0];
  if (!contentBlock || contentBlock.type !== "text") {
    throw new Error("Invalid response format from Anthropic API.");
  }

  const jsonMatch = contentBlock.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to extract JSON analysis from Claude response.");
  }

  const parsed = JSON.parse(jsonMatch[0]) as Omit<AIAnalysisResult, "generatedAt">;

  return {
    ...parsed,
    generatedAt: new Date().toISOString(),
  };
}
