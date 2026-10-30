/* eslint-disable @typescript-eslint/no-require-imports */
const USE_MOCKS = process.env.USE_MOCKS === 'true';

const pagespeedMock = require('./pagespeed.mock.js');
const gscMock = require('./gsc.mock.js');
const dataforseoMock = require('./dataforseo.mock.js');
const twilioMock = require('./twilio.mock.js');
const mockData = require('./mockData.js');

module.exports = {
  USE_MOCKS,
  pagespeedMock,
  gscMock,
  dataforseoMock,
  twilioMock,
  mockCrawlData: mockData.mockCrawlData,
  mockAiAnalysis: mockData.mockAiAnalysis,
};
