import { z } from 'zod';

/** `.env` often has `KEY=` (empty); that is not `undefined`, so `z.string().url().optional()` would fail. */
const optionalUrlEnv = () =>
  z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.string().url().optional(),
  );

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
  /** Default OTA channel id for queue sync and availability push (e.g. 1 = Booking.com). */
  ZODOMUS_DEFAULT_CHANNEL_ID: z.coerce.number().int().positive().default(1),
  /** Push computed availability to Zodomus after local booking changes. Default: true. */
  ZODOMUS_AUTO_PUSH_AVAILABILITY: z
    .enum(['true', 'false', '1', '0', 'yes', 'no'])
    .default('true')
    .transform((v) => v === 'true' || v === '1' || v === 'yes'),
  /** How many future nights to send to POST /availability (max 730). Default: 366. */
  ZODOMUS_AVAILABILITY_HORIZON_DAYS: z.coerce.number().int().min(1).max(730).default(366),
  /** Coalesce rapid booking updates into one push per property (ms). 0 = no debounce. Default: 2000. */
  ZODOMUS_AVAILABILITY_PUSH_DEBOUNCE_MS: z.coerce.number().int().min(0).max(60_000).default(2000),
  /** Retry properties with zodomusAvailabilityDirty on this interval (minutes). Default: 15. */
  ZODOMUS_AVAILABILITY_DIRTY_RETRY_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  /** Nightly full availability push for all Zodomus-linked properties (drift guard). Default: true. */
  ZODOMUS_AVAILABILITY_NIGHTLY_FULL_PUSH: z
    .enum(['true', 'false', '1', '0', 'yes', 'no'])
    .default('true')
    .transform((v) => v === 'true' || v === '1' || v === 'yes'),
  /** UTC hour (0–23) to run nightly push. Default: 3. */
  ZODOMUS_AVAILABILITY_NIGHTLY_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(3),
  /** Pause between properties during dirty retry / nightly (ms). Default: 1000. */
  ZODOMUS_AVAILABILITY_BATCH_GAP_MS: z.coerce.number().int().min(0).max(60_000).default(1000),
  /** Pause between GET /reservations calls when draining the queue (rate-limit / channel throttling). Default: 400. */
  ZODOMUS_QUEUE_ITEM_DELAY_MS: z.coerce.number().int().min(0).max(30_000).default(400),
  /** Per-attempt HTTP timeout for Zodomus upstream fetch (ms). Retries use a fresh timer each attempt. Default: 8000. */
  ZODOMUS_FETCH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(8000),
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
   * Property UUID for mirroring **direct** (non-OTA) inbound email into the chat inbox when routing gives no listing.
   * Booking/Airbnb never use this as a fallback after failed hotel/reservation/name match — inbox sync is skipped instead.
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

    /**
     * When false, `POST /auth/register` returns 403. Use in production to close public sign-up
     * (invite-only / admin-provisioned tenants).
     */
    AUTH_PUBLIC_REGISTRATION_ENABLED: z
      .enum(['true', 'false', '1', '0', 'yes', 'no'])
      .default('true')
      .transform((v) => v === 'true' || v === '1' || v === 'yes'),

    AI_PROVIDER: z.enum(['deepseek', 'openai']).default('deepseek'),
    DEEPSEEK_API_KEY: z.string().optional(),
    DEEPSEEK_BASE_URL: z.string().url().default('https://api.deepseek.com'),
    OPENAI_API_KEY: z.string().optional(),

    /** Whisper STT: default language hint (ISO 639-1). Client may override via multipart `language`. */
    VOICE_PARSE_LANGUAGE: z.string().optional().default('ru'),
    VOICE_PARSE_WHISPER_MODEL: z.string().optional().default('whisper-1'),
    /** LLM for voice JSON extraction (defaults: gpt-4o-mini / deepseek-chat). */
    VOICE_PARSE_LLM_MODEL: z.string().optional(),
    /**
     * OpenAI-compatible speech-to-text (Whisper) base URL, e.g. https://api.openai.com/v1 or https://api.groq.com/openai/v1.
     * Use with `VOICE_PARSE_STT_API_KEY`. DeepSeek chat API does not include STT — point this at a Whisper host.
     */
    VOICE_PARSE_STT_BASE_URL: optionalUrlEnv(),
    /** API key for `VOICE_PARSE_STT_BASE_URL` only. */
    VOICE_PARSE_STT_API_KEY: z.string().optional(),
    /** Groq Cloud — `whisper-large-v3` STT for `POST /tasks/voice-parse` (OpenAI-compatible client). */
    GROQ_API_KEY: z.string().optional(),
    /** Groq transcription model (default: whisper-large-v3). */
    VOICE_PARSE_GROQ_WHISPER_MODEL: z.string().optional().default('whisper-large-v3'),

    VOICE_PROVIDER: z.enum(['google', 'yandex', 'openai']).default('google'),
    GOOGLE_TTS_KEY: z.string().optional(),

    STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_PATH: z.string().default('./uploads'),

    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3001,http://localhost:3012,http://localhost:3013'),

    TELEGRAM_BOT_TOKEN: z.string().optional(),
    /** Bot @username without "t.me/" — used for staff invite deep links `https://t.me/<username>?start=`. */
    TELEGRAM_BOT_USERNAME: z.string().optional(),
    /** Public HTTPS URL of the Telegram Mini App (e.g. https://app.example.com/ru/tma/tasks). */
    TELEGRAM_MINI_APP_URL: optionalUrlEnv(),
    /**
     * Manager web dashboard base URL for Telegram incident buttons (e.g. https://app.example.com/en/dashboard).
     * Must be HTTPS in production. Path `/incidents?incident=<uuid>` is appended.
     */
    MANAGER_WEB_APP_URL: optionalUrlEnv(),
    TELEGRAM_WEBHOOK_SECRET: z.string().optional(),

    /** Redis URL for BullMQ (Telegram escalation queue). If unset, escalations use inline retries only. */
    REDIS_URL: z.string().optional(),
    /** Expose GET /api/v1/metrics (Prometheus). Default false. */
    METRICS_ENABLED: z
      .enum(['true', 'false', '1', '0', 'yes', 'no'])
      .default('false')
      .transform((v) => v === 'true' || v === '1' || v === 'yes'),

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
