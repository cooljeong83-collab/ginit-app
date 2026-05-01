import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';
import { HomeGlassStyles, homeBlurIntensity, shouldUseStaticGlassInsteadOfBlur } from '@/constants/home-glass-styles';
import { resolveMeetingListThumbnailUri } from '@/src/lib/meeting-list-thumbnail';
import type { Meeting } from '@/src/lib/meetings';
import { getMeetingRecruitmentPhase } from '@/src/lib/meetings';

type Props = {
  meeting: Meeting;
};

/**
 * 프로필 탭 — 홈 피드와 같은 톤의 풀블리드 이미지 + 글래스 레이어 카드
 */
export function JoinedMeetingDashboardCard({ meeting }: Props) {
  const router = useRouter();
  const uri = resolveMeetingListThumbnailUri(meeting);
  const phase = getMeetingRecruitmentPhase(meeting);
  const phaseLabel =
    phase === 'confirmed' ? '확정' : phase === 'full' ? '모집 완료' : '모집중';
  const orangePhase = phase === 'full';
  const schedule =
    meeting.scheduleDate && meeting.scheduleTime
      ? `${meeting.scheduleDate} · ${meeting.scheduleTime}`
      : meeting.scheduleDate?.trim() || null;

  return (
    <Pressable
      onPress={() => router.push(`/meeting/${meeting.id}`)}
      style={({ pressed }) => [HomeGlassStyles.dashboardCard, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${meeting.title} 상세`}>
      <Image
        source={{ uri }}
        style={HomeGlassStyles.dashboardImage}
        contentFit="cover"
        cachePolicy="disk"
        recyclingKey={meeting.id}
      />
      {shouldUseStaticGlassInsteadOfBlur() ? (
        <View style={[StyleSheet.absoluteFillObject, styles.staticGlass]} />
      ) : (
        <BlurView
          intensity={homeBlurIntensity}
          tint="light"
          style={StyleSheet.absoluteFillObject}
          experimentalBlurMethod="dimezisBlurView"
        />
      )}
      <View style={HomeGlassStyles.dashboardVeil} pointerEvents="none" />
      <View style={HomeGlassStyles.dashboardInnerBorder} pointerEvents="none" />
      <View style={HomeGlassStyles.dashboardBody}>
        <View style={[HomeGlassStyles.phasePill, orangePhase && HomeGlassStyles.phasePillOrange]}>
          <Text
            style={[HomeGlassStyles.phasePillText, orangePhase && HomeGlassStyles.phasePillOrangeText]}
            numberOfLines={1}>
            {phaseLabel}
          </Text>
        </View>
        <Text style={HomeGlassStyles.dashboardTitle} numberOfLines={2}>
          {meeting.title}
        </Text>
        <Text style={HomeGlassStyles.dashboardSub} numberOfLines={1}>
          {[meeting.categoryLabel, meeting.location].filter(Boolean).join(' · ') || '모임 상세 보기'}
        </Text>
        {schedule ? (
          <Text style={styles.scheduleLine} numberOfLines={1}>
            {schedule}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.94,
    transform: [{ scale: 0.99 }],
  },
  staticGlass: {
    backgroundColor: 'rgba(255, 255, 255, 0.52)',
  },
  scheduleLine: {
    fontSize: 12,
    fontWeight: '700',
    color: GinitTheme.themeMainColor,
    textShadowColor: 'rgba(255, 255, 255, 0.9)',
    textShadowOffset: { width: 0, height: 0.5 },
    textShadowRadius: 2,
  },
});
