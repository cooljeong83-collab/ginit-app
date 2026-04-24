import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { filterJoinedMeetings } from '@/src/lib/joined-meetings';
import type { LatLng } from '@/src/lib/geo-distance';
import type { Meeting } from '@/src/lib/meetings';

import { HomeGlassMeetingGridCard } from '@/components/feed/HomeGlassMeetingGridCard';

type Props = {
  meetings: Meeting[];
  userId: string | null | undefined;
  userCoords: LatLng | null;
  titleFontFamily?: string;
  onMeetingPress: (meetingId: string) => void;
};

/**
 * 홈 상단 — 내가 참여 중인 모임(반경 내 전체) 가로 스크롤 미니 글래스 카드
 */
export function HomeInProgressMeetingsStrip({
  meetings,
  userId,
  userCoords,
  titleFontFamily,
  onMeetingPress,
}: Props) {
  const joined = useMemo(() => filterJoinedMeetings(meetings, userId), [meetings, userId]);
  if (joined.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.sectionLabel}>참여 중인 모임</Text>
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}>
        {joined.map((m) => (
          <HomeGlassMeetingGridCard
            key={m.id}
            meeting={m}
            layout="strip"
            userCoords={userCoords}
            titleFontFamily={titleFontFamily}
            onPress={() => onMeetingPress(m.id)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 18,
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '800',
    color: '#f1f5f9',
    marginBottom: 10,
    letterSpacing: -0.3,
    textShadowColor: 'rgba(0, 0, 0, 0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  scrollContent: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
    paddingVertical: 2,
    paddingRight: 4,
  },
});
