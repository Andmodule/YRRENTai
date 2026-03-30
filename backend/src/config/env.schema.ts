import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),

  DATABASE_URL: z.string().url(),

  JWT_SECRET: z.string().min(16),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  AI_PROVIDER: z.enum(['deepseek', 'openai']).default('deepseek'),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.string().url().default('https://api.deepseek.com'),
  OPENAI_API_KEY: z.string().optional(),

  VOICE_PROVIDER: z.enum(['google', 'yandex', 'openai']).default('google'),
  GOOGLE_TTS_KEY: z.string().optional(),

  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./uploads'),

  CORS_ORIGINS: z.string().default('http://localhost:3001,http://localhost:3012'),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),

  FF_VOICE_ENABLED: z.coerce.boolean().default(false),
  FF_REALTIME_CALLS_ENABLED: z.coerce.boolean().default(false),
});

export type EnvConfig = z.infer<typeof envSchema>;
