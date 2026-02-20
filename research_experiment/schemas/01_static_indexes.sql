-- ============================================================
-- 01_static_indexes.sql
-- ============================================================
-- วัตถุประสงค์: สร้าง Static Indexes ตามผลลัพธ์จาก Phase 3 ranking
--              (Top candidates ที่ผ่านการคัดเลือกแล้ว)
--
-- Usage (run from server/ directory):
--   psql $DATABASE_URL -f research_experiment/schemas/01_static_indexes.sql
--
-- หรือใช้ Python script:
--   python research_experiment/scripts/apply_schema.py static
--
-- Note:
-- - Indexes ถูกเลือกจาก phase2_results_filtered.json
-- - เฉพาะ Customer-Centric indexes (ไม่รวม Admin endpoints)
-- - ควรรัน 00_baseline_drop_all.sql ก่อนเพื่อให้ clean state
-- ============================================================

-- ==============================
-- 1. Foreign Key Indexes (High Impact)
-- ==============================

-- FK06: ProductOnOrder.orderId (99.73% improvement)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_productOnOrder_orderId" 
ON "ProductOnOrder" ("orderId");

-- FK01: Image.productId (97.84% improvement)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_image_productId" 
ON "Image" ("productId");

-- FK03: Favorite.productId (92.83% improvement)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_favorite_productId" 
ON "Favorite" ("productId");

-- FK07: Order.orderedById (80.68% improvement)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_order_orderedById" 
ON "Order" ("orderedById");

-- FK04: Rating.productId (39.28% improvement)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_rating_productId" 
ON "Rating" ("productId");


-- ==============================
-- 2. Query Pattern Indexes
-- ==============================

-- U12: User order history pagination (95.23% improvement)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_order_orderedById_createdAt" 
ON "Order" ("orderedById", "createdAt" DESC);

-- P19: Price filter search (96.17% improvement)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_product_price" 
ON "Product" ("price");

-- P20: Brand filter (40.38% improvement)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_product_brandId" 
ON "Product" ("brandId");

-- P18: Category filter (32.93% improvement)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_product_categoryId" 
ON "Product" ("categoryId");


-- ==============================
-- 3. Composite Indexes
-- ==============================

-- P16: Display products by user + category (58.2% improvement)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_product_category_quantity_updated" 
ON "Product" ("categoryId", "quantity", "updatedAt" DESC);

-- U16: Favorite existence check
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_favorite_userId_productId" 
ON "Favorite" ("userId", "productId");


-- ==============================
-- 4. User Authentication Indexes
-- ==============================

-- AU02: Login email lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_user_email" 
ON "User" ("email");


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

-- Verify: List all indexes
SELECT 
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(quote_ident(indexname)::regclass)) as size
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;
