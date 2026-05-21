import { Redirect } from 'expo-router';

/** 레거시 경로 — `app_announcements` 제거 후 운영 공지 수신함으로 연결 */
export default function LegacySupportAnnouncementsRedirect() {
  return <Redirect href="/notices/inbox" />;
}
