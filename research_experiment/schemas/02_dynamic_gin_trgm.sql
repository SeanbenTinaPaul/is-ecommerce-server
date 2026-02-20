-- ============================================================
-- 02_dynamic_gin_trgm.sql
-- ============================================================
-- วัตถุประสงค์: สร้าง Dynamic Indexes รวมถึง GIN และ pg_trgm
--              สำหรับ full-text search และ LIKE queries
--
-- Usage (run from server/ directory):
--   psql $DATABASE_URL -f research_experiment/schemas/02_dynamic_gin_trgm.sql
--
-- หรือใช้ Python script:
--   python research_experiment/scripts/apply_schema.py dynamic
--
-- Prerequisites:
-- - pg_trgm extension (for trigram indexes)
-- - ควรรัน 00_baseline_drop_all.sql ก่อนเพื่อให้ clean state
--
-- Note:
-- - รวม Static indexes + Advanced text search indexes
-- - ใช้สำหรับทดสอบ searchFilters() ที่ต้องการ text search
-- ============================================================

-- ==============================
-- 0. Extensions
-- ==============================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ==============================
-- 1. Include Static Indexes (from 01_static_indexes.sql)
-- ==============================

-- FK indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_productOnOrder_orderId" 
ON "ProductOnOrder" ("orderId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_image_productId" 
ON "Image" ("productId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_favorite_productId" 
ON "Favorite" ("productId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_order_orderedById" 
ON "Order" ("orderedById");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_rating_productId" 
ON "Rating" ("productId");

-- Query pattern indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_order_orderedById_createdAt" 
ON "Order" ("orderedById", "createdAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_product_price" 
ON "Product" ("price");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_product_brandId" 
ON "Product" ("brandId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_product_categoryId" 
ON "Product" ("categoryId");

-- Composite indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_product_category_quantity_updated" 
ON "Product" ("categoryId", "quantity", "updatedAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_favorite_userId_productId" 
ON "Favorite" ("userId", "productId");

-- Auth indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_user_email" 
ON "User" ("email");


-- ==============================
-- 2. GIN Trigram Indexes (for ILIKE/LIKE '%...%')
-- ==============================
-- ใช้แทน B-tree index สำหรับ text search
-- รองรับ searchFilters() ที่ใช้ contains + insensitive

-- Product title search (ใช้แทน P17_SearchFiltersTitle ที่ B-tree ไม่ work)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_product_title_trgm" 
ON "Product" USING GIN ("title" gin_trgm_ops);

-- Product description search
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_product_description_trgm" 
ON "Product" USING GIN ("description" gin_trgm_ops);


-- ==============================
-- 3. Optional: Full-Text Search with tsvector
-- ==============================
-- Uncomment below if you want to add tsvector column for FTS
-- Note: ต้องปรับ productService.js ให้ใช้ raw SQL query

/*
-- Add tsvector column
ALTER TABLE "Product" 
ADD COLUMN IF NOT EXISTS "search_vector" tsvector
GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'B')
) STORED;

-- Create GIN index on tsvector
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_product_search_vector" 
ON "Product" USING GIN ("search_vector");

-- Example query (for productService.js):
-- SELECT * FROM "Product" WHERE "search_vector" @@ plainto_tsquery('english', 'search term');
*/


-- ==============================
-- Update Statistics
-- ==============================
ANALYZE "Product";
ANALYZE "Order";
ANALYZE "ProductOnOrder";
ANALYZE "Image";
ANALYZE "Favorite";
ANALYZE "Rating";
ANALYZE "User";


-- ==============================
-- Verify
-- ==============================
SELECT 
    tablename,
    indexname,
    indexdef,
    pg_size_pretty(pg_relation_size(quote_ident(indexname)::regclass)) as size
FROM pg_indexes
WHERE schemaname = 'public'
  AND (indexname LIKE 'idx_%' OR indexname LIKE '%_trgm')
ORDER BY tablename, indexname;
