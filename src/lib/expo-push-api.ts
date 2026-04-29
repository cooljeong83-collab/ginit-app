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
  /** iOS: 배너·배달 우선순위(백그라운드·집중 모드 등에서 표시에 영향) */
  interruptionLevel?: 'active' | 'passive' | 'timeSensitive' | 'critical';
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function stableJson(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((x) => stableJson(x)).join(',')}]`;
  if (t !== 'object') return JSON.stringify(String(value));
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(',')}}`;
}

function dedupeExpoMessages(messages: ExpoPushMessage[]): ExpoPushMessage[] {
  const seen = new Set<string>();
  const out: ExpoPushMessage[] = [];
  for (const m of messages) {
    const to = (m.to ?? '').trim();
    if (!to) continue;
    const key = [
      to,
      (m.title ?? '').trim(),
      (m.body ?? '').trim(),
      (m.subtitle ?? '').trim(),
      (m.priority ?? '').trim(),
      (m.channelId ?? '').trim(),
      stableJson(m.data ?? null),
      stableJson(m.sound ?? null),
      String(m.interruptionLevel ?? ''),
    ].join('\u001f');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...m, to });
  }
  return out;
}

/**
 * Expo Push API로 전송. `EXPO_PUBLIC_EXPO_ACCESS_TOKEN`이 있으면 Authorization에 포함합니다.
 * 프로덕션에서는 서버(Edge Function 등)에서 호출하는 것이 안전합니다.
 */
export async function sendExpoPushMessages(messages: ExpoPushMessage[]): Promise<void> {
  const deduped = dedupeExpoMessages(messages);
  if (deduped.length === 0) return;
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
    body: JSON.stringify(deduped),
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`Expo push 실패 (${res.status}): ${text.slice(0, 200)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return;
  }
  const data = parsed && typeof parsed === 'object' && 'data' in parsed ? (parsed as { data?: unknown }).data : undefined;
  if (!Array.isArray(data)) return;
  const errors = data.filter((row) => row && typeof row === 'object' && (row as { status?: string }).status === 'error');
  if (errors.length > 0) {
    const first = errors[0] as { message?: string };
    throw new Error(`Expo push 티켓 오류: ${String(first?.message ?? '').slice(0, 200)}`);
  }
}
