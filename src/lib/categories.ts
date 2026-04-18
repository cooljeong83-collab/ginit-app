/**
 * Firestore `categories` 컬렉션 (관리자가 콘솔에서 추가·수정하면 앱에 실시간 반영).
 *
 * 문서 필드 권장:
 *   label: string   (표시 이름, 예: "커피")
 *   emoji: string  (선택, 예: "☕")
 *   order: number  (선택, 정렬용 작을수록 앞)
 *
 * 규칙 예시:
 *   match /categories/{id} {
 *     allow read: if true;
 *     allow write: if request.auth != null && request.auth.token.admin == true;
 *   }
 */
import { collection, onSnapshot, type Unsubscribe } from 'firebase/firestore';

import { getFirebaseFirestore } from './firebase';

export const CATEGORIES_COLLECTION = 'categories';

export type Category = {
  id: string;
  label: string;
  emoji: string;
  order: number;
};

function normalizeCategory(id: string, data: Record<string, unknown>): Category {
  const label = typeof data.label === 'string' && data.label.trim() ? data.label.trim() : '이름 없음';
  const emoji = typeof data.emoji === 'string' && data.emoji.trim() ? data.emoji.trim() : '📌';
  const order = typeof data.order === 'number' && Number.isFinite(data.order) ? data.order : 999;
  return { id, label, emoji, order };
}

export function subscribeCategories(
  onData: (categories: Category[]) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  const ref = collection(getFirebaseFirestore(), CATEGORIES_COLLECTION);
  return onSnapshot(
    ref,
    (snap) => {
      const list = snap.docs
        .map((d) => normalizeCategory(d.id, d.data() as Record<string, unknown>))
        .sort((a, b) => (a.order !== b.order ? a.order - b.order : a.label.localeCompare(b.label, 'ko')));
      onData(list);
    },
    (err) => {
      onError?.(err.message ?? '카테고리 구독 오류');
    },
  );
}
