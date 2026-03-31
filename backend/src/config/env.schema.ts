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
});

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3000),

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
  .refine(
    (d) => !d.ZODOMUS_ENABLED || (!!d.ZODOMUS_API_USER && !!d.ZODOMUS_API_PASSWORD),
    {
      message: 'ZODOMUS_API_USER and ZODOMUS_API_PASSWORD required when ZODOMUS_ENABLED=true',
    },
  );

export type EnvConfig = z.infer<typeof envSchema>;
