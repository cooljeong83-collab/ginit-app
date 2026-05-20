import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { UserReportReasonChips } from '@/components/user-report/UserReportReasonChips';
import { GinitPressable } from '@/components/ui/GinitPressable';
import { KeyboardAwareScreenScroll } from '@/components/ui';
import { showTransientBottomMessage } from '@/components/ui/TransientBottomMessage';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import {
  prepareUserReportReporterId,
  submitUserReport,
  USER_REPORT_LOGIN_REQUIRED_MESSAGE,
} from '@/src/features/user-report/user-report-api';
import { uploadUserReportEvidenceImage } from '@/src/features/user-report/user-report-evidence-storage';
import type { UserReportReasonCode } from '@/src/features/user-report/user-report-reasons';
import {
  USER_REPORT_MAX_DESCRIPTION_LENGTH,
  USER_REPORT_MAX_IMAGES,
} from '@/src/features/user-report/user-report-reasons';
import { launchImageLibraryAsyncSafe } from '@/src/lib/expo-image-picker-safe-launch';
import { presentAppDialogAlert } from '@/src/lib/app-dialog-present';
import { normalizeParticipantId } from '@/src/lib/app-user-id';

type LocalAttachment = {
  id: string;
  uri: string;
  width?: number;
};

export type UserReportFormProps = {
  reportedUserId: string;
  reportedDisplayName?: string;
  onSubmitted?: () => void;
};

export function UserReportForm({
  reportedUserId,
  reportedDisplayName,
  onSubmitted,
}: UserReportFormProps) {
  const insets = useSafeAreaInsets();
  const { userId, isHydrated } = useUserSession();
  const [reasonCode, setReasonCode] = useState<UserReportReasonCode | null>(null);
  const [description, setDescription] = useState('');
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [busy, setBusy] = useState(false);

  const targetLabel = useMemo(() => {
    const n = reportedDisplayName?.trim();
    return n || reportedUserId.trim();
  }, [reportedDisplayName, reportedUserId]);

  const footerInset = 56 + Math.max(insets.bottom, 12);

  const onPickImages = useCallback(async () => {
    if (busy) return;
    if (Platform.OS === 'web') {
      presentAppDialogAlert({ title: '첨부', body: '웹에서는 이미지 첨부를 지원하지 않아요.' });
      return;
    }
    const remaining = USER_REPORT_MAX_IMAGES - attachments.length;
    if (remaining <= 0) {
      showTransientBottomMessage(`첨부는 최대 ${USER_REPORT_MAX_IMAGES}장까지예요.`);
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      presentAppDialogAlert({ title: '권한 필요', body: '사진 라이브러리 접근 권한이 필요해요.' });
      return;
    }
    const result = await launchImageLibraryAsyncSafe({
      mediaTypes: ['images'],
      allowsMultipleSelection: remaining > 1,
      selectionLimit: remaining,
      quality: 1,
    });
    if (result.canceled || !result.assets?.length) return;
    const next: LocalAttachment[] = result.assets.slice(0, remaining).map((a) => ({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      uri: a.uri,
      width: a.width,
    }));
    setAttachments((prev) => [...prev, ...next].slice(0, USER_REPORT_MAX_IMAGES));
  }, [attachments.length, busy]);

  const onRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const onSubmit = useCallback(async () => {
    if (busy) return;
    if (!reasonCode) {
      presentAppDialogAlert({ title: '신고', body: '신고 사유를 선택해 주세요.' });
      return;
    }
    if (!isHydrated) {
      presentAppDialogAlert({ title: '신고', body: '잠시 후 다시 시도해 주세요.' });
      return;
    }

    const reported = normalizeParticipantId(reportedUserId.trim());
    if (!reported) {
      presentAppDialogAlert({ title: '신고', body: '신고 대상을 찾을 수 없어요.' });
      return;
    }

    setBusy(true);
    let me: string;
    try {
      me = await prepareUserReportReporterId(userId);
    } catch (e) {
      setBusy(false);
      presentAppDialogAlert({
        title: '신고',
        body: e instanceof Error ? e.message : USER_REPORT_LOGIN_REQUIRED_MESSAGE,
      });
      return;
    }

    try {
      const imageUrls: string[] = [];
      for (const att of attachments) {
        const url = await uploadUserReportEvidenceImage({
          reporterUserId: me,
          localImageUri: att.uri,
          naturalWidth: att.width,
        });
        imageUrls.push(url);
      }
      await submitUserReport({
        reporterAppUserId: me,
        reportedAppUserId: reported,
        reasonCode,
        description: description.trim() || null,
        imageUrls,
      });
      showTransientBottomMessage('신고가 접수되었어요. 검토 후 조치됩니다.');
      onSubmitted?.();
    } catch (e) {
      presentAppDialogAlert({
        title: '신고 실패',
        body: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }, [attachments, busy, description, isHydrated, onSubmitted, reasonCode, reportedUserId, userId]);

  return (
    <View style={styles.root}>
      <KeyboardAwareScreenScroll
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: footerInset + 16 }]}
        extraScrollHeight={20}
        scrollProps={{ showsVerticalScrollIndicator: false, keyboardShouldPersistTaps: 'handled' }}>
        <Text style={styles.lead}>
          <Text style={styles.leadStrong}>{targetLabel}</Text>
          님을 신고합니다. 운영 정책에 따라 검토합니다.
        </Text>

        <Text style={styles.sectionLabel}>신고 사유</Text>
        <UserReportReasonChips selected={reasonCode} onSelect={setReasonCode} />

        <Text style={[styles.sectionLabel, styles.sectionGap]}>상세 설명 (선택)</Text>
        <TextInput
          style={styles.textArea}
          value={description}
          onChangeText={setDescription}
          placeholder="상황을 간단히 적어 주세요."
          placeholderTextColor={GinitTheme.colors.textMuted}
          multiline
          maxLength={USER_REPORT_MAX_DESCRIPTION_LENGTH}
          editable={!busy}
          textAlignVertical="top"
        />
        <Text style={styles.charCount}>
          {description.length}/{USER_REPORT_MAX_DESCRIPTION_LENGTH}
        </Text>

        <View style={styles.attachHeader}>
          <Text style={styles.sectionLabel}>첨부 사진 (선택)</Text>
          <Text style={styles.attachSub}>
            {attachments.length}/{USER_REPORT_MAX_IMAGES}
          </Text>
        </View>
        <GinitPressable
          onPress={() => void onPickImages()}
          disabled={busy || attachments.length >= USER_REPORT_MAX_IMAGES}
          style={({ pressed }) => [
            styles.addPhotoBtn,
            pressed && styles.addPhotoBtnPressed,
            (busy || attachments.length >= USER_REPORT_MAX_IMAGES) && styles.addPhotoBtnDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel="사진 추가">
          <GinitSymbolicIcon name="image-outline" size={22} color={GinitTheme.colors.primary} />
          <Text style={styles.addPhotoText}>사진 추가</Text>
        </GinitPressable>
        {attachments.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbRow}>
            {attachments.map((att) => (
              <View key={att.id} style={styles.thumbWrap}>
                <Image source={{ uri: att.uri }} style={styles.thumb} contentFit="cover" />
                <GinitPressable
                  onPress={() => onRemoveAttachment(att.id)}
                  disabled={busy}
                  style={styles.thumbRemove}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="첨부 삭제">
                  <GinitSymbolicIcon name="close-circle" size={22} color="#fff" />
                </GinitPressable>
              </View>
            ))}
          </ScrollView>
        ) : null}
      </KeyboardAwareScreenScroll>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <GinitPressable
          onPress={() => void onSubmit()}
          disabled={busy}
          style={({ pressed }) => [styles.submitBtn, pressed && !busy && { opacity: 0.92 }, busy && styles.submitBtnDisabled]}
          accessibilityRole="button"
          accessibilityLabel="신고하기">
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>신고하기</Text>
          )}
        </GinitPressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 8 },
  lead: { fontSize: 15, lineHeight: 22, color: GinitTheme.colors.textSub, marginBottom: 20 },
  leadStrong: { fontWeight: '700', color: '#0f172a' },
  sectionLabel: { fontSize: 14, fontWeight: '700', color: '#0f172a', marginBottom: 10 },
  sectionGap: { marginTop: 20 },
  textArea: {
    minHeight: 100,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.12)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#0f172a',
    backgroundColor: 'rgba(15, 23, 42, 0.03)',
  },
  charCount: {
    marginTop: 6,
    fontSize: 12,
    color: GinitTheme.colors.textMuted,
    textAlign: 'right',
  },
  attachHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
    marginBottom: 10,
  },
  attachSub: { fontSize: 13, color: GinitTheme.colors.textMuted },
  addPhotoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(69, 39, 160, 0.35)',
    backgroundColor: GinitTheme.colors.noticeSurface,
  },
  addPhotoBtnPressed: { opacity: 0.9 },
  addPhotoBtnDisabled: { opacity: 0.5 },
  addPhotoText: { fontSize: 15, fontWeight: '600', color: GinitTheme.colors.primary },
  thumbRow: { marginTop: 12 },
  thumbWrap: { marginRight: 10, position: 'relative' },
  thumb: { width: 88, height: 88, borderRadius: 10, backgroundColor: '#e2e8f0' },
  thumbRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    borderRadius: 11,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(15, 23, 42, 0.08)',
    backgroundColor: '#fff',
  },
  submitBtn: {
    backgroundColor: GinitTheme.colors.danger,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  submitBtnDisabled: { opacity: 0.65 },
  submitText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
