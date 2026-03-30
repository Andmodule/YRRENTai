import { existsSync } from 'fs';
import { config } from 'dotenv';
import { join } from 'path';
import { DataSource } from 'typeorm';

// TypeORM CLI does not load Nest ConfigModule. Do not use __dirname — the CLI may load this file as ESM.
const cwd = process.cwd();
const isRepoRoot = existsSync(join(cwd, 'backend', 'package.json'));
const monorepoRoot = isRepoRoot ? cwd : join(cwd, '..');
const backendDir = isRepoRoot ? join(cwd, 'backend') : cwd;
config({ path: join(monorepoRoot, '.env') });
config({ path: join(backendDir, '.env'), override: true });

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
});
