import { useFocusEffect } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { type ElementRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
    AccessibilityInfo,
    ActivityIndicator,
    Alert,
    Animated,
    findNodeHandle,
    InteractionManager,
    Keyboard,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    type TextInput as TextInputRefType,
    UIManager,
    View,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';

import { authScreenStyles as styles } from '@/components/auth/authScreenStyles';
import { BirthdateWheel } from '@/components/auth/BirthdateWheel';
import { phoneOtpInlineStyles as otpStyles } from '@/components/auth/phoneOtpStyles';
import { KeyboardAwareScreenScroll, ScreenShell } from '@/components/ui';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { useOtpSmsRetriever } from '@/src/hooks/useOtpSmsRetriever';
import { useSignUpFlow } from '@/src/hooks/useSignUpFlow';
import { hintKoreanImeForFocusedInput } from '@/src/lib/ko-ime-hint';
import { readAppIntroComplete } from '@/src/lib/onboarding-storage';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';
import { writeSecureAuthSession } from '@/src/lib/secure-auth-session';
import { sanitizeSignUpDisplayName, sanitizeSignUpEmail } from '@/src/lib/sign-up-input-sanitize';
import { setPendingConsentAction } from '@/src/lib/terms-consent-flow';
import { hasLoginableUserForPhoneE164 } from '@/src/lib/user-profile';
import { AuthService } from '@/src/services/AuthService';

function paramToString(v: string | string[] | undefined): string {
  if (v == null) return '';
  return Array.isArray(v) ? (v[0] ?? '') : v;
}

export default function SignUpScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ phone?: string | string[]; consented?: string | string[] }>();
  const initialPhone = useMemo(() => paramToString(params.phone), [params.phone]);
  const consented = useMemo(() => {
    const raw = params.consented;
    const s = Array.isArray(raw) ? raw[0] : raw;
    return s === '1' || s === 'true';
  }, [params.consented]);
  const { isHydrated } = useUserSession();
  const fade = useRef(new Animated.Value(1)).current;
  const scrollRef = useRef<ElementRef<typeof KeyboardAwareScrollView>>(null);
  const displayNameInputRef = useRef<TextInputRefType>(null);
  const emailInputRef = useRef<TextInputRefType>(null);
  const phoneInputRef = useRef<TextInputRefType>(null);
  const otpInputRef = useRef<TextInputRefType>(null);
  /** 전화 입력 완료 후 키보드/접근성 포커스를 인증번호 받기 쪽으로 옮깁니다. */
  const sendOtpFocusHostRef = useRef<View | null>(null);
  /** onChangeText 클로저·플랫폼 버그 대비: 마지막으로 확정된 숫자만 문자열 */
  const lastPhoneDigitsRef = useRef('');
  const [emailDomain, setEmailDomain] = useState<'gmail.com' | 'naver.com' | 'daum.net' | 'kakao.com' | 'hotmail.com' | 'icloud.com'>(
    'gmail.com',
  );
  const [emailDomainMode, setEmailDomainMode] = useState<'preset' | 'manual'>('manual');
  const [emailLocal, setEmailLocal] = useState('');
  const [emailFull, setEmailFull] = useState('');
  const [domainPickerOpen, setDomainPickerOpen] = useState(false);
  const [otpVerificationId, setOtpVerificationId] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [verifiedFirebaseUid, setVerifiedFirebaseUid] = useState<string | null>(null);
  const [displayNameBlockY, setDisplayNameBlockY] = useState<number | null>(null);
  const [phoneBlockY, setPhoneBlockY] = useState<number | null>(null);
  const [genderY, setGenderY] = useState<number | null>(null);
  const [ageBandY, setAgeBandY] = useState<number | null>(null);
  const [submitY, setSubmitY] = useState<number | null>(null);

  const composedEmail = useMemo(() => {
    if (emailDomainMode === 'manual') return emailFull.trim();
    const left = emailLocal.trim();
    if (!left) return '';
    return `${left}@${emailDomain}`;
  }, [emailDomainMode, emailFull, emailLocal, emailDomain]);

  const scrollToDisplayNameBlock = useCallback(() => {
    if (displayNameBlockY == null) return;
    scrollRef.current?.scrollTo({ x: 0, y: Math.max(0, displayNameBlockY - 14), animated: true });
  }, [displayNameBlockY]);

  const scrollToPhoneBlock = useCallback(() => {
    if (phoneBlockY == null) return;
    scrollRef.current?.scrollTo({ x: 0, y: Math.max(0, phoneBlockY - 14), animated: true });
  }, [phoneBlockY]);

  const scrollToGender = useCallback(() => {
    if (genderY == null) return;
    scrollRef.current?.scrollTo({ x: 0, y: Math.max(0, genderY - 14), animated: true });
  }, [genderY]);

  const scrollToAgeBand = useCallback(() => {
    if (ageBandY == null) return;
    scrollRef.current?.scrollTo({ x: 0, y: Math.max(0, ageBandY - 14), animated: true });
  }, [ageBandY]);

  const scrollToSubmit = useCallback(() => {
    if (submitY == null) return;
    scrollRef.current?.scrollTo({ x: 0, y: Math.max(0, submitY - 14), animated: true });
  }, [submitY]);

  const formatPhoneKrDisplay = useCallback((digitsOnly: string) => {
    const d = digitsOnly.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 11)}`;
  }, []);

  const scrollToFocused = useCallback((r: React.RefObject<TextInputRefType | null>) => {
    const input = r.current;
    const sv = scrollRef.current;
    if (!input || !sv) return;
    const scrollHandle = findNodeHandle(sv);
    const inputHandle = findNodeHandle(input);
    if (scrollHandle == null || inputHandle == null) return;
    UIManager.measureLayout(
      inputHandle,
      scrollHandle,
      () => {},
      (_x, y, _w, _h) => {
        sv.scrollTo({ x: 0, y: Math.max(0, y - 24), animated: true });
      },
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      return () => {
        Keyboard.dismiss();
      };
    }, []),
  );

  const {
    displayName,
    setDisplayName,
    phoneField,
    setPhoneField,
    setEmailField,
    genderCode,
    selectGenderCode,
    birthdate,
    setBirthdate,
    memberStatus,
    busy,
    errorText,
    canSubmit,
    runSignUp,
  } = useSignUpFlow(initialPhone);

  const smsRetriever = useOtpSmsRetriever({ onCode: setOtpCode });

  useLayoutEffect(() => {
    lastPhoneDigitsRef.current = phoneField.replace(/\D/g, '');
  }, [phoneField]);

  const normalizedPhone = useMemo(() => normalizePhoneUserId(phoneField), [phoneField]);
  const phoneDigitCount = useMemo(() => phoneField.replace(/\D/g, '').length, [phoneField]);
  /** 회원 여부와 관계없이 탭 가능. 11자리·유효 번호일 때만 실제 전송은 `onSendOtp`에서 진행합니다. */
  const canSendOtp =
    phoneDigitCount === 11 && !!normalizedPhone && !busy && !otpBusy && !verifiedFirebaseUid;
  const canConfirmOtp = !!otpVerificationId && otpCode.trim().length === 6 && !otpBusy && !busy && !verifiedFirebaseUid;

  // 이메일 입력은 "도메인 선택" 또는 "직접 입력" 모드를 지원하고,
  // 실제 저장 값은 hook의 emailField로 동기화합니다.
  useEffect(() => {
    setEmailField(composedEmail);
  }, [composedEmail, setEmailField]);

  // 전화번호가 바뀌면 OTP 세션은 리셋합니다.
  useEffect(() => {
    setOtpVerificationId(null);
    setOtpCode('');
    setOtpError(null);
    setVerifiedFirebaseUid(null);
    smsRetriever.stop();
  }, [normalizedPhone]);

  // OTP가 채워졌으면 SMS Retriever는 정리합니다.
  useEffect(() => {
    if (otpCode.trim().length === 6) smsRetriever.stop();
  }, [otpCode, smsRetriever]);

  const focusSendOtpControl = useCallback(() => {
    const host = sendOtpFocusHostRef.current;
    if (!host) return;
    try {
      // Android: D-pad/키보드 탭 순서용 포커스
      const focus = (host as View & { focus?: () => void }).focus;
      focus?.call(host);
    } catch {
      /* noop */
    }
    try {
      const tag = findNodeHandle(host);
      if (tag != null && typeof AccessibilityInfo.setAccessibilityFocus === 'function') {
        AccessibilityInfo.setAccessibilityFocus(tag);
      }
    } catch {
      /* noop */
    }
  }, []);

  const onSendOtp = useCallback(async () => {
    if (!normalizedPhone || !canSendOtp) return;
    smsRetriever.stop();
    setOtpBusy(true);
    setOtpError(null);
    try {
      const alreadyMember = await hasLoginableUserForPhoneE164(normalizedPhone);
      if (alreadyMember) {
        const msg = '이 번호는 이미 가입되어 있어요. 로그인 화면으로 돌아가 주세요.';
        setOtpError(msg);
        Alert.alert('안내', msg);
        return;
      }
      const { verificationId } = await AuthService.verifyPhoneNumber(normalizedPhone);
      setOtpVerificationId(verificationId);
      // Firebase verifyPhoneNumber와 SMS User Consent 이중 구독 시 Android에서 프로세스 종료가 날 수 있어 start 생략.
      InteractionManager.runAfterInteractions(() => {
        requestAnimationFrame(() => {
          scrollRef.current?.scrollToEnd({ animated: true });
        });
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setOtpError(msg);
    } finally {
      setOtpBusy(false);
    }
  }, [normalizedPhone, canSendOtp, smsRetriever]);

  const onConfirmOtp = useCallback(async () => {
    if (!otpVerificationId || !canConfirmOtp) return;
    setOtpBusy(true);
    setOtpError(null);
    try {
      const cred = await AuthService.confirmCode(otpVerificationId, otpCode);
      const uid = cred.user?.uid ?? '';
      if (!uid) throw new Error('인증은 완료됐지만 사용자 정보를 가져올 수 없습니다.');
      setVerifiedFirebaseUid(uid);
      // "당근마켓식" 자동 로그인: 부트에서 홈 진입을 위해 secure store에 세션을 저장합니다.
      if (normalizedPhone) {
        await writeSecureAuthSession({ uid, userId: normalizedPhone });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setOtpError(msg);
    } finally {
      setOtpBusy(false);
    }
  }, [otpVerificationId, otpCode, canConfirmOtp, normalizedPhone]);

  const proceedAfterSignUp = useCallback(() => {
    void (async () => {
      const introSeen = await readAppIntroComplete();
      Animated.timing(fade, {
        toValue: 0,
        duration: 320,
        useNativeDriver: true,
      }).start(() => {
        if (introSeen) {
          router.replace('/(tabs)');
          return;
        }
        router.replace({ pathname: '/onboarding', params: { next: 'tabs', flow: 'postSignup' } });
      });
    })();
  }, [fade, router]);

  const onSubmit = useCallback(() => {
    if (consented) {
      void runSignUp(verifiedFirebaseUid ?? '', proceedAfterSignUp);
      return;
    }
    setPendingConsentAction(async () => {
      await runSignUp(verifiedFirebaseUid ?? '', proceedAfterSignUp);
    });
    router.push('/terms-agreement');
  }, [consented, runSignUp, verifiedFirebaseUid, proceedAfterSignUp, router]);

  const signUpSubmitDisabled =
    !canSubmit ||
    busy ||
    otpBusy ||
    !verifiedFirebaseUid ||
    memberStatus === 'member' ||
    (memberStatus === 'checking' && phoneField.trim().length > 0);

  if (!isHydrated) {
    return (
      <View style={styles.bootCenter}>
        <ActivityIndicator size="large" color={GinitTheme.themeMainColor} />
        <Text style={styles.bootHint}>불러오는 중…</Text>
      </View>
    );
  }

  return (
    <Animated.View style={[styles.rootWrap, { opacity: fade }]}>
      <ScreenShell padded={false} style={styles.screen}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <KeyboardAwareScreenScroll
            ref={scrollRef}
            contentContainerStyle={[styles.scroll, signUpScrollExtra.content]}
            extraScrollHeight={18}
            extraHeight={32}
            dismissKeyboardOnScrollBeginDrag>
            <View style={styles.topBar}>
              <Pressable
                onPress={() => {
                  Keyboard.dismiss();
                  router.back();
                }}
                style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="뒤로 가기">
                <Text style={styles.backBtnText}>‹</Text>
              </Pressable>
              <Text style={styles.topBarTitle}>회원가입</Text>
            </View>

            <Pressable style={styles.topBrand} onPress={Keyboard.dismiss} accessible={false}>
              <Image source={require('@/assets/images/logo_symbol.png')} style={styles.brandSymbol} contentFit="contain" />
              <Text style={styles.brandName}>Ginit</Text>
              <Text style={styles.greeting}>
                필수 정보를 입력한 뒤{'\n'}회원가입 완료로 가입을 마쳐 주세요
              </Text>
            </Pressable>

            <View style={styles.authCard}>
              {Platform.OS === 'ios' ? (
                <BlurView
                  pointerEvents="none"
                  intensity={32}
                  tint="light"
                  style={StyleSheet.absoluteFill}
                  experimentalBlurMethod="dimezisBlurView"
                />
              ) : (
                <View pointerEvents="none" style={styles.authCardBackdropAndroid} />
              )}
              <View pointerEvents="none" style={styles.cardGlow} />
              <View pointerEvents="none" style={styles.cardBorder} />

              <View style={styles.authCardContent}>
              {memberStatus === 'checking' && phoneField.trim() ? (
                <View style={styles.checkingRow}>
                  <ActivityIndicator color={GinitTheme.colors.primary} />
                  <Text style={styles.checkingLabel}>회원 여부 확인 중…</Text>
                </View>
              ) : null}

              {memberStatus === 'member' ? (
                <Text style={styles.memberBadge}>이 번호는 이미 등록되어 있어요. 로그인 화면으로 돌아가 주세요.</Text>
              ) : null}

              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>이메일 (필수)</Text>
                <View style={emailCombo.row}>
                  {emailDomainMode === 'manual' ? (
                    <>
                      <View style={emailCombo.leftWrap}>
                        <TextInput
                          ref={emailInputRef}
                          value={emailFull}
                          onChangeText={(t) => setEmailFull(sanitizeSignUpEmail(t))}
                          placeholder="name@example.com"
                          placeholderTextColor="#94a3b8"
                          style={[styles.fullWidthInput, emailCombo.leftInput]}
                          keyboardType="email-address"
                          inputMode={Platform.OS === 'web' ? 'email' : undefined}
                          autoCapitalize="none"
                          autoCorrect={false}
                          autoComplete="email"
                          textContentType="emailAddress"
                          importantForAutofill="yes"
                          returnKeyType="next"
                          enterKeyHint="next"
                          submitBehavior="blurAndSubmit"
                          onFocus={() => scrollToFocused(emailInputRef)}
                          onSubmitEditing={scrollToDisplayNameBlock}
                          editable={!busy}
                          selectTextOnFocus
                        />
                      </View>
                      <Pressable
                        onPress={() => setDomainPickerOpen(true)}
                        disabled={busy}
                        style={({ pressed }) => [emailCombo.domainBtn, pressed && !busy && styles.pressed]}
                        accessibilityRole="button"
                        accessibilityLabel="이메일 도메인 선택">
                        <Text style={emailCombo.domainText}>직접 입력</Text>
                        <Text style={emailCombo.domainArrow}>▾</Text>
                      </Pressable>
                    </>
                  ) : (
                    <>
                      <View style={emailCombo.leftWrap}>
                        <TextInput
                          ref={emailInputRef}
                          value={emailLocal}
                          onChangeText={(t) => setEmailLocal(sanitizeSignUpEmail(t).replace(/@.*/g, ''))}
                          placeholder="이메일"
                          placeholderTextColor="#94a3b8"
                          style={[styles.fullWidthInput, emailCombo.leftInput]}
                          keyboardType="email-address"
                          inputMode={Platform.OS === 'web' ? 'email' : undefined}
                          autoCapitalize="none"
                          autoCorrect={false}
                          autoComplete="email"
                          textContentType="emailAddress"
                          importantForAutofill="yes"
                          returnKeyType="next"
                          enterKeyHint="next"
                          submitBehavior="blurAndSubmit"
                          onFocus={() => scrollToFocused(emailInputRef)}
                          onSubmitEditing={scrollToDisplayNameBlock}
                          editable={!busy}
                          selectTextOnFocus
                        />
                      </View>
                      <Text style={emailCombo.at}>@</Text>
                      <Pressable
                        onPress={() => setDomainPickerOpen(true)}
                        disabled={busy}
                        style={({ pressed }) => [emailCombo.domainBtn, pressed && !busy && styles.pressed]}
                        accessibilityRole="button"
                        accessibilityLabel="이메일 도메인 선택">
                        <Text style={emailCombo.domainText}>{emailDomain}</Text>
                        <Text style={emailCombo.domainArrow}>▾</Text>
                      </Pressable>
                    </>
                  )}
                </View>
                <Text style={emailCombo.hint}>이메일은 로그인 아이디로 사용됩니다.</Text>
              </View>

              <View style={styles.fieldBlock} onLayout={(e) => setDisplayNameBlockY(e.nativeEvent.layout.y)}>
                <Text style={styles.fieldLabel}>이름 (필수)</Text>
                <Pressable
                  onPress={scrollToDisplayNameBlock}
                  style={({ pressed }) => [pressed && styles.pressed]}>
                  <TextInput
                    ref={displayNameInputRef}
                    value={displayName}
                    onChangeText={(t) => setDisplayName(sanitizeSignUpDisplayName(t))}
                    onFocus={() => {
                      scrollToFocused(displayNameInputRef);
                      if (Platform.OS === 'android') {
                        requestAnimationFrame(() => hintKoreanImeForFocusedInput());
                        setTimeout(() => hintKoreanImeForFocusedInput(), 60);
                      }
                    }}
                    placeholder="실명 또는 닉네임"
                    placeholderTextColor="#94a3b8"
                    style={styles.fullWidthInput}
                    keyboardType="default"
                    inputMode="text"
                    autoCapitalize="none"
                    autoCorrect
                    autoComplete="name"
                    textContentType="nickname"
                    returnKeyType="next"
                    enterKeyHint="next"
                    blurOnSubmit={false}
                    onSubmitEditing={scrollToPhoneBlock}
                    {...(Platform.OS === 'web' ? ({ lang: 'ko' } as const) : {})}
                    editable={!busy}
                    selectTextOnFocus
                  />
                </Pressable>
              </View>

              <View style={styles.fieldBlock} onLayout={(e) => setPhoneBlockY(e.nativeEvent.layout.y)}>
                <Text style={styles.fieldLabel}>전화번호 (필수)</Text>
                <View style={styles.phoneRow}>
                  <TextInput
                    ref={phoneInputRef}
                    value={phoneField}
                    onChangeText={(t) => {
                      // 입력은 사용자가 익숙한 010... 로 받되, 전송 시 normalizePhoneUserId가 +82...로 변환합니다.
                      const digits = t.replace(/\D/g, '').slice(0, 11);
                      const prev = lastPhoneDigitsRef.current;
                      // 11자리 완성 직후 RN Web 등에서 한 이벤트로 '4'처럼 짧은 문자열만 넘어와 전체가 지워지는 경우 방지(접두어 유지 편집은 허용)
                      if (prev.length === 11 && digits.length > 0 && digits.length <= 4 && !prev.startsWith(digits)) {
                        return;
                      }
                      lastPhoneDigitsRef.current = digits;
                      setPhoneField(formatPhoneKrDisplay(digits));
                    }}
                    onFocus={() => scrollToFocused(phoneInputRef)}
                    placeholder="전화번호 입력"
                    placeholderTextColor="#94a3b8"
                    style={styles.phoneInputNew}
                    keyboardType="phone-pad"
                    inputMode="tel"
                    autoComplete={Platform.OS === 'android' ? 'off' : 'tel'}
                    textContentType={Platform.OS === 'ios' ? 'telephoneNumber' : undefined}
                    importantForAutofill={Platform.OS === 'android' ? 'no' : 'yes'}
                    autoCapitalize="none"
                    editable={!busy && !otpBusy && !verifiedFirebaseUid}
                    selectTextOnFocus
                    returnKeyType="done"
                    enterKeyHint="done"
                    onSubmitEditing={() => {
                      if (normalizedPhone && canSendOtp) {
                        Keyboard.dismiss();
                        requestAnimationFrame(() => focusSendOtpControl());
                        return;
                      }
                      if (normalizedPhone && memberStatus === 'checking') {
                        Keyboard.dismiss();
                        return;
                      }
                      Keyboard.dismiss();
                      InteractionManager.runAfterInteractions(() => {
                        scrollToGender();
                      });
                    }}
                  />
                  <View ref={sendOtpFocusHostRef} focusable={Platform.OS === 'android'} collapsable={false}>
                    <Pressable
                      onPress={() => void onSendOtp()}
                      disabled={!canSendOtp}
                      style={({ pressed }) => [
                        otpStyles.sendInlineBtn,
                        !canSendOtp && otpStyles.sendInlineBtnDisabled,
                        pressed && canSendOtp && styles.pressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="인증번호 받기">
                      <Text style={otpStyles.sendInlineText}>{otpBusy ? '전송 중…' : '인증번호 받기'}</Text>
                    </Pressable>
                  </View>
                </View>
                {verifiedFirebaseUid ? <Text style={otpStyles.verifiedBadge}>인증 완료</Text> : null}

                {otpVerificationId && !verifiedFirebaseUid ? (
                  <View style={otpStyles.otpRow}>
                    <TextInput
                      ref={otpInputRef}
                      value={otpCode}
                      onChangeText={(t) => setOtpCode(t.replace(/\D/g, '').slice(0, 6))}
                      onFocus={() => scrollToFocused(otpInputRef)}
                      placeholder="인증번호 6자리"
                      placeholderTextColor="#94a3b8"
                      style={otpStyles.otpInput}
                      keyboardType="number-pad"
                      inputMode="numeric"
                      textContentType="oneTimeCode"
                      autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
                      editable={!verifiedFirebaseUid && !otpBusy && !busy}
                      selectTextOnFocus
                      returnKeyType="done"
                      enterKeyHint="done"
                      onSubmitEditing={() => void onConfirmOtp()}
                    />
                    <Pressable
                      onPress={() => void onConfirmOtp()}
                      disabled={!canConfirmOtp}
                      style={({ pressed }) => [
                        otpStyles.confirmBtn,
                        !canConfirmOtp && otpStyles.confirmBtnDisabled,
                        pressed && canConfirmOtp && styles.pressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="인증 확인">
                      <Text style={otpStyles.confirmText}>{otpBusy ? '확인 중…' : '확인'}</Text>
                    </Pressable>
                  </View>
                ) : null}

                {otpError ? <Text style={otpStyles.otpError}>{otpError}</Text> : null}
              </View>

              <Modal visible={domainPickerOpen} animationType="fade" transparent onRequestClose={() => setDomainPickerOpen(false)}>
                <Pressable style={emailCombo.modalDim} onPress={() => setDomainPickerOpen(false)}>
                  <View style={emailCombo.modalCard}>
                    <Text style={emailCombo.modalTitle}>이메일 도메인 선택</Text>
                    <Pressable
                      onPress={() => {
                        setEmailDomainMode('manual');
                        const prev = composedEmail.trim();
                        if (prev) setEmailFull(prev);
                        setDomainPickerOpen(false);
                      }}
                      style={({ pressed }) => [emailCombo.domainRow, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel="직접 입력">
                      <Text
                        style={[
                          emailCombo.domainRowText,
                          emailDomainMode === 'manual' && emailCombo.domainRowTextSelected,
                        ]}>
                        직접 입력
                      </Text>
                    </Pressable>
                    {(
                      [
                        'gmail.com',
                        'naver.com',
                        'daum.net',
                        'kakao.com',
                        'hotmail.com',
                        'icloud.com',
                      ] as const
                    ).map((d) => {
                      const selected = d === emailDomain;
                      return (
                        <Pressable
                          key={d}
                          onPress={() => {
                            setEmailDomain(d);
                            setEmailDomainMode('preset');
                            if (emailFull.trim()) {
                              const left = emailFull.trim().split('@')[0] ?? '';
                              if (left) setEmailLocal(left);
                            }
                            setDomainPickerOpen(false);
                          }}
                          style={({ pressed }) => [emailCombo.domainRow, pressed && styles.pressed]}
                          accessibilityRole="button"
                          accessibilityLabel={`${d}${selected ? ', 선택됨' : ''}`}>
                          <Text style={[emailCombo.domainRowText, selected && emailCombo.domainRowTextSelected]}>{d}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </Pressable>
              </Modal>

              <View
                style={styles.fieldBlock}
                onLayout={(e) => {
                  setGenderY(e.nativeEvent.layout.y);
                }}>
                <Text style={styles.fieldLabel}>성별 (필수)</Text>
                <View style={styles.genderBinaryWrap} accessibilityRole="radiogroup" accessibilityLabel="성별 선택">
                  {(
                    [
                      { code: 'MALE' as const, label: '남자' },
                      { code: 'FEMALE' as const, label: '여자' },
                    ] as const
                  ).map(({ code, label }) => {
                    const selected = genderCode === code;
                    return (
                      <Pressable
                        key={code}
                        disabled={busy}
                        onPress={() => {
                          Keyboard.dismiss();
                          selectGenderCode(code);
                          InteractionManager.runAfterInteractions(() => {
                            scrollToAgeBand();
                          });
                        }}
                        style={({ pressed }) => [
                          styles.genderBinaryBtn,
                          selected ? styles.genderBinaryBtnSelected : styles.genderBinaryBtnIdle,
                          pressed && !busy && styles.pressed,
                        ]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected, checked: selected }}
                        accessibilityLabel={label}>
                        <Text style={selected ? styles.genderBinaryLabelSelected : styles.genderBinaryLabel}>
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View
                style={styles.fieldBlock}
                onLayout={(e) => {
                  setAgeBandY(e.nativeEvent.layout.y);
                }}>
                <Text style={styles.fieldLabel}>생년월일 (필수)</Text>
                <BirthdateWheel
                  value={birthdate}
                  onChange={(v) => {
                    Keyboard.dismiss();
                    setBirthdate(v);
                    InteractionManager.runAfterInteractions(() => {
                      scrollToSubmit();
                    });
                  }}
                  disabled={busy}
                />
              </View>

              <Pressable
                onLayout={(e) => setSubmitY(e.nativeEvent.layout.y)}
                onPress={() => {
                  Keyboard.dismiss();
                  void onSubmit();
                }}
                disabled={signUpSubmitDisabled}
                style={({ pressed }) => [
                  styles.signUpSubmitBtn,
                  signUpSubmitDisabled && styles.btnDisabled,
                  pressed && !signUpSubmitDisabled && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="회원가입 완료">
                {busy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.signUpSubmitBtnLabel}>회원가입 완료</Text>
                )}
              </Pressable>
              <Text style={styles.signUpSubmitHint}>
                가입이 완료되면 지닛을 소개하는 짧은 화면이 이어집니다. 건너뛰기로 바로 홈으로 갈 수도 있어요.
              </Text>
              </View>
            </View>

            <Pressable
              onPress={() => {
                Keyboard.dismiss();
                router.back();
              }}
              style={({ pressed }) => [pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="로그인으로 돌아가기">
              <View style={styles.registerLinkRow}>
                <Text style={styles.registerLinkMuted}>이미 회원이에요?</Text>
                <Text style={styles.registerLinkAccent}>로그인으로 돌아가기</Text>
              </View>
            </Pressable>

            {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}

            <Pressable onPress={Keyboard.dismiss} accessible={false}>
              <View style={styles.footerRule} />
              <Text style={styles.footerCredit}>UI/UX Vision by Ginit Human-Connection Team.</Text>
            </Pressable>
          </KeyboardAwareScreenScroll>
        </SafeAreaView>
      </ScreenShell>
    </Animated.View>
  );
}

const signUpScrollExtra = StyleSheet.create({
  content: {
    gap: 18,
    paddingBottom: 8,
  },
});

// (연령대 선택 UI 제거됨)

const emailCombo = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  leftWrap: {
    flex: 1,
  },
  leftInput: {
    paddingHorizontal: 12,
  },
  at: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
    marginTop: -1,
  },
  domainBtn: {
    height: 48,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.10)',
    backgroundColor: 'rgba(255, 255, 255, 0.65)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  domainText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
  },
  domainArrow: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
    marginTop: -1,
  },
  hint: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
  },
  modalDim: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    padding: 18,
    justifyContent: 'center',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.12)',
  },
  modalTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
    marginBottom: 10,
  },
  domainRow: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  domainRowText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
  },
  domainRowTextSelected: {
    color: '#0052CC',
  },
});

