import { BlurView } from 'expo-blur';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MeetingListThumbnailImage } from '@/components/feed/MeetingListThumbnailImage';
import { HomeGlassStyles, homeBlurIntensity, shouldUseStaticGlassInsteadOfBlur } from '@/constants/home-glass-styles';
import { joinedMeetingAgentLine } from '@/src/lib/joined-meetings';
import type { Meeting } from '@/src/lib/meetings';
import { getMeetingRecruitmentPhase } from '@/src/lib/meetings';

function MiniMeetingGlassCard({ meeting, onPress }: { meeting: Meeting; onPress: () => void }) {
  const phase = getMeetingRecruitmentPhase(meeting);
  const phaseLabel =
    phase === 'confirmed' ? '확정' : phase === 'full' ? '모집 완료' : '모집중';
  const orangePhase = phase === 'full';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [HomeGlassStyles.miniCardOuter, pressed && styles.miniPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${meeting.title}, ${phaseLabel}`}>
      <MeetingListThumbnailImage meeting={meeting} style={HomeGlassStyles.miniThumb} recyclingKey={meeting.id} />
      {shouldUseStaticGlassInsteadOfBlur() ? (
        <View style={[HomeGlassStyles.miniCardBlurWrap, styles.staticGlass]} />
      ) : (
        <BlurView
          intensity={homeBlurIntensity}
          tint="light"
          style={HomeGlassStyles.miniCardBlurWrap}
          experimentalBlurMethod="dimezisBlurView"
        />
      )}
      <View style={HomeGlassStyles.miniCardVeil} pointerEvents="none" />
      <View style={HomeGlassStyles.miniCardInnerBorder} pointerEvents="none" />
      <View style={HomeGlassStyles.miniCardBody}>
        <View style={[HomeGlassStyles.phasePill, orangePhase && HomeGlassStyles.phasePillOrange]}>
          <Text
            style={[HomeGlassStyles.phasePillText, orangePhase && HomeGlassStyles.phasePillOrangeText]}
            numberOfLines={1}>
            {phaseLabel}
          </Text>
        </View>
        <Text style={HomeGlassStyles.miniTitle} numberOfLines={2}>
          {meeting.title}
        </Text>
        {meeting.categoryLabel?.trim() ? (
          <Text style={HomeGlassStyles.miniMeta} numberOfLines={1}>
            {meeting.categoryLabel.trim()}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

type Props = {
  meetings: Meeting[];
  onOpenMeeting: (id: string) => void;
};

/**
 * 채팅 탭 상단 — 조율 중인 참가 모임 미니 글래스 카드 + AI 말풍선
 */
export function InProgressMeetingsStrip({ meetings, onOpenMeeting }: Props) {
  const agentLine = useMemo(() => {
    if (meetings.length === 0) return '참여 중인 모임이 없어요. 홈에서 모임에 참여해 보세요!';
    return joinedMeetingAgentLine(meetings[0], meetings[0].title.length);
  }, [meetings]);

  if (meetings.length === 0) {
    return (
      <View style={styles.emptyStrip}>
        <View style={HomeGlassStyles.agentBubble}>
          <Text style={HomeGlassStyles.agentBubbleText}>{agentLine}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={HomeGlassStyles.stripRow}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={HomeGlassStyles.stripScroll}
        contentContainerStyle={HomeGlassStyles.stripContent}>
        {meetings.map((m) => (
          <MiniMeetingGlassCard key={m.id} meeting={m} onPress={() => onOpenMeeting(m.id)} />
        ))}
      </ScrollView>
      <View style={styles.bubbleCol}>
        <View style={styles.heroArtSmall} accessibilityLabel="지닛 안내">
          <View style={styles.heroLogoSmallWrap} pointerEvents="none">
            <Image source={require('@/assets/images/logo_symbol.png')} style={styles.heroLogoSmall} contentFit="contain" />
          </View>
        </View>
        <View style={HomeGlassStyles.agentBubble}>
          <Text style={HomeGlassStyles.agentBubbleText}>{agentLine}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  miniPressed: {
    opacity: 0.94,
    transform: [{ scale: 0.98 }],
  },
  staticGlass: {
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
  },
  bubbleCol: {
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    maxWidth: 210,
  },
  heroArtSmall: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 82, 204, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(0, 82, 204, 0.14)',
  },
  heroEmojiSmall: {
    fontSize: 24,
  },
  heroLogoSmall: {
    width: 22,
    height: 22,
  },
  heroLogoSmallWrap: {
    width: 30,
    height: 30,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: 'rgba(15, 23, 42, 0.12)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
  },
  emptyStrip: {
    marginBottom: 16,
    alignItems: 'flex-start',
  },
});
