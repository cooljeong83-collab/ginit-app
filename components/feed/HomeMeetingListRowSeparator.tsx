import { StyleSheet, View } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';

/** 홈·탐색 모임 목록 `index.tsx` `homeMeetingListSeparator`와 동일 */
export const homeMeetingListRowSeparatorStyle = StyleSheet.create({
  root: {
    alignSelf: 'stretch',
    height: StyleSheet.hairlineWidth,
    backgroundColor: GinitTheme.colors.border,
  },
});

export function HomeMeetingListRowSeparator() {
  return <View style={homeMeetingListRowSeparatorStyle.root} />;
}
