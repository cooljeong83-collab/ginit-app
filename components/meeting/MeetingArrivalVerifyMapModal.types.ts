import type { MeetingArrivalRpcResult } from '@/src/lib/meeting-arrival-verify';
import type { Meeting } from '@/src/lib/meetings';

export type MeetingArrivalVerifyMapModalProps = {
  visible: boolean;
  onRequestClose: () => void;
  placeCoords: { latitude: number; longitude: number };
  authRadiusM: number;
  minAccuracyM: number;
  meetingId: string;
  appUserId: string;
  /** 탐색 지도와 동일한 카테고리 핀 표시용 */
  pinMeeting: Pick<Meeting, 'id' | 'categoryId' | 'categoryLabel' | 'title'>;
  /** 지도 첫 화면에서 중심 기준으로 보이는 반경(미). 기본 70 */
  mapViewRadiusM?: number;
  onRpcResult: (payload: { rpc: MeetingArrivalRpcResult | null; errorMessage: string | null }) => void;
};
