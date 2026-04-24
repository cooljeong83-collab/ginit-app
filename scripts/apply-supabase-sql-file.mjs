#!/usr/bin/env node
/**
 * 원격 Supabase Postgres에 SQL 파일을 실행합니다 (로컬/CI 전용).
 *
 * env/.env 에 다음 중 하나를 넣어 두세요:
 *   SUPABASE_DB_URL=postgresql://postgres.[ref]:[PASSWORD]@aws-0-....pooler.supabase.com:6543/postgres
 * (대시보드: Project Settings → Database → Connection string → URI)
 *
 * 사용:
 *   node ./scripts/apply-supabase-sql-file.mjs supabase/migrations/0005_profile_avatars_storage.sql
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../env/.env') });
dotenv.config();

const sqlFile = process.argv[2]?.trim();
const dbUrl = process.env.SUPABASE_DB_URL?.trim() || process.env.DATABASE_URL?.trim() || '';

if (!sqlFile) {
  console.error('사용법: node ./scripts/apply-supabase-sql-file.mjs <sql-파일-경로>');
  process.exit(1);
}
if (!dbUrl) {
  console.error(
    'SUPABASE_DB_URL(또는 DATABASE_URL)이 env/.env 에 없습니다.\n' +
      'Supabase 대시보드 → Project Settings → Database → Connection string → URI 를 복사해 넣은 뒤 다시 실행하세요.',
  );
  process.exit(1);
}

const abs = path.isAbsolute(sqlFile) ? sqlFile : path.resolve(process.cwd(), sqlFile);
const r = spawnSync(
  'npx',
  ['--yes', 'supabase@latest', 'db', 'query', '-f', abs, '--db-url', dbUrl],
  { stdio: 'inherit', shell: false },
);
process.exit(r.status ?? 1);
