-- SEOPilot daily free limits per user (keeps Serper / AI credits from running out when many people use the tool).
-- Run once: npx supabase db push

create table if not exists public.usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,                 -- research | keywords | backlinks
  day date not null default ((now() at time zone 'utc')::date),
  count int not null default 0,
  primary key (user_id, kind, day)
);
alter table public.usage_daily enable row level security;   -- no policies: only edge functions (service role) can touch it

-- Adds 1 to today's counter when it is still under the limit. One atomic statement, so parallel calls cannot sneak past the limit.
create or replace function public.take_quota(p_user uuid, p_kind text, p_limit int)
returns table (allowed boolean, used int)
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  insert into public.usage_daily as u (user_id, kind, day, count)
  values (p_user, p_kind, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, kind, day) do update set count = u.count + 1 where u.count < p_limit
  returning u.count into v;
  if v is null then
    select u.count into v from public.usage_daily u where u.user_id = p_user and u.kind = p_kind and u.day = (now() at time zone 'utc')::date;
    return query select false, coalesce(v, 0);
  else
    return query select true, v;
  end if;
end $$;
revoke all on function public.take_quota(uuid, text, int) from public, anon, authenticated;
grant execute on function public.take_quota(uuid, text, int) to service_role;