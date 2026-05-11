import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NaverPlaceWebViewModal } from '@/components/NaverPlaceWebViewModal';
import { MeetingArrivalVerifyMapBody } from '@/components/meeting/MeetingArrivalVerifyMapBody';
import { MeetingArrivalVerifyTopSummary } from '@/components/meeting/MeetingArrivalVerifyTopSummary';
import { SettlementAccountsScreenTopBar } from '@/components/settlement/SettlementAccountsScreenTopBar';
import { ScreenShell } from '@/components/ui';
import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitTheme } from '@/constants/ginit-theme';
import { useAppPolicies } from '@/src/context/AppPoliciesContext';
import { useUserSession } from '@/src/context/UserSessionContext';
import { meetingDetailQueryKey, useMeetingDetailQuery } from '@/src/hooks/use-meeting-detail-query';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { getMeetingArrivalVerifyPolicy } from '@/src/lib/meeting-arrival-verify';
import { resolveConfirmedPlaceCoordsForMeeting } from '@/src/lib/meeting-confirmed-place-coords';
import { hasLedgerArrivalVerified } from '@/src/lib/meeting-arrival-verify-reminders';
import {
  presentMeetingArrivalVerifyRpcOutcome,
  type MeetingArrivalVerifyRpcUiPayload,
} from '@/src/lib/meeting-arrival-verify-rpc-ui';
import { ledgerWritesToSupabase } from '@/src/lib/hybrid-data-source';
import { isConfirmedMeetingPastListEndWindow, type Meeting } from '@/src/lib/meetings';
import { isLedgerMeetingId } from '@/src/lib/meetings-ledger';
import { safeRouterBack } from '@/src/lib/router-safe';

function orderedParticipantIds(m: Meeting): string[] {
  const hostRaw = m.createdBy?.trim() ?? '';
  const host = hostRaw ? normalizeParticipantId(hostRaw) : '';
  const listRaw = m.participantIds ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  if (host) {
    seen.add(host);
    out.push(host);
  }
  for (const x of listRaw) {
    const id = normalizeParticipantId(String(x));
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function isMeetingHostLocal(sessionUserId: string | null, createdBy: string | null | undefined): boolean {
  const s = sessionUserId?.trim() ?? '';
  const c = createdBy?.trim() ?? '';
  if (!s || !c) return false;
  return normalizeParticipantId(s) === normalizeParticipantId(c);
}

export default function ArrivalVerifyMeetingScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { userId } = useUserSession();
  const { version: appPoliciesVersion } = useAppPolicies();
  const params = useLocalSearchParams<{ meetingId: string | string[] }>();
  const meetingId = Array.isArray(params.meetingId)
    ? (params.meetingId[0] ?? '').trim()
    : typeof params.meetingId === 'string'
      ? params.meetingId.trim()
      : '';

  const { meeting, loading, loadError, refetch } = useMeetingDetailQuery(meetingId, 0);
  const arrivalVerifyPol = useMemo(() => getMeetingArrivalVerifyPolicy(), [appPoliciesVersion]);
  const placeCoords = useMemo(() => resolveConfirmedPlaceCoordsForMeeting(meeting), [meeting]);

  const sessionPk = useMemo(() => (userId?.trim() ? normalizeParticipantId(userId.trim()) : ''), [userId]);
  const orderedList = useMemo(() => (meeting ? orderedParticipantIds(meeting) : []), [meeting]);
  const alreadyJoined = useMemo(() => Boolean(sessionPk && orderedList.includes(sessionPk)), [sessionPk, orderedList]);
  const isHost = useMemo(() => isMeetingHostLocal(userId, meeting?.createdBy), [userId, meeting?.createdBy]);

  const showArrivalFlow = useMemo(() => {
    if (Platform.OS === 'web') return false;
    if (!meeting || meeting.scheduleConfirmed !== true) return false;
    if (isConfirmedMeetingPastListEndWindow(meeting, Date.now())) return false;
    if (!ledgerWritesToSupabase() || !isLedgerMeetingId(meeting.id)) return false;
    if (!alreadyJoined && !isHost) return false;
    return true;
  }, [meeting, alreadyJoined, isHost]);

  const [alreadyVerified, setAlreadyVerified] = useState<boolean | null>(null);

  useEffect(() => {
    if (!meetingId.trim()) {
      safeRouterBack(router);
    }
  }, [meetingId, router]);

  useEffect(() => {
    if (!showArrivalFlow || !meeting?.id?.trim() || !userId?.trim()) {
      setAlreadyVerified(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const v = await hasLedgerArrivalVerified(meeting.id.trim(), userId.trim());
      if (!cancelled) setAlreadyVerified(v);
    })();
    return () => {
      cancelled = true;
    };
  }, [showArrivalFlow, meeting?.id, userId]);

  const onBack = useCallback(() => safeRouterBack(router), [router]);

  const refetchMeetingDetail = useCallback(() => {
    void refetch();
    void queryClient.invalidateQueries({ queryKey: meetingDetailQueryKey(meetingId) });
  }, [refetch, queryClient, meetingId]);

  const [naverPlaceWebModal, setNaverPlaceWebModal] = useState<{ url: string; title: string } | null>(null);

  const onRpcResult = useCallback(
    (payload: MeetingArrivalVerifyRpcUiPayload) => {
      presentMeetingArrivalVerifyRpcOutcome(payload, {
        meeting,
        userId: userId ?? '',
        refetchMeetingDetail,
        onAfterResolved: () => safeRouterBack(router),
      });
    },
    [meeting, userId, refetchMeetingDetail, router],
  );

  if (!meetingId.trim()) {
    return null;
  }

  if (loading && !meeting) {
    return (
      <ScreenShell padded={false} style={styles.rootShell}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <SettlementAccountsScreenTopBar title="장소 인증" onBack={onBack} />
          <View style={styles.centered}>
            <ActivityIndicator />
          </View>
        </SafeAreaView>
      </ScreenShell>
    );
  }

  if (loadError) {
    return (
      <ScreenShell padded={false} style={styles.rootShell}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <SettlementAccountsScreenTopBar title="장소 인증" onBack={onBack} />
          <View style={styles.centered}>
            <Text style={styles.muted}>모임 정보를 불러오지 못했어요.</Text>
            <GinitPressable onPress={() => void refetch()} style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.88 }]}>
              <Text style={styles.retryText}>다시 시도</Text>
            </GinitPressable>
          </View>
        </SafeAreaView>
      </ScreenShell>
    );
  }

  if (!showArrivalFlow) {
    return (
      <ScreenShell padded={false} style={styles.rootShell}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <SettlementAccountsScreenTopBar title="장소 인증" onBack={onBack} />
          <View style={styles.centered}>
            <Text style={styles.muted}>이 모임에서는 장소 인증을 이용할 수 없어요.</Text>
          </View>
        </SafeAreaView>
      </ScreenShell>
    );
  }

  if (alreadyVerified === true) {
    return (
      <ScreenShell padded={false} style={styles.rootShell}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <SettlementAccountsScreenTopBar title="장소 인증" onBack={onBack} />
          <View style={styles.centered}>
            <Text style={styles.muted}>이미 장소 인증을 완료했어요.</Text>
          </View>
        </SafeAreaView>
      </ScreenShell>
    );
  }

  if (!placeCoords) {
    return (
      <ScreenShell padded={false} style={styles.rootShell}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <SettlementAccountsScreenTopBar title="장소 인증" onBack={onBack} />
          <View style={styles.centered}>
            <Text style={styles.muted}>확정 장소 좌표가 없어 지도를 열 수 없어요.</Text>
          </View>
        </SafeAreaView>
      </ScreenShell>
    );
  }

  if (alreadyVerified === null) {
    return (
      <ScreenShell padded={false} style={styles.rootShell}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <SettlementAccountsScreenTopBar title="장소 인증" onBack={onBack} />
          <View style={styles.centered}>
            <ActivityIndicator />
          </View>
        </SafeAreaView>
      </ScreenShell>
    );
  }

  const pinMeeting = meeting!;

  return (
    <ScreenShell padded={false} style={styles.rootShell}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <SettlementAccountsScreenTopBar title="장소 인증" onBack={onBack} />
        <View style={styles.verifyMain}>
          <MeetingArrivalVerifyTopSummary
            meeting={pinMeeting}
            onOpenPlaceUrl={(url, title) => setNaverPlaceWebModal({ url, title })}
          />
          <MeetingArrivalVerifyMapBody
            active
            placeCoords={placeCoords}
            authRadiusM={arrivalVerifyPol.auth_radius_m}
            minAccuracyM={arrivalVerifyPol.min_accuracy_m}
            meetingId={pinMeeting.id}
            appUserId={userId!.trim()}
            pinMeeting={{
              id: pinMeeting.id,
              categoryId: pinMeeting.categoryId ?? null,
              categoryLabel: pinMeeting.categoryLabel ?? null,
              title: pinMeeting.title ?? '',
            }}
            mapViewRadiusM={70}
            onRpcResult={onRpcResult}
          />
        </View>
        <NaverPlaceWebViewModal
          visible={naverPlaceWebModal != null}
          url={naverPlaceWebModal?.url}
          pageTitle={naverPlaceWebModal?.title ?? '상세 정보'}
          onClose={() => setNaverPlaceWebModal(null)}
        />
      </SafeAreaView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  rootShell: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  safe: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  verifyMain: { flex: 1, minHeight: 0 },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 16,
  },
  muted: { fontSize: 15, fontWeight: '600', color: GinitTheme.colors.textSub, textAlign: 'center' },
  retryBtn: { paddingVertical: 10, paddingHorizontal: 16 },
  retryText: { fontSize: 15, fontWeight: '700', color: GinitTheme.colors.primary },
});
