import * as cheerio from "cheerio";
import { SchemaOrgInspection, JsonLdBlock, CrawlerFinding } from "@/types";

/**
 * Extracts and safely validates JSON-LD script blocks and Microdata elements
 */
export function inspectStructuredData(html: string): SchemaOrgInspection {
  const $ = cheerio.load(html);
  const jsonLdBlocks: JsonLdBlock[] = [];
  const discoveredTypes = new Set<string>();
  const findings: CrawlerFinding[] = [];

  // 1. JSON-LD Inspection
  $('script[type="application/ld+json"]').each((index, el) => {
    const raw = $(el).text().trim();
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      const typesForBlock: string[] = [];

      const extractTypes = (obj: unknown) => {
        if (!obj || typeof obj !== "object") return;

        if (Array.isArray(obj)) {
          obj.forEach(extractTypes);
          return;
        }

        const record = obj as Record<string, unknown>;
        if (record["@type"]) {
          if (Array.isArray(record["@type"])) {
            record["@type"].forEach((t) => {
              if (typeof t === "string") {
                typesForBlock.push(t);
                discoveredTypes.add(t);
              }
            });
          } else if (typeof record["@type"] === "string") {
            typesForBlock.push(record["@type"]);
            discoveredTypes.add(record["@type"]);
          }
        }

        // Support @graph arrays
        if (Array.isArray(record["@graph"])) {
          record["@graph"].forEach(extractTypes);
        }
      };

      extractTypes(parsed);

      jsonLdBlocks.push({
        valid: true,
        raw: raw.slice(0, 1000), // Bound size
        parsed: parsed as Record<string, unknown>,
        types: typesForBlock,
      });
    } catch (parseErr: unknown) {
      const errorMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      jsonLdBlocks.push({
        valid: false,
        raw: raw.slice(0, 500),
        types: [],
        error: errorMsg,
      });

      findings.push({
        code: "INVALID_JSON_LD",
        category: "Schema",
        severity: "HIGH",
        title: `Invalid JSON-LD Syntax in Block #${index + 1}`,
        description: `Encountered syntax error while parsing application/ld+json script: ${errorMsg}`,
        evidence: raw.slice(0, 150),
        recommendation: "Ensure JSON-LD script contains valid, well-formed JSON format without unescaped quotes or trailing commas.",
        source: "SchemaInspector",
      });
    }
  });

  // 2. Microdata Inspection
  const microdataItems = $("[itemscope]");
  const hasMicrodata = microdataItems.length > 0;
  const microdataTypes: string[] = [];

  microdataItems.each((_, el) => {
    const itemType = $(el).attr("itemtype");
    if (itemType) {
      const typeName = itemType.split("/").pop() || itemType;
      if (!microdataTypes.includes(typeName)) {
        microdataTypes.push(typeName);
        discoveredTypes.add(typeName);
      }
    }
  });

  // 3. Schema general findings
  if (jsonLdBlocks.length === 0 && !hasMicrodata) {
    findings.push({
      code: "NO_STRUCTURED_DATA",
      category: "Schema",
      severity: "MEDIUM",
      title: "No Schema.org Structured Data Detected",
      description: "Page lacks JSON-LD script blocks and Microdata markup for search engine rich results.",
      evidence: "0 JSON-LD blocks found",
      recommendation: "Implement JSON-LD Schema.org entities (such as Organization, WebSite, or specific entity types) to enhance search visibility.",
      source: "SchemaInspector",
    });
  }

  return {
    jsonLdBlocksCount: jsonLdBlocks.length,
    jsonLdBlocks,
    discoveredTypes: Array.from(discoveredTypes),
    hasMicrodata,
    microdataTypes,
    findings,
  };
}
