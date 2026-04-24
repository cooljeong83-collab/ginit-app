import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { FriendManager } from '@/components/social/FriendManager';
import { useUserSession } from '@/src/context/UserSessionContext';
import { socialDmRoomId } from '@/src/lib/social-chat-rooms';

export default function SocialConnectionsScreen() {
  const router = useRouter();
  const { userId } = useUserSession();

  return (
    <View style={styles.root}>
      <FriendManager
        userId={userId ?? ''}
        onOpenChatWithPeer={(peerAppUserId, peerDisplayName) => {
          const me = userId?.trim();
          if (!me) return;
          const rid = socialDmRoomId(me, peerAppUserId);
          router.push(
            `/social-chat/${encodeURIComponent(rid)}?peerName=${encodeURIComponent(peerDisplayName ?? '친구')}`,
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 8 },
});
