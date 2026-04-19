import { useFocusEffect } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GinitCard } from '@/components/ginit';
import { GinitStyles } from '@/constants/GinitStyles';
import { GinitTheme } from '@/constants/ginit-theme';
import type { Category } from '@/src/lib/categories';
import { subscribeCategories } from '@/src/lib/categories';
import { consumePendingMeetingPlace } from '@/src/lib/meeting-place-bridge';

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
  const [categories, setCategories] = useState<Category[]>([]);
  const [catLoading, setCatLoading] = useState(true);
  const [catError, setCatError] = useState<string | null>(null);

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState(true);

  const [placeName, setPlaceName] = useState('');

  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      const p = consumePendingMeetingPlace();
      if (p) {
        setPlaceName(p.placeName);
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
    router.push({
      pathname: '/create/details',
      params: {
        categoryId: selectedCategoryId,
        categoryLabel: selectedCategory.label,
        isPublic: isPublic ? '1' : '0',
        initialQuery: placeName.trim(),
        scheduleDate: fmtDate(new Date()),
        scheduleTime: '15:00',
      },
    });
  }, [isPublic, placeName, router, selectedCategory, selectedCategoryId]);

  const goBackTop = useCallback(() => {
    router.back();
  }, [router]);

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
              <Text style={GinitStyles.backLink}>← 닫기</Text>
            </Pressable>
            <Text style={GinitStyles.screenTitle}>모임 만들기</Text>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView
            contentContainerStyle={GinitStyles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
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

                <OrangeAction title="다음: 모임 정보 입력" onPress={goNext} disabled={!selectedCategoryId || categories.length === 0} />
          </ScrollView>

        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}
