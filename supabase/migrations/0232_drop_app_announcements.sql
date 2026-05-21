-- 레거시 고객센터 공지(app_announcements) 제거.
-- 앱·어드민은 public.notices / user_notifications 로 통합됨.
-- 유지: normalize_announcement_region_norm, current_profile_announcement_region_norm (운영 공지 region 타깃용, 0210·0227).

-- ---------------------------------------------------------------------------
-- RPC (app_announcements 전용)
-- ---------------------------------------------------------------------------
drop function if exists public.get_published_announcement(uuid);
drop function if exists public.list_published_announcements(int, timestamptz);
drop function if exists public.announcement_visible_to_current_user(public.app_announcements);

drop function if exists public.admin_publish_announcement(uuid, boolean);
drop function if exists public.admin_upsert_announcement(uuid, text, text, text, text, text);
drop function if exists public.admin_get_announcement(uuid);
drop function if exists public.admin_list_announcements(int, timestamptz);

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
drop index if exists public.app_announcements_published_list_idx;

drop table if exists public.app_announcements;

notify pgrst, 'reload schema';
