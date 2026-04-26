import { useCallback, useMemo, useState } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SocialDiscovery, type DiscoveryCardProfile } from '@/components/social/SocialDiscovery';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { notifyFriendRequestReceivedFireAndForget } from '@/src/lib/friend-push-notify';
import { sendGinitRequest } from '@/src/lib/friends';

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
  const { userId } = useUserSession();
  const [deck, setDeck] = useState(DEMO);

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

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <SocialDiscovery profiles={profiles} onAccept={onAccept} onPass={onPass} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: GinitTheme.colors.bg },
});
