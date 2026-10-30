/* eslint-disable @typescript-eslint/no-require-imports */
import {
  PageSpeedResult,
  GSCResult,
  DataForSEOResult,
  WhatsAppSendResult,
  ProviderOptions,
} from "@/types";

// Load CommonJS mock fixtures directly using relative path to avoid alias cycle
const pagespeedMock: PageSpeedResult = require("../mocks/pagespeed.mock.js");
const gscMock: GSCResult = require("../mocks/gsc.mock.js");
const dataforseoMock: DataForSEOResult = require("../mocks/dataforseo.mock.js");
const twilioMock = require("../mocks/twilio.mock.js");

export class ProviderNotConfiguredError extends Error {
  constructor(public readonly providerName: string, message?: string) {
    super(
      message ||
        `Provider '${providerName}' is not configured for live mode. Set USE_MOCKS="true" or configure live API credentials.`
    );
    this.name = "ProviderNotConfiguredError";
  }
}

/**
 * Determines whether mock mode is active, giving caller-provided override precedence
 */
export function isMockActive(override?: boolean): boolean {
  if (override !== undefined) {
    return override;
  }
  return process.env.USE_MOCKS === "true";
}

/**
 * PageSpeed Insights provider
 */
export async function getPageSpeed(
  url: string,
  options?: ProviderOptions
): Promise<PageSpeedResult> {
  if (isMockActive(options?.useMocks)) {
    return {
      ...pagespeedMock,
      url: url || pagespeedMock.url,
    };
  }

  // Live mode guard
  const apiKey = process.env.PAGESPEED_API_KEY;
  if (!apiKey || apiKey.startsWith("mock-")) {
    throw new ProviderNotConfiguredError(
      "PageSpeed Insights",
      "PageSpeed live API is not configured (missing PAGESPEED_API_KEY). Set USE_MOCKS=\"true\" for mock data."
    );
  }

  throw new ProviderNotConfiguredError(
    "PageSpeed Insights",
    "Live PageSpeed API call not implemented in Phase 3. Assessment specifies mocked integration."
  );
}

/**
 * Google Search Console provider
 */
export async function getSearchConsoleData(
  target: string,
  options?: ProviderOptions
): Promise<GSCResult> {
  if (isMockActive(options?.useMocks)) {
    return gscMock;
  }

  const credentials = process.env.GOOGLE_SEARCH_CONSOLE_KEY;
  if (!credentials || credentials.startsWith("mock-")) {
    throw new ProviderNotConfiguredError(
      "Google Search Console",
      "Google Search Console live API is not configured. Set USE_MOCKS=\"true\" for mock data."
    );
  }

  throw new ProviderNotConfiguredError(
    "Google Search Console",
    "Live GSC API call not implemented in Phase 3. Assessment specifies mocked integration."
  );
}

/**
 * DataForSEO SERP rankings provider
 */
export async function getDataForSEORankings(
  keyword: string,
  options?: ProviderOptions
): Promise<DataForSEOResult> {
  if (isMockActive(options?.useMocks)) {
    return dataforseoMock;
  }

  const apiKey = process.env.DATAFORSEO_API_KEY;
  if (!apiKey || apiKey.startsWith("mock-")) {
    throw new ProviderNotConfiguredError(
      "DataForSEO",
      "DataForSEO live API is not configured. Set USE_MOCKS=\"true\" for mock data."
    );
  }

  throw new ProviderNotConfiguredError(
    "DataForSEO",
    "Live DataForSEO API call not implemented in Phase 3. Assessment specifies mocked integration."
  );
}

/**
 * Twilio WhatsApp delivery provider
 */
export async function sendWhatsApp(
  clientId: string,
  pdfPath: string,
  score: number,
  options?: ProviderOptions
): Promise<WhatsAppSendResult> {
  if (isMockActive(options?.useMocks)) {
    return await twilioMock.sendWhatsApp(clientId, pdfPath, score);
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  if (!accountSid || accountSid.startsWith("mock-")) {
    throw new ProviderNotConfiguredError(
      "Twilio WhatsApp",
      "Twilio WhatsApp live API is not configured. Set USE_MOCKS=\"true\" for mock delivery."
    );
  }

  throw new ProviderNotConfiguredError(
    "Twilio WhatsApp",
    "Live Twilio WhatsApp delivery not implemented in Phase 3. Assessment specifies mocked integration."
  );
}
