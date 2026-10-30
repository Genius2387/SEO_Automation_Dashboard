import * as cheerio from "cheerio";

export interface OnPageExtractionResult {
  title: {
    text: string;
    exists: boolean;
    length: number;
    status: "OPTIMAL" | "TOO_SHORT" | "TOO_LONG" | "MISSING";
    multipleCount: number;
  };
  metaDescription: {
    text: string;
    exists: boolean;
    length: number;
    status: "OPTIMAL" | "TOO_SHORT" | "TOO_LONG" | "MISSING";
  };
  canonical: {
    url: string | null;
    count: number;
    isValid: boolean;
    matchesFinalUrl: boolean;
  };
  headings: {
    h1: string[];
    h2: string[];
    h3: string[];
    h1Count: number;
    h2Count: number;
    h3Count: number;
  };
  images: {
    totalCount: number;
    withAltCount: number;
    missingAltCount: number;
    decorativeCount: number;
    sample: {
      src: string;
      alt: string;
      hasAlt: boolean;
      isDecorative: boolean;
    }[];
  };
  links: {
    totalInternal: number;
    totalExternal: number;
    emptyHrefCount: number;
    sampleInternal: string[];
    sampleExternal: string[];
  };
  metadata: {
    metaRobots: string | null;
    xRobotsTag: string | null;
    lang: string | null;
    favicon: string | null;
    viewport: string | null;
    openGraph: {
      title?: string;
      description?: string;
      image?: string;
    };
    wordCount: number;
  };
}

export function extractOnPageSignals(
  html: string,
  finalUrl: string,
  xRobotsHeader: string | null = null
): OnPageExtractionResult {
  const $ = cheerio.load(html);

  // 1. Title
  const titleElements = $("title");
  const titleCount = titleElements.length;
  const titleText = titleElements.first().text().trim();
  const titleExists = titleText.length > 0;
  const titleLength = titleText.length;

  let titleStatus: "OPTIMAL" | "TOO_SHORT" | "TOO_LONG" | "MISSING" = "OPTIMAL";
  if (!titleExists) {
    titleStatus = "MISSING";
  } else if (titleLength < 30) {
    titleStatus = "TOO_SHORT";
  } else if (titleLength > 60) {
    titleStatus = "TOO_LONG";
  }

  // 2. Meta Description
  const metaDescAttr = $('meta[name="description" i]').attr("content");
  const metaDescText = metaDescAttr ? metaDescAttr.trim() : "";
  const metaDescExists = metaDescText.length > 0;
  const metaDescLength = metaDescText.length;

  let metaDescStatus: "OPTIMAL" | "TOO_SHORT" | "TOO_LONG" | "MISSING" = "OPTIMAL";
  if (!metaDescExists) {
    metaDescStatus = "MISSING";
  } else if (metaDescLength < 120) {
    metaDescStatus = "TOO_SHORT";
  } else if (metaDescLength > 160) {
    metaDescStatus = "TOO_LONG";
  }

  // 3. Canonical
  const canonicalLinks = $('link[rel="canonical" i]');
  const canonicalCount = canonicalLinks.length;
  const rawCanonical = canonicalLinks.first().attr("href")?.trim() || null;

  let isValidCanonical = false;
  let matchesFinalUrl = false;

  if (rawCanonical) {
    try {
      const parsedCanonical = new URL(rawCanonical, finalUrl);
      isValidCanonical = true;
      const parsedFinal = new URL(finalUrl);
      // Compare origin and path ignoring trailing slashes
      matchesFinalUrl =
        parsedCanonical.origin === parsedFinal.origin &&
        parsedCanonical.pathname.replace(/\/$/, "") ===
          parsedFinal.pathname.replace(/\/$/, "");
    } catch {
      isValidCanonical = false;
    }
  }

  // 4. Headings
  const h1: string[] = [];
  $("h1").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text) h1.push(text);
  });

  const h2: string[] = [];
  $("h2").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text) h2.push(text);
  });

  const h3: string[] = [];
  $("h3").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text) h3.push(text);
  });

  // 5. Images
  let totalImages = 0;
  let withAltCount = 0;
  let missingAltCount = 0;
  let decorativeCount = 0;
  const imageSample: OnPageExtractionResult["images"]["sample"] = [];

  $("img").each((_, el) => {
    totalImages++;
    const src = $(el).attr("src") || $(el).attr("data-src") || "";
    const altAttr = $(el).attr("alt");

    const hasAlt = typeof altAttr === "string" && altAttr.trim().length > 0;
    const isDecorative = typeof altAttr === "string" && altAttr.trim().length === 0;

    if (hasAlt) {
      withAltCount++;
    } else if (isDecorative) {
      decorativeCount++;
    } else {
      missingAltCount++;
    }

    if (imageSample.length < 25 && src) {
      imageSample.push({
        src: src.slice(0, 200),
        alt: altAttr ? altAttr.slice(0, 100) : "",
        hasAlt,
        isDecorative,
      });
    }
  });

  // 6. Links
  let totalInternal = 0;
  let totalExternal = 0;
  let emptyHrefCount = 0;
  const sampleInternal: string[] = [];
  const sampleExternal: string[] = [];

  let finalHostname = "";
  try {
    finalHostname = new URL(finalUrl).hostname.toLowerCase();
  } catch {
    finalHostname = "";
  }

  $("a").each((_, el) => {
    const href = $(el).attr("href");

    if (!href || href.trim() === "" || href.trim().startsWith("#")) {
      emptyHrefCount++;
      return;
    }

    const trimmedHref = href.trim();
    if (
      trimmedHref.startsWith("javascript:") ||
      trimmedHref.startsWith("mailto:") ||
      trimmedHref.startsWith("tel:")
    ) {
      return;
    }

    try {
      const resolved = new URL(trimmedHref, finalUrl);
      const isInternal = resolved.hostname.toLowerCase() === finalHostname;

      if (isInternal) {
        totalInternal++;
        if (sampleInternal.length < 25 && !sampleInternal.includes(resolved.href)) {
          sampleInternal.push(resolved.href);
        }
      } else {
        totalExternal++;
        if (sampleExternal.length < 25 && !sampleExternal.includes(resolved.href)) {
          sampleExternal.push(resolved.href);
        }
      }
    } catch {
      emptyHrefCount++;
    }
  });

  // 7. Metadata
  const metaRobots = $('meta[name="robots" i]').attr("content")?.trim() || null;
  const lang = $("html").attr("lang")?.trim() || null;
  const favicon =
    $('link[rel="icon" i], link[rel="shortcut icon" i]').attr("href")?.trim() ||
    null;
  const viewport = $('meta[name="viewport" i]').attr("content")?.trim() || null;

  const ogTitle = $('meta[property="og:title" i]').attr("content")?.trim();
  const ogDescription = $(
    'meta[property="og:description" i]'
  ).attr("content")?.trim();
  const ogImage = $('meta[property="og:image" i]').attr("content")?.trim();

  // Document word count
  // Remove script and style tags before extracting visible text
  $("script, style, noscript, svg").remove();
  const visibleText = $("body").text().replace(/\s+/g, " ").trim();
  const words = visibleText ? visibleText.split(/\s+/).filter(Boolean) : [];
  const wordCount = words.length;

  return {
    title: {
      text: titleText,
      exists: titleExists,
      length: titleLength,
      status: titleStatus,
      multipleCount: titleCount,
    },
    metaDescription: {
      text: metaDescText,
      exists: metaDescExists,
      length: metaDescLength,
      status: metaDescStatus,
    },
    canonical: {
      url: rawCanonical,
      count: canonicalCount,
      isValid: isValidCanonical,
      matchesFinalUrl,
    },
    headings: {
      h1,
      h2,
      h3,
      h1Count: h1.length,
      h2Count: h2.length,
      h3Count: h3.length,
    },
    images: {
      totalCount: totalImages,
      withAltCount,
      missingAltCount,
      decorativeCount,
      sample: imageSample,
    },
    links: {
      totalInternal,
      totalExternal,
      emptyHrefCount,
      sampleInternal,
      sampleExternal,
    },
    metadata: {
      metaRobots,
      xRobotsTag: xRobotsHeader,
      lang,
      favicon,
      viewport,
      openGraph: {
        title: ogTitle,
        description: ogDescription,
        image: ogImage,
      },
      wordCount,
    },
  };
}
