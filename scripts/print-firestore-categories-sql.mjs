#!/usr/bin/env node
/**
 * Firestore `categories` 컬렉션을 읽어 Supabase용 INSERT … ON CONFLICT SQL을 stdout에 출력합니다.
 *
 *   EXPO_PUBLIC_FIREBASE_PROJECT_ID 또는 FIREBASE_PROJECT_ID
 *   + 서비스 계정 (아래 중 하나):
 *     GOOGLE_APPLICATION_CREDENTIALS=/절대/경로/xxx.json
 *     또는 FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
 *     또는 FIREBASE_SERVICE_ACCOUNT_PATH=./로컬만있는키.json
 *
 * 사용:
 *   node ./scripts/print-firestore-categories-sql.mjs > ./supabase/seed/generated_categories.sql
 */
import admin from 'firebase-admin';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { initFirebaseAdminForScripts } from './_firebase-admin-init.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../env/.env') });
dotenv.config();

const projectId = initFirebaseAdminForScripts();

function sqlString(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function toInt(v, fallback = 999) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  return fallback;
}

async function main() {
  const snap = await admin.firestore().collection('categories').get();
  if (snap.empty) {
    console.log('-- No documents in Firestore collection `categories`');
    console.log('begin;\ncommit;');
    return;
  }

  const rows = snap.docs.map((d) => {
    const x = d.data() ?? {};
    const id = d.id;
    const label = typeof x.label === 'string' && x.label.trim() ? x.label.trim() : '이름 없음';
    const emoji = typeof x.emoji === 'string' && x.emoji.trim() ? x.emoji.trim() : '📌';
    const order = toInt(x.order, 999);
    return `  (${sqlString(id)}, ${sqlString(label)}, ${sqlString(emoji)}, ${order})`;
  });

  console.log(`-- Generated from Firestore project ${projectId} at ${new Date().toISOString()}`);
  console.log('-- Table: public.meeting_categories (see migration 0006)');
  console.log('');
  console.log('begin;');
  console.log('');
  console.log('insert into public.meeting_categories (id, label, emoji, sort_order)');
  console.log('values');
  console.log(rows.join(',\n'));
  console.log('on conflict (id) do update set');
  console.log('  label = excluded.label,');
  console.log('  emoji = excluded.emoji,');
  console.log('  sort_order = excluded.sort_order,');
  console.log('  updated_at = now();');
  console.log('');
  console.log('commit;');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
