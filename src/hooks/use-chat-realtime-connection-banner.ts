import { useCallback, useEffect, useMemo, useState } from 'react';

export type ChatRealtimeBannerTone = 'reconnecting' | 'error' | null;

export type ChatRealtimeConnectionHandlers = {
  onReconnecting: () => void;
  onReconnected: () => void;
  onGiveUp: (message: string) => void;
  clear: () => void;
};

/**
 * 채팅 Realtime: transport 끊김 →「재연결 시도 중」, 최종 실패만 에러 배너.
 * @param clearWhenUnfocused 포커스 잃으면 배너 초기화(화면 전환 중 거친 에러 방지)
 */
export function useChatRealtimeConnectionBanner(
  clearWhenUnfocused: boolean,
  isFocused: boolean,
): {
  bannerText: string | null;
  bannerTone: ChatRealtimeBannerTone;
  handlers: ChatRealtimeConnectionHandlers;
} {
  const [reconnecting, setReconnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!clearWhenUnfocused || isFocused) return;
    setReconnecting(false);
    setErrorMessage(null);
  }, [clearWhenUnfocused, isFocused]);

  const onReconnecting = useCallback(() => {
    setErrorMessage(null);
    setReconnecting(true);
  }, []);

  const onReconnected = useCallback(() => {
    setReconnecting(false);
    setErrorMessage(null);
  }, []);

  const onGiveUp = useCallback((message: string) => {
    setReconnecting(false);
    setErrorMessage(message);
  }, []);

  const clear = useCallback(() => {
    setReconnecting(false);
    setErrorMessage(null);
  }, []);

  const handlers = useMemo(
    (): ChatRealtimeConnectionHandlers => ({
      onReconnecting,
      onReconnected,
      onGiveUp,
      clear,
    }),
    [clear, onGiveUp, onReconnected, onReconnecting],
  );

  const bannerTone: ChatRealtimeBannerTone = reconnecting ? 'reconnecting' : errorMessage ? 'error' : null;
  const bannerText = reconnecting ? '실시간 연결을 다시 맞추는 중…' : errorMessage;

  return { bannerText, bannerTone, handlers };
}
