const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** RFC 4122 v4 — Hermes 등 `crypto.randomUUID` 미지원 환경용 폴백 포함 */
export function generateUuidV4(): string {
  const c = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof c.crypto?.randomUUID === 'function') {
    return c.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function isUuidV4(value: string): boolean {
  return UUID_V4_RE.test(value.trim());
}
