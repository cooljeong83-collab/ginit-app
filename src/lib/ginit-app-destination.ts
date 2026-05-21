/**
 * `ginitapp://` 딥링크 경로 파싱 — 푸시·공지 link_url 공용 (push-open-navigation ↔ notice-link-navigation 순환 방지).
 */
export function parseGinitAppChatDestination(
  url: string,
):
  | { type: 'social_dm'; roomId: string }
  | { type: 'meeting_chat'; meetingId: string }
  | { type: 'meeting_detail'; meetingId: string }
  | null {
  const u = url.trim();
  if (!u.toLowerCase().startsWith('ginitapp://')) return null;
  const rest = (u.slice('ginitapp://'.length).split(/[?#]/)[0] ?? '').trim();
  const segs = rest.split('/').filter(Boolean);
  const head = (segs[0] ?? '').toLowerCase();
  if (head === 'social-chat' && segs[1]) {
    try {
      return { type: 'social_dm', roomId: decodeURIComponent(segs[1]) };
    } catch {
      return { type: 'social_dm', roomId: segs[1] };
    }
  }
  if (head === 'meeting-chat' && segs[1]) {
    try {
      return { type: 'meeting_chat', meetingId: decodeURIComponent(segs[1]) };
    } catch {
      return { type: 'meeting_chat', meetingId: segs[1] };
    }
  }
  if (head === 'meeting' && segs[1]) {
    try {
      return { type: 'meeting_detail', meetingId: decodeURIComponent(segs[1]) };
    } catch {
      return { type: 'meeting_detail', meetingId: segs[1] };
    }
  }
  return null;
}
