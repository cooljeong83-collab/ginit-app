-- 지도 하이브리드 탐색: (위도, 경도, 반경 km) 기준 공개 모임 반경 검색.
-- PostGIS 없이 Haversine(구면 거리, km)로 필터 — 모든 Supabase 프로젝트에서 동작.
-- 클라이언트: supabase.rpc('search_public_meetings_within_km', { p_lat, p_ing, p_radius_km, p_category_id })

create or replace function public.search_public_meetings_within_km(
  p_lat double precision,
  p_ing double precision,
  p_radius_km double precision default 5,
  p_category_id text default null
)
returns setof public.meetings
language sql
stable
security definer
set search_path = public
as $$
  select m.*
  from public.meetings m
  where m.is_public = true
    and m.latitude is not null
    and m.longitude is not null
    and (
      p_category_id is null
      or length(trim(p_category_id)) = 0
      or m.category_id = trim(p_category_id)
    )
    and (
      6371.0 * acos(
        least(
          1::double precision,
          greatest(
            -1::double precision,
            cos(radians(p_lat)) * cos(radians(m.latitude))
            * cos(radians(m.longitude) - radians(p_ing))
            + sin(radians(p_lat)) * sin(radians(m.latitude))
          )
        )
      )
    ) <= greatest(0.1::double precision, least(200.0::double precision, p_radius_km))
  order by m.created_at desc
  limit 400;
$$;

comment on function public.search_public_meetings_within_km(double precision, double precision, double precision, text) is
  '공개 모임만 대상으로 위경도 반경(km) 내 행을 반환. RLS와 무관하게 security definer이나 결과는 is_public=true·좌표 존재 행으로 제한.';

revoke all on function public.search_public_meetings_within_km(double precision, double precision, double precision, text) from public;
grant execute on function public.search_public_meetings_within_km(double precision, double precision, double precision, text) to anon, authenticated;

notify pgrst, 'reload schema';
