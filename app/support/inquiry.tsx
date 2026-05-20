import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  ToastAndroid,
  View,
} from 'react-native';

import { GinitButton, GinitCard } from '@/components/ginit';
import { SupportScreenChrome } from '@/components/support/SupportScreenChrome';
import { supportScreenStyles as styles } from '@/components/support/supportScreenStyles';
import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { GINIT_OFFICIAL_SUPPORT_EMAIL } from '@/src/features/support/support-constants';
import {
  isSupportInquiryFromAccountGate,
  supportInquiryPrefillFromAccountGate,
} from '@/src/features/support/support-inquiry-account-gate';
import {
  isSupportInquiryFromGoogleAuth,
  supportInquiryPrefillFromGoogleAuth,
} from '@/src/features/support/support-inquiry-google-auth';
import {
  openSupportInquiryMail,
  SUPPORT_INQUIRY_BODY_MAX,
  SUPPORT_INQUIRY_CATEGORIES,
  type SupportInquiryCategoryId,
} from '@/src/features/support/support-inquiry';
import { useAndroidOverlayHardwareBack } from '@/src/hooks/use-android-overlay-hardware-back';
import { useUserProfileQuery } from '@/src/hooks/use-user-profile-query';
import { normalizeUserId } from '@/src/lib/app-user-id';
import { presentAppDialogAlert } from '@/src/lib/app-dialog-present';
import { safeRouterBack } from '@/src/lib/router-safe';
import { useTransitionRouter } from '@/src/lib/screen-transition-navigation';

function paramToString(v: string | string[] | undefined): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v[0]) return v[0];
  return '';
}

export default function SupportInquiryScreen() {
  const router = useTransitionRouter();
  const routeParams = useLocalSearchParams<{
    fromAccountGate?: string;
    fromGoogleAuth?: string;
    reason?: string;
    message?: string;
    appUserId?: string;
    dialogTitle?: string;
    dialogBody?: string;
    stillMissing?: string;
  }>();
  const routeAppUserId = paramToString(routeParams.appUserId);
  const fromAccountGate = isSupportInquiryFromAccountGate({
    fromAccountGate: paramToString(routeParams.fromAccountGate),
    reason: paramToString(routeParams.reason),
    message: paramToString(routeParams.message),
    appUserId: routeAppUserId,
  });
  const fromGoogleAuth = isSupportInquiryFromGoogleAuth({
    fromGoogleAuth: paramToString(routeParams.fromGoogleAuth),
    appUserId: routeAppUserId,
    dialogTitle: paramToString(routeParams.dialogTitle),
    dialogBody: paramToString(routeParams.dialogBody),
    stillMissing: paramToString(routeParams.stillMissing),
  });
  const skipProfileHydration = fromAccountGate || fromGoogleAuth;

  const handleHardwareBack = useCallback(() => safeRouterBack(router), [router]);
  useAndroidOverlayHardwareBack(handleHardwareBack);

  const { userId, authProfile } = useUserSession();
  const profilePk = useMemo(() => {
    const u = userId?.trim();
    if (u) return u;
    const em = authProfile?.email?.trim();
    if (em) return normalizeUserId(em) ?? '';
    return '';
  }, [userId, authProfile?.email]);

  const { profile } = useUserProfileQuery(profilePk, {
    enabled: Boolean(profilePk) && !skipProfileHydration,
  });

  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<SupportInquiryCategoryId | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [privacyAgreed, setPrivacyAgreed] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [nameHydrated, setNameHydrated] = useState(false);
  const routePrefillAppliedRef = useRef(false);

  useEffect(() => {
    if (routePrefillAppliedRef.current) return;
    if (!fromAccountGate && !fromGoogleAuth) return;
    routePrefillAppliedRef.current = true;
    const prefill = fromAccountGate
      ? supportInquiryPrefillFromAccountGate({
          fromAccountGate: '1',
          reason: paramToString(routeParams.reason),
          message: paramToString(routeParams.message),
          appUserId: routeAppUserId,
        })
      : supportInquiryPrefillFromGoogleAuth({
          fromGoogleAuth: '1',
          appUserId: routeAppUserId,
          dialogTitle: paramToString(routeParams.dialogTitle),
          dialogBody: paramToString(routeParams.dialogBody),
          stillMissing: paramToString(routeParams.stillMissing),
        });
    if (prefill.categoryId) setCategoryId(prefill.categoryId);
    if (prefill.title) setTitle(prefill.title);
    if (prefill.body) setBody(prefill.body);
  }, [
    fromAccountGate,
    fromGoogleAuth,
    routeAppUserId,
    routeParams.dialogBody,
    routeParams.dialogTitle,
    routeParams.message,
    routeParams.reason,
    routeParams.stillMissing,
  ]);

  useEffect(() => {
    if (skipProfileHydration || nameHydrated || !profile?.nickname?.trim()) return;
    setName(profile.nickname.trim());
    setNameHydrated(true);
  }, [skipProfileHydration, profile?.nickname, nameHydrated]);

  const canSubmit = useMemo(() => {
    return (
      name.trim().length > 0 &&
      categoryId != null &&
      title.trim().length > 0 &&
      body.trim().length > 0 &&
      body.length <= SUPPORT_INQUIRY_BODY_MAX &&
      privacyAgreed &&
      !submitBusy
    );
  }, [name, categoryId, title, body, privacyAgreed, submitBusy]);

  const onSubmit = useCallback(async () => {
    if (!canSubmit || !categoryId) return;
    setSubmitBusy(true);
    try {
      const mailUserId = profilePk || routeAppUserId || null;
      const result = await openSupportInquiryMail(
        { name, categoryId, title, body },
        {
          appUserId: mailUserId,
          userEmail: authProfile?.email?.trim() || profile?.email?.trim() || null,
          accountGateReason: fromAccountGate ? paramToString(routeParams.reason) || 'suspended' : null,
          inquirySource: fromGoogleAuth ? 'google_auth' : fromAccountGate ? 'account_gate' : null,
        },
      );
      if (result === 'unavailable') {
        presentAppDialogAlert({
          title: '메일 앱 없음',
          body: `메일 앱을 사용할 수 없어요. ${GINIT_OFFICIAL_SUPPORT_EMAIL} 으로 직접 문의해 주세요.`,
        });
        return;
      }
      const doneMsg = '메일 앱에서 보내기를 눌러 문의를 완료해 주세요.';
      if (Platform.OS === 'android') ToastAndroid.show(doneMsg, ToastAndroid.LONG);
      else presentAppDialogAlert({ title: '안내', body: doneMsg });
      safeRouterBack(router);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '문의 등록에 실패했습니다.';
      presentAppDialogAlert({ title: '등록 실패', body: msg });
    } finally {
      setSubmitBusy(false);
    }
  }, [
    canSubmit,
    categoryId,
    name,
    title,
    body,
    profilePk,
    routeAppUserId,
    fromAccountGate,
    fromGoogleAuth,
    routeParams.reason,
    authProfile?.email,
    profile?.email,
    router,
  ]);

  return (
    <SupportScreenChrome title="1:1 문의하기" onBack={handleHardwareBack}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <GinitCard appearance="light" style={styles.card}>
            <Text style={styles.label}>이름</Text>
            <TextInput
              value={name}
              onChangeText={(t) => setName(t.slice(0, 40))}
              placeholder="이름을 입력해 주세요"
              placeholderTextColor={GinitTheme.colors.textMuted}
              style={styles.input}
              editable={!submitBusy}
            />

            <Text style={[styles.label, { marginTop: 14 }]}>상담분류</Text>
            <View style={styles.chipWrap}>
              {SUPPORT_INQUIRY_CATEGORIES.map((c) => {
                const selected = categoryId === c.id;
                return (
                  <GinitPressable
                    key={c.id}
                    disabled={submitBusy}
                    onPress={() => setCategoryId(c.id)}
                    style={[styles.chip, selected && styles.chipSelected]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}>
                    <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                      {c.label}
                    </Text>
                  </GinitPressable>
                );
              })}
            </View>

            <View style={[styles.fieldHeader, { marginTop: 14 }]}>
              <Text style={styles.label}>제목</Text>
              <Text style={styles.charCount}>{title.length}/80</Text>
            </View>
            <TextInput
              value={title}
              onChangeText={(t) => setTitle(t.slice(0, 80))}
              placeholder="문의 제목"
              placeholderTextColor={GinitTheme.colors.textMuted}
              style={styles.input}
              editable={!submitBusy}
            />

            <View style={[styles.fieldHeader, { marginTop: 14 }]}>
              <Text style={styles.label}>문의내용</Text>
              <Text style={styles.charCount}>
                {body.length}/{SUPPORT_INQUIRY_BODY_MAX}
              </Text>
            </View>
            <TextInput
              value={body}
              onChangeText={(t) => setBody(t.slice(0, SUPPORT_INQUIRY_BODY_MAX))}
              placeholder="문의 내용을 입력해 주세요"
              placeholderTextColor={GinitTheme.colors.textMuted}
              style={[styles.input, styles.bodyInput]}
              multiline
              editable={!submitBusy}
            />

            <Text style={styles.hintText}>
              문의에 대한 답변은 평균 1~2영업일 정도 소요됩니다.
            </Text>

            <GinitPressable
              onPress={() => !submitBusy && setPrivacyAgreed((v) => !v)}
              style={styles.termsRow}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: privacyAgreed }}>
              <View
                style={[
                  styles.termsBox,
                  privacyAgreed ? styles.termsBoxChecked : styles.termsBoxUnchecked,
                ]}>
                {privacyAgreed ? <Text style={styles.termsCheckMark}>✓</Text> : null}
              </View>
              <Text style={styles.termsLabel}>문의 처리를 위한 개인정보 수집·이용에 동의합니다.</Text>
            </GinitPressable>
          </GinitCard>

          <View style={styles.footerRow}>
            <GinitButton
              title="취소"
              variant="secondary"
              onPress={handleHardwareBack}
              disabled={submitBusy}
              style={styles.footerBtn}
            />
            <GinitButton
              title={submitBusy ? '등록 중…' : '등록'}
              variant="primary"
              onPress={() => void onSubmit()}
              disabled={!canSubmit}
              style={styles.footerBtn}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SupportScreenChrome>
  );
}
