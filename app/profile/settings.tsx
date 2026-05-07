import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  ToastAndroid,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { MeetingServiceAuthModal } from '@/components/profile/MeetingServiceAuthModal';
import { ScreenShell } from '@/components/ui';
import { GinitSymbolicIcon, type SymbolicIconName } from '@/components/ui/GinitSymbolicIcon';
import { GinitStyles } from '@/constants/GinitStyles';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import {
  deleteFirebaseAuthUserStrict,
  purgeUserAccountRemote,
  purgeUserAccountRemoteByFirebaseUid,
  wipeLocalAppData,
} from '@/src/lib/account-deletion';
import { normalizeUserId } from '@/src/lib/app-user-id';
import { fetchMeetingAreaNotifyMatrix } from '@/src/lib/meeting-area-notify-rules';
import { isProfileRegisterInfoParamOn, PROFILE_REGISTER_INFO_QUERY } from '@/src/lib/profile-register-info';
import { ensureGinitFcmNotifeeChannel } from '@/src/lib/fcm-notifee-display';
import { ensureGinitInAppAndroidChannel } from '@/src/lib/in-app-alarm-push';
import {
  labelForProfileNotificationSoundId,
  loadProfileNotificationSoundId,
  PROFILE_NOTIFICATION_SOUND_OPTIONS,
  saveProfileNotificationSoundId,
  type ProfileNotificationSoundId,
} from '@/src/lib/profile-notification-sound-preference';
import {
  playProfileNotificationSoundPreview,
  stopProfileNotificationSoundPreview,
} from '@/src/lib/preview-profile-notification-sound';
import {
  DND_QUIET_HOURS_DEFAULT_END_MIN,
  DND_QUIET_HOURS_DEFAULT_START_MIN,
  loadProfileDndQuietHoursEnabled,
  loadProfileDndQuietHoursWindow,
  saveProfileDndQuietHoursEnabled,
  saveProfileDndQuietHoursWindow,
} from '@/src/lib/profile-settings-local';
import { safeRouterBack } from '@/src/lib/router-safe';
import { ensureUserProfile, isMeetingServiceComplianceComplete } from '@/src/lib/user-profile';

function RowSep() {
  return <View style={styles.sep} />;
}

function SettingsRowLeadIcon({
  name,
  destructive,
}: {
  name: SymbolicIconName;
  destructive?: boolean;
}) {
  return (
    <View
      style={[styles.rowIconSlot, destructive && styles.rowIconSlotDanger]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <GinitSymbolicIcon
        name={name}
        size={22}
        color={destructive ? GinitTheme.colors.danger : '#475569'}
      />
    </View>
  );
}

/** `app/social/friends-settings` 스위치 트랙과 동일 */
const meetingCreateSwitchTrack = { false: '#cbd5e1', true: GinitTheme.themeMainColor } as const;

function sectionTitle(label: string) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionHeadText}>{label}</Text>
    </View>
  );
}

function minutesOfDayFromDate(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function dateFromMinutesOfDay(min: number): Date {
  const h = Math.floor(min / 60) % 24;
  const m = ((min % 60) + 60) % 60;
  return new Date(2000, 0, 1, h, m, 0, 0);
}

function formatDndTimeLabel(min: number): string {
  return dateFromMinutesOfDay(min).toLocaleTimeString('ko-KR', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

type DndTimePick = { kind: 'start' | 'end'; draft: Date };

export default function ProfileAppSettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { registerInfo: registerInfoParam } = useLocalSearchParams<{ registerInfo?: string | string[] }>();
  const { userId, authProfile, signOutSession } = useUserSession();

  const [busy, setBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [notifyGranted, setNotifyGranted] = useState(false);
  const [notifyLoaded, setNotifyLoaded] = useState(false);
  const [dndOn, setDndOn] = useState(false);
  const [dndLoaded, setDndLoaded] = useState(false);
  const [dndStartMin, setDndStartMin] = useState(DND_QUIET_HOURS_DEFAULT_START_MIN);
  const [dndEndMin, setDndEndMin] = useState(DND_QUIET_HOURS_DEFAULT_END_MIN);
  const [dndPick, setDndPick] = useState<DndTimePick | null>(null);
  const dndWindowRef = useRef({ start: DND_QUIET_HOURS_DEFAULT_START_MIN, end: DND_QUIET_HOURS_DEFAULT_END_MIN });

  useEffect(() => {
    dndWindowRef.current = { start: dndStartMin, end: dndEndMin };
  }, [dndStartMin, dndEndMin]);

  const isSignedIn = Boolean(userId?.trim() || authProfile?.firebaseUid?.trim());

  const profilePk = useMemo(() => {
    const u = userId?.trim();
    if (u) return u;
    const em = authProfile?.email?.trim();
    if (em) return normalizeUserId(em) ?? '';
    return '';
  }, [userId, authProfile?.email]);

  const [meetingAuthComplete, setMeetingAuthComplete] = useState(false);
  const [meetingAuthLoaded, setMeetingAuthLoaded] = useState(false);
  const [authSheetVisible, setAuthSheetVisible] = useState(false);
  const [meetingNotifyLoaded, setMeetingNotifyLoaded] = useState(false);
  const [meetingNotifyEffectiveOn, setMeetingNotifyEffectiveOn] = useState(false);
  const [soundId, setSoundId] = useState<ProfileNotificationSoundId>('ginit_ring_w');
  const [soundLoaded, setSoundLoaded] = useState(false);
  const [soundPickOpen, setSoundPickOpen] = useState(false);

  const { height: windowHeight } = useWindowDimensions();
  const soundSheetLayout = useMemo(() => {
    const panelMax = Math.floor(windowHeight * 0.96);
    const panelPadBottom = Math.max(16, insets.bottom);
    const scrollMax = Math.max(280, panelMax - 18 - panelPadBottom - 12);
    return { panelMax, panelPadBottom, scrollMax };
  }, [windowHeight, insets.bottom]);

  const refreshMeetingAuth = useCallback(async () => {
    const pk = profilePk.trim();
    if (!pk) {
      setMeetingAuthComplete(false);
      setMeetingAuthLoaded(true);
      return;
    }
    setMeetingAuthLoaded(false);
    try {
      const p = await ensureUserProfile(pk);
      setMeetingAuthComplete(isMeetingServiceComplianceComplete(p, pk));
    } catch {
      setMeetingAuthComplete(false);
    } finally {
      setMeetingAuthLoaded(true);
    }
  }, [profilePk]);

  const refreshNotify = useCallback(async () => {
    if (Platform.OS === 'web') {
      setNotifyGranted(false);
      setNotifyLoaded(true);
      return;
    }
    try {
      const { status } = await Notifications.getPermissionsAsync();
      setNotifyGranted(status === 'granted');
    } catch {
      setNotifyGranted(false);
    } finally {
      setNotifyLoaded(true);
    }
  }, []);

  const refreshMeetingNotify = useCallback(async () => {
    if (Platform.OS === 'web') {
      setMeetingNotifyLoaded(true);
      setMeetingNotifyEffectiveOn(false);
      return;
    }
    const pk = profilePk.trim();
    if (!pk) {
      setMeetingNotifyLoaded(true);
      setMeetingNotifyEffectiveOn(false);
      return;
    }
    setMeetingNotifyLoaded(false);
    try {
      const m = await fetchMeetingAreaNotifyMatrix(pk);
      const rn = (m.region_norms ?? []).filter((x) => String(x ?? '').trim() !== '');
      const ci = (m.category_ids ?? []).filter((x) => String(x ?? '').trim() !== '');
      setMeetingNotifyEffectiveOn(rn.length > 0 && ci.length > 0);
    } catch {
      setMeetingNotifyEffectiveOn(false);
    } finally {
      setMeetingNotifyLoaded(true);
    }
  }, [profilePk]);

  const loadDnd = useCallback(async () => {
    try {
      const [v, win] = await Promise.all([loadProfileDndQuietHoursEnabled(), loadProfileDndQuietHoursWindow()]);
      setDndOn(v);
      setDndStartMin(win.startMin);
      setDndEndMin(win.endMin);
    } catch {
      setDndOn(false);
      setDndStartMin(DND_QUIET_HOURS_DEFAULT_START_MIN);
      setDndEndMin(DND_QUIET_HOURS_DEFAULT_END_MIN);
    } finally {
      setDndLoaded(true);
    }
  }, []);

  const loadNotificationSound = useCallback(async () => {
    if (Platform.OS === 'web') {
      setSoundLoaded(true);
      return;
    }
    try {
      const id = await loadProfileNotificationSoundId();
      setSoundId(id);
    } catch {
      setSoundId('ginit_ring_w');
    } finally {
      setSoundLoaded(true);
    }
  }, []);

  const onPickNotificationSound = useCallback(async (id: ProfileNotificationSoundId) => {
    if (Platform.OS === 'web') return;
    try {
      await stopProfileNotificationSoundPreview();
      await saveProfileNotificationSoundId(id);
      setSoundId(id);
      await ensureGinitFcmNotifeeChannel();
      await ensureGinitInAppAndroidChannel();
      if (Platform.OS === 'ios' || Platform.OS === 'android') void Haptics.selectionAsync();
      setSoundPickOpen(false);
    } catch {
      /* noop */
    }
  }, []);

  const onPreviewNotificationSound = useCallback(async (id: ProfileNotificationSoundId) => {
    if (Platform.OS === 'web') return;
    if (id === 'default') return;
    try {
      await playProfileNotificationSoundPreview(id);
      void Haptics.selectionAsync();
    } catch {
      Alert.alert('알림음', '재생할 수 없어요.');
    }
  }, []);

  useEffect(() => {
    if (!soundPickOpen && Platform.OS !== 'web') {
      void stopProfileNotificationSoundPreview();
    }
  }, [soundPickOpen]);

  useFocusEffect(
    useCallback(() => {
      void refreshNotify();
      void loadDnd();
      void loadNotificationSound();
      void refreshMeetingNotify();
      let cancelled = false;
      let clearParamTimer: ReturnType<typeof setTimeout> | undefined;
      void (async () => {
        try {
          await refreshMeetingAuth();
        } catch {
          /* refreshMeetingAuth 내부에서 상태 처리 */
        }
        if (cancelled) return;
        if (isProfileRegisterInfoParamOn(registerInfoParam)) {
          setAuthSheetVisible(true);
          clearParamTimer = setTimeout(() => {
            router.setParams({ [PROFILE_REGISTER_INFO_QUERY]: undefined });
          }, 0);
        }
      })();
      return () => {
        cancelled = true;
        if (clearParamTimer) clearTimeout(clearParamTimer);
      };
    }, [refreshNotify, loadDnd, loadNotificationSound, refreshMeetingNotify, refreshMeetingAuth, registerInfoParam, router]),
  );

  const onToggleNotify = useCallback(
    async (next: boolean) => {
      if (Platform.OS === 'web') {
        Alert.alert('안내', '웹에서는 브라우저/OS 설정에서 알림을 관리해 주세요.');
        return;
      }
      if (next) {
        const { status } = await Notifications.requestPermissionsAsync({
          ios: {
            allowAlert: true,
            allowBadge: true,
            allowSound: true,
            allowDisplayInCarPlay: true,
          },
        });
        setNotifyGranted(status === 'granted');
        if (status !== 'granted') {
          Alert.alert('알림', '알림을 켜려면 기기 설정에서 권한을 허용해 주세요.', [
            { text: '닫기', style: 'cancel' },
            { text: '설정 열기', onPress: () => void Linking.openSettings() },
          ]);
        }
      } else {
        Alert.alert('알림 끄기', '푸시·배너 알림을 끄려면 기기 설정에서 지닛 알림을 꺼 주세요.', [
          { text: '닫기', style: 'cancel' },
          { text: '설정 열기', onPress: () => void Linking.openSettings() },
        ]);
        void refreshNotify();
      }
    },
    [refreshNotify],
  );

  const onToggleDnd = useCallback(async (next: boolean) => {
    setDndOn(next);
    try {
      await saveProfileDndQuietHoursEnabled(next);
      if (next) {
        const win = await loadProfileDndQuietHoursWindow();
        await saveProfileDndQuietHoursWindow(win);
        setDndStartMin(win.startMin);
        setDndEndMin(win.endMin);
      }
    } catch {
      setDndOn((v) => !v);
    }
  }, []);

  const confirmDndIosPick = useCallback(() => {
    const cur = dndPick;
    if (!cur) return;
    const m = minutesOfDayFromDate(cur.draft);
    const { start, end } = dndWindowRef.current;
    const startMin = cur.kind === 'start' ? m : start;
    const endMin = cur.kind === 'end' ? m : end;
    setDndPick(null);
    void (async () => {
      try {
        await saveProfileDndQuietHoursWindow({ startMin, endMin });
        setDndStartMin(startMin);
        setDndEndMin(endMin);
      } catch {
        /* ignore */
      }
    })();
  }, [dndPick]);

  const openMeetingNotifySettings = useCallback(() => {
    router.push('/profile/meeting-notify-settings');
  }, [router]);

  const onSignOut = useCallback(async () => {
    setBusy(true);
    try {
      await signOutSession();
      router.replace('/login');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '알 수 없는 오류';
      Alert.alert('로그아웃 실패', msg);
    } finally {
      setBusy(false);
    }
  }, [router, signOutSession]);

  const runDeleteAccount = useCallback(async () => {
    const sessionUserId = userId?.trim() ?? '';
    const firebaseUid = authProfile?.firebaseUid?.trim() ?? '';
    if (!sessionUserId && !firebaseUid) {
      Alert.alert('안내', '로그인된 계정만 탈퇴할 수 있어요.');
      return;
    }
    setDeleteBusy(true);
    try {
      const res = sessionUserId
        ? await purgeUserAccountRemote(sessionUserId)
        : await purgeUserAccountRemoteByFirebaseUid(firebaseUid);
      if (!res.ok) {
        Alert.alert('탈퇴를 완료하지 못했어요', res.message);
        return;
      }
      const authDel = await deleteFirebaseAuthUserStrict();
      if (!authDel.ok) {
        Alert.alert('탈퇴를 완료하지 못했어요', authDel.message);
        return;
      }
      await signOutSession();
      await wipeLocalAppData();
      const doneMsg = '탈퇴가 완료되었습니다. 그동안 지닛과 함께해주셔서 감사합니다.';
      if (Platform.OS === 'android') {
        ToastAndroid.show(doneMsg, ToastAndroid.LONG);
        router.replace('/login');
      } else {
        Alert.alert('탈퇴 완료', doneMsg, [{ text: '확인', onPress: () => router.replace('/login') }]);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '알 수 없는 오류';
      Alert.alert('탈퇴 실패', msg);
    } finally {
      setDeleteBusy(false);
    }
  }, [userId, authProfile?.firebaseUid, router, signOutSession]);

  const onRequestDeleteAccount = useCallback(() => {
    const sessionUserId = userId?.trim() ?? '';
    const firebaseUid = authProfile?.firebaseUid?.trim() ?? '';
    if (!sessionUserId && !firebaseUid) {
      Alert.alert('안내', '로그인된 계정만 탈퇴할 수 있어요.');
      return;
    }
    Alert.alert(
      '회원 탈퇴',
      '탈퇴 시 이름·연락처·이메일·프로필 사진 등 개인 식별 정보는 서버에서 즉시 삭제(비식별화)됩니다.\n\n' +
        '• 채팅·투표·모임 참여 기록은 서비스 운영을 위해 익명 상태로 보관될 수 있습니다.\n' +
        '• 내가 만든 모임에 나 혼자만 있다면 해당 모임은 자동으로 삭제됩니다.\n' +
        '• 내가 만든 모임에 참여자가 2명 이상 있다면, 방장 권한이 다음 참여자에게 자동으로 이관되고 저는 모임에서 탈퇴합니다.\n' +
        '• 팔로워/팔로잉/맞팔(요청 포함) 관계는 모두 삭제됩니다.\n' +
        '• 이 기기에 저장된 로그인·캐시 등은 모두 지워집니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '다음',
          style: 'destructive',
          onPress: () => {
            Alert.alert('최종 확인', '정말 지닛에서 탈퇴할까요?', [
              { text: '아니오', style: 'cancel' },
              { text: '탈퇴하기', style: 'destructive', onPress: () => void runDeleteAccount() },
            ]);
          },
        },
      ],
    );
  }, [userId, authProfile?.firebaseUid, runDeleteAccount]);

  const versionLine = useMemo(() => {
    const app = Constants.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '—';
    const build =
      Constants.nativeBuildVersion ??
      (typeof Constants.expoConfig?.runtimeVersion === 'string' ? Constants.expoConfig.runtimeVersion : null);
    return build ? `${app} (${build})` : String(app);
  }, []);

  return (
    <ScreenShell padded={false} style={styles.rootShell}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.topBar}>
          <Pressable
            onPress={() => safeRouterBack(router)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="뒤로"
            style={styles.backBtn}>
            <GinitSymbolicIcon name="chevron-back" size={22} color="#0f172a" />
          </Pressable>
          <Text style={styles.topTitle} numberOfLines={1}>
            설정
          </Text>
          <View style={styles.topBarSpacer} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.block}>
            {sectionTitle('알림')}
            <View style={styles.row}>
              <SettingsRowLeadIcon name="notifications-outline" />
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>시스템 알림 설정</Text>
                <Text style={styles.rowSub}>
                  {Platform.OS === 'web'
                    ? '웹에서는 브라우저 설정을 이용해 주세요.'
                    : '모임·채팅 등 푸시·배너 알림을 받을지 기기 권한과 함께 맞춰요.'}
                </Text>
              </View>
              {notifyLoaded && Platform.OS !== 'web' ? (
                <Switch
                  value={notifyGranted}
                  onValueChange={(v) => void onToggleNotify(v)}
                  trackColor={meetingCreateSwitchTrack}
                  thumbColor={notifyGranted ? '#FFFFFF' : '#f1f5f9'}
                  ios_backgroundColor="#cbd5e1"
                  accessibilityLabel="시스템 알림 설정"
                />
              ) : Platform.OS === 'web' ? null : (
                <ActivityIndicator color={GinitTheme.colors.primary} />
              )}
            </View>
            <RowSep />
            {Platform.OS !== 'web' ? (
              <>
                <Pressable
                  onPress={() => {
                    if (soundLoaded) setSoundPickOpen(true);
                  }}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  accessibilityRole="button"
                  accessibilityLabel="알림음">
                  <SettingsRowLeadIcon name="musical-notes-outline" />
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel}>알림음</Text>
                    <Text style={styles.rowSub}>
                      {soundLoaded ? labelForProfileNotificationSoundId(soundId) : '불러오는 중…'}
                    </Text>
                  </View>
                  <GinitSymbolicIcon name="chevron-forward" size={18} color={GinitTheme.colors.textMuted} />
                </Pressable>
                <RowSep />
              </>
            ) : null}
            <View style={styles.row}>
              <SettingsRowLeadIcon name="moon-outline" />
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>방해금지 시간</Text>
                <Text style={styles.rowSub}>켜 두면 야간 등 방해 받지 않을 시간대에 맞춰 조용히 해요.</Text>
              </View>
              {dndLoaded ? (
                <Switch
                  value={dndOn}
                  onValueChange={(v) => {
                    if (Platform.OS !== 'web') void Haptics.selectionAsync();
                    void onToggleDnd(v);
                  }}
                  trackColor={meetingCreateSwitchTrack}
                  thumbColor={dndOn ? '#FFFFFF' : '#f1f5f9'}
                  ios_backgroundColor="#cbd5e1"
                  accessibilityLabel="방해금지 시간"
                />
              ) : (
                <ActivityIndicator color={GinitTheme.colors.primary} />
              )}
            </View>
            {dndOn && dndLoaded && Platform.OS !== 'web' ? (
              <>
                
                <Pressable
                  onPress={() =>
                    setDndPick({ kind: 'start', draft: dateFromMinutesOfDay(dndStartMin) })
                  }
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  accessibilityRole="button"
                  accessibilityLabel="방해금지 시작 시각">
                  
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel}>시작 시각</Text>
                  </View>
                  <Text style={styles.dndTimeValue}>{formatDndTimeLabel(dndStartMin)}</Text>
                </Pressable>
                
                <Pressable
                  onPress={() => setDndPick({ kind: 'end', draft: dateFromMinutesOfDay(dndEndMin) })}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  accessibilityRole="button"
                  accessibilityLabel="방해금지 종료 시각">
                  
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel}>종료 시각</Text>
                  </View>
                  <Text style={styles.dndTimeValue}>{formatDndTimeLabel(dndEndMin)}</Text>
                </Pressable>
                
              </>
            ) : null}
            {isSignedIn && Platform.OS !== 'web' ? (
              <>
                <RowSep />
                <Pressable
                  onPress={openMeetingNotifySettings}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  accessibilityRole="button"
                  accessibilityLabel="모임 생성 알림 설정">
                  <SettingsRowLeadIcon name="map-outline" />
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel}>공개 모임 생성 알림</Text>
                    <Text style={styles.rowSub}>관심 지역·카테고리별로 새 공개 모임만 알려요.</Text>
                  </View>
                  <Pressable
                    onPress={openMeetingNotifySettings}
                    hitSlop={10}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants">
                    {meetingNotifyLoaded ? (
                      <Switch
                        value={meetingNotifyEffectiveOn}
                        disabled
                        trackColor={meetingCreateSwitchTrack}
                        thumbColor={meetingNotifyEffectiveOn ? '#FFFFFF' : '#f1f5f9'}
                        ios_backgroundColor="#cbd5e1"
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                      />
                    ) : (
                      <ActivityIndicator color={GinitTheme.colors.primary} />
                    )}
                  </Pressable>
                </Pressable>
              </>
            ) : null}
          </View>
          

          <View style={[styles.block, styles.blockGap]}>
            {sectionTitle('기타')}
            <Pressable
              onPress={() => router.push('/profile/meeting-history')}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              accessibilityRole="button"
              accessibilityLabel="모임 히스토리">
              <SettingsRowLeadIcon name="history-outline" />
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>모임 히스토리</Text>
              </View>
              <GinitSymbolicIcon name="chevron-forward" size={18} color={GinitTheme.colors.textMuted} />
            </Pressable>
            <RowSep />
            
            <View style={styles.row}>
              <SettingsRowLeadIcon name="information-outline" />
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>버전 정보</Text>
                <Text style={styles.rowSub}>{versionLine}</Text>
              </View>
            </View>
            <RowSep />

            {isSignedIn ? (
              <>
                <Pressable
                  onPress={() => setAuthSheetVisible(true)}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  accessibilityRole="button"
                  accessibilityLabel="인증 정보 등록">
                  <SettingsRowLeadIcon name="shield-checkmark-outline" />
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel}>인증 정보 등록</Text>
                    {meetingAuthLoaded ? (
                      <Text
                        style={[styles.rowSub, meetingAuthComplete ? styles.rowSubOk : styles.rowSubWarn]}
                        numberOfLines={1}>
                        {meetingAuthComplete ? '인증 완료' : '미완료 · 눌러서 진행'}
                      </Text>
                    ) : (
                      <Text style={styles.rowSub}>불러오는 중…</Text>
                    )}
                  </View>
                  <GinitSymbolicIcon name="chevron-forward" size={18} color={GinitTheme.colors.textMuted} />
                </Pressable>
              </>
            ) : null}
            {isSignedIn ? (
              <>
                <RowSep />
                <Pressable
                  onPress={() => void onSignOut()}
                  disabled={busy || deleteBusy}
                  style={({ pressed }) => [
                    styles.row,
                    (busy || deleteBusy) && styles.rowDisabled,
                    pressed && !(busy || deleteBusy) && styles.rowPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="로그아웃">
                  <SettingsRowLeadIcon name="log-out-outline" />
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel}>로그아웃</Text>
                    <Text style={styles.rowSub}>이 기기에서 로그아웃해요.</Text>
                  </View>
                  <GinitSymbolicIcon name="chevron-forward" size={18} color={GinitTheme.colors.textMuted} />
                </Pressable>
                <RowSep />
                <Pressable
                  onPress={onRequestDeleteAccount}
                  disabled={deleteBusy || busy}
                  style={({ pressed }) => [
                    styles.row,
                    (deleteBusy || busy) && styles.rowDisabled,
                    pressed && !(deleteBusy || busy) && styles.rowPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="탈퇴하기">
                  <SettingsRowLeadIcon name="trash-outline" destructive />
                  <View style={styles.rowText}>
                    <Text style={[styles.rowLabel, styles.rowLabelDanger]}>
                      {deleteBusy ? '탈퇴 처리 중…' : '탈퇴하기'}
                    </Text>
                    <Text style={[styles.rowSub, styles.rowSubDanger]}>계정과 개인 식별 정보가 삭제돼요.</Text>
                  </View>
                  <GinitSymbolicIcon name="chevron-forward" size={18} color={GinitTheme.colors.danger} />
                </Pressable>
              </>
            ) : null}
          </View>
        </ScrollView>

        {dndPick && Platform.OS === 'android' ? (
          <DateTimePicker
            value={dndPick.draft}
            mode="time"
            display="spinner"
            {...({ accentColor: GinitTheme.colors.primary } as object)}
            onChange={(event, d) => {
              const t = (event as unknown as { type?: string } | null)?.type ?? '';
              if (t === 'dismissed') {
                setDndPick(null);
                return;
              }
              if (t === 'set' && d && dndPick) {
                const m = minutesOfDayFromDate(d);
                const kind = dndPick.kind;
                setDndPick(null);
                const { start, end } = dndWindowRef.current;
                const startMin = kind === 'start' ? m : start;
                const endMin = kind === 'end' ? m : end;
                void (async () => {
                  try {
                    await saveProfileDndQuietHoursWindow({ startMin, endMin });
                    setDndStartMin(startMin);
                    setDndEndMin(endMin);
                  } catch {
                    /* ignore */
                  }
                })();
                return;
              }
              if (!d) setDndPick(null);
            }}
          />
        ) : null}

        {soundPickOpen && Platform.OS !== 'web' ? (
          <Modal visible transparent animationType="fade" onRequestClose={() => setSoundPickOpen(false)}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
              style={styles.soundSheetKbWrap}>
              <View style={styles.soundSheetRoot}>
                <Pressable
                  style={styles.soundSheetBackdropFill}
                  onPress={() => setSoundPickOpen(false)}
                  accessibilityRole="button"
                  accessibilityLabel="닫기"
                />
                <View style={styles.soundSheetCenterWrap} pointerEvents="box-none">
                  <View
                    style={[
                      styles.soundSheetPanel,
                      {
                        maxHeight: soundSheetLayout.panelMax,
                        paddingBottom: soundSheetLayout.panelPadBottom,
                      },
                    ]}>
                    <Text style={styles.soundSheetTitle}>알림음</Text>
                    <Text style={styles.soundSheetLead}>푸시·로컬 알림에 사용할 소리를 골라요.</Text>
                    <FlashList
                      data={[...PROFILE_NOTIFICATION_SOUND_OPTIONS]}
                      keyExtractor={(item) => item.id}
                      style={{ maxHeight: soundSheetLayout.scrollMax }}
                      scrollEnabled={PROFILE_NOTIFICATION_SOUND_OPTIONS.length > 6}
                      showsVerticalScrollIndicator={false}
                      ItemSeparatorComponent={() => <View style={styles.soundListSep} />}
                      renderItem={({ item }) => {
                        const selected = soundId === item.id;
                        return (
                          <View style={styles.soundPickRow}>
                            <Pressable
                              onPress={() => void onPickNotificationSound(item.id)}
                              style={({ pressed }) => [styles.soundPickRowMain, pressed && styles.soundSheetPressed]}
                              accessibilityRole="button"
                              accessibilityState={{ selected }}
                              accessibilityLabel={item.label}>
                              <Text style={styles.soundPickLabel}>{item.label}</Text>
                            </Pressable>
                            {item.id === 'default' ? (
                              <View style={styles.soundPickPreviewPlaceholder} pointerEvents="none" />
                            ) : (
                              <Pressable
                                onPress={() => void onPreviewNotificationSound(item.id)}
                                style={({ pressed }) => [styles.soundPickPreviewBtn, pressed && { opacity: 0.86 }]}
                                hitSlop={8}
                                accessibilityRole="button"
                                accessibilityLabel={`${item.label} 미리듣기`}>
                                <GinitSymbolicIcon name="volume-high-outline" size={20} color="#0f172a" />
                              </Pressable>
                            )}
                            {selected ? (
                              <Text style={styles.soundPickCheck}>✓</Text>
                            ) : (
                              <View style={styles.soundPickSpacer} />
                            )}
                          </View>
                        );
                      }}
                    />
                  </View>
                </View>
              </View>
            </KeyboardAvoidingView>
          </Modal>
        ) : null}

        {dndPick && Platform.OS === 'ios' ? (
          <Modal visible transparent animationType="fade" onRequestClose={() => setDndPick(null)}>
            <View style={GinitStyles.modalRoot}>
              <Pressable
                style={GinitStyles.modalBackdrop}
                onPress={() => setDndPick(null)}
                accessibilityRole="button"
              />
              <View
                pointerEvents="box-none"
                style={{
                  position: 'absolute',
                  top: Math.max(insets.top, 8),
                  left: 0,
                  right: 0,
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  paddingHorizontal: 16,
                }}>
                <Pressable onPress={() => setDndPick(null)} hitSlop={10} accessibilityRole="button">
                  <Text style={GinitStyles.modalCancel}>취소</Text>
                </Pressable>
                <Pressable onPress={confirmDndIosPick} hitSlop={10} accessibilityRole="button">
                  <Text style={GinitStyles.modalDone}>완료</Text>
                </Pressable>
              </View>
              <View
                pointerEvents="box-none"
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  paddingBottom: Math.max(insets.bottom, 12),
                  alignItems: 'center',
                  backgroundColor: 'transparent',
                }}>
                <DateTimePicker
                  value={dndPick.draft}
                  mode="time"
                  display="spinner"
                  themeVariant="light"
                  locale="ko-KR"
                  onChange={(_ev, date) => {
                    if (!date) return;
                    setDndPick((prev) => (prev ? { ...prev, draft: date } : prev));
                  }}
                />
              </View>
            </View>
          </Modal>
        ) : null}
      </SafeAreaView>
      <MeetingServiceAuthModal
        visible={authSheetVisible}
        onRequestClose={() => setAuthSheetVisible(false)}
        profilePk={profilePk}
        onAfterComplianceSuccess={() => void refreshMeetingAuth()}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  rootShell: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  safe: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 48,
  },
  backBtn: { padding: 4 },
  topTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: '#0f172a' },
  topBarSpacer: { width: 30 },
  scroll: { paddingTop: 8, paddingBottom: 32 },
  block: { backgroundColor: 'transparent' },
  blockGap: { marginTop: 20 },
  sectionHead: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    paddingTop: 4,
  },
  sectionHeadText: {
    fontSize: 13,
    fontWeight: '700',
    color: GinitTheme.colors.textMuted,
    letterSpacing: -0.1,
  },
  rowIconSlot: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(15, 23, 42, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconSlotDanger: { backgroundColor: 'rgba(220, 38, 38, 0.08)' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 12,
  },
  rowPressed: { opacity: 0.82 },
  rowDisabled: { opacity: 0.55 },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 16, fontWeight: '400', color: GinitTheme.colors.text, letterSpacing: -0.2 },
  rowLabelDanger: { color: '#b91c1c' },
  rowSub: { marginTop: 4, fontSize: 12, fontWeight: '400', color: GinitTheme.colors.textMuted, lineHeight: 16 },
  rowSubOk: { color: '#0f766e' },
  rowSubWarn: { color: '#b91c1c' },
  rowSubDanger: { color: '#991b1b' },
  dndTimeValue: { fontSize: 16, fontWeight: '400', color: GinitTheme.colors.textSubGray, letterSpacing: -0.2 },
  sep: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 20,
    backgroundColor: GinitTheme.colors.border,
  },
  /** `MeetingServiceAuthModal`과 동일한 시트 스타일 */
  soundSheetKbWrap: {
    flex: 1,
  },
  soundSheetRoot: {
    flex: 1,
  },
  soundSheetBackdropFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  soundSheetCenterWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  soundSheetPanel: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.65)',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
  },
  soundSheetTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#0f172a',
    marginBottom: 6,
  },
  soundSheetLead: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
    lineHeight: 20,
    marginBottom: 14,
  },
  soundSheetPressed: {
    opacity: 0.85,
  },
  soundListSep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(15, 23, 42, 0.08)',
  },
  soundPickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  soundPickRowMain: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  soundPickPreviewBtn: {
    paddingVertical: 4,
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  /** 시스템 기본 행 — 미리듣기 버튼 자리만 유지(체크 정렬) */
  soundPickPreviewPlaceholder: {
    width: 28,
    height: 28,
  },
  soundPickLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
    lineHeight: 20,
  },
  soundPickCheck: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0052CC',
    width: 22,
    textAlign: 'center',
  },
  soundPickSpacer: { width: 22, height: 22 },
});
