-- meeting_categories: 대분류 코드(모임 생성 정책·Step 분기 키). 기존 행은 NULL 가능.

alter table public.meeting_categories
  add column if not exists major_code text;

comment on column public.meeting_categories.major_code is
  '대분류 코드. app_policies meeting_create.rules_by_major 키·앱 major→특화 매핑과 대응.';

create index if not exists meeting_categories_major_code_idx
  on public.meeting_categories (major_code)
  where major_code is not null and length(trim(major_code)) > 0;
