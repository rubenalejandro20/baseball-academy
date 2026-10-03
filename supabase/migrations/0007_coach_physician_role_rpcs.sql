-- ============================================================
-- Milestone 4 — Role RPCs: is_org_coach() / is_org_physician()
-- ============================================================
-- Closes the gap 0001 and getStaffContext() both explicitly flagged as
-- deferred ("Milestone 1 only distinguishes administrator or not"): until
-- now, `is_org_administrator()` was the only role-check RPC, so a plain
-- coach and a plain physician were indistinguishable at the database
-- level, and both had identical org-scoped access to every physician/
-- trainer table via the existing "Staff org access - X" policies.
--
-- SAFE TO APPLY AT ANY TIME: purely additive, matching 0001's own framing
-- for is_org_administrator() — two new SECURITY DEFINER functions, zero
-- table/policy/column changes. Nothing behaves differently until
-- 0008_coach_physician_rls_cutover.sql actually references these
-- functions from policy text. Applying this file alone has no observable
-- effect on any query result.
--
-- STRICT, SINGLE-ROLE CHECKS — NOT ADMINISTRATOR-INCLUSIVE:
-- `is_org_physician()` returns true ONLY for `role = 'physician'`, and
-- `is_org_coach()` only for `role = 'coach'`. An administrator gets FALSE
-- from both. This mirrors `is_org_administrator()`'s own strictness
-- exactly, and is deliberate: "administrators also keep physician-domain
-- access" is a POLICY-COMPOSITION decision, expressed in 0008 as
-- `(is_org_administrator() OR is_org_physician())`, not baked into this
-- function. Keeping each RPC single-responsibility keeps that composition
-- visible and auditable in the policy text itself, and keeps these
-- functions reusable later for coach-only tables where physician should
-- NOT be auto-included.
--
-- Same SEARCH-PATH HARDENING as every other SECURITY DEFINER function in
-- 0001/0004/0005: `search_path = ''` (empty), every reference fully
-- schema-qualified, so there is no schema-resolution ambiguity for an
-- unqualified name to be hijacked through.
--
-- DO NOT RUN AGAINST PRODUCTION YET. Per the Milestone 4 plan, this file
-- and 0008 are developed and tested together, entirely locally
-- (`npm run test:db`), with actual production application deferred to a
-- separate, later, explicitly authorized step — same posture 0004/0005/
-- 0006 originally had before their own production rollout.
-- ============================================================

BEGIN;

create or replace function is_org_coach()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists(
    select 1 from public.staff_profiles
    where auth_user_id = auth.uid() and role = 'coach' and is_active = true
  );
$$;

create or replace function is_org_physician()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists(
    select 1 from public.staff_profiles
    where auth_user_id = auth.uid() and role = 'physician' and is_active = true
  );
$$;

-- Same EXPLICIT EXECUTE PRIVILEGE audit as 0001: revoke the PUBLIC default
-- first, then grant only to the role(s) that actually need it.
-- `authenticated` needs these for the 0008 RLS policy expressions (policy
-- predicates evaluate as the querying role). `anon` never checks staff
-- roles and gets no grant — same reasoning as
-- current_org_id()/is_org_administrator()/is_super_user().
revoke execute on function is_org_coach() from public;
revoke execute on function is_org_physician() from public;

grant execute on function is_org_coach() to authenticated;
grant execute on function is_org_physician() to authenticated;

COMMIT;
