/* eslint-disable @typescript-eslint/no-require-imports */
import assert from "assert";
import {
  getPageSpeed,
  getSearchConsoleData,
  getDataForSEORankings,
  sendWhatsApp,
  ProviderNotConfiguredError,
} from "../src/services/providers";

// Verify CommonJS index.js file directly
const cjsIndex = require("../src/mocks/index.js");
const { pagespeedMock, gscMock, dataforseoMock, twilioMock } = cjsIndex;

async function runPhase3MockTests() {
  console.log("==================================================================");
  console.log("EDGELINK SEO DASHBOARD - PHASE 3 EXACT MOCK INTEGRATION TESTS");
  console.log("==================================================================");

  // ---------------------------------------------------------------------------
  // 1. CommonJS index.js Contract
  // ---------------------------------------------------------------------------
  console.log("\n[1/6] Testing CommonJS index.js exports...");
  assert(
    typeof cjsIndex.USE_MOCKS === "boolean",
    "cjsIndex.USE_MOCKS must be a boolean"
  );
  assert(cjsIndex.pagespeedMock, "cjsIndex.pagespeedMock must be defined");
  assert(cjsIndex.gscMock, "cjsIndex.gscMock must be defined");
  assert(cjsIndex.dataforseoMock, "cjsIndex.dataforseoMock must be defined");
  assert(cjsIndex.twilioMock, "cjsIndex.twilioMock must be defined");
  console.log("  ✔ CommonJS index.js exports verified successfully.");

  // ---------------------------------------------------------------------------
  // 2. Exact PageSpeed Fixture Integrity
  // ---------------------------------------------------------------------------
  console.log("\n[2/6] Verifying PageSpeed mock exact fixture integrity...");
  assert.strictEqual(
    pagespeedMock.url,
    "https://example-dental-clinic.com",
    "PageSpeed URL mismatch"
  );
  assert.strictEqual(
    pagespeedMock.strategy,
    "mobile",
    "PageSpeed strategy mismatch"
  );
  assert.strictEqual(
    pagespeedMock.categories.performance.score,
    0.61,
    "Performance score mismatch"
  );
  assert.strictEqual(
    pagespeedMock.categories.seo.score,
    0.89,
    "SEO score mismatch"
  );
  assert.strictEqual(
    pagespeedMock.categories.accessibility.score,
    0.74,
    "Accessibility score mismatch"
  );

  const lcp = pagespeedMock.audits["largest-contentful-paint"];
  assert.strictEqual(lcp.score, 0.4, "LCP score mismatch");
  assert.strictEqual(lcp.displayValue, "4.2 s", "LCP displayValue mismatch");

  const cls = pagespeedMock.audits["cumulative-layout-shift"];
  assert.strictEqual(cls.score, 0.9, "CLS score mismatch");
  assert.strictEqual(cls.displayValue, "0.08", "CLS displayValue mismatch");

  const inp = pagespeedMock.audits["interaction-to-next-paint"];
  assert.strictEqual(inp.score, 0.6, "INP score mismatch");
  assert.strictEqual(inp.displayValue, "280 ms", "INP displayValue mismatch");

  const rbr = pagespeedMock.audits["render-blocking-resources"];
  assert.strictEqual(rbr.score, 0.5, "RBR score mismatch");
  assert.strictEqual(
    rbr.description,
    "2 blocking resources",
    "RBR description mismatch"
  );

  const uj = pagespeedMock.audits["unused-javascript"];
  assert.strictEqual(uj.score, 0.4, "Unused JS score mismatch");
  assert.strictEqual(uj.displayValue, "420 KiB", "Unused JS displayValue mismatch");
  console.log("  ✔ PageSpeed exact fixture values verified.");

  // ---------------------------------------------------------------------------
  // 3. Exact Google Search Console (GSC) Fixture Integrity
  // ---------------------------------------------------------------------------
  console.log("\n[3/6] Verifying Google Search Console mock exact fixture integrity...");
  assert.strictEqual(gscMock.rows.length, 5, "GSC rows count mismatch");
  assert.strictEqual(gscMock.totalClicks, 167, "GSC totalClicks mismatch");
  assert.strictEqual(gscMock.totalImpressions, 4560, "GSC totalImpressions mismatch");
  assert.strictEqual(gscMock.indexCoverageErrors, 3, "GSC indexCoverageErrors mismatch");

  const expectedGscRows = [
    { query: "dental clinic in pune", clicks: 42, impressions: 980, ctr: 0.043, position: 6.2 },
    { query: "best dentist pune", clicks: 28, impressions: 740, ctr: 0.038, position: 8.1 },
    { query: "tooth extraction pune", clicks: 19, impressions: 430, ctr: 0.044, position: 5.7 },
    { query: "dental implants cost pune", clicks: 11, impressions: 310, ctr: 0.035, position: 11.3 },
    { query: "dentist near me", clicks: 67, impressions: 2100, ctr: 0.032, position: 9.4 },
  ];

  for (let i = 0; i < expectedGscRows.length; i++) {
    const expected = expectedGscRows[i];
    const actual = gscMock.rows[i];
    assert.strictEqual(actual.query, expected.query, `Row ${i} query mismatch`);
    assert.strictEqual(actual.clicks, expected.clicks, `Row ${i} clicks mismatch`);
    assert.strictEqual(actual.impressions, expected.impressions, `Row ${i} impressions mismatch`);
    assert.strictEqual(actual.ctr, expected.ctr, `Row ${i} ctr mismatch`);
    assert.strictEqual(actual.position, expected.position, `Row ${i} position mismatch`);
  }
  console.log("  ✔ GSC exact fixture values and 5 rows verified.");

  // ---------------------------------------------------------------------------
  // 4. Exact DataForSEO Fixture Integrity
  // ---------------------------------------------------------------------------
  console.log("\n[4/6] Verifying DataForSEO mock exact fixture integrity...");
  assert.strictEqual(dataforseoMock.client_rank_position, 4, "Client rank position mismatch");
  assert.strictEqual(dataforseoMock.keyword_search_volume, 1900, "Keyword search volume mismatch");
  assert(dataforseoMock.tasks && dataforseoMock.tasks[0], "Tasks array missing");
  const taskResult = dataforseoMock.tasks[0].result[0];
  assert.strictEqual(taskResult.keyword, "dental clinic pune", "Keyword mismatch");
  assert.strictEqual(taskResult.items.length, 3, "Items count mismatch");

  assert.deepStrictEqual(taskResult.items[0], {
    type: "organic",
    rank_group: 1,
    rank_absolute: 4,
    domain: "example-dental-clinic.com",
  });
  assert.deepStrictEqual(taskResult.items[1], {
    type: "organic",
    rank_group: 2,
    rank_absolute: 8,
    domain: "competitorA.com",
  });
  assert.deepStrictEqual(taskResult.items[2], {
    type: "organic",
    rank_group: 3,
    rank_absolute: 12,
    domain: "competitorB.com",
  });
  console.log("  ✔ DataForSEO exact ranking fixture verified.");

  // ---------------------------------------------------------------------------
  // 5. Twilio WhatsApp Mock Execution & Logging
  // ---------------------------------------------------------------------------
  console.log("\n[5/6] Verifying Twilio WhatsApp mock execution...");
  const interceptedLogs: string[] = [];
  const originalConsoleLog = console.log;
  console.log = (...args: unknown[]) => {
    interceptedLogs.push(args.join(" "));
    originalConsoleLog(...args);
  };

  try {
    const waResult = await twilioMock.sendWhatsApp(
      "client_pune_01",
      "/reports/dental_audit.pdf",
      88
    );
    assert.strictEqual(waResult.status, "mock_sent", "WhatsApp status must be 'mock_sent'");
    assert(
      waResult.sid && waResult.sid.startsWith("MOCK_SID_"),
      "WhatsApp sid must start with 'MOCK_SID_'"
    );

    // Verify exact log prefixes
    assert(
      interceptedLogs.some((log) => log.includes("[MOCK WHATSAPP] → Client: client_pune_01")),
      "Missing client log prefix"
    );
    assert(
      interceptedLogs.some((log) => log.includes("[MOCK WHATSAPP] → Score:  88/100")),
      "Missing score log prefix"
    );
    assert(
      interceptedLogs.some((log) =>
        log.includes("[MOCK WHATSAPP] → Report: /reports/dental_audit.pdf")
      ),
      "Missing report log prefix"
    );
  } finally {
    console.log = originalConsoleLog;
  }
  console.log("  ✔ Twilio WhatsApp execution, log prefixes, and return shape verified.");

  // ---------------------------------------------------------------------------
  // 6. Provider Abstractions & USE_MOCKS Switch Behavior
  // ---------------------------------------------------------------------------
  console.log("\n[6/6] Verifying Provider abstractions with USE_MOCKS switch...");

  // A. With useMocks: true
  const psMocked = await getPageSpeed("https://example-dental-clinic.com", {
    useMocks: true,
  });
  assert.strictEqual(psMocked.categories.performance.score, 0.61);

  const gscMocked = await getSearchConsoleData("https://example-dental-clinic.com", {
    useMocks: true,
  });
  assert.strictEqual(gscMocked.totalClicks, 167);

  const dfsMocked = await getDataForSEORankings("dental clinic pune", {
    useMocks: true,
  });
  assert.strictEqual(dfsMocked.client_rank_position, 4);

  const waMocked = await sendWhatsApp(
    "client_1",
    "/report.pdf",
    90,
    { useMocks: true }
  );
  assert.strictEqual(waMocked.status, "mock_sent");
  console.log("  ✔ Provider methods successfully return mock fixtures when useMocks = true.");

  // B. With useMocks: false (live mode guard - must NOT silently return mock data)
  let psCaught = false;
  try {
    await getPageSpeed("https://example.com", { useMocks: false });
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) {
      psCaught = true;
    }
  }
  assert(psCaught, "getPageSpeed must throw ProviderNotConfiguredError when useMocks = false without API key");

  let gscCaught = false;
  try {
    await getSearchConsoleData("https://example.com", { useMocks: false });
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) {
      gscCaught = true;
    }
  }
  assert(gscCaught, "getSearchConsoleData must throw ProviderNotConfiguredError when useMocks = false");

  let dfsCaught = false;
  try {
    await getDataForSEORankings("seo", { useMocks: false });
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) {
      dfsCaught = true;
    }
  }
  assert(dfsCaught, "getDataForSEORankings must throw ProviderNotConfiguredError when useMocks = false");

  let waCaught = false;
  try {
    await sendWhatsApp("c1", "/f.pdf", 80, { useMocks: false });
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) {
      waCaught = true;
    }
  }
  assert(waCaught, "sendWhatsApp must throw ProviderNotConfiguredError when useMocks = false");
  console.log("  ✔ Provider methods throw ProviderNotConfiguredError when useMocks = false (no silent mock leaking).");

  console.log("\n==================================================================");
  console.log("🎉 ALL PHASE 3 MOCK INTEGRATION & CONTRACT TESTS PASSED!");
  console.log("==================================================================");
}

runPhase3MockTests().catch((err) => {
  console.error("❌ Phase 3 Mock Test Failure:", err);
  process.exit(1);
});
