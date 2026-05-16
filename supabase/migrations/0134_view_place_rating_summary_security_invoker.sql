-- public.view_place_rating_summary: SECURITY DEFINER(뷰 소유자 권한) 경고 완화
--
-- 집계 뷰는 place_reviews를 읽습니다. security_invoker = true 이면
-- 뷰 본문이 "조회한 사용자"의 권한·RLS로 평가됩니다 (Postgres 15+).
-- 0075로 place_reviews가 제거된 환경에서는 아무 작업도 하지 않습니다.

do $migration$
begin
  if to_regclass('public.place_reviews') is null then
    return;
  end if;

  execute $sql$
    create or replace view public.view_place_rating_summary
    with (security_invoker = true)
    as
    select
      place_key,
      round(avg(rating)::numeric, 1) as average_rating,
      count(*)::bigint as total_reviews
    from public.place_reviews
    group by place_key
  $sql$;
end
$migration$;

notify pgrst, 'reload schema';
