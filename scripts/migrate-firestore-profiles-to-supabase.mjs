#!/usr/bin/env node
/**
 * Firestore `users` → Supabase `public.profiles` upsert (`app_user_id` = 문서 ID).
 * 마이그레이션 `0001`~`0004` 적용 후 실행하세요.
 *
 * 환경변수:
 *   GOOGLE_APPLICATION_CREDENTIALS 또는 FIREBASE_SERVICE_ACCOUNT_JSON 또는 FIREBASE_SERVICE_ACCOUNT_PATH
 *   EXPO_PUBLIC_FIREBASE_PROJECT_ID 또는 FIREBASE_PROJECT_ID
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * 선택: `MIGRATE_PROFILES_LIMIT=500` — 처리 문서 수 상한(테스트용)
 *
 * 실행: node ./scripts/migrate-firestore-profiles-to-supabase.mjs
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
const limitRaw = process.env.MIGRATE_PROFILES_LIMIT?.trim();
const docLimit = limitRaw ? Math.max(1, parseInt(limitRaw, 10) || 0) : 0;

if (!supabaseUrl || !serviceRole) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const db = admin.firestore();
const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

function tsToIso(v) {
  if (v == null) return null;
  if (typeof v.toDate === 'function') {
    try {
      return v.toDate().toISOString();
    } catch {
      return null;
    }
  }
  if (v instanceof Date) return v.toISOString();
  return null;
}

function str(v, max = 8000) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

function intOr(v, def, min, max) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return def;
  const n = Math.trunc(v);
  return Math.min(max, Math.max(min, n));
}

function firestoreUserToProfileRow(docId, data) {
  const x = data && typeof data === 'object' ? data : {};
  const nick = str(x.nickname, 200) || '모임친구';
  const isWithdrawn = x.isWithdrawn === true;

  return {
    app_user_id: docId,
    nickname: isWithdrawn ? '(탈퇴한 회원)' : nick,
    photo_url: isWithdrawn ? null : str(x.photoUrl, 4000),
    phone: isWithdrawn ? null : str(x.phone, 64),
    phone_verified_at: isWithdrawn ? null : tsToIso(x.phoneVerifiedAt),
    email: isWithdrawn ? null : str(x.email, 320),
    display_name: isWithdrawn ? null : str(x.displayName, 200),
    terms_agreed_at: isWithdrawn ? null : tsToIso(x.termsAgreedAt),
    gender: isWithdrawn ? null : str(x.gender, 32),
    age_band: isWithdrawn ? null : str(x.ageBand, 64),
    birth_year: isWithdrawn ? null : (typeof x.birthYear === 'number' ? intOr(x.birthYear, null, 1900, 2100) : null),
    birth_month: isWithdrawn ? null : (typeof x.birthMonth === 'number' ? intOr(x.birthMonth, null, 1, 12) : null),
    birth_day: isWithdrawn ? null : (typeof x.birthDay === 'number' ? intOr(x.birthDay, null, 1, 31) : null),
    g_level: intOr(x.gLevel, 1, 1, 999999),
    g_xp: typeof x.gXp === 'number' && Number.isFinite(x.gXp) ? Math.max(0, Math.trunc(x.gXp)) : 0,
    g_trust: intOr(x.gTrust, 100, 0, 1000),
    g_dna: str(x.gDna, 120) || 'Explorer',
    meeting_count: typeof x.meetingCount === 'number' ? Math.max(0, Math.trunc(x.meetingCount)) : 0,
    ranking_points: typeof x.rankingPoints === 'number' ? Math.max(0, Math.trunc(x.rankingPoints)) : 0,
    is_withdrawn: isWithdrawn,
    withdrawn_at: isWithdrawn ? tsToIso(x.withdrawnAt) ?? new Date().toISOString() : null,
  };
}

async function main() {
  let q = db.collection('users').orderBy(admin.firestore.FieldPath.documentId());
  if (docLimit > 0) {
    q = q.limit(docLimit);
  }
  const snap = await q.get();
  if (snap.empty) {
    console.log('No user documents in Firestore `users`.');
    return;
  }

  const rows = snap.docs.map((d) => firestoreUserToProfileRow(d.id, d.data()));
  const chunkSize = 80;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from('profiles').upsert(chunk, { onConflict: 'app_user_id' });
    if (error) {
      console.error('Supabase upsert failed:', error.message);
      process.exit(1);
    }
    upserted += chunk.length;
    console.log(`Upserted ${upserted} / ${rows.length}…`);
  }
  console.log(`Done. Upserted ${upserted} profiles into public.profiles (app_user_id).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
