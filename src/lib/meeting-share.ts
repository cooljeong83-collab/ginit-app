import { publicEnv } from '@/src/config/public-env';
import { supabase } from '@/src/lib/supabase';

/** 실제 사용자에게 보내는 웹 공유 페이지(운영). `env/.env`에 localhost가 있어도 공유 링크는 여기로 고정합니다. */
const MEETING_SHARE_PUBLIC_PAGE_ORIGIN = 'https://ginit-share.vercel.app';

function isPrivateOrLocalShareOrigin(base: string): boolean {
  const raw = base.trim().replace(/\/$/, '');
  if (!raw) return false;
  let hostname = '';
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    hostname = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  if (hostname === '127.0.0.1' || hostname.endsWith('.local')) return true;
  const m = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10 || a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/** 공유 시트·클립보드에 넣을 페이지 오리진(끝 슬래시 없음). */
export function resolveMeetingSharePageOrigin(): string {
  const configured = publicEnv.meetingShareWebBaseUrl?.trim().replace(/\/$/, '') ?? '';
  if (!configured) return MEETING_SHARE_PUBLIC_PAGE_ORIGIN;
  if (isPrivateOrLocalShareOrigin(configured)) return MEETING_SHARE_PUBLIC_PAGE_ORIGIN;
  return configured;
}

export function buildMeetingSharePageUrl(token: string): string {
  const base = resolveMeetingSharePageOrigin();
  const t = token.trim();
  return `${base}/s/${encodeURIComponent(t)}`;
}

export type MeetingShareCreateResult = {
  token: string;
  shareId: string;
  meetingId: string;
};

export async function createMeetingShareLinkRpc(meetingId: string, hostAppUserId: string): Promise<MeetingShareCreateResult> {
  const mid = meetingId.trim();
  const host = hostAppUserId.trim();
  if (!mid || !host) throw new Error('모임 또는 호스트 정보가 없습니다.');
  const { data, error } = await supabase.rpc('meeting_share_create', {
    p_meeting_id: mid,
    p_host_app_user_id: host,
  });
  if (error) throw new Error(error.message);
  const row = data as Record<string, unknown> | null;
  const token = typeof row?.token === 'string' ? row.token.trim() : '';
  const shareId = typeof row?.shareId === 'string' ? row.shareId.trim() : '';
  const meetingIdOut = typeof row?.meetingId === 'string' ? row.meetingId.trim() : '';
  if (!token) throw new Error('공유 링크를 만들지 못했어요.');
  return { token, shareId, meetingId: meetingIdOut || mid };
}
