-- ============================================================
-- 🛑 EMERGENCY ROLLBACK for 0002_milestone1_backfill.sql ONLY
-- DO NOT RUN UNLESS THIS STEP FAILED OR MUST BE UNDONE.
-- ============================================================
-- SCOPE: undoes only the DATA created by 0002 — the one organization, the
-- one staff_profiles row, the one platform_admins row, the organization_id
-- backfill on existing tables, and the audit_events row 0002 created. Does
-- NOT touch 0001's schema (tables/functions/triggers/enum stay), auth.users,
-- storage, or existing RLS policies. Valid only if 0003 has NOT been
-- applied yet.
--
-- NOTE: this deliberately disables staff_profiles_last_admin_delete_guard
-- for the single delete below. That trigger (correctly) blocks removing
-- the last active administrator of an organization that still exists —
-- but this rollback removes the organization itself in the same
-- transaction, so the guard's protection no longer applies. The trigger
-- is re-enabled immediately after, before the transaction commits.
-- ============================================================

BEGIN;

do $$
declare
  v_org_id uuid;
begin
  select id into v_org_id from organizations where slug = '7ar-baseball-academy';

  if v_org_id is not null then
    -- Reset the organization_id backfill (column itself is 0001's schema
    -- and is left in place — only the values 0002 wrote are cleared).
    update athletes     set organization_id = null where organization_id = v_org_id;
    update exercises    set organization_id = null where organization_id = v_org_id;
    update weekly_plans set organization_id = null where organization_id = v_org_id;

    -- Remove the audit trail row 0002 created for this org (required
    -- before the organization itself can be deleted).
    delete from audit_events where organization_id = v_org_id;

    -- Remove the platform_admins row 0002 created for the same account
    -- that was linked to this org's staff_profiles row.
    delete from platform_admins
    where auth_user_id in (select auth_user_id from staff_profiles where organization_id = v_org_id);

    -- Remove the staff_profiles row(s) for this org.
    alter table staff_profiles disable trigger staff_profiles_last_admin_delete_guard;
    delete from staff_profiles where organization_id = v_org_id;
    alter table staff_profiles enable trigger staff_profiles_last_admin_delete_guard;

    -- Remove the organization itself.
    delete from organizations where id = v_org_id;
  end if;
end $$;

COMMIT;
