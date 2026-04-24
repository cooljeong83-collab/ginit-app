import { ScreenShell } from '@/components/ui';
import { HomeGlassStyles } from '@/constants/home-glass-styles';
import { GinitTheme } from '@/constants/ginit-theme';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

export default function FriendsTab() {
  return (
    <ScreenShell padded={false} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={[HomeGlassStyles.scrollPad, styles.scrollBottom]} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>친구</Text>
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>친구(1:1) 기능은 다음 단계에서 연결됩니다.</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  safe: { flex: 1 },
  scrollBottom: { paddingTop: 8, paddingBottom: 32 },
  title: {
    fontSize: 22,
    fontWeight: '900',
    color: GinitTheme.colors.text,
    marginBottom: 16,
    letterSpacing: -0.4,
  },
  placeholder: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    padding: 16,
  },
  placeholderText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748b',
    lineHeight: 20,
  },
});

