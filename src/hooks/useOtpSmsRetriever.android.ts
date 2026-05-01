import {
  retrieveVerificationCode,
  startSmsHandling,
} from '@eabdullazyanov/react-native-sms-user-consent';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { InteractionManager } from 'react-native';

/**
 * Android SMS User Consent API — 인증 SMS 수신 시 시스템 동의 UI 후 본문에서 OTP를 추출합니다.
 * (Firebase 등 앱 해시가 없는 SMS에는 SMS Retriever보다 이 API가 적합합니다.)
 */
export type OtpSmsRetriever = {
  start: () => Promise<void>;
  stop: () => void;
};

export function useOtpSmsRetriever(opts: { onCode: (code: string) => void }): OtpSmsRetriever {
  const onCodeRef = useRef(opts.onCode);
  onCodeRef.current = opts.onCode;
  const stopSmsRef = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    if (stopSmsRef.current) {
      stopSmsRef.current();
      stopSmsRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    stop();
    // Modal·전화 인증 직후에는 getCurrentActivity()가 잠깐 null일 수 있어, 네이티브 subscribe를 한 틱 미룹니다.
    await new Promise<void>((resolve) => {
      InteractionManager.runAfterInteractions(() => {
        requestAnimationFrame(() => resolve());
      });
    });
    const stopSms = startSmsHandling((event) => {
      const sms = typeof event?.sms === 'string' ? event.sms : '';
      if (!sms) return;
      const parsed = retrieveVerificationCode(sms, 6);
      if (!parsed || !/^\d{6}$/.test(parsed)) return;
      onCodeRef.current(parsed);
      stopSms();
      stopSmsRef.current = null;
    });
    stopSmsRef.current = stopSms;
  }, [stop]);

  useEffect(() => () => stop(), [stop]);

  return useMemo(() => ({ start, stop }), [start, stop]);
}
