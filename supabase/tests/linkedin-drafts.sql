-- Run only in a disposable database after v304. All changes roll back.
BEGIN;
DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.linkedin_drafts;
 ASSERT n = 4, 'seed is idempotent';
 ASSERT NOT has_table_privilege('anon','public.linkedin_drafts','SELECT'), 'anonymous cannot read';
 ASSERT NOT has_table_privilege('authenticated','public.linkedin_drafts','UPDATE'), 'ordinary accounts cannot edit';
 UPDATE public.linkedin_drafts SET status='publishing',version=2 WHERE id='a47a0001-0000-4000-8000-000000000001' AND version=1 AND status='draft';
 GET DIAGNOSTICS n = ROW_COUNT; ASSERT n=1, 'first claim succeeds';
 UPDATE public.linkedin_drafts SET status='publishing',version=2 WHERE id='a47a0001-0000-4000-8000-000000000001' AND version=1 AND status='draft';
 GET DIAGNOSTICS n = ROW_COUNT; ASSERT n=0, 'repeat claim loses';
 UPDATE public.linkedin_drafts SET commentary='stale edit' WHERE id='a47a0001-0000-4000-8000-000000000001' AND version=1 AND status='draft';
 GET DIAGNOSTICS n = ROW_COUNT; ASSERT n=0, 'stale edit cannot change claimed text';
END $$;
ROLLBACK;
