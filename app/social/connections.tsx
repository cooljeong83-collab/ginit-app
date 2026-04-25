import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { FollowManager } from '@/components/social/FollowManager';
import { useUserSession } from '@/src/context/UserSessionContext';

export default function SocialConnectionsScreen() {
  const router = useRouter();
  const { userId } = useUserSession();

  return (
    <View style={styles.root}>
      <FollowManager userId={userId ?? ''} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 8 },
});
