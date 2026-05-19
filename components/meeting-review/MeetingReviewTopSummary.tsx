import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PlaceCandidateDetailLinkRow } from '@/components/create/PlaceCandidateDetailLinkRow';
import { MeetingReviewReceiptVerifiedBadge } from '@/components/meeting-review/MeetingReviewReceiptVerifiedBadge';
import { GinitTheme } from '@/constants/ginit-theme';
import type { Category } from '@/src/lib/categories';
import { formatDateTimeWithKoWeekday, formatYmdHmWithKoWeekday, formatYmdWithKoWeekday } from '@/src/lib/date-display';
import { arrivalVerifyPlaceChipToNaverImageFields } from '@/src/lib/meeting-arrival-verify-place-summary-data';
import { buildMeetingTopNoticeTitleLeft } from '@/src/lib/meetings';
import type { Meeting } from '@/src/lib/meetings';
import { meetingPrimaryStartMs } from '@/src/lib/meetings';
import type { MeetingReviewPlaceContext } from '@/src/lib/meeting-review/meeting-review-place-context';
import { searchNaverPlaceImageThumbnail } from '@/src/lib/naver-image-search';

type MeetingReviewTopSummaryProps = {
  meeting: Meeting;
  place: MeetingReviewPlaceContext;
  categories: readonly Category[];
  onOpenPlaceUrl: (url: string, title: string) => void;
  /** 정산 영수증 상호가 확정 장소와 일치할 때 */
  receiptPlaceVerified?: boolean;
};

function formatMeetingScheduleLine(m: Meeting): string {
  const date = m.scheduleDate?.trim() ?? '';
  const time = m.scheduleTime?.trim() ?? '';
  if (date && time) return formatYmdHmWithKoWeekday(date, time);
  if (date) return formatYmdWithKoWeekday(date);
  if (time) return time;
  const ms = meetingPrimaryStartMs(m);
  if (ms != null) return formatDateTimeWithKoWeekday(new Date(ms));
  return '';
}

/** 모임 상세·정산과 동일 — 모임 제목·일시 + 좌측 썸네일·우측 가게 정보 */
export function MeetingReviewTopSummary({
  meeting,
  place,
  categories,
  onOpenPlaceUrl,
  receiptPlaceVerified = false,
}: MeetingReviewTopSummaryProps) {
  const meetingTitle = buildMeetingTopNoticeTitleLeft(meeting, categories);
  const scheduleLine = useMemo(() => formatMeetingScheduleLine(meeting), [meeting]);

  const preferred = place.photoUrl?.trim() || null;
  const [fallbackThumb, setFallbackThumb] = useState<string | null | undefined>(undefined);
  const naverFields = useMemo(
    () =>
      arrivalVerifyPlaceChipToNaverImageFields({
        id: place.chipId,
        title: place.placeName,
        sub: place.address ?? undefined,
        category: place.category ?? undefined,
        preferredPhotoMediaUrl: preferred ?? undefined,
        naverPlaceLink: place.naverPlaceLink ?? undefined,
      }),
    [place, preferred],
  );

  useEffect(() => {
    if (preferred) {
      setFallbackThumb(undefined);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      void (async () => {
        try {
          const uri = await searchNaverPlaceImageThumbnail(naverFields);
          if (!alive) return;
          setFallbackThumb(uri);
        } catch {
          if (!alive) return;
          setFallbackThumb(null);
        }
      })();
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [preferred, naverFields]);

  const thumb = preferred ?? (fallbackThumb && fallbackThumb !== undefined ? fallbackThumb : null);

  return (
    <View style={styles.wrap}>
      <Text style={styles.meetingTitle} numberOfLines={2}>
        {meetingTitle}
      </Text>
      {scheduleLine ? <Text style={styles.scheduleLine}>{scheduleLine}</Text> : null}
      {place.visitDateLabel ? (
        <Text style={styles.visitLine}>방문 {place.visitDateLabel}</Text>
      ) : null}

      <View style={styles.placeRow}>
        <View style={styles.thumbWrap}>
          {thumb ? (
            <Image source={{ uri: thumb }} style={styles.thumb} contentFit="cover" />
          ) : (
            <View style={[styles.thumb, styles.thumbFallback]} />
          )}
        </View>
        <View style={styles.placeCol}>
          <View style={styles.placeColTop}>
            <Text style={styles.placeName} numberOfLines={3}>
              {place.placeName}
            </Text>
            {receiptPlaceVerified ? <MeetingReviewReceiptVerifiedBadge /> : null}
            {place.category ? (
              <Text style={styles.placeSub} numberOfLines={2}>
                {place.category}
              </Text>
            ) : null}
            {place.address ? (
              <Text style={styles.placeSub} numberOfLines={4}>
                {place.address}
              </Text>
            ) : null}
          </View>
          <PlaceCandidateDetailLinkRow
            title={place.placeName}
            link={place.naverPlaceLink}
            addressLine={place.address}
            containerStyle={styles.detailLinks}
            onOpenUrl={onOpenPlaceUrl}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 6,
    backgroundColor: GinitTheme.colors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GinitTheme.colors.border,
  },
  meetingTitle: {
    ...GinitTheme.typography.h2,
    color: GinitTheme.colors.text,
  },
  scheduleLine: {
    ...GinitTheme.typography.caption,
    color: GinitTheme.colors.textMuted,
  },
  visitLine: {
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.textSub,
  },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginTop: 6,
  },
  thumbWrap: {
    flex: 1,
    flexBasis: 0,
    height: 112,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(15, 23, 42, 0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.12)',
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  thumbFallback: {
    backgroundColor: 'rgba(15, 23, 42, 0.06)',
  },
  placeCol: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    minHeight: 112,
    justifyContent: 'space-between',
    alignItems: 'stretch',
  },
  placeColTop: {
    flexShrink: 1,
    gap: 4,
  },
  placeName: {
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.text,
    lineHeight: 18,
    marginBottom: 2,
  },
  placeSub: {
    fontSize: 11,
    fontWeight: '700',
    color: GinitTheme.colors.textMuted,
    lineHeight: 15,
  },
  detailLinks: {
    alignSelf: 'stretch',
    marginTop: 0,
  },
});
