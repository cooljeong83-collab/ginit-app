#!/usr/bin/env node
/**
 * Firestore `categories` → Supabase `public.meeting_categories` 일괄 upsert.
 * 마이그레이션 `0006_meeting_categories.sql` 적용 후 실행하세요.
 *
 * 환경변수:
 *   GOOGLE_APPLICATION_CREDENTIALS 또는 FIREBASE_SERVICE_ACCOUNT_JSON 또는 FIREBASE_SERVICE_ACCOUNT_PATH
 *   EXPO_PUBLIC_FIREBASE_PROJECT_ID 또는 FIREBASE_PROJECT_ID
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * 실행: node ./scripts/migrate-firestore-categories-to-supabase.mjs
 */
import { createClient } from '@supabase/supabase-js';
import admin from 'firebase-admin';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { initFirebaseAdminForScripts } from './_firebase-admin-init.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../env/.env') });
dotenv.config();

initFirebaseAdminForScripts();
const supabaseUrl = process.env.SUPABASE_URL?.trim() || process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || '';
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';

if (!supabaseUrl || !serviceRole) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const db = admin.firestore();
const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

function toInt(v, fallback = 999) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  return fallback;
}

async function main() {
  const snap = await db.collection('categories').get();
  if (snap.empty) {
    console.log('No documents in Firestore categories collection.');
    return;
  }

  const rows = snap.docs.map((d) => {
    const x = d.data() ?? {};
    const label = typeof x.label === 'string' && x.label.trim() ? x.label.trim() : '이름 없음';
    const emoji = typeof x.emoji === 'string' && x.emoji.trim() ? x.emoji.trim() : '📌';
    return {
      id: d.id,
      label,
      emoji,
      sort_order: toInt(x.order, 999),
    };
  });

  const { error } = await supabase.from('meeting_categories').upsert(rows, { onConflict: 'id' });
  if (error) {
    console.error('Supabase upsert failed:', error.message);
    process.exit(1);
  }
  console.log(`Upserted ${rows.length} categories into public.meeting_categories`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
