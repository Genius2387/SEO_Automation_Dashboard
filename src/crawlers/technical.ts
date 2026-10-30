import * as cheerio from "cheerio";
import { RobotsTxtInspection, SitemapInspection } from "@/types";
import { validateUrlForCrawl } from "./ssrf";

const CRAWLER_USER_AGENT = "EdgelinkSEOAuditBot/1.0 (+https://edgelink.tech/bot)";

/**
 * Fetches and analyzes the target domain's robots.txt file
 */
export async function inspectRobotsTxt(
  targetUrl: string,
  timeoutMs: number = 8000
): Promise<RobotsTxtInspection> {
  let origin = "";
  let targetPath = "/";
  try {
    const parsed = new URL(targetUrl);
    origin = parsed.origin;
    targetPath = parsed.pathname || "/";
  } catch {
    return {
      checked: false,
      url: "",
      exists: false,
      statusCode: null,
      isAccessible: false,
      sitemaps: [],
      isTargetDisallowed: false,
      error: "Invalid target URL for robots.txt inspection",
    };
  }

  const robotsUrl = `${origin}/robots.txt`;

  // SSRF check on robots.txt URL
  const ssrf = await validateUrlForCrawl(robotsUrl);
  if (!ssrf.valid) {
    return {
      checked: true,
      url: robotsUrl,
      exists: false,
      statusCode: null,
      isAccessible: false,
      sitemaps: [],
      isTargetDisallowed: false,
      error: ssrf.error || "SSRF validation failed for robots.txt",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(robotsUrl, {
      signal: controller.signal,
      headers: { "User-Agent": CRAWLER_USER_AGENT },
    });

    const statusCode = res.status;
    if (statusCode === 404) {
      return {
        checked: true,
        url: robotsUrl,
        exists: false,
        statusCode: 404,
        isAccessible: true,
        sitemaps: [],
        isTargetDisallowed: false,
      };
    }

    if (!res.ok) {
      return {
        checked: true,
        url: robotsUrl,
        exists: false,
        statusCode,
        isAccessible: false,
        sitemaps: [],
        isTargetDisallowed: false,
        error: `HTTP ${statusCode} encountered while retrieving robots.txt`,
      };
    }

    const text = await res.text();
    const sitemaps: string[] = [];
    const disallowRules: string[] = [];
    const allowRules: string[] = [];

    let currentAgentIsRelevant = false;
    const lines = text.split(/\r?\n/);

    for (const rawLine of lines) {
      const line = rawLine.split("#")[0].trim(); // Strip comments
      if (!line) continue;

      const [directive, ...rest] = line.split(":");
      const key = directive.trim().toLowerCase();
      const val = rest.join(":").trim();

      if (key === "sitemap") {
        if (val && !sitemaps.includes(val)) {
          sitemaps.push(val);
        }
        continue;
      }

      if (key === "user-agent") {
        const agent = val.toLowerCase();
        currentAgentIsRelevant =
          agent === "*" ||
          agent.includes("edgelink") ||
          agent.includes("googlebot");
        continue;
      }

      if (currentAgentIsRelevant) {
        if (key === "disallow" && val) {
          disallowRules.push(val);
        } else if (key === "allow" && val) {
          allowRules.push(val);
        }
      }
    }

    // Evaluate target path against rules
    let isDisallowed = false;
    let matchedRule: string | undefined;

    // Check allow rules first
    const matchingAllow = allowRules.find((rule) => targetPath.startsWith(rule));
    if (!matchingAllow) {
      const matchingDisallow = disallowRules.find((rule) => {
        if (rule === "/") return true;
        return targetPath.startsWith(rule);
      });

      if (matchingDisallow) {
        isDisallowed = true;
        matchedRule = `Disallow: ${matchingDisallow}`;
      }
    } else {
      matchedRule = `Allow: ${matchingAllow}`;
    }

    return {
      checked: true,
      url: robotsUrl,
      exists: true,
      statusCode: 200,
      isAccessible: true,
      sitemaps,
      isTargetDisallowed: isDisallowed,
      matchedRule,
      rawContent: text.slice(0, 1500), // Bounded sample
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      checked: true,
      url: robotsUrl,
      exists: false,
      statusCode: null,
      isAccessible: false,
      sitemaps: [],
      isTargetDisallowed: false,
      error: `Failed to retrieve robots.txt: ${errorMsg}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Inspects XML sitemaps discovered via robots.txt or default conventional /sitemap.xml
 */
export async function inspectSitemap(
  targetUrl: string,
  discoveredSitemaps: string[] = [],
  timeoutMs: number = 8000
): Promise<SitemapInspection> {
  let origin = "";
  try {
    origin = new URL(targetUrl).origin;
  } catch {
    return {
      checked: false,
      discoveredUrls: [],
      primaryUrl: null,
      exists: false,
      statusCode: null,
      isXml: false,
      isSitemapIndex: false,
      urlCount: 0,
      sampleUrls: [],
      error: "Invalid target URL for sitemap inspection",
    };
  }

  const candidateUrls = [...discoveredSitemaps];
  const defaultSitemap = `${origin}/sitemap.xml`;
  if (!candidateUrls.includes(defaultSitemap)) {
    candidateUrls.push(defaultSitemap);
  }

  const primaryUrl = candidateUrls[0] || defaultSitemap;

  // SSRF check on candidate sitemap URL
  const ssrf = await validateUrlForCrawl(primaryUrl);
  if (!ssrf.valid) {
    return {
      checked: true,
      discoveredUrls: candidateUrls,
      primaryUrl,
      exists: false,
      statusCode: null,
      isXml: false,
      isSitemapIndex: false,
      urlCount: 0,
      sampleUrls: [],
      error: ssrf.error || "SSRF validation failed for sitemap URL",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(primaryUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": CRAWLER_USER_AGENT,
        Accept: "application/xml,text/xml,application/xhtml+xml",
      },
    });

    const statusCode = res.status;
    if (!res.ok) {
      return {
        checked: true,
        discoveredUrls: candidateUrls,
        primaryUrl,
        exists: false,
        statusCode,
        isXml: false,
        isSitemapIndex: false,
        urlCount: 0,
        sampleUrls: [],
        error: `Sitemap returned HTTP ${statusCode}`,
      };
    }

    const xml = await res.text();
    // Safety check: max 2MB parse
    if (xml.length > 2 * 1024 * 1024) {
      return {
        checked: true,
        discoveredUrls: candidateUrls,
        primaryUrl,
        exists: true,
        statusCode: 200,
        isXml: true,
        isSitemapIndex: false,
        urlCount: 0,
        sampleUrls: [],
        error: "Sitemap exceeded 2MB size limit",
      };
    }

    const isXml = xml.includes("<?xml") || xml.includes("<urlset") || xml.includes("<sitemapindex");
    if (!isXml) {
      return {
        checked: true,
        discoveredUrls: candidateUrls,
        primaryUrl,
        exists: true,
        statusCode: 200,
        isXml: false,
        isSitemapIndex: false,
        urlCount: 0,
        sampleUrls: [],
        error: "Response content is not valid XML sitemap",
      };
    }

    const $ = cheerio.load(xml, { xmlMode: true });
    const isSitemapIndex = $("sitemapindex").length > 0;

    const urls: string[] = [];
    if (isSitemapIndex) {
      $("sitemap > loc").each((_, el) => {
        const loc = $(el).text().trim();
        if (loc && urls.length < 500) urls.push(loc);
      });
    } else {
      $("url > loc").each((_, el) => {
        const loc = $(el).text().trim();
        if (loc && urls.length < 500) urls.push(loc);
      });
    }

    return {
      checked: true,
      discoveredUrls: candidateUrls,
      primaryUrl,
      exists: true,
      statusCode: 200,
      isXml: true,
      isSitemapIndex,
      urlCount: urls.length,
      sampleUrls: urls.slice(0, 15),
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      checked: true,
      discoveredUrls: candidateUrls,
      primaryUrl,
      exists: false,
      statusCode: null,
      isXml: false,
      isSitemapIndex: false,
      urlCount: 0,
      sampleUrls: [],
      error: `Failed to fetch sitemap: ${errorMsg}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
