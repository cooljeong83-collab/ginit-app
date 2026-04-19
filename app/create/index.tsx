import { useFocusEffect } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GinitStyles } from '@/constants/GinitStyles';
import { GinitTheme } from '@/constants/ginit-theme';
import { consumePendingMeetingPlace } from '@/src/lib/meeting-place-bridge';

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function OrangeAction({
  title,
  onPress,
}: {
  title: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        GinitStyles.ctaButtonWideShadow,
        pressed && GinitStyles.ctaButtonWidePressed,
      ]}>
      <Text style={GinitStyles.ctaButtonLabel}>{title}</Text>
    </Pressable>
  );
}

export default function CreateMeetingScreen() {
  const router = useRouter();
  const [placeName, setPlaceName] = useState('');

  useFocusEffect(
    useCallback(() => {
      const p = consumePendingMeetingPlace();
      if (p) {
        setPlaceName(p.placeName);
      }
    }, []),
  );

  const goDetails = useCallback(() => {
    router.push({
      pathname: '/create/details',
      params: {
        initialQuery: placeName.trim(),
        scheduleDate: fmtDate(new Date()),
        scheduleTime: '15:00',
      },
    });
  }, [placeName, router]);

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
            <Text style={GinitStyles.heroTitle}>한 화면에서 끝까지</Text>
            <Text style={GinitStyles.mutedBlock}>
              카테고리·일정·장소까지 지닛이 단계별로 안내해요. 아래에서 바로 시작할 수 있어요.
            </Text>
            <OrangeAction title="모임 만들기 시작" onPress={goDetails} />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}
