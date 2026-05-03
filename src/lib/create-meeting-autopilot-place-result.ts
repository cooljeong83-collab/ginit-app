/** `/place-search` 자동 진행이 실패했을 때 생성 화면이 소비하는 한 번성 메시지 */

let lastError: string | null = null;

export function setCreateMeetingPlaceAutopilotError(message: string): void {
  lastError = message.trim() || '장소를 자동으로 고르지 못했어요.';
}

export function consumeCreateMeetingPlaceAutopilotError(): string | null {
  const v = lastError;
  lastError = null;
  return v;
}
