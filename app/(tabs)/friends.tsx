import { FriendsHomeScreen } from '@/components/social/FriendsHomeScreen';
import { StyleSheet, View } from 'react-native';

export default function FriendsTab() {
  return (
    <View style={styles.root}>
      <FriendsHomeScreen />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});

