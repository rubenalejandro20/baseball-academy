-- ============================================================
-- Exercise organization isolation — remove the anonymous SELECT policy
-- ============================================================
-- Removes "Public read exercises" (FOR SELECT TO anon USING (is_active =
-- true)) from public.exercises. That policy let ANY caller holding the
-- public anon key read every active exercise across EVERY organization
-- directly via PostgREST (e.g. a raw GET against
-- /rest/v1/exercises?select=*), with no PIN, no app involvement, and no
-- rate limiting — org-private exercise names/descriptions/video links
-- included. 0003_milestone1_rls.sql's own header comment already named
-- this exact risk and called its removal "REQUIRED, NOT OPTIONAL" once a
-- second organization exists or athlete auth moves off the PIN bridge; it
-- had simply not been acted on until now.
--
-- WHY THIS IS SAFE TO REMOVE NOW (and was not safe when 0003 was written):
-- the original justification for keeping this policy open was the
-- pre-Milestone-2 athlete routine wizard's embedded
-- `exercise:exercises(*)` join, read directly by the anon client. That
-- code path no longer exists — Milestone 2
-- (0004_milestone2_activity_routines_schema.sql /
-- 0005_milestone2_activity_routines_rls_rpc.sql) replaced it with the
-- get_athlete_routines() SECURITY DEFINER RPC, which bypasses RLS/table
-- policies entirely and already returns every exercise field the athlete
-- UI needs. Confirmed by inspection: no file under src/app/athlete/ or
-- src/app/api/ queries `exercises` directly at all. Removing this policy
-- requires ZERO changes to get_athlete_routines() or to any application
-- code.
--
-- DOES NOT TOUCH the staff policy ("Staff org access - exercises", added
-- in 0003 Section 2) — authenticated staff access to exercises (own org +
-- global/null-org exercises) is completely unaffected by this file.
--
-- DO NOT RUN AGAINST PRODUCTION YET. Local-repo/local-test-only work
-- pending review, same posture as 0004/0005.
-- ============================================================

BEGIN;

drop policy if exists "Public read exercises" on exercises;

COMMIT;
