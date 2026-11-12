-- After the rollback script: the ACLs must equal the recorded production baseline exactly.
SELECT t.ok(NOT EXISTS (
  (SELECT * FROM t.acl_baseline
   EXCEPT
   SELECT c.relname, a.grantee::regrole::text, a.privilege_type FROM pg_class c, aclexplode(c.relacl) a
   WHERE c.oid IN ('public.paid_sessions'::regclass, 'public.tips'::regclass, 'public.paid_sessions_id_seq'::regclass) AND a.grantee <> 0)
  UNION ALL
  (SELECT c.relname, a.grantee::regrole::text, a.privilege_type FROM pg_class c, aclexplode(c.relacl) a
   WHERE c.oid IN ('public.paid_sessions'::regclass, 'public.tips'::regclass, 'public.paid_sessions_id_seq'::regclass) AND a.grantee <> 0
   EXCEPT
   SELECT * FROM t.acl_baseline)), 'rollback: table and sequence ACLs identical to the 2026-11-05 production baseline');
SELECT t.assert_history_unchanged('after rollback');
