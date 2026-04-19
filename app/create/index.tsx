import { Redirect } from 'expo-router';

/**
 * `/create` 진입 시 대기 UI 없이 곧바로 모임 생성 폼으로 이동합니다.
 */
export default function CreateMeetingEntry() {
  return <Redirect href="/create/details" />;
}
