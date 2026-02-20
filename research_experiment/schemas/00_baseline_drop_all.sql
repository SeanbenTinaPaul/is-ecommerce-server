-- ============================================================
-- 00_baseline_drop_all.sql
-- ============================================================
-- วัตถุประสงค์: ลบ indexes ทั้งหมด (ยกเว้น PK และ Unique Constraints)
--              เพื่อวัด Baseline performance
--
-- Usage (run from server/ directory):
--   psql $DATABASE_URL -f research_experiment/schemas/00_baseline_drop_all.sql
--
-- หรือใช้ Python script:
--   python research_experiment/scripts/apply_schema.py baseline
--
-- Note:
-- - ไม่ลบ Primary Key (_pkey) และ Unique Constraints (_key)
-- - เฉพาะ indexes ที่สร้างเพิ่มเติมเท่านั้น
-- ============================================================

DO $$
DECLARE
    idx_name text;
BEGIN
    -- Loop through all indexes that are NOT:
    -- 1. Primary key (_pkey)
    -- 2. Unique constraints (_key)
    -- 3. System indexes (pg_)
    FOR idx_name IN
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname NOT LIKE '%_pkey'
          AND indexname NOT LIKE '%_key'
          AND indexname NOT LIKE 'pg_%'
          AND indexname NOT LIKE '%_unique%'
    LOOP
        EXECUTE format('DROP INDEX IF EXISTS "%s"', idx_name);
        RAISE NOTICE 'Dropped index: %', idx_name;
    END LOOP;
END $$;

-- Verify: List remaining indexes
SELECT 
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
