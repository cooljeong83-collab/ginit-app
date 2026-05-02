/**
 * 네이버 Open API(`openapi.naver.com` — 지역·이미지 검색 등) 공용 클라이언트 레이트 제한.
 * 호출을 직렬화하고 요청 완료 후 최소 간격을 두어 429(속도 제한) 완화.
 */

const NAVER_OPENAPI_MIN_GAP_MS = 420;

let chainTail: Promise<void> = Promise.resolve();

/**
 * 동일 앱에서 Open API 요청이 겹치지 않도록 큐에 넣고, 이전 요청 종료 후 `NAVER_OPENAPI_MIN_GAP_MS` 만큼 쉰 뒤 다음을 실행합니다.
 */
export function withNaverOpenApiClientRateLimit<T>(operation: () => Promise<T>): Promise<T> {
  const scheduled = chainTail.then(() => operation());
  chainTail = scheduled.then(
    () => new Promise<void>((resolve) => setTimeout(resolve, NAVER_OPENAPI_MIN_GAP_MS)),
    () => new Promise<void>((resolve) => setTimeout(resolve, NAVER_OPENAPI_MIN_GAP_MS)),
  );
  return scheduled;
}
