import { View, type ViewStyle, type StyleProp } from 'react-native';
import type { ReactNode } from 'react';

export function VoteCandidateListV<T>({
  items,
  style,
  renderItem,
  keyForItem,
}: {
  items: T[];
  style?: StyleProp<ViewStyle>;
  renderItem: (item: T, index: number) => ReactNode;
  keyForItem: (item: T, index: number) => string;
}) {
  return (
    <View style={style}>
      {items.map((item, i) => (
        <View key={keyForItem(item, i)}>{renderItem(item, i)}</View>
      ))}
    </View>
  );
}

