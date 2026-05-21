import * as Linking from 'expo-linking';
import type { Router } from 'expo-router';

import { parseGinitAppChatDestination } from '@/src/lib/ginit-app-destination';

/**
 * 공지 `link_url` 처리 — `ginitapp://` 는 기존 채팅·모임 파서 재사용.
 */
export function navigateFromNoticeLink(
  router: Router,
  params: { noticeId: string; linkUrl: string | null | undefined },
): boolean {
  const link = params.linkUrl?.trim() ?? '';
  if (!link) {
    router.push(`/notices/${params.noticeId}` as never);
    return true;
  }

  const lower = link.toLowerCase();
  if (lower.startsWith('ginitapp://')) {
    const dest = parseGinitAppChatDestination(link);
    if (dest?.type === 'social_dm') {
      router.push(`/social-chat/${encodeURIComponent(dest.roomId)}` as never);
      return true;
    }
    if (dest?.type === 'meeting_chat') {
      router.push(`/meeting-chat/${dest.meetingId}` as never);
      return true;
    }
    if (dest?.type === 'meeting_detail') {
      router.push(`/meeting/${dest.meetingId}` as never);
      return true;
    }
    const path = link.slice('ginitapp://'.length).split(/[?#]/)[0]?.trim() ?? '';
    if (path) {
      router.push(`/${path.replace(/^\//, '')}` as never);
      return true;
    }
  }

  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    void Linking.openURL(link);
    return true;
  }

  router.push(`/notices/${params.noticeId}` as never);
  return true;
}
