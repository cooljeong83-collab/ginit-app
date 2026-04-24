#!/usr/bin/env node
/**
 * Firestore `users` → Supabase `public.profiles` 일괄 upsert (app_user_id = Firestore 문서 ID).
 *
 * 필요:
 *   npm i -D firebase-admin dotenv   (firebase-admin은 devDependency 권장)
 *
 * 환경변수:
 *   GOOGLE_APPLICATION_CREDENTIALS  — Firebase Admin 서비스 계정 JSON 파일 경로
 *   EXPO_PUBLIC_FIREBASE_PROJECT_ID 또는 FIREBASE_PROJECT_ID
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY       — 서버 전용, 절대 앱에 넣지 말 것
 *
 * 실행: node ./scripts/migrate-firestore-users-to-supabase.mjs
 */
import { createClient } from '@supabase/supabase-js';
import admin from 'firebase-admin';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../env/.env') });
dotenv.config();

const projectId =
  process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID?.trim() ||
  process.env.FIREBASE_PROJECT_ID?.trim() ||
  '';
const supabaseUrl = process.env.SUPABASE_URL?.trim() || process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || '';
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';

if (!projectId) {
  console.error('Missing EXPO_PUBLIC_FIREBASE_PROJECT_ID or FIREBASE_PROJECT_ID');
  process.exit(1);
}
if (!supabaseUrl || !serviceRole) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({ projectId });
}

const db = admin.firestore();
const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

function toInt(v, fallback = null) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  return fallback;
}

async function main() {
  const snap = await db.collection('users').get();
  let ok = 0;
  let fail = 0;
  for (const doc of snap.docs) {
    const appUserId = doc.id;
    const d = doc.data() ?? {};

    const row = {
      app_user_id: appUserId,
      nickname: typeof d.nickname === 'string' && d.nickname.trim() ? d.nickname.trim() : '모임친구',
      photo_url: typeof d.photoUrl === 'string' && d.photoUrl.trim() ? d.photoUrl.trim() : null,
      phone: typeof d.phone === 'string' && d.phone.trim() ? d.phone.trim() : null,
      email: typeof d.email === 'string' && d.email.trim() ? d.email.trim() : null,
      display_name: typeof d.displayName === 'string' && d.displayName.trim() ? d.displayName.trim() : null,
      gender: typeof d.gender === 'string' && d.gender.trim() ? d.gender.trim() : null,
      birth_year: toInt(d.birthYear),
      birth_month: toInt(d.birthMonth),
      birth_day: toInt(d.birthDay),
      g_level: toInt(d.gLevel, 1),
      g_xp: typeof d.gXp === 'number' && Number.isFinite(d.gXp) ? Math.trunc(d.gXp) : 0,
      g_trust: toInt(d.gTrust, 100),
      g_dna: typeof d.gDna === 'string' && d.gDna.trim() ? d.gDna.trim() : 'Explorer',
      meeting_count: toInt(d.meetingCount, 0),
      ranking_points: toInt(d.rankingPoints, 0),
      is_withdrawn: d.isWithdrawn === true,
    };

    const { error } = await supabase.from('profiles').upsert(row, { onConflict: 'app_user_id' });
    if (error) {
      console.error(`[fail] ${appUserId}`, error.message);
      fail += 1;
    } else {
      ok += 1;
    }
  }
  console.log(`Done. upserted=${ok} failed=${fail} total_docs=${snap.size}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
