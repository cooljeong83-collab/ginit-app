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
import { useUserSession } from '@/src/context/UserSessionContext';
import type { DateCandidate } from '@/src/lib/meeting-place-bridge';
import type { Meeting } from '@/src/lib/meetings';
import { getMeetingById } from '@/src/lib/meetings';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';

const WEEK_KO = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** 칩 한 줄 — 날짜 + (선택) 시간 (`startDate` 누락·레거시 문서 대비) */
function formatDateCandidateTitle(dc: DateCandidate): string {
  const raw = typeof dc.startDate === 'string' ? dc.startDate.trim() : '';
  if (!raw) {
    return dc.textLabel?.trim() || '일정 후보';
  }
  const parts = raw.split('-').map((n) => Number(n));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return dc.textLabel?.trim() || raw;
  }
  const [y, mo, d] = parts;
  const date = new Date(y, mo - 1, d);
  const w = WEEK_KO[date.getDay()] ?? '';
  return `${mo}월 ${d}일 (${w})`;
}

type DateChip = { id: string; title: string; sub?: string };

function buildDateChips(meeting: Meeting): DateChip[] {
  const list = meeting.dateCandidates ?? [];
  if (list.length > 0) {
    return list.map((dc, i) => ({
      id: dc.id?.trim() || `dc-${i}`,
      title: formatDateCandidateTitle(dc),
      sub: dc.startTime?.trim() || undefined,
    }));
  }
  return [
    { id: 'mock-1', title: '4월 16일 (목)', sub: '14:00' },
    { id: 'mock-2', title: '4월 17일 (금)', sub: '14:00' },
  ];
}

const MOCK_PARTICIPANTS = [
  { id: '1', label: 'Sarah\n(호스트)', initial: 'S' },
  { id: '2', label: 'Alex', initial: 'A' },
  { id: '3', label: 'Maria', initial: 'M' },
  { id: '4', label: 'Chris', initial: 'C' },
  { id: '5', label: 'Ken', initial: 'K' },
] as const;

/** 세션 전화 PK와 모임 `createdBy`(정규화된 전화 PK)가 같으면 주선자 */
function isMeetingHost(sessionPhone: string | null, createdBy: string | null | undefined): boolean {
  const s = sessionPhone?.trim() ?? '';
  const c = createdBy?.trim() ?? '';
  if (!s || !c) return false;
  if (s === c) return true;
  const ns = normalizePhoneUserId(s) ?? s;
  const nc = normalizePhoneUserId(c) ?? c;
  return ns === nc;
}

export default function MeetingDetailScreen() {
  const router = useRouter();
  const { phoneUserId } = useUserSession();
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = typeof rawId === 'string' ? rawId : Array.isArray(rawId) ? rawId[0] : '';

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 일시 투표 — 후보 id 다중 선택 (로컬 UI, 추후 서버 반영) */
  const [selectedDateIds, setSelectedDateIds] = useState<string[]>([]);

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

  useEffect(() => {
    setSelectedDateIds([]);
  }, [meeting?.id]);

  const dateChips = useMemo(() => (meeting ? buildDateChips(meeting) : []), [meeting]);

  const toggleDateSelection = useCallback((chipId: string) => {
    setSelectedDateIds((prev) =>
      prev.includes(chipId) ? prev.filter((x) => x !== chipId) : [...prev, chipId],
    );
  }, []);

  const isHost = useMemo(() => (meeting ? isMeetingHost(phoneUserId, meeting.createdBy) : false), [meeting, phoneUserId]);

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

            <View style={styles.dateVoteHeaderBlock}>
              <Text style={styles.sectionTitle}>일시 투표 ({dateChips.length}건)</Text>
              <Text style={styles.dateVoteSub}>가능한 날짜를 가로로 스크롤하며 여러 개 선택할 수 있어요.</Text>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateChipScroll}>
              {dateChips.map((chip) => {
                const selected = selectedDateIds.includes(chip.id);
                return (
                  <Pressable
                    key={chip.id}
                    onPress={() => toggleDateSelection(chip.id)}
                    style={({ pressed }) => [
                      styles.dateChip,
                      selected ? styles.dateChipSelected : null,
                      pressed ? styles.dateChipPressed : null,
                    ]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={`${chip.title}${chip.sub ? ` ${chip.sub}` : ''}${selected ? ', 선택됨' : ', 선택 안 됨'}`}>
                    {selected ? (
                      <View style={styles.dateChipCheckWrap} pointerEvents="none">
                        <Ionicons name="checkmark-circle" size={20} color={GinitTheme.trustBlue} />
                      </View>
                    ) : null}
                    <Text style={[styles.dateChipTitle, selected && styles.dateChipTitleSelected]} numberOfLines={2}>
                      {chip.title}
                    </Text>
                    {chip.sub ? (
                      <Text style={[styles.dateChipSub, selected && styles.dateChipSubSelected]} numberOfLines={1}>
                        {chip.sub}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
            <Text style={selectedDateIds.length > 0 ? styles.dateSelectionHint : styles.dateSelectionHintMuted}>
              {selectedDateIds.length > 0 ? `${selectedDateIds.length}개 선택됨` : '아직 선택한 일정이 없어요'}
            </Text>

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
            {isHost ? (
              <>
                <Pressable style={[styles.bottomPill, styles.pillBlue]} accessibilityRole="button" accessibilityLabel="모임 수정">
                  <Ionicons name="construct-outline" size={18} color="#fff" />
                  <Text style={styles.pillText}>수정</Text>
                </Pressable>
                <Pressable style={[styles.bottomPill, styles.pillBlue]} accessibilityRole="button" accessibilityLabel="초대">
                  <Ionicons name="mail-outline" size={18} color="#fff" />
                  <Text style={styles.pillText}>초대</Text>
                </Pressable>
                <Pressable style={[styles.bottomPill, styles.pillOrange]} accessibilityRole="button" accessibilityLabel="일정 확정">
                  <Ionicons name="checkmark-circle" size={18} color="#fff" />
                  <Text style={styles.pillText}>확정</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Pressable
                  style={[styles.bottomPill, styles.pillBlue, styles.bottomPillFlex]}
                  accessibilityRole="button"
                  accessibilityLabel="초대">
                  <Ionicons name="mail-outline" size={18} color="#fff" />
                  <Text style={styles.pillText}>초대</Text>
                </Pressable>
                <Pressable
                  style={[styles.bottomPill, styles.pillOrange, styles.bottomPillFlex]}
                  accessibilityRole="button"
                  accessibilityLabel="모임 참여">
                  <Ionicons name="hand-right-outline" size={18} color="#fff" />
                  <Text style={styles.pillText}>참여</Text>
                </Pressable>
              </>
            )}
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
  dateVoteHeaderBlock: { marginBottom: 10, gap: 4 },
  dateVoteSub: { fontSize: 12, color: '#5C6570', lineHeight: 17 },
  dateChipScroll: { flexDirection: 'row', gap: 10, paddingBottom: 6, paddingRight: 8 },
  dateChip: {
    minWidth: 112,
    maxWidth: 140,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#E4E9EF',
    position: 'relative',
    shadowColor: 'rgba(15, 23, 42, 0.06)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
  },
  dateChipSelected: {
    borderColor: GinitTheme.trustBlue,
    backgroundColor: 'rgba(0, 82, 204, 0.07)',
  },
  dateChipPressed: { opacity: 0.9 },
  dateChipCheckWrap: { position: 'absolute', top: 6, right: 6 },
  dateChipTitle: { fontSize: 14, fontWeight: '700', color: '#1A1A1A', textAlign: 'center' },
  dateChipTitleSelected: { color: GinitTheme.trustBlue },
  dateChipSub: { fontSize: 13, fontWeight: '600', color: '#5C6570', textAlign: 'center', marginTop: 6 },
  dateChipSubSelected: { color: GinitTheme.trustBlue },
  dateSelectionHint: { fontSize: 13, color: GinitTheme.trustBlue, fontWeight: '600', marginTop: 8 },
  dateSelectionHintMuted: { fontSize: 12, color: '#8B95A1', marginTop: 8 },
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
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 22,
  },
  /** 게스트 2버튼일 때 가로 폭 균등 */
  bottomPillFlex: { flex: 1, minWidth: 0 },
  pillBlue: { backgroundColor: GinitTheme.trustBlue },
  pillOrange: { backgroundColor: GinitTheme.pointOrange },
  pillText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
