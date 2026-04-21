import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  InteractionManager,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInput as TextInputRefType,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { authScreenStyles as styles } from '@/components/auth/authScreenStyles';
import { KeyboardAwareScreenScroll, ScreenShell } from '@/components/ui';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { useSignUpFlow } from '@/src/hooks/useSignUpFlow';
import { readAppIntroComplete } from '@/src/lib/onboarding-storage';
import { hintKoreanImeForFocusedInput } from '@/src/lib/ko-ime-hint';
import { sanitizeSignUpDisplayName, sanitizeSignUpEmail } from '@/src/lib/sign-up-input-sanitize';
import { setPendingConsentAction } from '@/src/lib/terms-consent-flow';

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
  const displayNameInputRef = useRef<TextInputRefType>(null);
  const emailInputRef = useRef<TextInputRefType>(null);
  const [emailDomain, setEmailDomain] = useState<'gmail.com' | 'naver.com' | 'daum.net' | 'kakao.com' | 'hotmail.com' | 'icloud.com'>(
    'gmail.com',
  );
  const [emailLocal, setEmailLocal] = useState('');
  const [domainPickerOpen, setDomainPickerOpen] = useState(false);

  const composedEmail = useMemo(() => {
    const left = emailLocal.trim();
    if (!left) return '';
    return `${left}@${emailDomain}`;
  }, [emailLocal, emailDomain]);

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
    emailField,
    setEmailField,
    genderCode,
    selectGenderCode,
    memberStatus,
    busy,
    errorText,
    canSubmit,
    runSignUp,
  } = useSignUpFlow(initialPhone);

  // 이메일 입력은 "아이디(골뱅이 앞)" + 도메인 선택으로 구성하고,
  // 실제 저장 값은 hook의 emailField로 동기화합니다.
  useEffect(() => {
    setEmailField(composedEmail);
  }, [composedEmail, setEmailField]);

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
      void runSignUp(proceedAfterSignUp);
      return;
    }
    setPendingConsentAction(async () => {
      await runSignUp(proceedAfterSignUp);
    });
    router.push('/terms-agreement');
  }, [consented, runSignUp, proceedAfterSignUp, router]);

  const signUpSubmitDisabled =
    !canSubmit || busy || memberStatus === 'member' || (memberStatus === 'checking' && phoneField.trim().length > 0);

  if (!isHydrated) {
    return (
      <View style={styles.bootCenter}>
        <ActivityIndicator size="large" color={GinitTheme.trustBlue} />
        <Text style={styles.bootHint}>불러오는 중…</Text>
      </View>
    );
  }

  return (
    <Animated.View style={[styles.rootWrap, { opacity: fade }]}>
      <ScreenShell padded={false} style={styles.screen}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <KeyboardAwareScreenScroll
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
              <Image source={require('@/assets/images/logo-symbol.png')} style={styles.brandSymbol} contentFit="contain" />
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
                <Text style={styles.fieldLabel}>이름 (필수)</Text>
                <Pressable
                  onPress={() => {
                    displayNameInputRef.current?.focus();
                    if (Platform.OS === 'android') {
                      requestAnimationFrame(() => hintKoreanImeForFocusedInput());
                    }
                  }}
                  style={({ pressed }) => [pressed && styles.pressed]}>
                  <TextInput
                    ref={displayNameInputRef}
                    value={displayName}
                    onChangeText={(t) => setDisplayName(sanitizeSignUpDisplayName(t))}
                    onFocus={() => {
                      if (Platform.OS === 'android') {
                        requestAnimationFrame(() => hintKoreanImeForFocusedInput());
                        // 일부 IME는 첫 프레임에 힌트를 무시해서 한 번 더 걸어줍니다.
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
                    onSubmitEditing={() => {
                      emailInputRef.current?.focus();
                      if (Platform.OS === 'android') {
                        InteractionManager.runAfterInteractions(() => {
                          emailInputRef.current?.focus();
                        });
                      }
                    }}
                    {...(Platform.OS === 'web' ? ({ lang: 'ko' } as const) : {})}
                    editable={!busy}
                    selectTextOnFocus
                  />
                </Pressable>
              </View>

              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>전화번호 (필수)</Text>
                <View style={styles.phoneRow}>
                  <View style={[styles.countryCodeBtn, styles.countryCodeBtnReadOnly]} pointerEvents="none">
                    <Text style={styles.countryCodeText}>+82</Text>
                    <Text style={styles.countryCodeArrow}>▾</Text>
                  </View>
                  <TextInput
                    value={phoneField}
                    placeholder="전화번호 (- 없이)"
                    placeholderTextColor="#94a3b8"
                    style={[styles.phoneInputNew, styles.phoneInputReadOnly]}
                    keyboardType="phone-pad"
                    autoCapitalize="none"
                    editable={false}
                    selectTextOnFocus={false}
                  />
                </View>
              </View>

              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>이메일 (선택)</Text>
                <View style={emailCombo.row}>
                  <Pressable
                    onPress={() => emailInputRef.current?.focus()}
                    style={({ pressed }) => [emailCombo.leftWrap, pressed && styles.pressed]}>
                    <TextInput
                      ref={emailInputRef}
                      value={emailLocal}
                      onChangeText={(t) => setEmailLocal(sanitizeSignUpEmail(t).replace(/@.*/g, ''))}
                      placeholder="아이디"
                      placeholderTextColor="#94a3b8"
                      style={[styles.fullWidthInput, emailCombo.leftInput]}
                      keyboardType="default"
                      inputMode="text"
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="email"
                      textContentType="emailAddress"
                      importantForAutofill="yes"
                      returnKeyType="done"
                      enterKeyHint="done"
                      submitBehavior="blurAndSubmit"
                      onSubmitEditing={Keyboard.dismiss}
                      editable={!busy}
                      selectTextOnFocus
                    />
                  </Pressable>
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
                </View>
                <Text style={emailCombo.hint}>아이디만 입력하면 도메인은 선택할 수 있어요.</Text>
              </View>

              <Modal visible={domainPickerOpen} animationType="fade" transparent onRequestClose={() => setDomainPickerOpen(false)}>
                <Pressable style={emailCombo.modalDim} onPress={() => setDomainPickerOpen(false)}>
                  <View style={emailCombo.modalCard}>
                    <Text style={emailCombo.modalTitle}>이메일 도메인 선택</Text>
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

              <View style={styles.fieldBlock}>
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

              <Pressable
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
    fontWeight: '900',
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
    fontWeight: '800',
    color: '#0f172a',
  },
  domainArrow: {
    fontSize: 12,
    fontWeight: '900',
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
    fontWeight: '900',
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
    fontWeight: '800',
    color: '#0f172a',
  },
  domainRowTextSelected: {
    color: '#0052CC',
  },
});
