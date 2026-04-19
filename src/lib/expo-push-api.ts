import { publicEnv } from '@/src/config/public-env';

export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  sound?: 'default' | null;
  data?: Record<string, unknown>;
  channelId?: string;
  /** Android/iOS 배너·헤드업 우선순위 */
  priority?: 'default' | 'normal' | 'high';
  /** iOS: 제목 아래 보조 한 줄 */
  subtitle?: string;
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Expo Push API로 전송. `EXPO_PUBLIC_EXPO_ACCESS_TOKEN`이 있으면 Authorization에 포함합니다.
 * 프로덕션에서는 서버(Edge Function 등)에서 호출하는 것이 안전합니다.
 */
export async function sendExpoPushMessages(messages: ExpoPushMessage[]): Promise<void> {
  if (messages.length === 0) return;
  const accessToken = publicEnv.expoAccessToken?.trim();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'Content-Type': 'application/json',
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(messages),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Expo push 실패 (${res.status}): ${text.slice(0, 200)}`);
  }
}
