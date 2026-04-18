import React from 'react';
import { ImageBackground, StyleSheet, Text, View } from 'react-native';

export default function App() {
  return (
    <ImageBackground 
      source={{ uri: 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4' }} 
      style={styles.container}
    >
      <View style={styles.glassCard}>
        <Text style={styles.title}>Ginit (지닛) 🚀</Text>
        <Text style={styles.subtitle}>입구 파일 재건축 완료!</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>이제 로그인을 구현해볼까요?</Text>
        </View>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  glassCard: {
    padding: 30,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    alignItems: 'center',
    // 웹 브라우저용 블러 효과
    backdropFilter: 'blur(10px)',
  },
  title: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: 10 },
  subtitle: { fontSize: 16, color: '#eee', marginBottom: 20 },
  badge: { backgroundColor: '#0052CC', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 20 },
  badgeText: { color: '#fff', fontWeight: '600' }
});