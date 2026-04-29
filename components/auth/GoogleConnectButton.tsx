import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

/** Google Sign-In 라이트 테마 버튼 톤(흰 배경·테두리·가독성 있는 라벨) */
const BORDER = '#dadce0';
const LABEL = '#3c4043';
const DISABLED = 'rgba(60, 64, 67, 0.38)';

export type GoogleConnectButtonProps = {
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** 기본: Google 계정으로 연동하기 */
  label?: string;
};

/**
 * Google 브랜드 가이드라인에 가깝게: 흰 배경, 1px 테두리, 그림자, G 마크 + 라벨.
 * (멀티컬러 G는 벡터 세트 제약으로 단색 로고 — 벡터 폰트 번들 손상 시 Ionicons 사용)
 */
export function GoogleConnectButton({
  onPress,
  disabled,
  loading,
  label = 'Google 계정으로 연동하기',
}: GoogleConnectButtonProps) {
  const inactive = !!disabled || !!loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.wrap,
        inactive && styles.wrapDisabled,
        pressed && !inactive && styles.wrapPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: !!loading, disabled: inactive }}>
      <View style={styles.inner}>
        {loading ? (
          <ActivityIndicator size="small" color="#5f6368" style={styles.spinner} />
        ) : (
          <Ionicons name="logo-google" size={20} color="#4285F4" style={styles.icon} />
        )}
        <Text style={[styles.label, inactive && styles.labelDisabled]} numberOfLines={2}>
          {loading ? '연결 중…' : label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'stretch',
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: 'rgba(60, 64, 67, 0.3)',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 3,
    elevation: 2,
  },
  wrapDisabled: {
    opacity: 0.55,
    shadowOpacity: 0,
    elevation: 0,
  },
  wrapPressed: {
    backgroundColor: '#f8f9fa',
  },
  inner: {
    flex: 1,
    minHeight: 52,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  icon: { marginTop: 1 },
  spinner: { marginVertical: 2 },
  label: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '700',
    color: LABEL,
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  labelDisabled: {
    color: DISABLED,
  },
});
