import { Image } from 'expo-image';
import { useMemo } from 'react';
import type { StyleProp, ImageStyle } from 'react-native';

import { firstKakaoPlaceDetailPageUrlFromMeeting } from '@/src/lib/feed-meeting-utils';
import {
  firstPlaceCandidatePreferredPhotoUri,
  meetingHasMovieListPoster,
  resolveMeetingListThumbnailUri,
} from '@/src/lib/meeting-list-thumbnail';
import type { Meeting } from '@/src/lib/meetings';
import { useKakaoPlaceListThumbnail } from '@/src/lib/use-kakao-place-list-thumbnail';

type Props = {
  meeting: Meeting;
  style: StyleProp<ImageStyle>;
  recyclingKey?: string;
};

/**
 * 모임 목록·지도 리스트용 썸네일: 저장된 카카오맵 `place_url`(og:image)이 있으면 우선, 없으면 `resolveMeetingListThumbnailUri`.
 * 영화 포스터가 있으면 카카오를 쓰지 않습니다.
 */
export function MeetingListThumbnailImage({ meeting, style, recyclingKey }: Props) {
  const baseUri = useMemo(() => resolveMeetingListThumbnailUri(meeting), [meeting]);
  const preferredPlacePhoto = useMemo(
    () => (meetingHasMovieListPoster(meeting) ? undefined : firstPlaceCandidatePreferredPhotoUri(meeting)),
    [meeting],
  );
  const kakaoPage = useMemo(
    () => (meetingHasMovieListPoster(meeting) ? null : firstKakaoPlaceDetailPageUrlFromMeeting(meeting)),
    [meeting],
  );
  const { uri: kakaoUri } = useKakaoPlaceListThumbnail(kakaoPage);
  const uri = preferredPlacePhoto ?? kakaoUri ?? baseUri;

  return (
    <Image
      source={{ uri }}
      style={style}
      contentFit="cover"
      cachePolicy="disk"
      recyclingKey={recyclingKey ?? meeting.id}
      accessibilityIgnoresInvertColors
    />
  );
}
