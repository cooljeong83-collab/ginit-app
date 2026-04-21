export type OtpSmsRetriever = {
  start: () => Promise<void>;
  stop: () => void;
};

export function useOtpSmsRetriever(_opts: { onCode: (code: string) => void }): OtpSmsRetriever {
  return {
    start: async () => {},
    stop: () => {},
  };
}

