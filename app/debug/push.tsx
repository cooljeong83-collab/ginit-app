import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import notifee from '@notifee/react-native';

import { ScreenShell } from '@/components/ui';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { fcmDebugGetSnapshot } from '@/src/lib/fcm-debug-state';
import { sendFcmPushToUsersWithResult } from '@/src/lib/fcm-push-api';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import { getUserProfile } from '@/src/lib/user-profile';

type ChannelSnapshot = {
  id: string;
  name: string;
  importance?: number;
  sound?: string | null;
  vibrationPattern?: number[] | null;
};

export default function PushDebugScreen() {
  const { userId } = useUserSession();
  const uid = useMemo(() => (userId ?? '').trim(), [userId]);

  const [expoPerm, setExpoPerm] = useState<string>('unknown');
  const [expoChannels, setExpoChannels] = useState<ChannelSnapshot[]>([]);
  const [notifeeChannels, setNotifeeChannels] = useState<ChannelSnapshot[]>([]);
  const [profileFcmToken, setProfileFcmToken] = useState<string | null>(null);
  const [profileErr, setProfileErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastEdgeResult, setLastEdgeResult] = useState<string>('');

  const refresh = useCallback(async () => {
    if (Platform.OS === 'web') return;
    setProfileErr(null);
    try {
      const { status } = await Notifications.getPermissionsAsync();
      setExpoPerm(String(status ?? 'unknown'));
    } catch {
      setExpoPerm('error');
    }

    if (Platform.OS === 'android') {
      try {
        const raw = await Notifications.getNotificationChannelsAsync();
        const mapped: ChannelSnapshot[] = (raw ?? []).map((c) => ({
          id: String((c as any)?.id ?? ''),
          name: String((c as any)?.name ?? ''),
          importance: typeof (c as any)?.importance === 'number' ? (c as any).importance : undefined,
          sound: typeof (c as any)?.sound === 'string' ? (c as any).sound : null,
          vibrationPattern: Array.isArray((c as any)?.vibrationPattern) ? ((c as any).vibrationPattern as number[]) : null,
        }));
        setExpoChannels(mapped.filter((c) => c.id));
      } catch {
        setExpoChannels([]);
      }
      try {
        const getter = (notifee as any)?.getChannels as undefined | (() => Promise<any[]>);
        const raw = getter ? await getter() : [];
        const mapped: ChannelSnapshot[] = (raw ?? []).map((c) => ({
          id: String((c as any)?.id ?? ''),
          name: String((c as any)?.name ?? ''),
          importance: typeof (c as any)?.importance === 'number' ? (c as any).importance : undefined,
          sound: typeof (c as any)?.sound === 'string' ? (c as any).sound : null,
          vibrationPattern: Array.isArray((c as any)?.vibrationPattern) ? ((c as any).vibrationPattern as number[]) : null,
        }));
        setNotifeeChannels(mapped.filter((c) => c.id));
      } catch {
        setNotifeeChannels([]);
      }
    } else {
      setExpoChannels([]);
      setNotifeeChannels([]);
    }

    if (!uid) {
      setProfileFcmToken(null);
      return;
    }
    try {
      const p = await getUserProfile(uid);
      setProfileFcmToken(p?.fcmToken ?? null);
    } catch (e) {
      setProfileFcmToken(null);
      setProfileErr(e instanceof Error ? e.message : String(e));
    }
  }, [uid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const requestPermission = useCallback(async () => {
    if (Platform.OS === 'web') return;
    try {
      const { status } = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
          allowDisplayInCarPlay: true,
        },
      });
      ginitNotifyDbg('PushDebug', 'request_perm', { status });
    } catch (e) {
      ginitNotifyDbg('PushDebug', 'request_perm_failed', { message: e instanceof Error ? e.message : String(e) });
    } finally {
      await refresh();
    }
  }, [refresh]);

  const sendTestPush = useCallback(async () => {
    if (!uid) return;
    setBusy(true);
    setLastEdgeResult('');
    try {
      ginitNotifyDbg('PushDebug', 'test_push_start', { uidSuffix: uid.slice(-6) });
      const res = await sendFcmPushToUsersWithResult({
        toUserIds: [uid],
        title: '푸시 진단 테스트',
        body: `FCM 테스트 (${new Date().toLocaleString()})`,
        data: { action: 'push_debug', ts: Date.now() },
      });
      setLastEdgeResult(JSON.stringify(res));
      ginitNotifyDbg('PushDebug', 'test_push_ok', { ok: res.ok, successCount: res.successCount, sent: res.sent, reason: res.reason });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLastEdgeResult(msg);
      ginitNotifyDbg('PushDebug', 'test_push_failed', { message: msg });
    } finally {
      setBusy(false);
      await refresh();
    }
  }, [refresh, uid]);

  const fcmSnap = fcmDebugGetSnapshot();
  const tokenPreview = fcmSnap.lastToken ? `${fcmSnap.lastToken.slice(0, 12)}…(${fcmSnap.lastToken.length})` : '(없음)';
  const savedPreview = profileFcmToken ? `${profileFcmToken.slice(0, 12)}…(${profileFcmToken.length})` : '(없음)';

  const channelSummary = useMemo(() => {
    if (Platform.OS !== 'android') return '(Android 전용)';
    const all = [...expoChannels, ...notifeeChannels];
    if (all.length === 0) return '(채널 없음/조회 실패)';
    const pick = all
      .filter((c) => c.id === 'ginit_fcm' || c.id === 'default')
      .map((c) => `${c.id}(importance=${c.importance ?? 'n/a'})`)
      .join(', ');
    return pick || '(ginit_fcm/default 채널 미생성)';
  }, [expoChannels, notifeeChannels]);

  return (
    <ScreenShell padded>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>푸시 진단 (Android)</Text>
        <Text style={styles.desc}>
          이 화면은 “FCM 토큰 저장 → Edge 발송 → 권한/채널”을 한 번에 확인하기 위한 내부 진단 도구입니다.
        </Text>

        <View style={styles.block}>
          <Text style={styles.h}>현재 상태</Text>
          <Row label="platform" value={Platform.OS} />
          <Row label="userId" value={uid ? `${uid.slice(0, 4)}…${uid.slice(-4)}` : '(로그인 필요)'} />
          <Row label="expoPermission" value={expoPerm} />
          <Row label="channels" value={channelSummary} />
        </View>

        <View style={styles.block}>
          <Text style={styles.h}>FCM 토큰</Text>
          <Row label="lastToken(JS snapshot)" value={tokenPreview} />
          <Row label="lastSaveOk(JS snapshot)" value={String(fcmSnap.lastSaveOk ?? 'null')} />
          <Row label="profiles.fcm_token(Supabase)" value={savedPreview} />
          {profileErr ? <Text style={styles.err}>profile 읽기 실패: {profileErr}</Text> : null}
        </View>

        <View style={styles.block}>
          <Text style={styles.h}>테스트</Text>
          <ActionButton label="권한 요청/갱신" onPress={requestPermission} />
          <ActionButton label={busy ? '테스트 푸시 전송 중…' : '내 계정으로 테스트 푸시 전송'} onPress={sendTestPush} disabled={busy || !uid} />
          <ActionButton label="상태 새로고침" onPress={refresh} disabled={busy} />
          {lastEdgeResult ? (
            <View style={styles.edgeBox}>
              <Text style={styles.edgeTitle}>마지막 Edge 결과</Text>
              <Text style={styles.edgeText}>{lastEdgeResult}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.block}>
          <Text style={styles.h}>로그 필터</Text>
          <Text style={styles.mono}>[GinitNotify:</Text>
          <Text style={styles.desc}>
            릴리즈에서 로그가 안 보이면 빌드 환경에 `EXPO_PUBLIC_GINIT_NOTIFY_DEBUG=1`이 필요합니다.
          </Text>
        </View>
      </ScrollView>
    </ScreenShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void | Promise<void>;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.btn,
        disabled ? styles.btnDisabled : null,
        pressed && !disabled ? styles.btnPressed : null,
      ]}
    >
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: GinitTheme.spacing.lg,
    gap: GinitTheme.spacing.lg,
  },
  title: {
    color: GinitTheme.colors.text,
    fontSize: 20,
    fontWeight: '900',
  },
  desc: {
    color: GinitTheme.colors.textSub,
    fontSize: 13,
    lineHeight: 18,
  },
  mono: {
    color: GinitTheme.colors.text,
    fontSize: 13,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
  block: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    backgroundColor: GinitTheme.colors.surfaceStrong,
    borderRadius: 14,
    padding: GinitTheme.spacing.md,
    gap: 10,
  },
  h: {
    color: GinitTheme.colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  rowLabel: {
    width: 170,
    color: GinitTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  rowValue: {
    flex: 1,
    color: GinitTheme.colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  err: {
    color: GinitTheme.colors.danger,
    fontSize: 12,
    fontWeight: '700',
  },
  btn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.borderStrong,
    backgroundColor: GinitTheme.colors.bgAlt,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  btnPressed: {
    opacity: 0.82,
  },
  btnDisabled: {
    opacity: 0.55,
  },
  btnText: {
    color: GinitTheme.colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  edgeBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    backgroundColor: GinitTheme.colors.surfaceStrong,
    borderRadius: 12,
    padding: 10,
    gap: 6,
  },
  edgeTitle: {
    color: GinitTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  edgeText: {
    color: GinitTheme.colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
});

