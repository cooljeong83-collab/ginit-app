/**
 * Google People API — 생일·성별 (OAuth `user.birthday.read` / `user.gender.read` 동의 시).
 * GCP에서 People API 사용 설정이 필요합니다.
 */
export type GooglePeopleExtras = {
  gender: string | null;
  birthYear: number | null;
  birthMonth: number | null;
  birthDay: number | null;
};

/** People API `genders[].value` (예: male/female) → Firestore `users.gender` */
export function mapGooglePeopleGenderToProfileGender(raw: string | null | undefined): 'MALE' | 'FEMALE' | null {
  if (!raw?.trim()) return null;
  const l = raw.trim().toLowerCase();
  if (l === 'male' || l === 'man' || l === 'masculine') return 'MALE';
  if (l === 'female' || l === 'woman' || l === 'feminine') return 'FEMALE';
  /** People API: other / unspecified / not specified 등은 앱에서 MALE·FEMALE로 저장하지 않음 */
  return null;
}

type PeopleDate = { year?: number; month?: number; day?: number };

type PeopleJson = {
  genders?: { value?: string }[];
  birthdays?: { date?: PeopleDate }[];
};

function pickPrimaryBirthday(birthdays?: { date?: PeopleDate }[]): PeopleDate | null {
  if (!birthdays?.length) return null;
  const withYear = birthdays.find((b) => typeof b.date?.year === 'number');
  const d = (withYear ?? birthdays[0])?.date;
  return d && (d.year != null || d.month != null || d.day != null) ? d : null;
}

export async function fetchGooglePeopleExtras(accessToken: string | null): Promise<GooglePeopleExtras | null> {
  const token = accessToken?.trim();
  if (!token) return null;
  try {
    const url =
      'https://people.googleapis.com/v1/people/me?personFields=birthdays,genders';
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      if (__DEV__) {
        const body = await res.text().catch(() => '');
        console.warn(
          '[GooglePeople]',
          'people/me failed',
          res.status,
          res.statusText,
          body?.slice(0, 200) ?? '',
        );
      }
      return null;
    }
    const j = (await res.json()) as PeopleJson;
    const gender = j.genders?.[0]?.value?.trim() || null;
    const date = pickPrimaryBirthday(j.birthdays);
    return {
      gender,
      birthYear: typeof date?.year === 'number' ? date.year : null,
      birthMonth: typeof date?.month === 'number' ? date.month : null,
      birthDay: typeof date?.day === 'number' ? date.day : null,
    };
  } catch {
    return null;
  }
}
