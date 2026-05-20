import { Platform } from 'react-native';

import {
  fetchGooglePeopleExtras,
  mapGooglePeopleGenderToProfileGender,
  type GooglePeopleExtras,
} from '@/src/lib/google-people-extras';
import {
  addGooglePeopleScopesAndGetAccessToken,
  getGoogleAccessTokenIfAvailable,
  REDIRECT_STARTED,
  signInWithGoogle,
} from '@/src/lib/google-sign-in';
import {
  firestoreTimestampLikeToDate,
  type UserProfile,
} from '@/src/lib/user-profile';

import { GINIT_OFFICIAL_SUPPORT_EMAIL } from '@/src/features/support/support-constants';

export { GINIT_OFFICIAL_SUPPORT_EMAIL };
export {
  GOOGLE_OAUTH_SCOPE_BIRTHDAY,
  GOOGLE_OAUTH_SCOPE_GENDER,
  googlePeopleScopesForFields,
} from '@/src/lib/google-people-oauth-scopes';

import type { GooglePeopleDemographicField } from '@/src/lib/google-sign-in-result';

export type { GooglePeopleDemographicField };

export type GooglePeopleDemographicsResolved = {
  gender: 'MALE' | 'FEMALE' | null;
  birth: { year: number; month: number; day: number } | null;
  genderFromGoogle: boolean;
  birthFromGoogle: boolean;
  stillMissing: GooglePeopleDemographicField[];
};

export function profileHasCompleteGender(p: UserProfile | null | undefined): boolean {
  const g = p?.gender?.trim() ?? '';
  return g === 'MALE' || g === 'FEMALE';
}

export function profileHasCompleteBirth(p: UserProfile | null | undefined): boolean {
  if (!p) return false;
  if (firestoreTimestampLikeToDate(p.birthDate)) return true;
  const y = p.birthYear;
  const m = p.birthMonth;
  const d = p.birthDay;
  return (
    typeof y === 'number' &&
    Number.isFinite(y) &&
    typeof m === 'number' &&
    Number.isFinite(m) &&
    typeof d === 'number' &&
    Number.isFinite(d)
  );
}

export function peopleHasCompleteGender(people: GooglePeopleExtras | null): boolean {
  return mapGooglePeopleGenderToProfileGender(people?.gender ?? null) != null;
}

export function peopleHasCompleteBirth(people: GooglePeopleExtras | null): boolean {
  const py = people?.birthYear ?? null;
  const pm = people?.birthMonth ?? null;
  const pd = people?.birthDay ?? null;
  return py != null && pm != null && pd != null;
}

/** 프로필·People API 기준으로 Google에서 아직 받아야 할 항목 */
export function missingGooglePeopleDemographicFields(
  profile: UserProfile | null | undefined,
  people: GooglePeopleExtras | null,
): GooglePeopleDemographicField[] {
  const missing: GooglePeopleDemographicField[] = [];
  if (!profileHasCompleteGender(profile) && !peopleHasCompleteGender(people)) {
    missing.push('gender');
  }
  if (!profileHasCompleteBirth(profile) && !peopleHasCompleteBirth(people)) {
    missing.push('birth');
  }
  return missing;
}

export function resolveGooglePeopleDemographics(
  profile: UserProfile | null | undefined,
  people: GooglePeopleExtras | null,
): GooglePeopleDemographicsResolved {
  const genderFromPeople = mapGooglePeopleGenderToProfileGender(people?.gender ?? null);
  const genderFromProfile =
    profile?.gender?.trim() === 'MALE' || profile?.gender?.trim() === 'FEMALE'
      ? (profile.gender.trim() as 'MALE' | 'FEMALE')
      : mapGooglePeopleGenderToProfileGender(profile?.gender ?? null);

  const gender = genderFromPeople ?? genderFromProfile;
  const genderFromGoogle = Boolean(genderFromPeople);

  let birth: { year: number; month: number; day: number } | null = null;
  let birthFromGoogle = false;

  const py = people?.birthYear ?? null;
  const pm = people?.birthMonth ?? null;
  const pd = people?.birthDay ?? null;
  if (py != null && pm != null && pd != null) {
    birth = { year: py, month: pm, day: pd };
    birthFromGoogle = true;
  } else {
    const bdDate = firestoreTimestampLikeToDate(profile?.birthDate);
    if (bdDate) {
      birth = {
        year: bdDate.getFullYear(),
        month: bdDate.getMonth() + 1,
        day: bdDate.getDate(),
      };
    } else if (profileHasCompleteBirth(profile)) {
      birth = {
        year: profile!.birthYear as number,
        month: profile!.birthMonth as number,
        day: profile!.birthDay as number,
      };
    }
  }

  const stillMissing = missingGooglePeopleDemographicFields(profile, people);

  return {
    gender,
    birth,
    genderFromGoogle,
    birthFromGoogle,
    stillMissing,
  };
}

/** 동의 화면에서 거부한 뒤 재시도가 안 될 때 안내(앱 내 1:1 문의하기로 연결) */
export function googlePeopleDemographicsDeniedScopeGuideBlock(): string {
  return [
    '이전에 동의 화면에서 거부하셨다면, Google 계정에서 Ginit(지닛) 접근 권한을 삭제한 뒤 다시 시도해 주세요.',
    '· Google 계정 → 보안 → 타사 앱에 연결된 계정(Third-party app access)',
    '· 목록에서 Ginit(지닛) 선택 → 액세스 삭제',
    '· 앱으로 돌아와 「Google 인증하기」(또는 부족한 항목 버튼)를 다시 눌러 주세요',
    '거부한 항목은 동의 창이 다시 뜨지 않을 수 있어요.',
    '계속 어려우시면 팝업의 「1:1 문의하기」로 문의해 주세요.',
  ].join('\n');
}

function appendGooglePeopleDemographicsSupportGuide(body: string): string {
  return `${body}\n\n${googlePeopleDemographicsDeniedScopeGuideBlock()}`;
}

export function googlePeopleDemographicsFailureMessage(
  stillMissing: readonly GooglePeopleDemographicField[],
): string {
  let lead: string;
  if (stillMissing.length === 2) {
    lead =
      '성별과 생년월일을 Google에서 받지 못했어요. Google 계정에 정보가 등록돼 있는지, 동의 화면에서 모두 허용했는지 확인해 주세요.';
  } else if (stillMissing.includes('gender')) {
    lead =
      '성별을 Google에서 받지 못했어요. Google 계정에 성별이 등록돼 있는지, 동의 화면에서 허용했는지 확인해 주세요.';
  } else {
    lead =
      '생년월일을 Google에서 받지 못했어요. Google 계정에 생년월일이 등록돼 있는지, 동의 화면에서 허용했는지 확인해 주세요.';
  }
  return appendGooglePeopleDemographicsSupportGuide(lead);
}

export function googlePeopleDemographicsPartialSavedMessage(
  stillMissing: readonly GooglePeopleDemographicField[],
): string {
  let lead: string;
  if (stillMissing.includes('gender') && stillMissing.includes('birth')) {
    lead = 'Google에서 성별·생년월일을 아직 받지 못했어요. 다시 시도해 주세요.';
  } else if (stillMissing.includes('gender')) {
    lead =
      '생년월일은 저장됐어요. 성별은 아래 「Google에서 성별 가져오기」로 다시 동의해 주세요.';
  } else {
    lead =
      '성별은 저장됐어요. 생년월일은 아래 「Google에서 생년월일 가져오기」로 다시 동의해 주세요.';
  }
  return appendGooglePeopleDemographicsSupportGuide(lead);
}

/**
 * People API 조회 → 부족한 스코프만 추가 동의 → 재조회.
 * 네이티브: `addScopes`에 누락 스코프만 전달. 웹: OAuth에 동일하게 반영.
 */
export async function importGooglePeopleDemographicsWithIncrementalConsent(
  profile: UserProfile,
): Promise<GooglePeopleDemographicsResolved> {
  let token = await getGoogleAccessTokenIfAvailable();
  let people = await fetchGooglePeopleExtras(token);
  let missing = missingGooglePeopleDemographicFields(profile, people);

  if (missing.length === 0) {
    return resolveGooglePeopleDemographics(profile, people);
  }

  if (Platform.OS === 'web') {
    const { googleAccessToken } = await signInWithGoogle({
      forRegistration: false,
      promptSelectAccount: false,
      peopleDemographicFields: [...missing],
    });
    token = googleAccessToken;
  } else {
    token = await addGooglePeopleScopesAndGetAccessToken(missing);
  }

  people = await fetchGooglePeopleExtras(token);
  missing = missingGooglePeopleDemographicFields(profile, people);

  return resolveGooglePeopleDemographics(profile, people);
}

export { REDIRECT_STARTED };
