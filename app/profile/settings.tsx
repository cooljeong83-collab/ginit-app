
import { useFocusEffect } from '@react-navigation/native';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  ToastAndroid,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MeetingServiceAuthModal } from '@/components/profile/MeetingServiceAuthModal';
import { ScreenShell } from '@/components/ui';
import { GinitSymbolicIcon, type SymbolicIconName } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import {
  deleteFirebaseAuthUserStrict,
  purgeUserAccountRemote,
  purgeUserAccountRemoteByFirebaseUid,
  wipeLocalAppData,
} from '@/src/lib/account-deletion';
import { normalizeUserId } from '@/src/lib/app-user-id';
import { isProfileRegisterInfoParamOn, PROFILE_REGISTER_INFO_QUERY } from '@/src/lib/profile-register-info';
import {
  loadProfileDndQuietHoursEnabled,
  saveProfileDndQuietHoursEnabled,
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

export default function ProfileAppSettingsScreen() {
  const router = useRouter();
  const { registerInfo: registerInfoParam } = useLocalSearchParams<{ registerInfo?: string | string[] }>();
  const { userId, authProfile, signOutSession } = useUserSession();

  const [busy, setBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [notifyGranted, setNotifyGranted] = useState(false);
  const [notifyLoaded, setNotifyLoaded] = useState(false);
  const [dndOn, setDndOn] = useState(false);
  const [dndLoaded, setDndLoaded] = useState(false);

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

  const loadDnd = useCallback(async () => {
    try {
      const v = await loadProfileDndQuietHoursEnabled();
      setDndOn(v);
    } catch {
      setDndOn(false);
    } finally {
      setDndLoaded(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshNotify();
      void loadDnd();
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
    }, [refreshNotify, loadDnd, refreshMeetingAuth, registerInfoParam, router]),
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

  const onToggleDnd = useCallback(
    async (next: boolean) => {
      setDndOn(next);
      try {
        await saveProfileDndQuietHoursEnabled(next);
      } catch {
        setDndOn((v) => !v);
      }
    },
    [],
  );

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
                <Text style={styles.rowLabel}>알림 설정</Text>
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
                  accessibilityLabel="알림 설정"
                />
              ) : Platform.OS === 'web' ? null : (
                <ActivityIndicator color={GinitTheme.colors.primary} />
              )}
            </View>
            <RowSep />
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
  rowLabel: { fontSize: 16, fontWeight: '600', color: GinitTheme.colors.text, letterSpacing: -0.2 },
  rowLabelDanger: { color: '#b91c1c' },
  rowSub: { marginTop: 4, fontSize: 12, fontWeight: '600', color: GinitTheme.colors.textMuted, lineHeight: 16 },
  rowSubOk: { color: '#0f766e' },
  rowSubWarn: { color: '#b91c1c' },
  rowSubDanger: { color: '#991b1b' },
  sep: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 20,
    backgroundColor: GinitTheme.colors.border,
  },
});
