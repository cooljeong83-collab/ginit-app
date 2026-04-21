import { useMemo } from 'react';

import { useSMSRetriever } from '@ebrimasamba/react-native-sms-retriever';

export type OtpSmsRetriever = {
  start: () => Promise<void>;
  stop: () => void;
};

export function useOtpSmsRetriever(opts: { onCode: (code: string) => void }): OtpSmsRetriever {
  const retriever = useSMSRetriever({
    onSuccess: (otp) => {
      const clean = String(otp || '').replace(/\D/g, '').slice(0, 6);
      if (clean.length === 6) opts.onCode(clean);
    },
    onError: () => {
      // silent
    },
  });

  return useMemo(
    () => ({
      start: async () => {
        await retriever.startListening();
      },
      stop: () => {
        retriever.stopListening();
      },
    }),
    [retriever],
  );
}

