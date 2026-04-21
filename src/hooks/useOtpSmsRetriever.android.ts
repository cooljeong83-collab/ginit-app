/**
 * Android SMS Retriever (OTP 자동 감지)
 *
 * 현재 프로젝트에서는 라이브러리의 TIMEOUT이 콘솔에 ERROR로 기록되어
 * 개발 경험을 크게 해칩니다. OTP 자동 감지는 필수 기능이 아니므로,
 * 당분간은 Android에서도 no-op으로 비활성화합니다.
 *
 * 필요해지면 "명시적으로 start()를 호출했을 때만 listening" 하도록
 * 구현을 교체하는 형태로 다시 활성화하세요.
 */

export type OtpSmsRetriever = {
  start: () => Promise<void>;
  stop: () => void;
};

export function useOtpSmsRetriever(opts: { onCode: (code: string) => void }): OtpSmsRetriever {
  void opts;
  return {
    start: async () => {},
    stop: () => {},
  };
}

