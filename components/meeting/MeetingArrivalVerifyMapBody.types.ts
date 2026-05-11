import type { MeetingArrivalRpcResult } from '@/src/lib/meeting-arrival-verify';
import type { Meeting } from '@/src/lib/meetings';

export type MeetingArrivalVerifyMapBodyProps = {
  /** 화면 포커스 등 — false면 위치 구독·맵 셸을 정리합니다. */
  active: boolean;
  placeCoords: { latitude: number; longitude: number };
  authRadiusM: number;
  minAccuracyM: number;
  meetingId: string;
  appUserId: string;
  pinMeeting: Pick<Meeting, 'id' | 'categoryId' | 'categoryLabel' | 'title'>;
  mapViewRadiusM?: number;
  onRpcResult: (payload: { rpc: MeetingArrivalRpcResult | null; errorMessage: string | null }) => void;
};
