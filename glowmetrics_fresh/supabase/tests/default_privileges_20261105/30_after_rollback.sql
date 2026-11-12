SELECT t.ok(NOT EXISTS ((SELECT * FROM t.defaults_baseline EXCEPT SELECT * FROM t.defaults()) UNION ALL (SELECT * FROM t.defaults() EXCEPT SELECT * FROM t.defaults_baseline)),
            'rollback: pg_default_acl identical to the recorded production defaults');
CREATE TABLE public.probe_rolled_back (id bigserial PRIMARY KEY);
SELECT t.ok(t.privs('public.probe_rolled_back', 'anon') LIKE '%TRUNCATE%', 'rollback: new tables again inherit the old (broad) defaults');
SELECT t.ok(t.privs('public.probe_after', 'anon') = 'REFERENCES,SELECT,TRIGGER', 'rollback: a table created while narrowed keeps its narrow grants');
