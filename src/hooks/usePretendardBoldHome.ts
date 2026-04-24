import * as Font from 'expo-font';
import { useEffect, useState } from 'react';

const PRETENDARD_BOLD_URI =
  'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/public/static/Pretendard-Bold.otf';

/**
 * 홈 글래스 그리드 타이포용 Pretendard Bold (로드 실패 시 undefined → 시스템 굵은 글꼴)
 */
export function usePretendardBoldHome(): string | undefined {
  const [family, setFamily] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await Font.loadAsync({ PretendardBold: PRETENDARD_BOLD_URI });
        if (!cancelled) setFamily('PretendardBold');
      } catch {
        if (!cancelled) setFamily(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return family;
}
