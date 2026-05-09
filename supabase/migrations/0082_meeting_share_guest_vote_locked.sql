-- 웹 게스트: 참여(join/request) 시점의 투표만 반영. 이후 meeting_share_guest_vote 로 변경 불가.

create or replace function public.meeting_share_guest_vote(
  p_token text,
  p_guest_user_id text,
  p_display_name text,
  p_votes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'meeting_share_guest_vote_locked';
end;
$$;

revoke all on function public.meeting_share_guest_vote(text, text, text, jsonb) from public;
grant execute on function public.meeting_share_guest_vote(text, text, text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
