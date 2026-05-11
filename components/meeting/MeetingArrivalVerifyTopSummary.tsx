import { PlaceCandidateDetailLinkRow } from '@/components/create/PlaceCandidateDetailLinkRow';
import { GinitTheme } from '@/constants/ginit-theme';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  arrivalVerifyPlaceChipToNaverImageFields,
  buildArrivalVerifyPlaceChips,
  resolveArrivalVerifyConfirmedPlaceChip,
} from '@/src/lib/meeting-arrival-verify-place-summary-data';
import type { Meeting } from '@/src/lib/meetings';
import { meetingPrimaryStartMs } from '@/src/lib/meetings';
import { searchNaverPlaceImageThumbnail } from '@/src/lib/naver-image-search';

export type MeetingArrivalVerifyTopSummaryProps = {
  meeting: Meeting;
  onOpenPlaceUrl: (url: string, title: string) => void;
};

function formatArrivalVerifyScheduleLine(m: Meeting): string {
  const date = m.scheduleDate?.trim() ?? '';
  const time = m.scheduleTime?.trim() ?? '';
  if (date && time) return `${date} ${time}`;
  if (date) return date;
  if (time) return time;
  const ms = meetingPrimaryStartMs(m);
  if (ms != null) {
    return new Intl.DateTimeFormat('ko-KR', {
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(ms));
  }
  return '';
}

/**
 * 장소 인증 상단 — 모임 제목·일시·상세와 동일 레이아웃의 확정 장소 카드(썸네일 좌 / 상호·업종·주소 우).
 */
export function MeetingArrivalVerifyTopSummary({ meeting, onOpenPlaceUrl }: MeetingArrivalVerifyTopSummaryProps) {
  const placeChips = useMemo(() => buildArrivalVerifyPlaceChips(meeting), [meeting]);
  const chip = useMemo(() => resolveArrivalVerifyConfirmedPlaceChip(meeting, placeChips), [meeting, placeChips]);
  const scheduleLine = useMemo(() => formatArrivalVerifyScheduleLine(meeting), [meeting]);

  /** 모임 상세 확정 장소 카드와 동일: `placeThumbByChipId` 검색 썸네일만 표시 */
  const [placeThumbByChipId, setPlaceThumbByChipId] = useState<Record<string, string | null>>({});

  useEffect(() => {
    if (!chip) return;
    if (placeThumbByChipId[chip.id] !== undefined) return;
    let alive = true;
    const t = setTimeout(() => {
      void (async () => {
        try {
          const uri = await searchNaverPlaceImageThumbnail(arrivalVerifyPlaceChipToNaverImageFields(chip));
          if (!alive) return;
          setPlaceThumbByChipId((prev) => {
            if (prev[chip.id] !== undefined) return prev;
            return { ...prev, [chip.id]: uri };
          });
        } catch {
          if (!alive) return;
          setPlaceThumbByChipId((prev) => {
            if (prev[chip.id] !== undefined) return prev;
            return { ...prev, [chip.id]: null };
          });
        }
      })();
    }, 180);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [chip, placeThumbByChipId]);

  const thumb = chip ? placeThumbByChipId[chip.id] ?? null : null;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      <Text style={styles.meetingTitle}>{(meeting.title ?? '').trim() || '모임'}</Text>
      {scheduleLine ? <Text style={styles.scheduleLine}>{scheduleLine}</Text> : null}
      {chip ? (
        <>
          <Text style={styles.sectionLabel}>장소</Text>
          <View style={styles.placeDetailBlock}>
            <View style={styles.placeDetailHeroRow}>
              <View style={styles.placeDetailSquareThumbWrap}>
                {thumb ? (
                  <Image source={{ uri: thumb }} style={styles.placeVoteImage} contentFit="cover" />
                ) : (
                  <View style={styles.placeVoteImageFallback} />
                )}
              </View>
              <View style={styles.placeDetailRightCol}>
                <View style={styles.placeDetailRightColTop}>
                  <Text style={styles.placeVoteTitle} numberOfLines={3}>
                    {chip.title}
                  </Text>
                  {chip.category ? (
                    <Text style={styles.placeVoteSub} numberOfLines={2}>
                      {chip.category}
                    </Text>
                  ) : null}
                  {chip.sub ? (
                    <Text style={styles.placeVoteSub} numberOfLines={6}>
                      {chip.sub}
                    </Text>
                  ) : null}
                </View>
                <PlaceCandidateDetailLinkRow
                  title={chip.title}
                  link={chip.naverPlaceLink}
                  addressLine={chip.sub}
                  containerStyle={{ alignSelf: 'stretch', marginTop: 0 }}
                  onOpenUrl={onOpenPlaceUrl}
                />
              </View>
            </View>
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 0, backgroundColor: GinitTheme.colors.bg },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 8,
    backgroundColor: GinitTheme.colors.bg,
  },
  meetingTitle: { ...GinitTheme.typography.h2, color: GinitTheme.colors.text },
  scheduleLine: { ...GinitTheme.typography.caption, color: GinitTheme.colors.textMuted },
  sectionLabel: { fontSize: 15, fontWeight: '700', color: GinitTheme.colors.text, marginTop: 4 },
  placeDetailBlock: { marginTop: 0 },
  placeDetailHeroRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 12,
    marginBottom: 4,
  },
  placeDetailSquareThumbWrap: {
    width: 150,
    height: 112,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.12)',
  },
  placeVoteImage: { width: '100%', height: '100%' },
  placeVoteImageFallback: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.06)' },
  placeDetailRightCol: {
    flex: 1,
    minWidth: 0,
    minHeight: 112,
    justifyContent: 'space-between',
    alignItems: 'stretch',
  },
  placeDetailRightColTop: { flexShrink: 1 },
  placeVoteTitle: { fontSize: 13, fontWeight: '600', color: GinitTheme.colors.text, lineHeight: 18, marginBottom: 6 },
  placeVoteSub: { fontSize: 11, fontWeight: '700', color: GinitTheme.colors.textMuted, lineHeight: 15 },
});
