import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, BackHandler, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, ToastAndroid, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GinitButton, GinitCard } from '@/components/ginit';
import { ScreenShell } from '@/components/ui';
import { HomeGlassStyles } from '@/constants/home-glass-styles';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { normalizeUserId } from '@/src/lib/app-user-id';
import { deleteFirebaseAuthUserBestEffort, purgeUserAccountRemote, purgeUserAccountRemoteByFirebaseUid, wipeLocalAppData } from '@/src/lib/account-deletion';
import { ensureUserProfile, updateUserProfile } from '@/src/lib/user-profile';
import { uploadProfilePhoto } from '@/src/lib/profile-photo';

export default function ProfileEditScreen() {
  const router = useRouter();
  const { userId, authProfile, signOutSession } = useUserSession();
  const profilePk = useMemo(() => {
    const u = userId?.trim();
    if (u) return u;
    const em = authProfile?.email?.trim();
    if (em) return normalizeUserId(em) ?? '';
    return '';
  }, [userId, authProfile?.email]);

  const [profileBusy, setProfileBusy] = useState(false);
  const [photoUploadBusy, setPhotoUploadBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [nickname, setNickname] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!profilePk) return;
      try {
        const p = await ensureUserProfile(profilePk);
        if (!alive) return;
        setNickname(p.nickname);
        setPhotoUrl(p.photoUrl ?? '');
      } catch {
        if (!alive) return;
        setNickname('');
        setPhotoUrl('');
      }
    })();
    return () => {
      alive = false;
    };
  }, [profilePk]);

  const onPickAndUploadPhoto = useCallback(async () => {
    if (!profilePk) {
      Alert.alert('안내', '로그인 후 업로드할 수 있어요.');
      return;
    }
    setPhotoUploadBusy(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('권한 필요', '사진을 선택하려면 사진 보관함 권한이 필요합니다.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      const uri = asset?.uri?.trim() ?? '';
      if (!uri) throw new Error('이미지 정보를 가져오지 못했습니다.');

      const url = await uploadProfilePhoto({
        userId: profilePk,
        localImageUri: uri,
        naturalWidth: asset?.width,
      });
      setPhotoUrl(url);
      await updateUserProfile(profilePk, { photoUrl: url });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('업로드 완료', '프로필 사진을 업데이트했어요.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '업로드에 실패했습니다.';
      Alert.alert('업로드 실패', msg);
    } finally {
      setPhotoUploadBusy(false);
    }
  }, [profilePk]);

  const onSaveProfile = useCallback(async () => {
    if (!profilePk) {
      Alert.alert('안내', '로그인 후 프로필을 저장할 수 있어요.');
      return;
    }
    setProfileBusy(true);
    try {
      await ensureUserProfile(profilePk);
      await updateUserProfile(profilePk, {
        nickname: nickname.trim(),
        photoUrl: photoUrl.trim() || null,
      });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('저장됨', '닉네임과 프로필 사진 설정을 반영했어요.');
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '저장에 실패했습니다.';
      Alert.alert('저장 실패', msg);
    } finally {
      setProfileBusy(false);
    }
  }, [profilePk, nickname, photoUrl, router]);

  const onSignOut = useCallback(async () => {
    setBusy(true);
    try {
      await signOutSession();
      router.replace('/login');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '알 수 없는 오류';
      Alert.alert('로그아웃 실패', msg);
    } finally {
      setBusy(false);
    }
  }, [router, signOutSession]);

  const runDeleteAccount = useCallback(async () => {
    const sessionUserId = userId?.trim() ?? '';
    const firebaseUid = authProfile?.firebaseUid?.trim() ?? '';
    if (!sessionUserId && !firebaseUid) {
      Alert.alert('안내', '로그인된 계정만 탈퇴할 수 있어요.');
      return;
    }
    setDeleteBusy(true);
    try {
      const res = sessionUserId ? await purgeUserAccountRemote(sessionUserId) : await purgeUserAccountRemoteByFirebaseUid(firebaseUid);
      if (!res.ok) {
        Alert.alert('탈퇴를 완료하지 못했어요', res.message);
        return;
      }
      await deleteFirebaseAuthUserBestEffort();
      await signOutSession();
      await wipeLocalAppData();
      const doneMsg = '탈퇴가 완료되었습니다. 그동안 지닛과 함께해주셔서 감사합니다.';
      if (Platform.OS === 'android') {
        ToastAndroid.show(doneMsg, ToastAndroid.LONG);
        setTimeout(() => BackHandler.exitApp(), 400);
        return;
      }
      Alert.alert('탈퇴 완료', doneMsg, [{ text: '확인', onPress: () => router.replace('/login') }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '알 수 없는 오류';
      Alert.alert('탈퇴 실패', msg);
    } finally {
      setDeleteBusy(false);
    }
  }, [userId, authProfile?.firebaseUid, router, signOutSession]);

  const onRequestDeleteAccount = useCallback(() => {
    const sessionUserId = userId?.trim() ?? '';
    const firebaseUid = authProfile?.firebaseUid?.trim() ?? '';
    if (!sessionUserId && !firebaseUid) {
      Alert.alert('안내', '로그인된 계정만 탈퇴할 수 있어요.');
      return;
    }
    Alert.alert(
      '회원 탈퇴',
      '탈퇴 시 이름·연락처·이메일·프로필 사진 등 개인 식별 정보는 서버에서 즉시 삭제(비식별화)됩니다.\n\n' +
        '• 채팅·투표·모임 참여 기록은 서비스 운영을 위해 익명 상태로 보관될 수 있습니다.\n' +
        '• 진행 중인 모임의 방장인 경우 탈퇴할 수 없습니다(모임 폐쇄 또는 방장 위임 후 가능).\n' +
        '• 이 기기에 저장된 로그인·캐시 등은 모두 지워집니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '다음',
          style: 'destructive',
          onPress: () => {
            Alert.alert('최종 확인', '정말 지닛에서 탈퇴할까요?', [
              { text: '아니오', style: 'cancel' },
              { text: '탈퇴하기', style: 'destructive', onPress: () => void runDeleteAccount() },
            ]);
          },
        },
      ],
    );
  }, [userId, authProfile?.firebaseUid, runDeleteAccount]);

  return (
    <ScreenShell padded={false} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={[HomeGlassStyles.scrollPad, styles.scrollBottom]} showsVerticalScrollIndicator={false}>
          <View style={styles.topRow}>
            <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]} accessibilityRole="button">
              <Text style={styles.backText}>←</Text>
            </Pressable>
            <Text style={styles.screenTitle}>프로필 편집</Text>
            <View style={{ width: 40 }} />
          </View>

          <GinitCard appearance="light" style={styles.card}>
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
              keyboardType="default"
              inputMode="text"
              editable={!profileBusy && !deleteBusy}
            />

            <Text style={styles.label}>프로필 사진 URL (선택)</Text>
            <Text style={styles.subHint}>HTTPS 이미지 주소를 넣으면 모임 참여자 목록에 표시돼요.</Text>
            <GinitButton
              title={photoUploadBusy ? '사진 업로드 중…' : '프로필 사진 업로드'}
              variant="secondary"
              onPress={() => void onPickAndUploadPhoto()}
              disabled={photoUploadBusy || profileBusy || deleteBusy || busy}
            />
            <TextInput
              value={photoUrl}
              onChangeText={setPhotoUrl}
              placeholder="https://…"
              placeholderTextColor="#94a3b8"
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              editable={!profileBusy && !deleteBusy}
            />

            {photoUrl.trim() ? (
              <View style={styles.previewWrap}>
                <Image source={{ uri: photoUrl.trim() }} style={styles.preview} contentFit="cover" />
              </View>
            ) : null}

            <GinitButton title={profileBusy ? '저장 중…' : '저장'} variant="primary" onPress={() => void onSaveProfile()} disabled={profileBusy} />
          </GinitCard>

          <GinitCard appearance="light" style={styles.card}>
            <GinitButton title="로그아웃" variant="secondary" onPress={onSignOut} disabled={busy || deleteBusy} />
            <Pressable
              onPress={onRequestDeleteAccount}
              disabled={deleteBusy || profileBusy}
              style={({ pressed }) => [styles.deleteAccountBtn, pressed && styles.deleteAccountBtnPressed]}
              accessibilityRole="button"
              accessibilityLabel="회원 탈퇴">
              <Text style={styles.deleteAccountLabel}>{deleteBusy ? '탈퇴 처리 중…' : '회원 탈퇴'}</Text>
            </Pressable>
          </GinitCard>
        </ScrollView>
      </SafeAreaView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  safe: { flex: 1 },
  scrollBottom: { paddingTop: 8, paddingBottom: 32 },
  pressed: { opacity: 0.88 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 20, fontWeight: '900', color: '#0f172a' },
  screenTitle: { fontSize: 20, fontWeight: '900', color: '#0f172a', letterSpacing: -0.4 },
  card: { borderColor: 'rgba(255, 255, 255, 0.55)', marginBottom: 14 },
  label: { fontSize: 12, fontWeight: '700', color: '#64748b', marginTop: 12, marginBottom: 4 },
  subHint: { fontSize: 12, color: '#94a3b8', marginBottom: 6 },
  input: {
    minHeight: 46,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    color: '#0f172a',
    fontWeight: '800',
  },
  previewWrap: {
    marginTop: 12,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.12)',
  },
  preview: { width: '100%', height: 160 },
  deleteAccountBtn: {
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.12)',
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
  },
  deleteAccountBtnPressed: { opacity: 0.88 },
  deleteAccountLabel: { fontSize: 14, fontWeight: '900', color: '#b91c1c' },
});

