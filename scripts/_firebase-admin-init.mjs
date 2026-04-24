/**
 * Node 스크립트용 firebase-admin 초기화.
 * `projectId`만 넘기면 ADC가 없을 때 Firestore가 "Could not load the default credentials"로 실패합니다.
 */
import { existsSync, readFileSync } from 'node:fs';
import admin from 'firebase-admin';

/**
 * @returns {string} projectId
 */
export function initFirebaseAdminForScripts() {
  if (admin.apps.length) {
    return (
      process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID?.trim() ||
      process.env.FIREBASE_PROJECT_ID?.trim() ||
      ''
    );
  }

  const projectId =
    process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID?.trim() ||
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    '';

  if (!projectId) {
    throw new Error('EXPO_PUBLIC_FIREBASE_PROJECT_ID 또는 FIREBASE_PROJECT_ID 가 필요합니다.');
  }

  const inlineJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (inlineJson) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(inlineJson)),
      projectId,
    });
    return projectId;
  }

  const keyPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim() ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ||
    '';

  if (keyPath && existsSync(keyPath)) {
    const key = JSON.parse(readFileSync(keyPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(key),
      projectId,
    });
    return projectId;
  }

  throw new Error(
    [
      'Firebase Admin 서비스 계정이 없습니다. 아래 중 하나를 설정한 뒤 다시 실행하세요.',
      '',
      '  1) GOOGLE_APPLICATION_CREDENTIALS=/절대/경로/서비스계정.json',
      '     (Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → 새 비공개 키)',
      '  2) FIREBASE_SERVICE_ACCOUNT_JSON=\'{"type":"service_account",...}\'  (한 줄 JSON, CI용)',
      '  3) FIREBASE_SERVICE_ACCOUNT_PATH=./로컬에만 있는키.json',
      '',
      '참고: 프로젝트 ID만으로는 인증되지 않습니다.',
    ].join('\n'),
  );
}
