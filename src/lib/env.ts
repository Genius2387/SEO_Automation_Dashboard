import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_URL: z.string().optional(),
  REDIS_URL: z.string().min(1, "REDIS_URL is required").default("redis://localhost:6379"),
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-6"),
  USE_MOCKS: z
    .union([z.string(), z.boolean()])
    .transform((val) => val === true || val === "true" || val === "1")
    .default(true),
  CRON_SECRET: z
    .string()
    .min(1, "CRON_SECRET is required")
    .refine(
      (val) => {
        if (process.env.NODE_ENV === "production") {
          return val !== "dev-cron-secret-12345";
        }
        return true;
      },
      { message: "In production, CRON_SECRET cannot use the development default 'dev-cron-secret-12345'." }
    )
    .optional()
    .default(process.env.NODE_ENV === "production" ? (undefined as unknown as string) : "dev-cron-secret-12345"),
  ADMIN_SECRET_KEY: z.string().optional().default("dev-admin-secret"),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error("❌ Invalid environment variables:", JSON.stringify(result.error.format(), null, 2));
    // In build mode or testing, provide graceful fallback if running in mock mode
    if (process.env.USE_MOCKS === "true" || process.env.NODE_ENV !== "production") {
      console.warn("⚠️ Warning: Running with fallback environment variables because USE_MOCKS is active.");
      return envSchema.parse({
        NODE_ENV: process.env.NODE_ENV || "development",
        NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
        DATABASE_URL: process.env.DATABASE_URL || "postgresql://mock:mock@localhost:5432/mock",
        REDIS_URL: process.env.REDIS_URL || "redis://localhost:6379",
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "mock-anthropic-key",
        ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
        USE_MOCKS: "true",
        CRON_SECRET: process.env.CRON_SECRET || "dev-cron-secret-12345",
        ADMIN_SECRET_KEY: process.env.ADMIN_SECRET_KEY || "dev-admin-secret",
      });
    }
    throw new Error("Invalid environment variables. Check .env configuration.");
  }

  return result.data;
}

export const env = parseEnv();
