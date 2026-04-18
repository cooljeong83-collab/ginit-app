/**
 * Firestore `meetings` 컬렉션.
 *
 * `createdBy`는 **정규화된 전화번호 PK**(+8210…) 문자열로 저장됩니다. (Firebase UID와 다를 수 있음)
 *
 * 콘솔 규칙 예시(인증만 요구하는 단순형):
 *   match /meetings/{id} {
 *     allow read: if request.auth != null;
 *     allow create: if request.auth != null;
 *     allow update, delete: if request.auth != null && request.auth.uid == resource.data.createdBy;
 *   }
 * → 위 update/delete 규칙은 UID 기준이므로, 전화 PK만 쓰려면 예를 들어
 *   `resource.data.createdBy == request.auth.token.phone_number` 처럼
 *   Custom Claim을 두거나, 별도 `authorUid` 필드와 함께 정책을 조정해야 합니다.
 */
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';

import { getFirebaseFirestore } from './firebase';

export const MEETINGS_COLLECTION = 'meetings';

export type Meeting = {
  id: string;
  title: string;
  /** 장소명(표시용). 기존 데이터 호환 */
  location: string;
  description: string;
  capacity: number;
  /** Firestore 서버 타임스탬프 */
  createdAt?: Timestamp | null;
  createdBy?: string | null;
  imageUrl?: string | null;
  categoryId?: string | null;
  categoryLabel?: string | null;
  isPublic?: boolean | null;
  scheduleDate?: string | null;
  scheduleTime?: string | null;
  scheduledAt?: Timestamp | null;
  placeName?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export function getFirestoreDb() {
  return getFirebaseFirestore();
}

type PlaceCandidateLike = { id: string; placeName: string; address: string; latitude: number; longitude: number };
type DateCandidateLike = { id: string; scheduleDate: string; scheduleTime: string };

export type CreateMeetingInput = {
  title: string;
  /** 목록/호환용 장소 한 줄 표기(보통 placeName) */
  location: string;
  placeName: string;
  address: string;
  latitude: number;
  longitude: number;
  description: string;
  capacity: number;
  createdBy: string | null;
  categoryId: string;
  categoryLabel: string;
  isPublic: boolean;
  scheduleDate: string;
  scheduleTime: string;
  imageUrl?: string | null;
  placeCandidates?: PlaceCandidateLike[] | null;
  dateCandidates?: DateCandidateLike[] | null;
};

/** `YYYY-MM-DD` + `H:mm` 또는 `HH:mm` → Firestore Timestamp (파싱 실패 시 null). */
export function parseScheduleToTimestamp(dateStr: string, timeStr: string): Timestamp | null {
  const d = dateStr.trim();
  const t = timeStr.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const hh = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  const dt = new Date(`${d}T${hh}:${mm}:00`);
  if (Number.isNaN(dt.getTime())) return null;
  return Timestamp.fromDate(dt);
}

export async function addMeeting(input: CreateMeetingInput): Promise<void> {
  const scheduledAt = parseScheduleToTimestamp(input.scheduleDate, input.scheduleTime);
  const ref = collection(getFirestoreDb(), MEETINGS_COLLECTION);
  await addDoc(ref, {
    title: input.title.trim(),
    location: input.location.trim(),
    placeName: input.placeName.trim(),
    address: input.address.trim(),
    latitude: input.latitude,
    longitude: input.longitude,
    description: input.description.trim(),
    capacity: input.capacity,
    createdBy: input.createdBy,
    imageUrl: input.imageUrl?.trim() || null,
    categoryId: input.categoryId,
    categoryLabel: input.categoryLabel.trim(),
    isPublic: input.isPublic,
    scheduleDate: input.scheduleDate.trim(),
    scheduleTime: input.scheduleTime.trim(),
    scheduledAt,
    placeCandidates: input.placeCandidates?.length ? input.placeCandidates : null,
    dateCandidates: input.dateCandidates?.length ? input.dateCandidates : null,
    createdAt: serverTimestamp(),
  });
}

export function subscribeMeetings(
  onData: (meetings: Meeting[]) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  const ref = collection(getFirestoreDb(), MEETINGS_COLLECTION);
  const q = query(ref, orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      const list: Meeting[] = snap.docs.map((d) => {
        const data = d.data() as Omit<Meeting, 'id'>;
        return {
          id: d.id,
          title: typeof data.title === 'string' ? data.title : '',
          location: typeof data.location === 'string' ? data.location : '',
          description: typeof data.description === 'string' ? data.description : '',
          capacity: typeof data.capacity === 'number' && Number.isFinite(data.capacity) ? data.capacity : 0,
          createdAt: data.createdAt ?? null,
          createdBy: typeof data.createdBy === 'string' ? data.createdBy : null,
          imageUrl: typeof data.imageUrl === 'string' ? data.imageUrl : null,
          categoryId: typeof data.categoryId === 'string' ? data.categoryId : null,
          categoryLabel: typeof data.categoryLabel === 'string' ? data.categoryLabel : null,
          isPublic: typeof data.isPublic === 'boolean' ? data.isPublic : null,
          scheduleDate: typeof data.scheduleDate === 'string' ? data.scheduleDate : null,
          scheduleTime: typeof data.scheduleTime === 'string' ? data.scheduleTime : null,
          scheduledAt: data.scheduledAt ?? null,
          placeName: typeof data.placeName === 'string' ? data.placeName : null,
          address: typeof data.address === 'string' ? data.address : null,
          latitude: typeof data.latitude === 'number' && Number.isFinite(data.latitude) ? data.latitude : null,
          longitude: typeof data.longitude === 'number' && Number.isFinite(data.longitude) ? data.longitude : null,
        };
      });
      onData(list);
    },
    (err) => {
      onError?.(err.message ?? 'Firestore 구독 오류');
    },
  );
}
