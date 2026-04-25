import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const DEFAULT_MS = 2000;

type EmitFn = (message: string, durationMs: number) => void;

let emit: EmitFn | undefined;

/**
 * 루트에 `<TransientBottomMessageHost />`가 마운트된 경우에만 동작합니다.
 * 일정 겹침 안내 등 짧은 하단 메시지(기본 2초 후 자동 제거).
 */
export function showTransientBottomMessage(message: string, durationMs: number = DEFAULT_MS) {
  const trimmed = message.trim();
  if (!trimmed) return;
  emit?.(trimmed, Math.max(800, Math.min(8000, durationMs)));
}

export function TransientBottomMessageHost() {
  const [text, setText] = useState<string | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();

  const scheduleClear = useCallback((ms: number) => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => {
      setText(null);
      clearTimer.current = null;
    }, ms);
  }, []);

  useEffect(() => {
    const handler: EmitFn = (message, ms) => {
      setText(message);
      scheduleClear(ms);
    };
    emit = handler;
    return () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
      clearTimer.current = null;
      emit = undefined;
    };
  }, [scheduleClear]);

  if (!text) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View
        pointerEvents="none"
        style={[
          styles.banner,
          {
            bottom: Math.max(16, insets.bottom + 8),
            left: 16,
            right: 16,
          },
        ]}>
        <Text style={styles.bannerText}>{text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    zIndex: 9999,
    elevation: 9999,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(30, 58, 138, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    maxHeight: 200,
  },
  bannerText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19,
    letterSpacing: -0.2,
  },
});
