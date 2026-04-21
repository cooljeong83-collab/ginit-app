import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  ToastAndroid,
  View,
} from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';

const RIPPLE = 'rgba(15, 23, 42, 0.08)';
const LABEL = '#000000';
const ICON_SIZE = 20;
const GOOGLE_BLUE = '#4285F4';
const KAKAO_YELLOW = '#FEE500';
const KAKAO_INK = '#191919';
const NAVER_GREEN = '#03C75A';

/** 로고+텍스트 한 덩어리의 고정 가로폭 (dp, 좁은 부모에서는 onLayout으로 축소) */
const INNER_BAND_MAX = 220;
const INNER_BAND_MIN = 160;
const ICON_SLOT = 40;
const ICON_TEXT_GAP = 12;
/** 항목 사이 세로 간격 (요청 12dp) */
const ROW_VERTICAL_GAP = 12;

function toastServicePrepare(): void {
  const msg = '서비스 준비 중입니다';
  if (Platform.OS === 'android') {
    ToastAndroid.show(msg, ToastAndroid.SHORT);
  } else {
    Alert.alert('안내', msg);
  }
}

type RowProps = {
  innerBandWidth: number;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon: ReactNode;
  accessibilityLabel: string;
};

function SnsTextLinkRow({ innerBandWidth, label, onPress, disabled, loading, icon, accessibilityLabel }: RowProps) {
  const inactive = !!disabled || !!loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      android_ripple={{ color: RIPPLE, borderless: false }}
      style={({ pressed }) => [
        rowStyles.hit,
        inactive && rowStyles.hitDisabled,
        Platform.OS === 'ios' && pressed && !inactive && rowStyles.hitPressedIos,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: !!loading, disabled: inactive }}>
      <View style={[rowStyles.innerBand, { width: innerBandWidth }]}>
        <View style={rowStyles.iconSlot}>
          {loading ? <ActivityIndicator size="small" color={GOOGLE_BLUE} /> : icon}
        </View>
        <Text style={rowStyles.label} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

export type SnsEasySignUpSectionProps = {
  onGooglePress: () => void;
  googleDisabled: boolean;
  googleLoading: boolean;
};

/**
 * 로그인·회원가입 공통 — SNS 간편 연동(텍스트 링크 스타일, 배경·테두리 없음).
 * Google은 실제 플로우, 카카오·네이버는 토스트만(추후 연동).
 */
export function SnsEasySignUpSection({ onGooglePress, googleDisabled, googleLoading }: SnsEasySignUpSectionProps) {
  const [innerBandWidth, setInnerBandWidth] = useState(INNER_BAND_MAX);

  const onSectionLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w < 1) return;
    const capped = Math.min(INNER_BAND_MAX, Math.max(INNER_BAND_MIN, w - GinitTheme.spacing.md * 2));
    setInnerBandWidth(capped);
  }, []);

  return (
    <View style={secStyles.section} onLayout={onSectionLayout}>
      <View style={secStyles.dividerRow}>
        <View style={secStyles.dividerLine} />
        <Text style={secStyles.dividerTitle}>SNS 간편 가입</Text>
        <View style={secStyles.dividerLine} />
      </View>

      <View style={secStyles.stack}>
        <SnsTextLinkRow
          innerBandWidth={innerBandWidth}
          label="Google로 시작하기"
          onPress={onGooglePress}
          disabled={googleDisabled}
          loading={googleLoading}
          accessibilityLabel="Google로 시작하기"
          icon={<FontAwesome5 name="google" size={ICON_SIZE} color={GOOGLE_BLUE} brand />}
        />
        <SnsTextLinkRow
          innerBandWidth={innerBandWidth}
          label="카카오톡으로 시작하기"
          onPress={toastServicePrepare}
          accessibilityLabel="카카오톡으로 시작하기"
          icon={
            <View style={secStyles.kakaoMark} accessibilityElementsHidden>
              <MaterialCommunityIcons name="chat" size={15} color={KAKAO_INK} />
            </View>
          }
        />
        <SnsTextLinkRow
          innerBandWidth={innerBandWidth}
          label="네이버로 시작하기"
          onPress={toastServicePrepare}
          accessibilityLabel="네이버로 시작하기"
          icon={
            <Text style={secStyles.naverLetter} accessibilityElementsHidden>
              N
            </Text>
          }
        />
      </View>
    </View>
  );
}

const secStyles = StyleSheet.create({
  /** authCard 내부: 카드 `padding`과 맞추기 위해 좌우 여백 없음 */
  section: {
    alignSelf: 'stretch',
    width: '100%',
    marginTop: GinitTheme.spacing.xl,
    paddingHorizontal: 0,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: GinitTheme.spacing.md,
    gap: GinitTheme.spacing.sm,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    minHeight: 1,
    backgroundColor: 'rgba(148, 163, 184, 0.55)',
  },
  dividerTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#94a3b8',
    letterSpacing: 0.4,
  },
  stack: {
    width: '100%',
    alignSelf: 'stretch',
    alignItems: 'stretch',
    gap: ROW_VERTICAL_GAP,
  },
  kakaoMark: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: KAKAO_YELLOW,
    alignItems: 'center',
    justifyContent: 'center',
  },
  naverLetter: {
    width: 24,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '900',
    color: NAVER_GREEN,
    letterSpacing: -0.5,
  },
});

const rowStyles = StyleSheet.create({
  /** match_parent: 전체 너비 터치 영역 */
  hit: {
    alignSelf: 'stretch',
    width: '100%',
    borderRadius: 10,
    overflow: 'hidden',
    paddingVertical: 14,
    paddingHorizontal: GinitTheme.spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  hitDisabled: {
    opacity: 0.45,
  },
  hitPressedIos: {
    opacity: 0.78,
  },
  /** 고정 폭 밴드 안에서 로고 왼쪽·텍스트 옆 고정 간격 */
  innerBand: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: ICON_TEXT_GAP,
  },
  iconSlot: {
    width: ICON_SLOT,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  label: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.2,
    textAlign: 'left',
  },
});
