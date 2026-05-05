import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';
import {
  resolveKakaoPlacePageWebUrl,
  resolveNaverPlaceDetailWebUrlLikeVoteChip,
  resolveNaverPlacePageUrlFromLinkField,
} from '@/src/lib/naver-local-search';

export type PlaceCandidateDetailLinkRowProps = {
  title: string;
  link?: string | null | undefined;
  addressLine?: string | null | undefined;
  disabled?: boolean;
  onOpenUrl: (url: string, title: string) => void;
  containerStyle?: StyleProp<ViewStyle>;
};

/** 모임 생성·상세 장소 검색 행 하단 — 카카오맵 장소 / 상세 정보(`link`의 m.place·ader `fu=` 우선·없으면 통합검색) */
export function PlaceCandidateDetailLinkRow({
  title,
  link,
  addressLine,
  disabled = false,
  onOpenUrl,
  containerStyle,
}: PlaceCandidateDetailLinkRowProps) {
  const kakaoUrl = resolveKakaoPlacePageWebUrl(link);
  const line = typeof addressLine === 'string' && addressLine.trim() ? addressLine.trim() : undefined;
  const detailUrl =
    resolveNaverPlacePageUrlFromLinkField(link) ??
    resolveNaverPlaceDetailWebUrlLikeVoteChip({
      naverPlaceLink: undefined,
      title,
      addressLine: line,
    });
  const pageTitle = title.trim() || '장소';
  if (!kakaoUrl && !detailUrl) return null;

  return (
    <View style={[styles.row, containerStyle]}>
      {kakaoUrl ? (
        <Pressable
          onPress={() => onOpenUrl(kakaoUrl, pageTitle)}
          disabled={disabled}
          style={({ pressed }) => [styles.btn, pressed && !disabled && { opacity: 0.88 }]}
          accessibilityRole="button"
          accessibilityLabel="카카오맵에서 장소 보기">
          <Text style={styles.btnText}>카카오</Text>
        </Pressable>
      ) : null}
      {detailUrl ? (
        <Pressable
          onPress={() => onOpenUrl(detailUrl, pageTitle)}
          disabled={disabled}
          style={({ pressed }) => [styles.btn, pressed && !disabled && { opacity: 0.88 }]}
          accessibilityRole="button"
          accessibilityLabel="상세 정보 보기">
          <Text style={styles.btnText}>상세 정보</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    alignSelf: 'stretch',
    gap: 6,
  },
  btn: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: GinitTheme.radius.button,
    backgroundColor: GinitTheme.colors.deepPurple,
  },
  btnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
});
