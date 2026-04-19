import { useFocusEffect } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GinitButton, GinitCard } from '@/components/ginit';
import { GinitPlaceholderColor, GinitStyles } from '@/constants/GinitStyles';
import { GinitTheme } from '@/constants/ginit-theme';
import type { Category } from '@/src/lib/categories';
import { subscribeCategories } from '@/src/lib/categories';
import { useUserSession } from '@/src/context/UserSessionContext';
import { primaryScheduleFromDateCandidate } from '@/src/lib/date-candidate';
import type { VoteCandidatesPayload } from '@/src/lib/meeting-place-bridge';
import { consumePendingMeetingPlace, consumePendingVoteCandidates } from '@/src/lib/meeting-place-bridge';
import { addMeeting } from '@/src/lib/meetings';
import { generateSuggestedMeetingTitle } from '@/src/lib/meeting-title-suggestion';

import { VoteCandidatesForm, type VoteCandidatesFormHandle } from './details';

const TRUST_BLUE = '#0052CC';

type Step = 1 | 2;

const AI_TEMPLATES: { title: string; keywords: string[] }[] = [
  { title: '🔥 오늘 저녁 약속', keywords: ['레스토랑', '식사', '저녁'] },
  { title: '☕️ 가벼운 커피', keywords: ['커피'] },
  { title: '🗓️ 팀 싱크 회의', keywords: ['회의', '미팅', '워크'] },
  { title: '🎂 생일 파티 계획', keywords: ['파티', '생일'] },
];

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function pickCategoryByKeywords(categories: Category[], keywords: string[]): Category | null {
  for (const kw of keywords) {
    const hit = categories.find((c) => c.label.includes(kw));
    if (hit) return hit;
  }
  return categories[0] ?? null;
}

function OrangeAction({
  title,
  onPress,
  disabled,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        GinitStyles.ctaButtonWideShadow,
        disabled && GinitStyles.ctaButtonWideDisabled,
        pressed && !disabled && GinitStyles.ctaButtonWidePressed,
      ]}>
      <Text style={GinitStyles.ctaButtonLabel}>{title}</Text>
    </Pressable>
  );
}

export default function CreateMeetingScreen() {
  const router = useRouter();
  const { phoneUserId } = useUserSession();
  const [step, setStep] = useState<Step>(1);
  const [categories, setCategories] = useState<Category[]>([]);
  const [catLoading, setCatLoading] = useState(true);
  const [catError, setCatError] = useState<string | null>(null);

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState(true);

  const [title, setTitle] = useState('');
  const [scheduleDate, setScheduleDate] = useState(() => fmtDate(new Date()));
  const [scheduleTime, setScheduleTime] = useState('15:00');
  const [placeName, setPlaceName] = useState('');
  const [address, setAddress] = useState('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [capacityText, setCapacityText] = useState('4');
  const [description, setDescription] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 상세(2단계) 텍스트 필드 포커스 — Trust Blue 테두리 */
  const [focusedStep2Field, setFocusedStep2Field] = useState<'title' | 'cap' | 'desc' | null>(null);
  const [votePayload, setVotePayload] = useState<VoteCandidatesPayload | null>(null);
  const [voteHydrateKey, setVoteHydrateKey] = useState(0);
  const voteFormRef = useRef<VoteCandidatesFormHandle>(null);
  const [aiTitleSuggestion, setAiTitleSuggestion] = useState('');

  useFocusEffect(
    useCallback(() => {
      const vote = consumePendingVoteCandidates();
      if (vote) {
        setVotePayload(vote);
        setVoteHydrateKey((k) => k + 1);
        if (vote.placeCandidates.length > 0) {
          const p0 = vote.placeCandidates[0];
          setPlaceName(p0.placeName);
          setAddress(p0.address);
          setLatitude(p0.latitude);
          setLongitude(p0.longitude);
        }
        if (vote.dateCandidates.length > 0) {
          const d0 = vote.dateCandidates[0];
          const primary = primaryScheduleFromDateCandidate(d0);
          setScheduleDate(primary.scheduleDate);
          setScheduleTime(primary.scheduleTime);
        }
        return;
      }
      const p = consumePendingMeetingPlace();
      if (p) {
        setPlaceName(p.placeName);
        setAddress(p.address);
        setLatitude(p.latitude);
        setLongitude(p.longitude);
      }
    }, []),
  );

  useEffect(() => {
    setCatLoading(true);
    const unsub = subscribeCategories(
      (list) => {
        setCategories(list);
        setCatError(null);
        setCatLoading(false);
        setSelectedCategoryId((prev) => {
          if (prev && list.some((c) => c.id === prev)) return prev;
          return list[0]?.id ?? null;
        });
      },
      (msg) => {
        setCatError(msg);
        setCatLoading(false);
      },
    );
    return unsub;
  }, []);

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === selectedCategoryId) ?? null,
    [categories, selectedCategoryId],
  );

  useEffect(() => {
    if (step !== 2 || !selectedCategory?.label?.trim()) {
      setAiTitleSuggestion('');
      return;
    }
    setAiTitleSuggestion(generateSuggestedMeetingTitle(selectedCategory.label, new Date()));
  }, [step, selectedCategory?.label]);

  const onTemplatePress = useCallback(
    (keywords: string[]) => {
      const cat = pickCategoryByKeywords(categories, keywords);
      if (cat) setSelectedCategoryId(cat.id);
    },
    [categories],
  );

  const goNext = useCallback(() => {
    setError(null);
    if (!selectedCategoryId || !selectedCategory) {
      setError('카테고리를 선택해 주세요.');
      return;
    }
    setStep(2);
  }, [selectedCategory, selectedCategoryId]);

  const goBackTop = useCallback(() => {
    if (step === 2) {
      setStep(1);
      setError(null);
      return;
    }
    router.back();
  }, [router, step]);

  const onSubmit = useCallback(async () => {
    setError(null);
    if (!selectedCategoryId || !selectedCategory) {
      setError('카테고리 정보가 없습니다. 처음부터 다시 시도해 주세요.');
      return;
    }

    if (!title.trim()) {
      setError('모임 이름을 입력해 주세요.');
      return;
    }

    const built = voteFormRef.current?.buildPayload();
    if (!built?.ok) {
      setError(built?.error ?? '일시·장소 후보를 확인해 주세요.');
      return;
    }
    const vote = built.payload;
    const cap = parseInt(capacityText.replace(/\D/g, ''), 10);
    if (!Number.isFinite(cap) || cap < 1) {
      setError('인원수는 1 이상의 숫자로 입력해 주세요.');
      return;
    }
    if (!description.trim()) {
      setError('설명을 입력해 주세요.');
      return;
    }

    if (!phoneUserId?.trim()) {
      Alert.alert('전화번호 필요', '모임을 등록하려면 로그인 화면에서 전화번호로 시작해 주세요.');
      router.replace('/');
      return;
    }

    const p0 = vote.placeCandidates[0];
    const d0 = vote.dateCandidates[0];
    const primaryPlaceName = p0.placeName.trim();
    const primaryAddress = p0.address.trim();
    const primaryLat = p0.latitude;
    const primaryLng = p0.longitude;
    const primary = primaryScheduleFromDateCandidate(d0);
    const primaryDate = primary.scheduleDate.trim();
    const primaryTime = primary.scheduleTime.trim();

    setBusy(true);
    try {
      await addMeeting({
        title: title.trim(),
        location: primaryPlaceName,
        placeName: primaryPlaceName,
        address: primaryAddress,
        latitude: primaryLat,
        longitude: primaryLng,
        description: description.trim(),
        capacity: cap,
        createdBy: phoneUserId.trim(),
        categoryId: selectedCategoryId,
        categoryLabel: selectedCategory.label,
        isPublic,
        scheduleDate: primaryDate,
        scheduleTime: primaryTime,
        placeCandidates: vote.placeCandidates,
        dateCandidates: vote.dateCandidates,
      });
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '저장에 실패했습니다.';
      setError(msg);
      Alert.alert('등록 실패', msg);
    } finally {
      setBusy(false);
    }
  }, [capacityText, description, isPublic, phoneUserId, router, selectedCategory, selectedCategoryId, title]);

  return (
    <View style={GinitStyles.screenRoot}>
      <LinearGradient colors={['#DCEEFF', '#EEF6FF', '#FFF4ED']} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
      {Platform.OS === 'web' ? (
        <View style={[StyleSheet.absoluteFill, GinitStyles.webVeil]} />
      ) : (
        <>
          <BlurView
            pointerEvents="none"
            intensity={GinitTheme.glassModal.blurIntensity}
            tint="light"
            style={StyleSheet.absoluteFill}
          />
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, GinitStyles.frostVeil]} />
        </>
      )}
      <KeyboardAvoidingView
        style={GinitStyles.flexFill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
        <SafeAreaView style={GinitStyles.safeAreaPlain} edges={['top', 'bottom']}>
          <View style={GinitStyles.topBarRowPadded}>
            <Pressable onPress={goBackTop} accessibilityRole="button" hitSlop={12}>
              <Text style={GinitStyles.backLink}>{step === 2 ? '← 이전' : '← 닫기'}</Text>
            </Pressable>
            <Text style={GinitStyles.screenTitle}>{step === 1 ? '모임 만들기' : '상세 입력'}</Text>
            <Text style={GinitStyles.stepBadge}>{step}/2</Text>
          </View>

          <ScrollView
            contentContainerStyle={GinitStyles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {step === 1 ? (
              <>
                <Text style={GinitStyles.heroTitle}>어떤 모임인가요?</Text>
                <Text style={GinitStyles.sectionLabel}>AI 빠른 템플릿</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={GinitStyles.templateRow}>
                  {AI_TEMPLATES.map((t) => (
                    <Pressable
                      key={t.title}
                      onPress={() => onTemplatePress(t.keywords)}
                      style={GinitStyles.glassChip}
                      accessibilityRole="button">
                      <Text style={GinitStyles.glassChipText}>{t.title}</Text>
                    </Pressable>
                  ))}
                </ScrollView>

                {catLoading ? (
                  <View style={GinitStyles.centerRow}>
                    <ActivityIndicator />
                    <Text style={GinitStyles.mutedBlock}>카테고리 불러오는 중…</Text>
                  </View>
                ) : null}

                {catError ? (
                  <View style={GinitStyles.warnBox}>
                    <Text style={GinitStyles.warnTitle}>카테고리를 불러오지 못했어요</Text>
                    <Text style={GinitStyles.warnBody}>{catError}</Text>
                  </View>
                ) : null}

                {!catLoading && !catError && categories.length === 0 ? (
                  <Text style={GinitStyles.mutedBlock}>
                    Firestore에 `categories` 문서가 없습니다. 콘솔에서 label·emoji·order 필드로 추가해 주세요.
                  </Text>
                ) : null}

                <View style={GinitStyles.gridOuter}>
                  <View style={GinitStyles.gridWrap}>
                    {categories.map((c) => {
                      const active = c.id === selectedCategoryId;
                      return (
                        <Pressable
                          key={c.id}
                          onPress={() => setSelectedCategoryId(c.id)}
                          style={[GinitStyles.glassGridCard, active && GinitStyles.glassGridCardActive]}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}>
                          <Text style={GinitStyles.gridEmoji}>{c.emoji}</Text>
                          <Text style={GinitStyles.gridLabel}>{c.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <View style={GinitStyles.glassMascotFloat} pointerEvents="none">
                    <Text style={GinitStyles.mascotEmoji}>🤖</Text>
                  </View>
                </View>

                <Text style={[GinitStyles.sectionLabel, GinitStyles.privacyLabelSpacer]}>공개 / 비공개 모임</Text>
                <GinitCard style={GinitStyles.privacyCardSpacer}>
                  <View style={GinitStyles.glassSegment}>
                    <Pressable
                      onPress={() => setIsPublic(false)}
                      style={[GinitStyles.segmentSide, !isPublic && GinitStyles.segmentSideActivePrivate]}
                      accessibilityRole="button">
                      <Text style={[GinitStyles.segmentTitle, !isPublic && GinitStyles.segmentTitleOn]}>🔒 비공개</Text>
                      <Text style={GinitStyles.segmentSub}>(초대만 가능)</Text>
                    </Pressable>
                    <View style={GinitStyles.segmentKnobWrap} pointerEvents="none">
                      <View style={[GinitStyles.segmentKnob, { left: isPublic ? '58%' : '12%' }]} />
                    </View>
                    <Pressable
                      onPress={() => setIsPublic(true)}
                      style={[GinitStyles.segmentSide, isPublic && GinitStyles.segmentSideActivePublic]}
                      accessibilityRole="button">
                      <Text style={[GinitStyles.segmentTitle, isPublic && GinitStyles.segmentTitleOn]}>🌐 공개</Text>
                      <Text style={GinitStyles.segmentSub}>(지역 내 검색 허용)</Text>
                    </Pressable>
                  </View>
                </GinitCard>

                {error ? <Text style={GinitStyles.formErrorText}>{error}</Text> : null}

                <OrangeAction title="다음: 상세 입력" onPress={goNext} disabled={!selectedCategoryId || categories.length === 0} />
              </>
            ) : (
              <>
                <Text style={GinitStyles.step2Title}>
                  {(selectedCategory?.emoji ? `${selectedCategory.emoji} ` : '')}
                  {selectedCategory?.label ?? ''} 모임 생성
                </Text>

                <GinitCard appearance="light" style={[GinitStyles.fixedGlassCard, GinitStyles.cardSpacer]}>
                  <Text style={GinitStyles.fieldLabel}>모임 이름</Text>
                  <TextInput
                    value={title}
                    onChangeText={setTitle}
                    placeholder="예: 오후 3시, 당 떨어지는 시간! 커피 타임 ☕️"
                    placeholderTextColor={GinitPlaceholderColor}
                    style={[
                      GinitStyles.glassInput,
                      GinitStyles.detailFormText,
                      focusedStep2Field === 'title' && GinitStyles.glassInputFocused,
                    ]}
                    editable={!busy}
                    onFocus={() => setFocusedStep2Field('title')}
                    onBlur={() => setFocusedStep2Field(null)}
                  />

                  {!title.trim() && aiTitleSuggestion ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`AI 추천 모임 이름: ${aiTitleSuggestion}`}
                      onPress={() => setTitle(aiTitleSuggestion)}
                      style={({ pressed }) => [titleSuggestStyles.chip, pressed && titleSuggestStyles.chipPressed]}>
                      <Text style={titleSuggestStyles.chipText} numberOfLines={2}>
                        ✨ AI 추천: 「{aiTitleSuggestion}」
                      </Text>
                    </Pressable>
                  ) : null}

                  <Text style={[GinitStyles.fieldLabel, GinitStyles.fieldLabelSpaced]}>일시·장소 후보</Text>
                  <Text style={GinitStyles.hintSmall}>
                    + 버튼으로 후보 카드를 추가하세요. 장소 행을 누르면 장소 선택 화면으로 이동합니다. 「모임 등록」 시 아래 후보가 함께 저장됩니다.
                  </Text>
                  <VoteCandidatesForm
                    ref={voteFormRef}
                    key={voteHydrateKey}
                    embedded
                    seedPlaceQuery={placeName}
                    seedScheduleDate={scheduleDate}
                    seedScheduleTime={scheduleTime}
                    initialPayload={votePayload}
                  />

                  <Text style={[GinitStyles.fieldLabel, GinitStyles.fieldLabelSpaced]}>인원수 (최대)</Text>
                  <TextInput
                    value={capacityText}
                    onChangeText={setCapacityText}
                    placeholder="4"
                    placeholderTextColor={GinitPlaceholderColor}
                    style={[
                      GinitStyles.glassInput,
                      GinitStyles.detailFormText,
                      focusedStep2Field === 'cap' && GinitStyles.glassInputFocused,
                    ]}
                    keyboardType="number-pad"
                    editable={!busy}
                    onFocus={() => setFocusedStep2Field('cap')}
                    onBlur={() => setFocusedStep2Field(null)}
                  />

                  <Text style={[GinitStyles.fieldLabel, GinitStyles.fieldLabelSpaced]}>설명</Text>
                  <TextInput
                    value={description}
                    onChangeText={setDescription}
                    placeholder="모임 소개, 진행 방식, 준비물 등"
                    placeholderTextColor={GinitPlaceholderColor}
                    style={[
                      GinitStyles.glassInput,
                      GinitStyles.glassInputMultiline,
                      GinitStyles.detailFormText,
                      focusedStep2Field === 'desc' && GinitStyles.glassInputFocused,
                    ]}
                    multiline
                    textAlignVertical="top"
                    editable={!busy}
                    onFocus={() => setFocusedStep2Field('desc')}
                    onBlur={() => setFocusedStep2Field(null)}
                  />

                  <View style={GinitStyles.glassSummary}>
                    <Text style={GinitStyles.summaryLine}>
                      카테고리: {selectedCategory?.emoji} {selectedCategory?.label}
                    </Text>
                    <Text style={GinitStyles.summaryLine}>{isPublic ? '🌐 공개 모임' : '🔒 비공개 모임'}</Text>
                  </View>

                  {error ? <Text style={GinitStyles.formErrorText}>{error}</Text> : null}

                  <OrangeAction title={busy ? '등록 중...' : '모임 등록'} onPress={onSubmit} disabled={busy} />
                  {busy ? <ActivityIndicator style={GinitStyles.spinner} /> : null}

                  <GinitButton
                    title="취소하고 이전 단계"
                    variant="ghost"
                    textStyle={GinitStyles.detailFormText}
                    onPress={() => setStep(1)}
                    disabled={busy}
                  />
                </GinitCard>
              </>
            )}
          </ScrollView>

        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}

const titleSuggestStyles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    marginTop: 10,
    marginBottom: 2,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(0, 82, 204, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(0, 82, 204, 0.42)',
    shadowColor: TRUST_BLUE,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 4,
  },
  chipPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.99 }],
  },
  chipText: {
    fontSize: 13,
    fontWeight: '800',
    color: TRUST_BLUE,
    letterSpacing: -0.2,
    maxWidth: '100%',
  },
});
