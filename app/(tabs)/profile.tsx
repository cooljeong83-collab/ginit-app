import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GinitButton, GinitCard } from '@/components/ginit';
import { ScreenShell } from '@/components/ui';
import { HomeGlassStyles } from '@/constants/home-glass-styles';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { ensureUserProfile, updateUserProfile } from '@/src/lib/user-profile';

export default function ProfileTab() {
  const router = useRouter();
  const { phoneUserId, signOutSession } = useUserSession();
  const [busy, setBusy] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [nickname, setNickname] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');

  useEffect(() => {
    if (!phoneUserId?.trim()) return;
    let cancelled = false;
    (async () => {
      try {
        const p = await ensureUserProfile(phoneUserId);
        if (cancelled) return;
        setNickname(p.nickname);
        setPhotoUrl(p.photoUrl ?? '');
      } catch {
        if (!cancelled) {
          setNickname('');
          setPhotoUrl('');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phoneUserId]);

  const onSaveProfile = useCallback(async () => {
    if (!phoneUserId?.trim()) {
      Alert.alert('안내', '로그인 후 프로필을 저장할 수 있어요.');
      return;
    }
    setProfileBusy(true);
    try {
      await ensureUserProfile(phoneUserId);
      await updateUserProfile(phoneUserId, {
        nickname: nickname.trim(),
        photoUrl: photoUrl.trim() || null,
      });
      Alert.alert('저장됨', '닉네임과 프로필 사진 설정을 반영했어요.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '저장에 실패했습니다.';
      Alert.alert('저장 실패', msg);
    } finally {
      setProfileBusy(false);
    }
  }, [phoneUserId, nickname, photoUrl]);

  const onSignOut = useCallback(async () => {
    setBusy(true);
    try {
      await signOutSession();
      router.replace('/');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '알 수 없는 오류';
      Alert.alert('로그아웃 실패', msg);
    } finally {
      setBusy(false);
    }
  }, [router, signOutSession]);

  return (
    <ScreenShell padded={false} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={[HomeGlassStyles.scrollPad, styles.scrollBottom]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <Text style={styles.screenTitle}>프로필</Text>

          <GinitCard appearance="light" style={styles.profileCard}>
            <Text style={styles.title}>계정 정보</Text>
            <Text style={styles.hint}>
              닉네임과 프로필 사진(이미지 주소)을 변경할 수 있어요. 전화번호로 가입 시 닉네임이 자동 생성될 수 있어요.
            </Text>

            <Text style={styles.label}>회원 ID (전화번호)</Text>
            <Text style={styles.phone}>{phoneUserId ?? '(없음)'}</Text>

            <Text style={styles.label}>닉네임</Text>
            <TextInput
              value={nickname}
              onChangeText={setNickname}
              placeholder="모임에서 보이는 이름"
              placeholderTextColor="#94a3b8"
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={24}
            />

            <Text style={styles.label}>프로필 사진 URL (선택)</Text>
            <Text style={styles.subHint}>HTTPS 이미지 주소를 넣으면 모임 참여자 목록에 표시돼요.</Text>
            <TextInput
              value={photoUrl}
              onChangeText={setPhotoUrl}
              placeholder="https://…"
              placeholderTextColor="#94a3b8"
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            {photoUrl.trim() ? (
              <View style={styles.previewWrap}>
                <Image source={{ uri: photoUrl.trim() }} style={styles.preview} contentFit="cover" />
              </View>
            ) : null}

            <GinitButton title="프로필 저장" variant="primary" onPress={() => void onSaveProfile()} disabled={profileBusy} />
            <GinitButton title="로그아웃" variant="secondary" onPress={onSignOut} disabled={busy} />
          </GinitCard>

          <GinitButton
            title="히스토리"
            variant="secondary"
            onPress={() => router.push('/profile/meeting-history')}
            style={styles.historyBtn}
          />
          <Text style={styles.historyHint}>참가했던 모임(참여 중인 모임)을 모아서 확인해요.</Text>
        </ScrollView>
      </SafeAreaView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  safe: {
    flex: 1,
  },
  scrollBottom: {
    paddingTop: 8,
    paddingBottom: 32,
  },
  screenTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: GinitTheme.colors.text,
    marginBottom: 16,
    letterSpacing: -0.4,
    textShadowColor: 'rgba(255, 255, 255, 0.7)',
    textShadowOffset: { width: 0, height: 0.5 },
    textShadowRadius: 2,
  },
  profileCard: {
    marginTop: 0,
    borderColor: 'rgba(255, 255, 255, 0.55)',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    color: '#0f172a',
  },
  hint: {
    fontSize: 14,
    color: '#64748b',
    lineHeight: 20,
    marginBottom: 16,
  },
  subHint: {
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    marginTop: 12,
    marginBottom: 4,
  },
  phone: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#0f172a',
    backgroundColor: '#fff',
  },
  previewWrap: {
    marginTop: 10,
    alignSelf: 'center',
    borderRadius: 40,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#e2e8f0',
  },
  preview: {
    width: 80,
    height: 80,
  },
  historyBtn: {
    marginTop: 20,
  },
  historyHint: {
    marginTop: 8,
    fontSize: 13,
    color: '#64748b',
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
});
