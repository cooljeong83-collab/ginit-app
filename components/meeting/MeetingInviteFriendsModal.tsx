import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import { homeBlurIntensity, shouldUseStaticGlassInsteadOfBlur } from '@/constants/home-glass-styles';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import type { FriendAcceptedRow } from '@/src/lib/friends';
import { fetchFriendsAcceptedList } from '@/src/lib/friends';
import type { Meeting } from '@/src/lib/meetings';
import { getPeerUserProfilesForIds } from '@/src/lib/user-profile';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

const BACKDROP_FADE_IN_MS = 240;
const BACKDROP_FADE_OUT_MS = 220;

type InviteFriendRow = {
  peerAppUserId: string;
  nickname: string;
  photoUrl: string | null;
  disabled: boolean;
  disabledReason: string | null;
};

export type MeetingInviteFriendsModalProps = {
  visible: boolean;
  meeting: Meeting | null;
  inviterAppUserId: string;
  busy: boolean;
  onRequestClose: () => void;
  onSubmit: (peerAppUserIds: string[]) => void | Promise<void>;
};

function participantPkSet(meeting: Meeting | null): Set<string> {
  const set = new Set<string>();
  if (!meeting) return set;
  const host = meeting.createdBy?.trim();
  if (host) {
    const h = normalizeParticipantId(host) ?? host;
    if (h) set.add(h);
  }
  for (const id of meeting.participantIds ?? []) {
    const pk = normalizeParticipantId(String(id)) ?? String(id).trim();
    if (pk) set.add(pk);
  }
  return set;
}

export function MeetingInviteFriendsModal({
  visible,
  meeting,
  inviterAppUserId,
  busy,
  onRequestClose,
  onSubmit,
}: MeetingInviteFriendsModalProps) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0.96)).current;
  const fadeAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const mountedRef = useRef(visible);

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<InviteFriendRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const cardMaxHeight = Math.min(Math.round(windowHeight * 0.72), 560);
  const cardWidth = Math.min(windowWidth - 48, 400);
  const listMaxHeight = Math.max(160, cardMaxHeight - 200);

  const inviterPk = useMemo(
    () => normalizeParticipantId(inviterAppUserId) ?? inviterAppUserId.trim(),
    [inviterAppUserId],
  );
  const joinedPkSet = useMemo(() => participantPkSet(meeting), [meeting]);

  const runBackdropFadeIn = useCallback(() => {
    fadeAnimRef.current?.stop();
    backdropOpacity.setValue(0);
    cardOpacity.setValue(0);
    cardScale.setValue(0.96);
    fadeAnimRef.current = Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: BACKDROP_FADE_IN_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(cardOpacity, {
        toValue: 1,
        duration: BACKDROP_FADE_IN_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(cardScale, {
        toValue: 1,
        duration: BACKDROP_FADE_IN_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    fadeAnimRef.current.start();
  }, [backdropOpacity, cardOpacity, cardScale]);

  const runBackdropFadeOut = useCallback(
    (onEnd?: () => void) => {
      fadeAnimRef.current?.stop();
      fadeAnimRef.current = Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: BACKDROP_FADE_OUT_MS,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(cardOpacity, {
          toValue: 0,
          duration: BACKDROP_FADE_OUT_MS,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(cardScale, {
          toValue: 0.96,
          duration: BACKDROP_FADE_OUT_MS,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]);
      fadeAnimRef.current.start(({ finished }) => {
        if (finished) onEnd?.();
      });
    },
    [backdropOpacity, cardOpacity, cardScale],
  );

  useEffect(() => {
    if (visible) {
      mountedRef.current = true;
      setMounted(true);
      runBackdropFadeIn();
      return;
    }
    if (!mountedRef.current) return;
    runBackdropFadeOut(() => {
      mountedRef.current = false;
      setMounted(false);
    });
  }, [visible, runBackdropFadeIn, runBackdropFadeOut]);

  useEffect(() => {
    return () => {
      fadeAnimRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (!visible) {
      setSelected(new Set());
      return;
    }
    let alive = true;
    setLoading(true);
    setLoadError(null);
    void (async () => {
      try {
        const accepted: FriendAcceptedRow[] = await fetchFriendsAcceptedList(inviterAppUserId);
        const peerIds = accepted
          .map((r) => r.peer_app_user_id?.trim())
          .filter((id): id is string => Boolean(id));
        const profiles = await getPeerUserProfilesForIds(peerIds);
        const next: InviteFriendRow[] = [];
        for (const r of accepted) {
          const peerId = r.peer_app_user_id?.trim() ?? '';
          if (!peerId) continue;
          const pk = normalizeParticipantId(peerId) ?? peerId;
          const prof = profiles.get(peerId) ?? profiles.get(pk);
          const nickname = prof?.nickname?.trim() || prof?.displayName?.trim() || '친구';
          const photoUrl = prof?.photoUrl?.trim() || null;
          let disabled = false;
          let disabledReason: string | null = null;
          if (pk === inviterPk) {
            disabled = true;
            disabledReason = '본인';
          } else if (joinedPkSet.has(pk)) {
            disabled = true;
            disabledReason = '이미 참여 중';
          }
          next.push({ peerAppUserId: peerId, nickname, photoUrl, disabled, disabledReason });
        }
        next.sort((a, b) => a.nickname.localeCompare(b.nickname, 'ko'));
        if (!alive) return;
        setRows(next);
      } catch (e) {
        if (!alive) return;
        setLoadError(e instanceof Error ? e.message : '친구 목록을 불러오지 못했어요.');
        setRows([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [visible, inviterAppUserId, inviterPk, joinedPkSet]);

  const selectedCount = selected.size;

  const togglePeer = useCallback(
    (peerId: string, disabled: boolean) => {
      if (disabled || busy) return;
      const pk = normalizeParticipantId(peerId) ?? peerId.trim();
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(pk)) next.delete(pk);
        else next.add(pk);
        return next;
      });
    },
    [busy],
  );

  const handleRequestClose = useCallback(() => {
    if (busy) return;
    onRequestClose();
  }, [busy, onRequestClose]);

  const handleSubmit = useCallback(() => {
    if (selectedCount === 0 || busy) return;
    void onSubmit([...selected]);
  }, [busy, onSubmit, selected, selectedCount]);

  if (!mounted) return null;

  const useStaticBackdrop = Platform.OS === 'web' || shouldUseStaticGlassInsteadOfBlur();

  return (
    <Modal visible={mounted} animationType="none" transparent onRequestClose={handleRequestClose}>
      <View style={styles.modalRoot}>
        <Animated.View style={[styles.backdropLayer, { opacity: backdropOpacity }]} pointerEvents="box-none">
          {useStaticBackdrop ? (
            <View style={[StyleSheet.absoluteFill, styles.backdropStatic]} />
          ) : (
            <BlurView
              tint="dark"
              intensity={GinitTheme.blur.intensityStrong ?? homeBlurIntensity}
              style={StyleSheet.absoluteFill}
              {...(Platform.OS === 'android' ? { experimentalBlurMethod: 'dimezisBlurView' as const } : {})}
            />
          )}
          <View style={[StyleSheet.absoluteFill, styles.backdropVeil]} pointerEvents="none" />
          <GinitPressable
            style={StyleSheet.absoluteFill}
            onPress={handleRequestClose}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="친구 초대 닫기"
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.cardWrap,
            {
              opacity: cardOpacity,
              transform: [{ scale: cardScale }],
              width: cardWidth,
              maxHeight: cardMaxHeight,
            },
          ]}
          pointerEvents="box-none">
          <View style={styles.card}>
            <View style={styles.header}>
              <Text style={styles.title}>친구 초대</Text>
              <GinitPressable
                onPress={handleRequestClose}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="닫기"
                style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.85 }]}>
                <GinitSymbolicIcon name="close" size={22} color={GinitTheme.colors.textSub} />
              </GinitPressable>
            </View>
            <Text style={styles.subtitle} numberOfLines={2}>
              {meeting?.title?.trim() ? `「${meeting.title.trim()}」` : '모임'}에 초대할 친구를 선택하세요.
            </Text>

            {loading ? (
              <View style={[styles.centerBox, { minHeight: Math.min(200, listMaxHeight) }]}>
                <ActivityIndicator color={GinitTheme.colors.primary} />
              </View>
            ) : loadError ? (
              <View style={[styles.centerBox, { minHeight: Math.min(200, listMaxHeight) }]}>
                <Text style={styles.emptyText}>{loadError}</Text>
              </View>
            ) : rows.length === 0 ? (
              <View style={[styles.centerBox, { minHeight: Math.min(200, listMaxHeight) }]}>
                <Text style={styles.emptyTitle}>초대할 친구가 없어요</Text>
                <Text style={styles.emptyText}>친구 탭에서 지닛을 보낸 뒤 다시 시도해 주세요.</Text>
              </View>
            ) : (
              <ScrollView
                style={[styles.list, { maxHeight: listMaxHeight }]}
                contentContainerStyle={styles.listContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator>
                {rows.map((row) => {
                  const pk = normalizeParticipantId(row.peerAppUserId) ?? row.peerAppUserId;
                  const checked = selected.has(pk);
                  return (
                    <GinitPressable
                      key={row.peerAppUserId}
                      onPress={() => togglePeer(row.peerAppUserId, row.disabled)}
                      disabled={row.disabled || busy}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked, disabled: row.disabled }}
                      accessibilityLabel={`${row.nickname}${row.disabledReason ? `, ${row.disabledReason}` : ''}`}
                      style={({ pressed }) => [
                        styles.row,
                        row.disabled && styles.rowDisabled,
                        pressed && !row.disabled && !busy && { opacity: 0.88 },
                      ]}>
                      <View style={styles.avatarWrap}>
                        {row.photoUrl ? (
                          <Image source={{ uri: row.photoUrl }} style={styles.avatar} contentFit="cover" />
                        ) : (
                          <View style={styles.avatarFallback}>
                            <Text style={styles.avatarLetter}>{row.nickname.slice(0, 1) || '?'}</Text>
                          </View>
                        )}
                      </View>
                      <View style={styles.rowText}>
                        <Text style={styles.rowName} numberOfLines={1}>
                          {row.nickname}
                        </Text>
                        {row.disabledReason ? (
                          <Text style={styles.rowMeta} numberOfLines={1}>
                            {row.disabledReason}
                          </Text>
                        ) : null}
                      </View>
                      <View
                        style={[styles.check, checked && styles.checkOn, row.disabled && styles.checkDisabled]}>
                        {checked ? <GinitSymbolicIcon name="checkmark" size={16} color="#fff" /> : null}
                      </View>
                    </GinitPressable>
                  );
                })}
              </ScrollView>
            )}

            <GinitPressable
              onPress={handleSubmit}
              disabled={busy || selectedCount === 0}
              accessibilityRole="button"
              accessibilityLabel={`초대하기 ${selectedCount}명`}
              style={({ pressed }) => [
                styles.cta,
                (busy || selectedCount === 0) && styles.ctaDisabled,
                pressed && selectedCount > 0 && !busy && { opacity: 0.9 },
              ]}>
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.ctaText}>
                  초대하기{selectedCount > 0 ? ` (${selectedCount})` : ''}
                </Text>
              )}
            </GinitPressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  backdropLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  backdropStatic: {
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
  },
  backdropVeil: {
    backgroundColor: 'rgba(15, 23, 42, 0.28)',
  },
  cardWrap: {
    zIndex: 2,
    maxWidth: '100%',
  },
  card: {
    borderRadius: 20,
    paddingTop: 16,
    paddingHorizontal: 18,
    paddingBottom: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.72)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 28,
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: GinitTheme.colors.text,
  },
  closeBtn: {
    padding: 6,
  },
  subtitle: {
    fontSize: 13,
    color: GinitTheme.colors.textMuted,
    marginBottom: 12,
  },
  centerBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 16,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: GinitTheme.colors.text,
    marginBottom: 6,
  },
  emptyText: {
    fontSize: 14,
    color: GinitTheme.colors.textMuted,
    textAlign: 'center',
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    paddingBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GinitTheme.colors.border,
  },
  rowDisabled: {
    opacity: 0.5,
  },
  avatarWrap: {
    marginRight: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  avatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: GinitTheme.colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    fontSize: 16,
    fontWeight: '700',
    color: GinitTheme.colors.primary,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontSize: 16,
    fontWeight: '600',
    color: GinitTheme.colors.text,
  },
  rowMeta: {
    fontSize: 12,
    color: GinitTheme.colors.textMuted,
    marginTop: 2,
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: GinitTheme.colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: {
    backgroundColor: GinitTheme.colors.primary,
    borderColor: GinitTheme.colors.primary,
  },
  checkDisabled: {
    borderColor: GinitTheme.colors.border,
  },
  cta: {
    marginTop: 14,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: GinitTheme.colors.deepPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaDisabled: {
    opacity: 0.45,
  },
  ctaText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});
