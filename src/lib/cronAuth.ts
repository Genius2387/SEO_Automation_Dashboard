import { NextRequest } from "next/server";

/**
 * Validates the caller's CRON_SECRET from authorization header or x-cron-secret.
 * In production:
 *   - CRON_SECRET must be explicitly configured in the environment.
 *   - The predictable development default ('dev-cron-secret-12345') is strictly rejected.
 *   - Any missing, empty, or default secret fails closed (401 Unauthorized).
 * In development / test:
 *   - Uses CRON_SECRET if provided; otherwise allows development default for local testing.
 */
export function isAuthorizedCronRequest(req: NextRequest): boolean {
  const isProduction = process.env.NODE_ENV === "production";
  const configuredSecret = process.env.CRON_SECRET?.trim();

  let expectedSecret: string | null = null;

  if (isProduction) {
    if (!configuredSecret || configuredSecret === "dev-cron-secret-12345") {
      console.error(
        "[Cron Auth] In production, CRON_SECRET must be explicitly set to a secure, non-default value."
      );
      return false;
    }
    expectedSecret = configuredSecret;
  } else {
    // In development or test, fall back to dev default only if unset
    expectedSecret = configuredSecret || "dev-cron-secret-12345";
  }

  if (!expectedSecret) {
    return false;
  }

  const headerSecret = req.headers.get("x-cron-secret")?.trim();
  const authHeader = req.headers.get("authorization");
  const bearerSecret = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;

  const provided = headerSecret || bearerSecret;
  return Boolean(provided && provided === expectedSecret);
}

