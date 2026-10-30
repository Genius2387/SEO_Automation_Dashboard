/* eslint-disable @typescript-eslint/no-require-imports */
import {
  CrawlResult,
  AIAnalysisResult,
  PageSpeedResult,
  GSCResult,
  DataForSEOResult,
} from "@/types";

// Central mock switch (server-only)
export const USE_MOCKS = process.env.USE_MOCKS === "true";

// Exact CommonJS fixtures
export const pagespeedMock: PageSpeedResult = require("./pagespeed.mock.js");
export const gscMock: GSCResult = require("./gsc.mock.js");
export const dataforseoMock: DataForSEOResult = require("./dataforseo.mock.js");
export const twilioMock = require("./twilio.mock.js");

// Preserved crawl & AI mock facades
const mockData = require("./mockData.js");
export const mockCrawlData: CrawlResult = mockData.mockCrawlData;
export const mockAiAnalysis: AIAnalysisResult = mockData.mockAiAnalysis;

// Provider exports
export {
  getPageSpeed,
  getSearchConsoleData,
  getDataForSEORankings,
  sendWhatsApp,
  ProviderNotConfiguredError,
  isMockActive,
} from "@/services/providers";
