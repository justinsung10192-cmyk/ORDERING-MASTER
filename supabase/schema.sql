-- ============================================================
-- 班級訂午餐系統 v2 — Supabase / PostgreSQL Schema
-- 在 Supabase 專案的「SQL Editor」整段貼上並執行即可。
-- ============================================================

-- 班級 ------------------------------------------------------------------
create table if not exists public.classes (
  id         bigint generated always as identity primary key,
  class_id   text not null unique,
  name       text not null,
  created_at timestamptz not null default now()
);

-- 帳號 ------------------------------------------------------------------
create table if not exists public.users (
  id               bigint generated always as identity primary key,
  class_id         text not null references public.classes(class_id) on delete cascade,
  student_no       text not null,
  student_name     text not null,
  seat_no          text not null default '',
  email            text not null default '',
  password_hash    text not null,
  salt             text not null,
  role             text not null default 'Student',
  wallet_balance   numeric(10,2) not null default 0,
  is_disabled      boolean not null default false,
  email_verified   boolean not null default false,
  auth_version     int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (class_id, student_no),
  unique (class_id, email)
);
create index if not exists idx_users_student_no on public.users (student_no);
create index if not exists idx_users_class on public.users (class_id);

-- 店家 / 餐點 / 客製選項 ----------------------------------------------------
create table if not exists public.stores (
  id         bigint generated always as identity primary key,
  class_id   text not null references public.classes(class_id) on delete cascade,
  name       text not null,
  is_active  boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_stores_class on public.stores (class_id);

create table if not exists public.menu_items (
  id         bigint generated always as identity primary key,
  class_id   text not null references public.classes(class_id) on delete cascade,
  store_id   bigint not null references public.stores(id) on delete cascade,
  name       text not null,
  price      numeric(10,2) not null default 0,
  is_active  boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_menu_items_store on public.menu_items (store_id);

create table if not exists public.item_options (
  id           bigint generated always as identity primary key,
  class_id     text not null references public.classes(class_id) on delete cascade,
  store_id     bigint not null references public.stores(id) on delete cascade,
  menu_item_id bigint not null references public.menu_items(id) on delete cascade,
  name         text not null,
  price        numeric(10,2) not null default 0,
  max_select   int not null default 1,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists idx_item_options_item on public.item_options (menu_item_id);

-- 訂餐場次 ----------------------------------------------------------------
create table if not exists public.sessions (
  id                    bigint generated always as identity primary key,
  class_id              text not null references public.classes(class_id) on delete cascade,
  store_id              bigint not null references public.stores(id),
  order_date            date not null,
  cutoff_time           timestamptz not null,
  payment_mode          text not null default 'Stored-value Only',
  is_open               boolean not null default true,
  cutoff_reminder_sent  boolean not null default false,
  created_at            timestamptz not null default now(),
  closed_at             timestamptz
);
create index if not exists idx_sessions_class_date on public.sessions (class_id, order_date);
create index if not exists idx_sessions_cutoff on public.sessions (cutoff_time);

-- 訂單 ------------------------------------------------------------------
create table if not exists public.orders (
  id             bigint generated always as identity primary key,
  class_id       text not null references public.classes(class_id) on delete cascade,
  session_id     bigint not null references public.sessions(id),
  user_id        bigint references public.users(id) on delete set null,
  items          jsonb not null default '[]',
  total_price    numeric(10,2) not null default 0,
  prior_paid     numeric(10,2) not null default 0,
  payment_status text not null default 'UnpaidCash',
  pickup_status  text not null default 'Pending',
  note           text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (session_id, user_id)
);
create index if not exists idx_orders_class_session on public.orders (class_id, session_id);
create index if not exists idx_orders_user on public.orders (user_id);
create index if not exists idx_orders_session on public.orders (session_id);

-- 交易帳目（錢包金流）-------------------------------------------------------
create table if not exists public.transactions (
  id         bigint generated always as identity primary key,
  class_id   text not null references public.classes(class_id) on delete cascade,
  user_id    bigint references public.users(id) on delete set null,
  order_id   bigint references public.orders(id) on delete set null,
  amount     numeric(10,2) not null,
  kind       text not null,
  note       text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_transactions_user on public.transactions (user_id, created_at);

-- QR 驗證紀錄 ---------------------------------------------------------------
create table if not exists public.verification_records (
  id         bigint generated always as identity primary key,
  class_id   text not null references public.classes(class_id) on delete cascade,
  session_id bigint references public.sessions(id) on delete set null,
  user_id    bigint references public.users(id) on delete set null,
  payload    text not null,
  status     text not null default 'Pending',
  expires_at timestamptz not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_verification_user on public.verification_records (user_id, status, expires_at);

-- 登入／驗證／重設 Token -----------------------------------------------------
create table if not exists public.auth_tokens (
  id         bigint generated always as identity primary key,
  class_id   text not null default '',
  user_id    bigint references public.users(id) on delete cascade,
  type       text not null,
  token_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_auth_tokens_hash on public.auth_tokens (token_hash);
create index if not exists idx_auth_tokens_user on public.auth_tokens (user_id, type);

-- 推播訂閱（Web Push）--------------------------------------------------------
create table if not exists public.push_subscriptions (
  id           bigint generated always as identity primary key,
  class_id     text not null default '',
  user_id      bigint references public.users(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  device_label text not null default '',
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- 邀請碼（一般使用者註冊）------------------------------------------------------
create table if not exists public.invite_codes (
  id          bigint generated always as identity primary key,
  class_id    text not null references public.classes(class_id) on delete cascade,
  code_hash   text not null,
  label       text not null default '',
  is_disabled boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists idx_invite_codes_hash on public.invite_codes (code_hash);

-- 班級管理者代碼（開發者核發，一次性）--------------------------------------------
create table if not exists public.class_admin_codes (
  id         bigint generated always as identity primary key,
  code_hash  text not null,
  label      text not null default '',
  is_used    boolean not null default false,
  used_by    text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_class_admin_codes_hash on public.class_admin_codes (code_hash);

-- 開發者帳號 ----------------------------------------------------------------
create table if not exists public.developers (
  id            bigint generated always as identity primary key,
  username      text not null unique,
  email         text not null default '',
  password_hash text not null,
  salt          text not null,
  is_disabled   boolean not null default false,
  created_at    timestamptz not null default now()
);

-- 班級設定（emailDomain、adminAuthCode 等）-------------------------------------
create table if not exists public.app_settings (
  id       bigint generated always as identity primary key,
  class_id text not null default '',
  key      text not null,
  value    text not null default '',
  unique (class_id, key)
);

-- ============================================================
-- 金流原子運算（由 API 以 supabase.rpc 呼叫，避免並發扣款錯誤）
-- ============================================================

-- 建立／更新訂單並結算儲值金與現金未繳
create or replace function public.fn_settle_order(
  p_class_id text,
  p_user_id bigint,
  p_session_id bigint,
  p_total numeric,
  p_wallet_paid numeric,
  p_cash_outstanding numeric,
  p_prior_paid numeric default 0,
  p_order_id bigint default null,
  p_items jsonb default '[]',
  p_note text default ''
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_balance numeric;
  v_status text;
  v_order_id bigint;
  v_owned bigint;
begin
  select wallet_balance into v_balance
  from users where id = p_user_id and class_id = p_class_id
  for update;
  if v_balance is null then
    raise exception 'USER_NOT_FOUND';
  end if;

  -- 更新訂單時：先退回原單已付金額，再重新結算
  v_balance := v_balance + coalesce(p_prior_paid, 0);

  if p_wallet_paid > 0 then
    if v_balance < p_wallet_paid then
      raise exception 'INSUFFICIENT_BALANCE';
    end if;
    v_balance := v_balance - p_wallet_paid;
  end if;

  update users set wallet_balance = v_balance, updated_at = now()
  where id = p_user_id;

  if p_cash_outstanding > 0 and p_wallet_paid > 0 then
    v_status := 'PartiallyPaid';
  elsif p_cash_outstanding > 0 then
    v_status := 'UnpaidCash';
  else
    v_status := 'PaidWallet';
  end if;

  if p_order_id is not null then
    select id into v_owned from orders
    where id = p_order_id and user_id = p_user_id and class_id = p_class_id;
    if v_owned is null then
      raise exception 'ORDER_NOT_FOUND';
    end if;
    update orders
       set items = p_items, total_price = p_total, prior_paid = p_wallet_paid,
           payment_status = v_status, note = p_note, updated_at = now()
     where id = p_order_id
    returning id into v_order_id;
  else
    insert into orders (class_id, session_id, user_id, items, total_price, prior_paid, payment_status, pickup_status, note)
    values (p_class_id, p_session_id, p_user_id, p_items, p_total, p_wallet_paid, v_status, 'Pending', p_note)
    returning id into v_order_id;
  end if;

  if p_prior_paid > 0 then
    insert into transactions (class_id, user_id, order_id, amount, kind, note)
    values (p_class_id, p_user_id, v_order_id, p_prior_paid, 'Refund', '訂單修改退款');
  end if;
  if p_wallet_paid > 0 then
    insert into transactions (class_id, user_id, order_id, amount, kind, note)
    values (p_class_id, p_user_id, v_order_id, -p_wallet_paid, 'Wallet', '訂餐扣款');
  end if;
  if p_cash_outstanding > 0 then
    insert into transactions (class_id, user_id, order_id, amount, kind, note)
    values (p_class_id, p_user_id, v_order_id, p_cash_outstanding, 'Cash', '現金未繳');
  end if;

  return jsonb_build_object(
    'order_id', v_order_id,
    'wallet_balance', v_balance,
    'payment_status', v_status
  );
end;
$$;

-- 刪除訂單並退回已扣儲值金
create or replace function public.fn_refund_order(
  p_class_id text,
  p_user_id bigint,
  p_order_id bigint
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_balance numeric;
  v_order record;
  v_refund numeric;
begin
  select wallet_balance into v_balance
  from users where id = p_user_id and class_id = p_class_id
  for update;
  if v_balance is null then
    raise exception 'USER_NOT_FOUND';
  end if;

  select * into v_order from orders
  where id = p_order_id and user_id = p_user_id and class_id = p_class_id;
  if v_order.id is null then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  v_refund := coalesce(v_order.prior_paid, 0);
  v_balance := v_balance + v_refund;

  update users set wallet_balance = v_balance, updated_at = now()
  where id = p_user_id;

  if v_refund > 0 then
    insert into transactions (class_id, user_id, order_id, amount, kind, note)
    values (p_class_id, p_user_id, p_order_id, v_refund, 'Refund', '取消訂單退款');
  end if;

  delete from orders where id = p_order_id;

  return jsonb_build_object('wallet_balance', v_balance, 'refunded', v_refund);
end;
$$;

-- 管理員儲值：先抵最舊的現金未繳訂單，剩餘入錢包
create or replace function public.fn_topup(
  p_class_id text,
  p_user_id bigint,
  p_amount numeric
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_balance numeric;
  v_remaining numeric := p_amount;
  v_order record;
  v_outstanding numeric;
  v_applied numeric := 0;
begin
  select wallet_balance into v_balance
  from users where id = p_user_id and class_id = p_class_id
  for update;
  if v_balance is null then
    raise exception 'USER_NOT_FOUND';
  end if;

  for v_order in
    select o.id, o.total_price, o.prior_paid
    from orders o
    where o.class_id = p_class_id and o.user_id = p_user_id
      and o.payment_status in ('UnpaidCash', 'PartiallyPaid')
    order by o.created_at
  loop
    if v_remaining <= 0 then exit; end if;
    v_outstanding := v_order.total_price - v_order.prior_paid;
    if v_outstanding > 0 then
      if v_remaining >= v_outstanding then
        update orders set prior_paid = total_price, payment_status = 'PaidCash', updated_at = now()
        where id = v_order.id;
        insert into transactions (class_id, user_id, order_id, amount, kind, note)
        values (p_class_id, p_user_id, v_order.id, -v_outstanding, 'Cash', '儲值抵欠款');
        v_remaining := v_remaining - v_outstanding;
        v_applied := v_applied + v_outstanding;
      else
        update orders set prior_paid = prior_paid + v_remaining, payment_status = 'PartiallyPaid', updated_at = now()
        where id = v_order.id;
        insert into transactions (class_id, user_id, order_id, amount, kind, note)
        values (p_class_id, p_user_id, v_order.id, -v_remaining, 'Cash', '儲值抵欠款');
        v_applied := v_applied + v_remaining;
        v_remaining := 0;
      end if;
    end if;
  end loop;

  if v_remaining > 0 then
    v_balance := v_balance + v_remaining;
    update users set wallet_balance = v_balance, updated_at = now()
    where id = p_user_id;
  end if;

  insert into transactions (class_id, user_id, order_id, amount, kind, note)
  values (p_class_id, p_user_id, null, p_amount, 'TopUp', '管理員儲值');

  return jsonb_build_object(
    'wallet_balance', v_balance,
    'applied_to_debt', v_applied,
    'remaining_debt', (select coalesce(sum(o.total_price - o.prior_paid), 0) from orders o
                        where o.class_id = p_class_id and o.user_id = p_user_id
                          and o.payment_status in ('UnpaidCash', 'PartiallyPaid'))
  );
end;
$$;

-- 管理員現金結清指定訂單
create or replace function public.fn_settle_cash(
  p_class_id text,
  p_user_id bigint,
  p_order_ids bigint[]
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_order_id bigint;
  v_order record;
  v_outstanding numeric;
  v_total_settled numeric := 0;
begin
  select wallet_balance from users
  where id = p_user_id and class_id = p_class_id
  for update;

  foreach v_order_id in array p_order_ids loop
    select * into v_order from orders
    where id = v_order_id and user_id = p_user_id and class_id = p_class_id;
    if v_order.id is not null then
      v_outstanding := v_order.total_price - v_order.prior_paid;
      if v_outstanding > 0 then
        update orders set prior_paid = total_price, payment_status = 'PaidCash', updated_at = now()
        where id = v_order.id;
        insert into transactions (class_id, user_id, order_id, amount, kind, note)
        values (p_class_id, p_user_id, v_order.id, -v_outstanding, 'Cash', '現金結清');
        v_total_settled := v_total_settled + v_outstanding;
      end if;
    end if;
  end loop;

  return jsonb_build_object('settled', v_total_settled);
end;
$$;

-- ============================================================
-- 排程：截止提醒（選用）——部署完成後在 SQL Editor 執行並替換網址：
--   select cron.schedule(
--     'cutoff-reminders',
--     '0 * * * *',
--     $$ select net.http_post(
--          url := 'https://你的-app.vercel.app/api/cron?secret=你的CRON_SECRET',
--          headers := jsonb_build_object('Content-Type','application/json'),
--          body := '{}'
--        ) $$
--   );
-- 移除排程：
--   select cron.unschedule('cutoff-reminders');
-- ============================================================
