-- Run this once in your Supabase SQL Editor
-- https://supabase.com/dashboard → SQL Editor

-- 1. Create the meta table
create table if not exists update_meta (
  id          int primary key default 1,
  version     text,
  description text default '',
  android_url text,
  windows_url text,
  updated_at  text
);

-- Ensure only one row ever exists
alter table update_meta add constraint update_meta_single_row check (id = 1);

-- Insert the initial empty row
insert into update_meta (id, version, description, android_url, windows_url, updated_at)
values (1, null, '', null, null, null)
on conflict (id) do nothing;

-- 2. Disable RLS so the service_role key can read/write freely
alter table update_meta disable row level security;
