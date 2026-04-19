import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

import { publicEnv } from '@/src/config/public-env';

const firebaseConfig = {
  apiKey: publicEnv.firebaseApiKey,
  authDomain: publicEnv.firebaseAuthDomain,
  projectId: publicEnv.firebaseProjectId,
  storageBucket: publicEnv.firebaseStorageBucket,
  messagingSenderId: publicEnv.firebaseMessagingSenderId,
  appId: publicEnv.firebaseAppId,
};

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let firestore: Firestore | undefined;
let storage: FirebaseStorage | undefined;

/**
 * Firebase JS SDK 초기화 (Expo 권장 경로).
 * Android 네이티브 설정은 `env/google-services.json` 등으로 별도 구성합니다.
 */
export function getFirebaseApp(): FirebaseApp {
  if (app) return app;
  if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
    throw new Error(
      '[firebase] env/.env의 FIREBASE_*(또는 expo.extra)가 비어 있습니다.',
    );
  }
  if (!getApps().length) {
    app = initializeApp(firebaseConfig);
    return app;
  }
  app = getApps()[0]!;
  return app;
}

/**
 * Firebase Auth — `getAuth` 기본 persistence(메모리)만 사용합니다.
 * React Native에서 `initializeAuth` + `getReactNativePersistence(AsyncStorage)`를 쓰지 않으므로,
 * 터미널에 `@firebase/auth`의 persistence 관련 안내 로그가 남을 수 있습니다(동작에는 지장 없음).
 */
export function getFirebaseAuth(): Auth {
  if (auth) return auth;
  const firebaseApp = getFirebaseApp();
  auth = getAuth(firebaseApp);
  return auth;
}

/**
 * 전화번호만 로그인한 경우 `currentUser`가 없어 Storage 토큰을 못 씁니다.
 * 이때 한 번 `signInAnonymously`로 ID 토큰을 만듭니다.
 *
 * Firebase 콘솔 → Authentication → 로그인 제공업체 → **익명** 사용 설정이 필요합니다.
 */
export async function ensureFirebaseAuthUserForStorage(): Promise<void> {
  const a = getFirebaseAuth();
  if (a.currentUser) return;
  try {
    await signInAnonymously(a);
  } catch (e) {
    const code =
      typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '';
    if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') {
      throw new Error(
        '채팅 사진 업로드에는 Firebase「익명」로그인이 필요합니다. Firebase 콘솔 → Authentication → 로그인 제공업체에서 익명을 켠 뒤 다시 시도해 주세요.',
      );
    }
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/** Cloud Firestore */
export function getFirebaseFirestore(): Firestore {
  if (firestore) return firestore;
  firestore = getFirestore(getFirebaseApp());
  return firestore;
}

/** Firebase Storage (채팅 이미지 등) — 버킷 문자열이 있으면 `gs://`로 명시(빈 문자열·캐시 앱 불일치 방지). */
export function getFirebaseStorage(): FirebaseStorage {
  if (storage) return storage;
  const firebaseApp = getFirebaseApp();
  const raw = publicEnv.firebaseStorageBucket?.trim();
  if (raw) {
    const bucketUrl = raw.startsWith('gs://') ? raw : `gs://${raw}`;
    storage = getStorage(firebaseApp, bucketUrl);
  } else {
    storage = getStorage(firebaseApp);
  }
  return storage;
}
