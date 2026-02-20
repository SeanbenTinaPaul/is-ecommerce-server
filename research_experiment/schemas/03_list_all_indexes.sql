-- ============================================================
-- 03_list_all_indexes.sql
-- ============================================================
-- วัตถุประสงค์: แสดง indexes ทั้งหมดใน database พร้อม size
--              ใช้สำหรับ verify สถานะก่อน/หลังการทดลอง
--
-- Usage:
--   psql $DATABASE_URL -f research_experiment/schemas/03_list_all_indexes.sql
-- ============================================================

-- All indexes with details
SELECT 
    t.relname AS table_name,
    i.relname AS index_name,
    pg_size_pretty(pg_relation_size(i.oid)) AS index_size,
    a.attname AS column_name,
    am.amname AS index_type
FROM 
    pg_class t
JOIN 
    pg_index ix ON t.oid = ix.indrelid
JOIN 
    pg_class i ON i.oid = ix.indexrelid
JOIN 
    pg_am am ON i.relam = am.oid
LEFT JOIN 
    pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
WHERE 
    t.relkind = 'r'
    AND t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
ORDER BY 
    t.relname, 
    i.relname;

-- Summary by table
SELECT 
    tablename,
    COUNT(*) as index_count,
    pg_size_pretty(SUM(pg_relation_size(quote_ident(indexname)::regclass))) as total_size
FROM pg_indexes
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY tablename;
