/**
 * 회원가입 폼 입력 제한 — 잘못된 키보드/붙여넣기로 들어온 문자를 걸러냅니다.
 */

/** 실명·닉네임: 한글(완성형·자모)·영문 대소문자·공백만 */
export function sanitizeSignUpDisplayName(raw: string): string {
  return raw.replace(/[^가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z\s]/g, '');
}

/** 이메일: 일반적인 ASCII 이메일 문자만 (영문·숫자·@._%+-) */
export function sanitizeSignUpEmail(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9@._%+-]/g, '');
}
