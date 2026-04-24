
> ginit-app@1.0.0 print:categories-sql
> node ./scripts/print-firestore-categories-sql.mjs

◇ injected env (33) from env/.env // tip: ⌘ override existing { override: true }
◇ injected env (8) from .env // tip: ⌁ auth for agents [www.vestauth.com]
-- Generated from Firestore project ginit-1b7b3 at 2026-04-24T15:42:08.805Z
-- Table: public.meeting_categories (see migration 0006)

begin;

insert into public.meeting_categories (id, label, emoji, sort_order)
values
  ('sRI7BKMxlPfE9MrtuS0G', '영화', '🎬', 2),
  ('snMorugrx3Sh3uvBlu2N', '커피', '☕', 6),
  ('uUnuq6A7Aal9fw3lLOQ3', '운동', '🏃', 3),
  ('xYAgS71J2K5t9x4PfTkJ', '벙개', '❤️', 0),
  ('ymihqIsLyDJnVDbVmgi7', '식사', '🍽️', 1),
  ('yqbX78qBYbnocQZJi6dI', '스터디', '📚', 4)
on conflict (id) do update set
  label = excluded.label,
  emoji = excluded.emoji,
  sort_order = excluded.sort_order,
  updated_at = now();

commit;
