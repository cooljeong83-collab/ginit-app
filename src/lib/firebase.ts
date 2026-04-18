import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

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

/** Cloud Firestore */
export function getFirebaseFirestore(): Firestore {
  if (firestore) return firestore;
  firestore = getFirestore(getFirebaseApp());
  return firestore;
}
