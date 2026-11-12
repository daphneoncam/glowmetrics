-- BEFORE: a newly created table / sequence inherits the broad defaults.
CREATE TABLE public.probe_before (id bigserial PRIMARY KEY);
SELECT t.ok(t.privs('public.probe_before', 'anon') = CASE WHEN t.v17() THEN 'DELETE,INSERT,MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE' ELSE 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE' END,
            'before: a new table gives anon INSERT/UPDATE/DELETE/TRUNCATE' || CASE WHEN t.v17() THEN '/MAINTAIN' ELSE '' END);
SELECT t.ok(t.privs('public.probe_before', 'authenticated') LIKE '%TRUNCATE%', 'before: a new table gives authenticated TRUNCATE');
SELECT t.ok(t.privs('public.probe_before_id_seq', 'anon') = 'SELECT,UPDATE,USAGE', 'before: a new sequence gives anon UPDATE (setval) and USAGE');
BEGIN; SET LOCAL ROLE anon; TRUNCATE public.probe_before; RESET ROLE;
SELECT t.ok(true, 'before: anon CAN truncate a freshly created table');
ROLLBACK;
