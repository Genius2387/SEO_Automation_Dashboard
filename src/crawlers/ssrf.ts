import dns from "node:dns/promises";
import net from "node:net";

export class SSRFValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SSRFValidationError";
  }
}

/**
 * Checks whether an IPv4 address belongs to a private, loopback, or reserved range
 */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true; // Malformed IP treated as unsafe
  }

  const [a, b] = parts;

  // 0.0.0.0/8: Current network
  if (a === 0) return true;

  // 10.0.0.0/8: Private
  if (a === 10) return true;

  // 127.0.0.0/8: Loopback
  if (a === 127) return true;

  // 100.64.0.0/10: Shared Address Space / Carrier-Grade NAT
  if (a === 100 && b >= 64 && b <= 127) return true;

  // 169.254.0.0/16: Link-Local / Cloud Instance Metadata (e.g. AWS 169.254.169.254)
  if (a === 169 && b === 254) return true;

  // 172.16.0.0/12: Private
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.168.0.0/16: Private
  if (a === 192 && b === 168) return true;

  // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24: Documentation / TEST-NET
  if (a === 192 && b === 0 && parts[2] === 2) return true;
  if (a === 198 && b === 51 && parts[2] === 100) return true;
  if (a === 203 && b === 0 && parts[2] === 113) return true;

  // 224.0.0.0/4: Multicast & 240.0.0.0/4: Reserved
  if (a >= 224) return true;

  return false;
}

/**
 * Checks whether an IPv6 address belongs to a private, loopback, or reserved range
 */
export function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  // Loopback & Unspecified
  if (normalized === "::1" || normalized === "::") return true;

  // IPv4-mapped IPv6 address (::ffff:192.0.2.128)
  if (normalized.startsWith("::ffff:")) {
    const ipv4Part = normalized.substring(7);
    if (net.isIPv4(ipv4Part)) {
      return isPrivateIPv4(ipv4Part);
    }
  }

  // Unique Local Addresses (fc00::/7 -> fc.. or fd..)
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;

  // Link-Local (fe80::/10 -> fe8, fe9, fea, feb)
  if (
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true;
  }

  return false;
}

/**
 * Comprehensive IP safety check against private/reserved/internal addresses
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const ipType = net.isIP(ip);
  if (ipType === 4) {
    return isPrivateIPv4(ip);
  }
  if (ipType === 6) {
    return isPrivateIPv6(ip);
  }
  return true; // Not a recognized valid IP
}

/**
 * Validates a submitted URL against SSRF and protocol restrictions
 */
export async function validateUrlForCrawl(
  rawUrl: string
): Promise<{ valid: boolean; normalizedUrl: string; error?: string }> {
  if (!rawUrl || typeof rawUrl !== "string") {
    return { valid: false, normalizedUrl: "", error: "Target URL is required." };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { valid: false, normalizedUrl: "", error: "Malformed or invalid target URL format." };
  }

  // Protocol whitelist
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      valid: false,
      normalizedUrl: "",
      error: `Unsupported protocol '${parsed.protocol}'. Only 'http:' and 'https:' are permitted.`,
    };
  }

  // Reject embedded credentials
  if (parsed.username || parsed.password) {
    return {
      valid: false,
      normalizedUrl: "",
      error: "URLs containing embedded credentials (user:pass@) are disallowed.",
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Hostname string checks
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    return {
      valid: false,
      normalizedUrl: "",
      error: `Access to local/internal host '${hostname}' is rejected by security policy (SSRF protection).`,
    };
  }

  // If hostname is directly an IP literal
  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      return {
        valid: false,
        normalizedUrl: "",
        error: `Access to private or reserved IP '${hostname}' is disallowed.`,
      };
    }
  } else {
    // Resolve hostname to IP to protect against DNS rebinding & private intranet names
    try {
      const records = await dns.lookup(hostname, { all: true });
      if (!records || records.length === 0) {
        return {
          valid: false,
          normalizedUrl: "",
          error: `DNS resolution failed for hostname '${hostname}'.`,
        };
      }

      for (const rec of records) {
        if (isPrivateOrReservedIp(rec.address)) {
          return {
            valid: false,
            normalizedUrl: "",
            error: `Hostname '${hostname}' resolves to private/reserved IP '${rec.address}', which is disallowed.`,
          };
        }
      }
    } catch (dnsErr: unknown) {
      const msg = dnsErr instanceof Error ? dnsErr.message : String(dnsErr);
      return {
        valid: false,
        normalizedUrl: "",
        error: `DNS lookup failed for host '${hostname}': ${msg}`,
      };
    }
  }

  return {
    valid: true,
    normalizedUrl: parsed.toString(),
  };
}
