import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SocialDiscovery, type DiscoveryCardProfile } from '@/components/social/SocialDiscovery';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { notifyFriendRequestReceivedFireAndForget } from '@/src/lib/friend-push-notify';
import { sendGinitRequest } from '@/src/lib/friends';
import { friendsAllowRecommendationsStorageKey, loadFriendBoolPref } from '@/src/lib/friends-privacy-local';

const DEMO: DiscoveryCardProfile[] = [
  {
    userId: 'demo-peer-1',
    displayName: '민지',
    ageLabel: '28',
    gLevel: 12,
    gTrust: 92,
    gDna: 'Socializer',
    photoUrl: null,
  },
  {
    userId: 'demo-peer-2',
    displayName: '준호',
    ageLabel: '31',
    gLevel: 9,
    gTrust: 78,
    gDna: 'Explorer',
    photoUrl: null,
  },
];

export default function SocialDiscoveryScreen() {
  const router = useRouter();
  const { userId } = useUserSession();
  const me = useMemo(() => (userId?.trim() ? normalizeParticipantId(userId.trim()) : ''), [userId]);
  const [deck, setDeck] = useState(DEMO);
  const [recOn, setRecOn] = useState(true);
  const [recLoaded, setRecLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!me) {
        setRecLoaded(true);
        return;
      }
      let alive = true;
      void loadFriendBoolPref(me, friendsAllowRecommendationsStorageKey, true).then((v) => {
        if (!alive) return;
        setRecOn(v);
        setRecLoaded(true);
      });
      return () => {
        alive = false;
      };
    }, [me]),
  );

  const onAccept = useCallback(
    async (peerId: string) => {
      const me = userId?.trim();
      if (!me) {
        Alert.alert('안내', '로그인 후 지닛을 보낼 수 있어요.');
        return;
      }
      try {
        await sendGinitRequest(me, peerId);
        const card = deck.find((x) => x.userId === peerId);
        notifyFriendRequestReceivedFireAndForget({
          addresseeAppUserId: peerId,
          requesterAppUserId: me,
          requesterDisplayName: card?.displayName,
        });
        Alert.alert('지닛 전송', '상대에게 친구 요청을 보냈어요.');
      } catch (e) {
        Alert.alert('오류', e instanceof Error ? e.message : String(e));
      }
      setDeck((d) => d.filter((x) => x.userId !== peerId));
    },
    [userId, deck],
  );

  const onPass = useCallback((peerId: string) => {
    setDeck((d) => d.filter((x) => x.userId !== peerId));
  }, []);

  const profiles = useMemo(() => deck, [deck]);

  if (!recLoaded) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <ActivityIndicator color={GinitTheme.colors.primary} />
      </SafeAreaView>
    );
  }

  if (me && !recOn) {
    return (
      <SafeAreaView style={styles.offWrap} edges={['bottom']}>
        <Text style={styles.offTitle}>친구 추천이 꺼져 있어요</Text>
        <Text style={styles.offBody}>친구 관리에서 「친구 추천 허용」을 켜면 이 화면의 추천을 다시 볼 수 있어요.</Text>
        <Pressable
          onPress={() => router.push('/social/friends-settings')}
          style={({ pressed }) => [styles.offBtn, pressed && { opacity: 0.88 }]}
          accessibilityRole="button"
          accessibilityLabel="친구 관리 열기">
          <Text style={styles.offBtnTxt}>친구 관리</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <SocialDiscovery profiles={profiles} onAccept={onAccept} onPass={onPass} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  center: { flex: 1, backgroundColor: GinitTheme.colors.bg, alignItems: 'center', justifyContent: 'center' },
  offWrap: { flex: 1, backgroundColor: GinitTheme.colors.bg, paddingHorizontal: 24, paddingTop: 32, gap: 12 },
  offTitle: { fontSize: 18, fontWeight: '600', color: GinitTheme.colors.text, letterSpacing: -0.3 },
  offBody: { fontSize: 14, fontWeight: '600', color: GinitTheme.colors.textMuted, lineHeight: 21 },
  offBtn: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    backgroundColor: GinitTheme.colors.surfaceStrong,
  },
  offBtnTxt: { fontSize: 15, fontWeight: '600', color: GinitTheme.colors.text },
});
