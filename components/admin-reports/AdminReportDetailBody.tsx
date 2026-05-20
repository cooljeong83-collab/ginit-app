import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { AdminReportEvidenceImageViewer } from '@/components/admin-reports/AdminReportEvidenceImageViewer';
import { AdminReportParticipantCard } from '@/components/admin-reports/AdminReportParticipantCard';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { GinitPressable } from '@/components/ui/GinitPressable';
import { showTransientBottomMessage } from '@/components/ui/TransientBottomMessage';
import { GinitTheme } from '@/constants/ginit-theme';
import type { AdminUserReportRow } from '@/src/features/admin-reports/admin-user-reports-api';
import type { AdminReportApprovalAction } from '@/src/features/admin-reports/admin-user-reports-api';
import {
  formatAdminReportApprovalActionLabel,
  formatAdminReportReasonLabel,
  resolveAdminUserReport,
} from '@/src/features/admin-reports/admin-user-reports-api';
import {
  loadAdminReportParticipantSnapshots,
  type AdminReportParticipantSnapshot,
} from '@/src/features/admin-reports/admin-report-participant-profile';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { presentAppDialogAlert, presentAppDialogConfirm } from '@/src/lib/app-dialog-present';
import { useTransitionRouter } from '@/src/lib/screen-transition-navigation';

type AdminReportDetailBodyProps = {
  report: AdminUserReportRow;
  onResolved?: () => void;
};

function formatStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return '대기';
    case 'reviewing':
      return '검토 중';
    case 'approved':
      return '승인';
    case 'dismissed':
      return '기각';
    default:
      return status;
  }
}

const EMPTY_PARTICIPANT = (appUserId: string): AdminReportParticipantSnapshot => ({
  appUserId,
  nickname: appUserId,
  photoUrl: null,
  withdrawn: false,
});

export function AdminReportDetailBody({ report, onResolved }: AdminReportDetailBodyProps) {
  const router = useTransitionRouter();
  const [note, setNote] = useState(report.resolution_note ?? '');
  const [busy, setBusy] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [reportedParticipant, setReportedParticipant] = useState<AdminReportParticipantSnapshot>(() =>
    EMPTY_PARTICIPANT(report.reported_app_user_id),
  );
  const [reporterParticipant, setReporterParticipant] = useState<AdminReportParticipantSnapshot>(() =>
    EMPTY_PARTICIPANT(report.reporter_app_user_id),
  );
  const imageUrls = report.evidence?.image_urls ?? [];
  const terminal = report.status === 'approved' || report.status === 'dismissed';

  useEffect(() => {
    let cancelled = false;
    setProfilesLoading(true);
    void (async () => {
      const snaps = await loadAdminReportParticipantSnapshots(
        report.reported_app_user_id,
        report.reporter_app_user_id,
      );
      if (cancelled) return;
      setReportedParticipant(snaps.reported);
      setReporterParticipant(snaps.reporter);
      setProfilesLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [report.reported_app_user_id, report.reporter_app_user_id]);

  const openUserProfile = useCallback(
    (appUserId: string) => {
      const norm = normalizeParticipantId(appUserId.trim());
      if (!norm || norm === 'ginit_ai') return;
      router.push(`/profile/user/${encodeURIComponent(norm)}` as never);
    },
    [router],
  );

  const runResolve = useCallback(
    (
      status: 'reviewing' | 'approved' | 'dismissed',
      confirmTitle: string,
      confirmBody: string,
      approvalAction?: AdminReportApprovalAction,
    ) => {
      if (busy || terminal) return;
      presentAppDialogConfirm({
        title: confirmTitle,
        body: confirmBody,
        confirmLabel: '확인',
        confirmVariant: status === 'approved' ? 'destructive' : undefined,
        onConfirm: () => {
          setBusy(true);
          void (async () => {
            try {
              await resolveAdminUserReport({
                reportId: report.id,
                status,
                approvalAction: status === 'approved' ? approvalAction : null,
                resolutionNote: note.trim() || null,
              });
              showTransientBottomMessage('처리했어요.');
              onResolved?.();
            } catch (e) {
              presentAppDialogAlert({
                title: '처리 실패',
                body: e instanceof Error ? e.message : String(e),
              });
            } finally {
              setBusy(false);
            }
          })();
        },
      });
    },
    [busy, note, onResolved, report.id, terminal],
  );

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <Text style={styles.label}>상태</Text>
      <Text style={styles.value}>{formatStatusLabel(report.status)}</Text>

      {report.status === 'approved' ? (
        <>
          <Text style={styles.label}>승인 유형</Text>
          <Text style={styles.value}>
            {formatAdminReportApprovalActionLabel(report.approval_action) ?? '—'}
          </Text>
        </>
      ) : null}

      <AdminReportParticipantCard
        roleLabel="피신고자"
        participant={reportedParticipant}
        loading={profilesLoading}
        disabled={busy}
        onPressProfile={() => openUserProfile(reportedParticipant.appUserId)}
      />

      <AdminReportParticipantCard
        roleLabel="신고자"
        participant={reporterParticipant}
        loading={profilesLoading}
        disabled={busy}
        onPressProfile={() => openUserProfile(reporterParticipant.appUserId)}
      />

      <Text style={styles.label}>사유</Text>
      <Text style={styles.value}>{formatAdminReportReasonLabel(report.reason_code)}</Text>

      {report.description ? (
        <>
          <Text style={styles.label}>설명</Text>
          <Text style={styles.valueMultiline}>{report.description}</Text>
        </>
      ) : null}

      {imageUrls.length > 0 ? (
        <>
          <Text style={styles.label}>첨부</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbRow}>
            {imageUrls.map((uri, idx) => (
              <GinitPressable
                key={uri}
                onPress={() => setViewerIndex(idx)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`첨부 사진 ${idx + 1} 크게 보기`}>
                <Image source={{ uri }} style={styles.thumb} contentFit="cover" />
              </GinitPressable>
            ))}
          </ScrollView>
          <AdminReportEvidenceImageViewer
            visible={viewerIndex !== null}
            imageUrls={imageUrls}
            initialIndex={viewerIndex ?? 0}
            onClose={() => setViewerIndex(null)}
          />
        </>
      ) : null}

      <Text style={styles.label}>처리 메모</Text>
      <TextInput
        style={styles.noteInput}
        value={note}
        onChangeText={setNote}
        placeholder="내부 메모 (선택)"
        placeholderTextColor={GinitTheme.colors.textMuted}
        multiline
        editable={!busy && !terminal}
      />

      {!terminal ? (
        <View style={styles.actions}>
          <GinitPressable
            disabled={busy}
            onPress={() =>
              runResolve('reviewing', '검토 시작', '이 신고를 검토 중으로 표시할까요?')
            }
            style={({ pressed }) => [styles.actionBtn, styles.actionSecondary, pressed && { opacity: 0.9 }]}>
            <Text style={styles.actionSecondaryText}>검토 중</Text>
          </GinitPressable>
          <GinitPressable
            disabled={busy}
            onPress={() =>
              runResolve(
                'approved',
                '승인 (패널티)',
                '패널티만 적용합니다. 피신고자 gTrust가 감점되며 신고 내역·첨부는 보관됩니다. 계속할까요?',
                'penalty',
              )
            }
            style={({ pressed }) => [styles.actionBtn, styles.actionDanger, pressed && { opacity: 0.9 }]}>
            <Text style={styles.actionDangerText}>승인 (패널티)</Text>
          </GinitPressable>
          <GinitPressable
            disabled={busy}
            onPress={() =>
              runResolve(
                'approved',
                '승인 (이용 중지)',
                '패널티와 함께 계정 이용이 중지됩니다. 해당 계정은 로그인·앱 이용이 불가합니다. 신고 내역·첨부는 보관됩니다. 계속할까요?',
                'suspend',
              )
            }
            style={({ pressed }) => [styles.actionBtn, styles.actionDanger, pressed && { opacity: 0.9 }]}>
            <Text style={styles.actionDangerText}>승인 (이용 중지)</Text>
          </GinitPressable>
          <GinitPressable
            disabled={busy}
            onPress={() =>
              runResolve('dismissed', '기각', '기각 시 신고 내역·첨부 사진이 삭제됩니다. 계속할까요?')
            }
            style={({ pressed }) => [styles.actionBtn, styles.actionSecondary, pressed && { opacity: 0.9 }]}>
            <Text style={styles.actionSecondaryText}>기각</Text>
          </GinitPressable>
        </View>
      ) : null}

      {busy ? (
        <View style={styles.busyWrap}>
          <ActivityIndicator color={GinitTheme.colors.primary} />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 32 },
  label: { marginTop: 16, fontSize: 12, fontWeight: '700', color: GinitTheme.colors.textMuted },
  value: { marginTop: 6, fontSize: 15, fontWeight: '600', color: '#0f172a' },
  valueMultiline: { marginTop: 6, fontSize: 15, lineHeight: 22, color: '#0f172a' },
  thumbRow: { marginTop: 8 },
  thumb: { width: 96, height: 96, borderRadius: 10, marginRight: 8, backgroundColor: '#e2e8f0' },
  noteInput: {
    marginTop: 8,
    minHeight: 80,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.12)',
    padding: 12,
    fontSize: 15,
    color: '#0f172a',
  },
  actions: { marginTop: 24, gap: 10 },
  actionBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  actionSecondary: {
    backgroundColor: 'rgba(15, 23, 42, 0.06)',
  },
  actionSecondaryText: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  actionDanger: { backgroundColor: GinitTheme.colors.danger },
  actionDangerText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  busyWrap: { marginTop: 16, alignItems: 'center' },
});
