import type { Href } from 'expo-router';

/** 프로필 탭 진입 시 `서비스 이용 인증`(정보 등록) 시트를 자동으로 엽니다. */
export const PROFILE_REGISTER_INFO_QUERY = 'registerInfo' as const;

export function isProfileRegisterInfoParamOn(raw: string | string[] | undefined): boolean {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === '1' || v === 'true';
}

const hrefProfileOpenRegisterInfo = {
  pathname: '/(tabs)/profile' as const,
  params: { [PROFILE_REGISTER_INFO_QUERY]: '1' },
};

/** 모임 생성·참여 등에서 정보 등록 화면(프로필 인증 시트)으로 보낼 때 사용 */
export function pushProfileOpenRegisterInfo(router: { push: (href: Href) => void }): void {
  router.push(hrefProfileOpenRegisterInfo as Href);
}
