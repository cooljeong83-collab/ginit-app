import { useRouter } from 'expo-router';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { GinitButton, GinitCard } from '@/components/ginit';
import { useUserSession } from '@/src/context/UserSessionContext';
import { getFirebaseAuth } from '@/src/lib/firebase';

export default function ProfileTab() {
  const router = useRouter();
  const { phoneUserId, signOutSession } = useUserSession();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const auth = getFirebaseAuth();
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

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
        <Text style={styles.title}>프로필</Text>
        <Text style={styles.label}>회원 ID (전화번호)</Text>
        <Text style={styles.phone}>{phoneUserId ?? '(없음)'}</Text>
        <Text style={styles.label}>Firebase</Text>
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
    marginBottom: 12,
    color: '#0f172a',
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    marginTop: 8,
    marginBottom: 4,
  },
  phone: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 4,
  },
  line: {
    fontSize: 15,
    color: '#334155',
    marginBottom: 8,
  },
});
