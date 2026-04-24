-- `upsert_profile_payload`가 `p.signup_provider`를 갱신합니다.
-- 0008을 건너뛰었거나 수동으로 함수만 재배포한 DB에서 탈퇴 시
--   column p.signup_provider does not exist
-- 가 나지 않도록 컬럼을 보강합니다.

alter table public.profiles
  add column if not exists signup_provider text;

notify pgrst, 'reload schema';
