import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { GinitButton, GinitCard } from '@/components/ginit';
import { useUserSession } from '@/src/context/UserSessionContext';
import { getFirebaseAuth } from '@/src/lib/firebase';
import { ensureUserProfile, updateUserProfile } from '@/src/lib/user-profile';

export default function ProfileTab() {
  const router = useRouter();
  const { phoneUserId, signOutSession } = useUserSession();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [nickname, setNickname] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');

  useEffect(() => {
    const auth = getFirebaseAuth();
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

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

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <GinitCard>
        <Text style={styles.title}>계정 · 프로필</Text>
        <Text style={styles.hint}>
          전화번호로 가입하면 닉네임이 자동으로 만들어져요. 아래에서 닉네임과 프로필 사진(이미지 주소)을 바꿀 수 있어요.
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

        <Text style={[styles.label, styles.divider]}>Firebase</Text>
        <Text style={styles.line}>이메일: {user?.email ?? '(없음)'}</Text>
        <Text style={styles.line}>UID: {user?.uid ?? ''}</Text>
        <Text style={styles.line}>익명: {user?.isAnonymous ? '예' : '아니오'}</Text>
        <GinitButton title="로그아웃" variant="secondary" onPress={onSignOut} disabled={busy} />
      </GinitCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  },
  scroll: {
    padding: 24,
    paddingTop: 56,
    backgroundColor: '#F1F5F9',
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
  divider: {
    marginTop: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
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
  line: {
    fontSize: 15,
    color: '#334155',
    marginBottom: 8,
  },
});
