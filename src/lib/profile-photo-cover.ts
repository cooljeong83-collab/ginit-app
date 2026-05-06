/** `profiles.metadata` 병합 키 — 프로필 원형/사각 썸네일에 쓸 초점(업로드 이미지는 원본 비율 유지) */
export const PROFILE_META_PHOTO_COVER = 'photo_cover' as const;

export type ProfilePhotoCover = {
  /** 업로드 이미지 너비 기준 0~1, 보이는 사각(정사각) 중심에 해당하는 가로 위치 */
  ax: number;
  /** 업로드 이미지 높이 기준 0~1 */
  ay: number;
  /** 1 = 기본(사각을 덮는 최소 배율), 확대 시 1 초과 */
  z: number;
};

export function parseProfilePhotoCover(metadata: Record<string, unknown> | null | undefined): ProfilePhotoCover | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const raw = metadata[PROFILE_META_PHOTO_COVER];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const ax = typeof o.ax === 'number' && Number.isFinite(o.ax) ? o.ax : NaN;
  const ay = typeof o.ay === 'number' && Number.isFinite(o.ay) ? o.ay : NaN;
  const z = typeof o.z === 'number' && Number.isFinite(o.z) ? o.z : NaN;
  if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(z)) return null;
  return {
    ax: Math.min(1, Math.max(0, ax)),
    ay: Math.min(1, Math.max(0, ay)),
    z: Math.min(6, Math.max(1, z)),
  };
}
