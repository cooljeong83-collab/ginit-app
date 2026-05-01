import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';

import { GINIT_SYMBOLIC_ICON_MAP, type SymbolicIconName } from '@/src/lib/ginit-symbolic-icon-map';

export type { SymbolicIconName };

type MciName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export function GinitSymbolicIcon({
  name,
  ...rest
}: { name: SymbolicIconName } & Omit<ComponentProps<typeof MaterialCommunityIcons>, 'name'>) {
  const glyph = GINIT_SYMBOLIC_ICON_MAP[name] as MciName;
  return <MaterialCommunityIcons name={glyph} {...rest} />;
}
