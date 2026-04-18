import { StyleSheet, Text, View } from 'react-native';

import { GinitCard } from '@/components/ginit';

export default function ChatTab() {
  return (
    <View style={styles.root}>
      <GinitCard>
        <Text style={styles.title}>채팅</Text>
        <Text style={styles.body}>대화 목록은 곧 연결됩니다.</Text>
      </GinitCard>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    padding: 24,
    paddingTop: 56,
    backgroundColor: '#F1F5F9',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 8,
  },
  body: {
    fontSize: 15,
    color: '#64748b',
  },
});
