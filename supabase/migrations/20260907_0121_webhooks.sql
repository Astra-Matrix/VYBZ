-- ===========================================================================
-- VYBZ Platform — signed webhooks.
--
-- Organizations register HTTPS endpoints for events. The gateway records an
-- event once (webhook_emit) and one delivery row per subscribed endpoint.
-- Delivery runs inside Postgres with pg_net: the body is signed with the
-- endpoint's secret (HMAC-SHA256 over "<timestamp>.<body>"), sent, and the
-- response reconciled on the next dispatch pass. Failures retry with backoff
-- (1 min, 5 min, 30 min, 2 h, 12 h) and give up after six attempts.
-- ===========================================================================

create table if not exists public.webhook_endpoints (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  url            text not null check (url ~ '^https://'),
  description    text,
  secret         text not null,
  events         text[] not null default '{}',
  active         boolean not null default true,
  created_by_key uuid references public.api_keys(id) on delete set null,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists webhook_endpoints_org_idx on public.webhook_endpoints(org_id, created_at desc);
alter table public.webhook_endpoints enable row level security;
drop policy if exists webhook_endpoints_select on public.webhook_endpoints;
create policy webhook_endpoints_select on public.webhook_endpoints for select using (public.is_org_admin(org_id));

create table if not exists public.webhook_deliveries (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  endpoint_id     uuid not null references public.webhook_endpoints(id) on delete cascade,
  event           text not null,
  payload         jsonb not null,
  status          text not null default 'pending' check (status in ('pending','sending','delivered','failed')),
  attempt         int not null default 0,
  next_attempt_at timestamptz not null default now(),
  request_id      bigint,
  last_status     int,
  last_error      text,
  created_at      timestamptz not null default now(),
  delivered_at    timestamptz
);
create index if not exists webhook_deliveries_due_idx on public.webhook_deliveries(next_attempt_at) where status in ('pending','sending');
create index if not exists webhook_deliveries_endpoint_idx on public.webhook_deliveries(endpoint_id, created_at desc);
create index if not exists webhook_deliveries_org_idx on public.webhook_deliveries(org_id, created_at desc);
alter table public.webhook_deliveries enable row level security;
drop policy if exists webhook_deliveries_select on public.webhook_deliveries;
create policy webhook_deliveries_select on public.webhook_deliveries for select using (public.is_org_member(org_id));

-- Record an event: one delivery per active endpoint subscribed to it (or to '*').
create or replace function public.webhook_emit(p_org uuid, p_event text, p_data jsonb)
returns int language plpgsql security definer set search_path = public as $fn$
declare n int := 0; ep record; body jsonb; did uuid;
begin
  for ep in select id from public.webhook_endpoints where org_id = p_org and active and (p_event = any(events) or '*' = any(events)) loop
    did := gen_random_uuid();
    body := jsonb_build_object('id', did, 'object', 'event', 'event', p_event, 'created_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'org_id', p_org, 'data', p_data);
    insert into public.webhook_deliveries(id, org_id, endpoint_id, event, payload) values (did, p_org, ep.id, p_event, body);
    n := n + 1;
  end loop;
  return n;
end $fn$;

-- Reconcile in-flight responses, then send everything that is due.
create or replace function public.webhook_dispatch(p_limit int default 100)
returns table (sent int, delivered int, failed int)
language plpgsql security definer set search_path = public, net, extensions as $fn$
declare d record; ts bigint; sig text; rid bigint; n_sent int := 0; n_ok int := 0; n_fail int := 0; backoff interval;
begin
  -- 1. Responses that have arrived for deliveries marked sending.
  for d in
    select w.id, w.attempt, r.status_code, r.timed_out, r.error_msg
    from public.webhook_deliveries w
    join net._http_response r on r.id = w.request_id
    where w.status = 'sending'
  loop
    if d.status_code between 200 and 299 and not coalesce(d.timed_out, false) then
      update public.webhook_deliveries set status = 'delivered', delivered_at = now(), last_status = d.status_code, last_error = null where id = d.id;
      n_ok := n_ok + 1;
    else
      backoff := case d.attempt when 1 then interval '1 minute' when 2 then interval '5 minutes' when 3 then interval '30 minutes' when 4 then interval '2 hours' else interval '12 hours' end;
      update public.webhook_deliveries
         set status = case when d.attempt >= 6 then 'failed' else 'pending' end,
             next_attempt_at = now() + backoff,
             last_status = d.status_code,
             last_error = coalesce(d.error_msg, case when coalesce(d.timed_out, false) then 'timed out' else 'HTTP ' || coalesce(d.status_code::text, '?') end),
             request_id = null
       where id = d.id;
      if d.attempt >= 6 then n_fail := n_fail + 1; end if;
    end if;
  end loop;
  -- Sending rows whose response never appeared (pg_net keeps responses ~6 h).
  update public.webhook_deliveries
     set status = case when attempt >= 6 then 'failed' else 'pending' end, next_attempt_at = now() + interval '5 minutes', last_error = 'no response recorded', request_id = null
   where status = 'sending' and next_attempt_at < now() - interval '10 minutes';

  -- 2. Send what is due.
  for d in
    select w.id, w.event, w.payload, w.attempt, e.url, e.secret
    from public.webhook_deliveries w
    join public.webhook_endpoints e on e.id = w.endpoint_id
    where w.status = 'pending' and w.next_attempt_at <= now() and e.active
    order by w.next_attempt_at
    limit greatest(1, least(p_limit, 500))
    for update of w skip locked
  loop
    ts := extract(epoch from now())::bigint;
    sig := encode(extensions.hmac(convert_to(ts::text || '.' || d.payload::text, 'utf8'), convert_to(d.secret, 'utf8'), 'sha256'), 'hex');
    select net.http_post(
      url := d.url,
      body := d.payload,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'User-Agent', 'vybz-webhooks/1 (+https://vybz.cloud/docs/api)',
        'X-VYBZ-Event', d.event,
        'X-VYBZ-Delivery', d.id::text,
        'X-VYBZ-Attempt', (d.attempt + 1)::text,
        'X-VYBZ-Signature', 't=' || ts::text || ',v1=' || sig
      ),
      timeout_milliseconds := 15000
    ) into rid;
    update public.webhook_deliveries set status = 'sending', attempt = attempt + 1, request_id = rid, next_attempt_at = now() where id = d.id;
    n_sent := n_sent + 1;
  end loop;
  return query select n_sent, n_ok, n_fail;
end $fn$;

-- Console helpers (members read; admins manage). Secrets are returned only at creation.
create or replace function public.webhooks_list(p_org uuid)
returns table (id uuid, url text, description text, events text[], active boolean, created_at timestamptz, updated_at timestamptz,
               deliveries_24h bigint, failed_24h bigint, last_delivery_at timestamptz)
language sql stable security definer set search_path = public as $$
  select e.id, e.url, e.description, e.events, e.active, e.created_at, e.updated_at,
         (select count(*) from public.webhook_deliveries d where d.endpoint_id = e.id and d.created_at > now() - interval '24 hours'),
         (select count(*) from public.webhook_deliveries d where d.endpoint_id = e.id and d.status = 'failed' and d.created_at > now() - interval '24 hours'),
         (select max(d.delivered_at) from public.webhook_deliveries d where d.endpoint_id = e.id)
  from public.webhook_endpoints e
  where e.org_id = p_org and public.is_org_member(p_org)
  order by e.created_at desc;
$$;

revoke all on function public.webhook_emit(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.webhook_dispatch(int) from public, anon, authenticated;
grant execute on function public.webhook_emit(uuid, text, jsonb) to service_role;
grant execute on function public.webhook_dispatch(int) to service_role;
grant execute on function public.webhooks_list(uuid) to authenticated, service_role;

-- API keys may carry the new scope.
create or replace function public.api_key_create(
  p_org uuid, p_name text, p_scopes text[], p_rate_limit int default 300, p_expires_at timestamptz default null
) returns table (id uuid, prefix text, key text, scopes text[], created_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $fn$
declare raw text; kid uuid; pfx text; now_ts timestamptz := now();
        allowed text[] := array['org:read','provenance:read','provenance:write','provenance:detect','vault:read','vault:write','webhooks:manage'];
        s text;
begin
  if not public.is_org_admin(p_org) then raise exception 'forbidden'; end if;
  foreach s in array coalesce(p_scopes, '{}') loop
    if not (s = any(allowed)) then raise exception 'unknown scope: %', s; end if;
  end loop;
  raw := 'vybz_live_' || encode(gen_random_bytes(24), 'hex');
  pfx := substr(raw, 1, 14);
  insert into public.api_keys(org_id, name, prefix, key_hash, scopes, rate_limit_per_min, created_by, expires_at)
    values (p_org, trim(p_name), pfx, encode(digest(raw, 'sha256'), 'hex'), coalesce(p_scopes, '{}'),
            coalesce(p_rate_limit, 300), auth.uid(), p_expires_at)
    returning api_keys.id into kid;
  return query select kid, pfx, raw, coalesce(p_scopes, '{}'), now_ts;
end $fn$;

-- Retry sweep every minute; the gateway also dispatches immediately after emitting.
select cron.unschedule(jobid) from cron.job where jobname = 'webhook-dispatch';
select cron.schedule('webhook-dispatch', '* * * * *', $$select public.webhook_dispatch(200);$$);

-- Deliveries older than 30 days are not needed.
create or replace function public.webhook_deliveries_prune()
returns void language sql security definer set search_path = public as $$
  delete from public.webhook_deliveries where created_at < now() - interval '30 days';
$$;
revoke all on function public.webhook_deliveries_prune() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'webhook-deliveries-prune';
select cron.schedule('webhook-deliveries-prune', '30 4 * * *', $$select public.webhook_deliveries_prune();$$);
