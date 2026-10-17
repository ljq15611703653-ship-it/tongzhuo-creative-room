begin;
create or replace function public.room_slot() returns integer language sql stable security definer set search_path='' as $$
 select slot::integer from public.members where id=(select auth.uid());
$$;
revoke all on function public.room_slot() from public,anon;
grant execute on function public.room_slot() to authenticated;

create table public.writing_counts (
 writer_id uuid not null references public.members(id),
 day date not null,
 delta integer not null check(delta between -10000000 and 10000000),
 baseline_started_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(writer_id,day)
);
create table public.writer_keys (
 key_hash text primary key,
 writer_id uuid not null references public.members(id),
 expires_at timestamptz not null
);
create table public.writing_mouse (
 room_id integer primary key check(room_id=1),
 x double precision not null default .76 check(x between 0 and 1),
 y double precision not null default .62 check(y between 0 and 1),
 pose text not null default 'sit' check(pose in('sit','wave','peek','float','drag','write')),
 updated_at timestamptz not null default now()
);
insert into public.writing_mouse(room_id) values(1);
create table public.writing_comments (
 id bigint generated always as identity primary key,
 user_id uuid not null references public.members(id),
 body text not null check(char_length(trim(body)) between 1 and 300),
 created_at timestamptz not null default now()
);
alter table public.writing_counts enable row level security;
alter table public.writer_keys enable row level security;
alter table public.writing_mouse enable row level security;
alter table public.writing_comments enable row level security;
revoke all on public.writing_counts,public.writer_keys,public.writing_mouse,public.writing_comments from anon,authenticated;
grant select on public.writing_counts,public.writing_mouse,public.writing_comments to authenticated;
grant update(x,y,pose) on public.writing_mouse to authenticated;
grant insert(user_id,body) on public.writing_comments to authenticated;
grant usage on sequence public.writing_comments_id_seq to authenticated;
create policy counts_members_read on public.writing_counts for select to authenticated using(public.is_member());
create policy mouse_members_read on public.writing_mouse for select to authenticated using(public.is_member());
create policy mouse_only_shushu_moves on public.writing_mouse for update to authenticated using(public.room_slot()=2) with check(public.room_slot()=2);
create policy comments_members_read on public.writing_comments for select to authenticated using(public.is_member());
create policy comments_only_shushu_writes on public.writing_comments for insert to authenticated with check(public.room_slot()=2 and user_id=(select auth.uid()));

create function public.writing_touch_mouse() returns trigger language plpgsql set search_path='' as $$ begin new.updated_at=now();return new;end; $$;
revoke all on function public.writing_touch_mouse() from public,anon,authenticated;
create trigger writing_mouse_touch before update on public.writing_mouse for each row execute function public.writing_touch_mouse();

-- A random, revocable key can ONLY write one member's daily integer count.
create function public.issue_writer_key() returns jsonb language plpgsql security definer set search_path='' as $$
declare k text; expiry timestamptz;
begin
 if not exists(select 1 from public.members where id=auth.uid() and slot=1) then raise exception 'Only sister can connect a writer helper'; end if;
 k=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''); expiry=now()+interval '7 days';
 delete from public.writer_keys where writer_id=auth.uid();
 insert into public.writer_keys values(encode(sha256(convert_to(k,'UTF8')),'hex'),auth.uid(),expiry);
 return jsonb_build_object('key',k,'expires_at',expiry);
end; $$;
create function public.revoke_writer_key() returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.members where id=auth.uid() and slot=1) then raise exception 'Only sister can disconnect'; end if;
 delete from public.writer_keys where writer_id=auth.uid();
end; $$;
create function public.writer_sync(p_key text,p_day date,p_delta integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid;
begin
 if p_key is null or p_key !~ '^[0-9a-f]{64}$' then raise exception 'Invalid helper key'; end if;
 select k.writer_id into owner_id from public.writer_keys k join public.members m on m.id=k.writer_id and m.slot=1
 where k.key_hash=encode(sha256(convert_to(p_key,'UTF8')),'hex') and k.expires_at>now();
 if owner_id is null then raise exception 'Helper key expired or revoked'; end if;
 if p_day is null or p_day<>(now() at time zone 'Asia/Shanghai')::date or p_delta is null or p_delta not between -10000000 and 10000000 then raise exception 'Invalid daily count'; end if;
 insert into public.writing_counts(writer_id,day,delta) values(owner_id,p_day,p_delta)
 on conflict(writer_id,day) do update set delta=excluded.delta,updated_at=now();
 return jsonb_build_object('ok',true);
end; $$;
revoke all on function public.issue_writer_key(),public.revoke_writer_key(),public.writer_sync(text,date,integer) from public,anon,authenticated;
grant execute on function public.issue_writer_key(),public.revoke_writer_key() to authenticated;
grant execute on function public.writer_sync(text,date,integer) to anon,authenticated;

do $$ declare t text;begin
 foreach t in array array['writing_counts','writing_mouse','writing_comments'] loop
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
   execute format('alter publication supabase_realtime add table public.%I',t);
  end if;
 end loop;
end $$;
commit;
