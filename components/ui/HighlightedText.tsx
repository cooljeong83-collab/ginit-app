import { useMemo } from 'react';
import { Text, type TextProps } from 'react-native';

type Props = TextProps & {
  text: string;
  query: string;
  /** 배경 없을 때 일치 구간 글자색 (기본 딥퍼플) */
  highlightColor?: string;
  /** 설정 시 일치 구간에 배경색(말풍선 등에서 딥퍼플 칩 스타일) */
  highlightBackgroundColor?: string;
  /** 배경 모드일 때 일치 구간 글자색 (기본 흰색) */
  highlightTextColor?: string;
};

export function HighlightedText({
  text,
  query,
  highlightColor = '#4527A0',
  highlightBackgroundColor,
  highlightTextColor = '#FFFFFF',
  style,
  ...rest
}: Props) {
  const parts = useMemo(() => {
    const q = String(query ?? '').trim();
    const t = String(text ?? '');
    if (!q) return [{ s: t, hit: false }];

    const lower = t.toLowerCase();
    const needle = q.toLowerCase();
    const out: Array<{ s: string; hit: boolean }> = [];

    let i = 0;
    while (i < t.length) {
      const idx = lower.indexOf(needle, i);
      if (idx < 0) {
        out.push({ s: t.slice(i), hit: false });
        break;
      }
      if (idx > i) out.push({ s: t.slice(i, idx), hit: false });
      out.push({ s: t.slice(idx, idx + needle.length), hit: true });
      i = idx + needle.length;
    }
    return out.length ? out : [{ s: t, hit: false }];
  }, [text, query]);

  return (
    <Text style={style} {...rest}>
      {parts.map((p, idx) =>
        p.hit ? (
          <Text
            key={idx}
            style={
              highlightBackgroundColor
                ? {
                    backgroundColor: highlightBackgroundColor,
                    color: highlightTextColor,
                    fontWeight: '700',
                    paddingHorizontal: 3,
                    paddingVertical: 1,
                    borderRadius: 4,
                    overflow: 'hidden',
                  }
                : { color: highlightColor, fontWeight: '800' }
            }>
            {p.s}
          </Text>
        ) : (
          <Text key={idx}>{p.s}</Text>
        ),
      )}
    </Text>
  );
}

