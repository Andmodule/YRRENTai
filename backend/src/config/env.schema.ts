import { z } from 'zod';

const zodomusEnvFields = z.object({
  /** Explicit string enum — avoid z.coerce.boolean() on env strings (Boolean("false") === true). */
  ZODOMUS_ENABLED: z
    .enum(['true', 'false', '1', '0', 'yes', 'no'])
    .default('false')
    .transform((v) => v === 'true' || v === '1' || v === 'yes'),
  ZODOMUS_API_USER: z.string().optional(),
  ZODOMUS_API_PASSWORD: z.string().optional(),
  ZODOMUS_BASE_URL: z.string().url().default('https://api.zodomus.com'),
  ZODOMUS_API_PASSWORD_CC: z.string().optional(),
  /** Zodomus property id for doc/zodomus/fetch-samples.mjs step 3 only (not used by Nest at runtime). */
  ZODOMUS_SAMPLE_PROPERTY_ID: z.string().optional(),
  /**
   * Webhook key from Zodomus backoffice (Development → Webhook Key).
   * Sent in the POST body by Zodomus on every reservation event.
   * If not set, webhook key validation is skipped (not recommended in production).
   */
  ZODOMUS_WEBHOOK_KEY: z.string().optional(),
  /** How often (minutes) to poll reservations-queue as a backup to webhooks. Default: 15. */
  ZODOMUS_POLL_INTERVAL_MINUTES: z.coerce.number().min(1).max(1440).default(15),
});

const icalEnvFields = z.object({
  /** How often (minutes) to re-import all iCal URLs. Default: 60. */
  ICAL_POLL_INTERVAL_MINUTES: z.coerce.number().min(1).max(1440).default(60),
});

const resendEnvFields = z.object({
  RESEND_API_KEY: z.string().optional(),
  /** Svix signing secret from Resend inbound webhook. Omit in dev to skip verification (not for production). */
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  RESEND_INBOUND_DOMAIN: z.string().optional(),
  /** Default owner (user UUID) for inbound email when not resolved from routing. Required for POST /webhooks/resend to work. */
  RESEND_DEFAULT_OWNER_ID: z.string().uuid().optional(),
  /**
   * Property UUID for mirroring inbound email into the chat inbox (`conversations` / `chat_messages`).
   * If unset, the first property owned by RESEND_DEFAULT_OWNER_ID is used.
   */
  RESEND_INBOUND_PROPERTY_ID: z.string().uuid().optional(),
});

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3000),
    /**
     * HTTP bind address. Default `::` (dual-stack: IPv4 + IPv6) so `localhost` → [::1] works with cloudflared on Windows.
     * Use `0.0.0.0` only if you need IPv4-only and point cloudflared at `http://127.0.0.1:PORT` instead of `localhost`.
     */
    HOST: z.string().default('::'),

    DATABASE_URL: z.string().url(),

    JWT_SECRET: z.string().min(16),
    JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

    /** When true (production): httpOnly cookies use SameSite=None; Secure — required for SPA on another origin (e.g. Vercel) talking to API on Render. */
    AUTH_COOKIE_CROSS_SITE: z.coerce.boolean().default(false),

    AI_PROVIDER: z.enum(['deepseek', 'openai']).default('deepseek'),
    DEEPSEEK_API_KEY: z.string().optional(),
    DEEPSEEK_BASE_URL: z.string().url().default('https://api.deepseek.com'),
    OPENAI_API_KEY: z.string().optional(),

    VOICE_PROVIDER: z.enum(['google', 'yandex', 'openai']).default('google'),
    GOOGLE_TTS_KEY: z.string().optional(),

    STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_PATH: z.string().default('./uploads'),

    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3001,http://localhost:3012,http://localhost:3013'),

    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_WEBHOOK_SECRET: z.string().optional(),

    FF_VOICE_ENABLED: z.coerce.boolean().default(false),
    FF_REALTIME_CALLS_ENABLED: z.coerce.boolean().default(false),
  })
  .merge(zodomusEnvFields)
  .merge(icalEnvFields)
  .merge(resendEnvFields)
  .refine(
    (d) => !d.ZODOMUS_ENABLED || (!!d.ZODOMUS_API_USER && !!d.ZODOMUS_API_PASSWORD),
    {
      message: 'ZODOMUS_API_USER and ZODOMUS_API_PASSWORD required when ZODOMUS_ENABLED=true',
    },
  );

export type EnvConfig = z.infer<typeof envSchema>;
