import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GinitTheme } from '@/constants/ginit-theme';
import type { DateCandidate } from '@/src/lib/meeting-place-bridge';
import type { Meeting } from '@/src/lib/meetings';
import { getMeetingById } from '@/src/lib/meetings';

const WEEK_KO = ['일', '월', '화', '수', '목', '금', '토'] as const;

const MOCK_VOTE_NAMES = [
  'Sarah (호스트), Alex, Maria',
  'Ken, Chris',
  'Alex, Ken',
  'Maria',
];

function formatDateCandidateLine(dc: DateCandidate): string {
  const parts = dc.startDate.split('-').map((n) => Number(n));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return dc.textLabel?.trim() || dc.startDate;
  }
  const [y, mo, d] = parts;
  const date = new Date(y, mo - 1, d);
  const w = WEEK_KO[date.getDay()] ?? '';
  const timePart = dc.startTime?.trim() ? ` ${dc.startTime.trim()}` : '';
  return `${mo}월 ${d}일 (${w})${timePart}`;
}

type VoteSlot = { id: string; label: string; votes: number; names: string; leading: boolean };

function buildDateVoteSlots(meeting: Meeting): VoteSlot[] {
  const list = meeting.dateCandidates ?? [];
  if (list.length > 0) {
    const maxVotes = Math.max(3, list.length);
    return list.map((dc, i) => ({
      id: dc.id,
      label: formatDateCandidateLine(dc),
      votes: maxVotes - i,
      names: MOCK_VOTE_NAMES[i % MOCK_VOTE_NAMES.length] ?? '—',
      leading: i === 0,
    }));
  }
  return [
    {
      id: 'mock-1',
      label: '4월 16일 (목) 14:00',
      votes: 3,
      names: 'Sarah (호스트), Alex, Maria',
      leading: true,
    },
    {
      id: 'mock-2',
      label: '4월 17일 (금) 14:00',
      votes: 2,
      names: 'Ken, Chris',
      leading: false,
    },
  ];
}

const MOCK_PARTICIPANTS = [
  { id: '1', label: 'Sarah\n(호스트)', initial: 'S' },
  { id: '2', label: 'Alex', initial: 'A' },
  { id: '3', label: 'Maria', initial: 'M' },
  { id: '4', label: 'Chris', initial: 'C' },
  { id: '5', label: 'Ken', initial: 'K' },
] as const;

export default function MeetingDetailScreen() {
  const router = useRouter();
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = typeof rawId === 'string' ? rawId : Array.isArray(rawId) ? rawId[0] : '';

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id?.trim()) {
      setMeeting(null);
      setLoadError(null);
      setLoading(false);
      return;
    }
    setLoadError(null);
    setLoading(true);
    try {
      const m = await getMeetingById(id);
      setMeeting(m);
    } catch (e) {
      setMeeting(null);
      setLoadError(e instanceof Error ? e.message : '불러오기에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const voteSlots = useMemo(() => (meeting ? buildDateVoteSlots(meeting) : []), [meeting]);
  const maxVotes = useMemo(() => Math.max(1, ...voteSlots.map((s) => s.votes)), [voteSlots]);

  const placeTitle = meeting
    ? meeting.placeCandidates?.[0]?.placeName ?? meeting.placeName?.trim() ?? meeting.location
    : '';
  const placeAddr = meeting ? meeting.placeCandidates?.[0]?.address ?? meeting.address?.trim() ?? '' : '';

  const notFound = !loading && !loadError && meeting === null;

  return (
    <LinearGradient colors={['#E8F2FF', '#FFF5EB']} style={styles.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <View style={styles.topBar}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="뒤로">
            <Ionicons name="chevron-back" size={26} color="#1A1A1A" />
          </Pressable>
          <Text style={styles.topTitle}>모임 상세</Text>
          <View style={styles.badgeOrange}>
            <Text style={styles.badgeOrangeText}>투표 진행 중</Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.centerFill}>
            <ActivityIndicator color={GinitTheme.trustBlue} />
            <Text style={styles.muted}>불러오는 중…</Text>
          </View>
        ) : null}

        {loadError ? (
          <View style={styles.centerFill}>
            <Text style={styles.errorTitle}>문제가 생겼어요</Text>
            <Text style={styles.muted}>{loadError}</Text>
            <Pressable onPress={() => void load()} style={styles.retryBtn} accessibilityRole="button">
              <Text style={styles.retryText}>다시 시도</Text>
            </Pressable>
          </View>
        ) : null}

        {notFound ? (
          <View style={styles.centerFill}>
            <Text style={styles.errorTitle}>모임을 찾을 수 없어요</Text>
            <Pressable onPress={() => router.back()} style={styles.retryBtn} accessibilityRole="button">
              <Text style={styles.retryText}>돌아가기</Text>
            </Pressable>
          </View>
        ) : null}

        {!loading && !loadError && meeting !== null ? (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled">
            <View style={styles.titleCard}>
              <Pressable style={styles.pencilAbs} accessibilityRole="button" accessibilityLabel="제목 수정">
                <Ionicons name="pencil" size={18} color={GinitTheme.trustBlue} />
              </Pressable>
              <Text style={styles.titleCardText}>{meeting.title || '제목 없음'}</Text>
              <Text style={styles.mascotPeek} accessibilityElementsHidden>
                🤖
              </Text>
            </View>

            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>일시 투표 ({voteSlots.length}건)</Text>
              <View style={styles.calIcons}>
                {[0, 1, 2, 3].map((i) => (
                  <Ionicons key={i} name="calendar-outline" size={16} color={GinitTheme.trustBlue} style={{ opacity: 0.35 + i * 0.15 }} />
                ))}
              </View>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
              {voteSlots.map((slot) => (
                <View key={slot.id} style={[styles.voteCard, slot.leading && styles.voteCardLead]}>
                  <Text style={styles.voteCardDate}>{slot.label}</Text>
                  <Text style={[styles.voteCount, slot.leading ? styles.voteCountLead : styles.voteCountMuted]}>
                    {slot.votes}표
                  </Text>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${Math.round((slot.votes / maxVotes) * 100)}%` }, slot.leading ? styles.progressLead : styles.progressMuted]} />
                  </View>
                  <Text style={styles.voterNames} numberOfLines={2}>
                    {slot.names}
                  </Text>
                </View>
              ))}
            </ScrollView>

            <Pressable style={styles.addOutlineBtn} accessibilityRole="button">
              <Ionicons name="add" size={20} color="#5C6570" />
              <Text style={styles.addOutlineText}>후보 추가</Text>
            </Pressable>

            <Text style={[styles.sectionTitle, styles.sectionSpaced]}>장소</Text>
            <View style={styles.placeCard}>
              <View style={styles.mapThumb}>
                <Ionicons name="map" size={22} color={GinitTheme.trustBlue} />
                <Ionicons name="location" size={14} color={GinitTheme.pointOrange} style={styles.pinOnMap} />
              </View>
              <View style={styles.placeBody}>
                <Text style={styles.placeName} numberOfLines={2}>
                  {placeTitle || '장소 미정'}
                </Text>
                {placeAddr ? (
                  <Text style={styles.placeAddr} numberOfLines={2}>
                    {placeAddr}
                  </Text>
                ) : null}
                <Text style={styles.placePay}>결제: 💵 1/N 정산</Text>
              </View>
              <Pressable style={styles.pencilPlace} accessibilityRole="button" accessibilityLabel="장소 수정">
                <Ionicons name="pencil" size={18} color={GinitTheme.trustBlue} />
              </Pressable>
            </View>

            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>참여자 (5명)</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.avatarRow}>
              {MOCK_PARTICIPANTS.map((p) => (
                <View key={p.id} style={styles.avatarCol}>
                  <View style={styles.avatarCircle}>
                    <Text style={styles.avatarInitial}>{p.initial}</Text>
                  </View>
                  <Text style={styles.avatarLabel} numberOfLines={2}>
                    {p.label.includes('\n') ? (
                      <>
                        {p.label.split('\n')[0]}
                        {'\n'}
                        {p.label.split('\n')[1]}
                      </>
                    ) : (
                      p.label
                    )}
                  </Text>
                </View>
              ))}
              <Pressable style={styles.avatarAdd} accessibilityRole="button" accessibilityLabel="참여자 초대">
                <Ionicons name="add" size={26} color={GinitTheme.trustBlue} />
              </Pressable>
            </ScrollView>

            <View style={styles.bottomSpacer} />
          </ScrollView>
        ) : null}

        {!loading && !loadError && meeting !== null ? (
          <View style={styles.bottomBar}>
            <Pressable style={[styles.bottomPill, styles.pillBlue]} accessibilityRole="button">
              <Ionicons name="construct-outline" size={18} color="#fff" />
              <Text style={styles.pillText}>수정</Text>
            </Pressable>
            <Pressable style={[styles.bottomPill, styles.pillBlue]} accessibilityRole="button">
              <Ionicons name="mail-outline" size={18} color="#fff" />
              <Text style={styles.pillText}>초대</Text>
            </Pressable>
            <Pressable style={[styles.bottomPill, styles.pillOrange]} accessibilityRole="button">
              <Ionicons name="checkmark-circle" size={18} color="#fff" />
              <Text style={styles.pillText}>확정</Text>
            </Pressable>
          </View>
        ) : null}
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  safe: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 8,
    gap: 4,
  },
  iconBtn: { padding: 8, borderRadius: 12 },
  pressed: { opacity: 0.7 },
  topTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: '#1A1A1A', textAlign: 'center' },
  badgeOrange: {
    backgroundColor: GinitTheme.pointOrange,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    marginRight: 4,
  },
  badgeOrangeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  centerFill: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10, padding: 24 },
  muted: { color: '#5C6570', fontSize: 14 },
  errorTitle: { fontSize: 17, fontWeight: '700', color: '#1A1A1A' },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: GinitTheme.trustBlue,
  },
  retryText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 12 },
  titleCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    paddingRight: 56,
    marginBottom: 20,
    shadowColor: 'rgba(15, 23, 42, 0.12)',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 14,
    elevation: 4,
    position: 'relative',
    overflow: 'visible',
  },
  pencilAbs: { position: 'absolute', top: 14, right: 14, zIndex: 2, padding: 4 },
  titleCardText: { fontSize: 18, fontWeight: '700', color: '#1A1A1A', lineHeight: 26 },
  mascotPeek: { position: 'absolute', right: 4, bottom: -4, fontSize: 36 },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1A1A1A' },
  sectionSpaced: { marginTop: 20, marginBottom: 10 },
  calIcons: { flexDirection: 'row', gap: 4 },
  hScroll: { gap: 12, paddingBottom: 4 },
  voteCard: {
    width: 200,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    shadowColor: 'rgba(0,0,0,0.08)',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 10,
    elevation: 2,
  },
  voteCardLead: { borderColor: 'rgba(0, 82, 204, 0.35)' },
  voteCardDate: { fontSize: 15, fontWeight: '700', color: '#1A1A1A', marginBottom: 8 },
  voteCount: { fontSize: 14, fontWeight: '700', marginBottom: 6 },
  voteCountLead: { color: GinitTheme.trustBlue },
  voteCountMuted: { color: '#8B95A1' },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#E8ECF0',
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: { height: '100%', borderRadius: 3 },
  progressLead: { backgroundColor: GinitTheme.trustBlue },
  progressMuted: { backgroundColor: '#B8C0C8' },
  voterNames: { fontSize: 12, color: '#5C6570', lineHeight: 17 },
  addOutlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#D0D7E0',
    backgroundColor: 'rgba(255,255,255,0.65)',
  },
  addOutlineText: { fontSize: 15, fontWeight: '600', color: '#5C6570' },
  placeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 12,
    gap: 12,
    shadowColor: 'rgba(15, 23, 42, 0.08)',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 3,
  },
  mapThumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: '#E8F2FF',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pinOnMap: { position: 'absolute', bottom: 8 },
  placeBody: { flex: 1, minWidth: 0 },
  placeName: { fontSize: 16, fontWeight: '700', color: '#1A1A1A' },
  placeAddr: { fontSize: 13, color: '#5C6570', marginTop: 4 },
  placePay: { fontSize: 12, color: '#5C6570', marginTop: 6 },
  pencilPlace: { padding: 6 },
  avatarRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingVertical: 4 },
  avatarCol: { width: 64, alignItems: 'center' },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#E8F2FF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: 'rgba(0,0,0,0.1)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 2,
  },
  avatarInitial: { fontSize: 18, fontWeight: '700', color: GinitTheme.trustBlue },
  avatarLabel: { marginTop: 6, fontSize: 11, color: '#333', textAlign: 'center', lineHeight: 14 },
  avatarAdd: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: GinitTheme.trustBlue,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 0,
    opacity: 0.85,
  },
  bottomSpacer: { height: 100 },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    paddingBottom: 20,
    backgroundColor: 'transparent',
  },
  bottomPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 22,
  },
  pillBlue: { backgroundColor: GinitTheme.trustBlue },
  pillOrange: { backgroundColor: GinitTheme.pointOrange },
  pillText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
