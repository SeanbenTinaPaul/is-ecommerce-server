# API Frequency Score Analysis for DB Indexing Research

## วัตถุประสงค์
วิเคราะห์ความถี่ของ API requests จากฝั่ง client เพื่อใช้เป็น input สำหรับงานวิจัย DB Indexing
- **Scope**: เฉพาะ Guest และ User routes เท่านั้น (ไม่รวม Admin)
- **Assumption**: ผู้ใช้เน้นใช้งานหน้า **Shop** มากกว่าหน้า **Home**

---

## Research Framework (3 Phases)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Phase 1: Rule-Based Code Analysis                                           │
│ ► วิเคราะห์ WHERE, ORDER BY, JOIN conditions จาก service code              │
│ ► สร้าง Top 100 Index Candidates                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│ Phase 2: Virtual Index Creation (HypoPG)                                    │
│ ► สร้าง hypothetical indexes ไม่ต้อง rebuild จริง                           │
│ ► เก็บ performance metrics (EXPLAIN ANALYZE)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│ Phase 3: XGBoost Recommendation                                              │
│ ► Train model ด้วย: freq_score, column_cardinality, query_cost_reduction   │
│ ► Output: Ranked index recommendations                                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. API Frequency Scoring (Guest Routes)

### Routes ที่วิเคราะห์ (เรียงตามความถี่ใช้งาน):
```
/shop               → Shop (ค้นหาสินค้า) ★ PRIMARY
/                   → Home (หน้าแรก)
/view-product/:id   → ViewProdPage (ดูรายละเอียด)
/login              → Login
/register           → Register
```

### คะแนนความถี่ (Scale: 1-10)

| Score | API Endpoint | Method | Service Function | Triggered By | Est. Calls/Session |
|-------|--------------|--------|------------------|--------------|-------------------|
| **10** | `/api/products/:count` | GET | `listProd` | Shop.jsx load, SearchForProd reset | 3-8 |
| **10** | `/api/products-paginated` | GET | `listProdPaginated` | Shop.jsx Load More button | 2-5 |
| **9** | `/api/search-filters` | POST | `searchFilters` | SearchForProd submit | 1-5 |
| **8** | `/api/category` | GET | `listCategory` | SearchForProd init | 1-2 |
| **8** | `/api/brand` | GET | `listBrand` | SearchForProd init | 1-2 |
| **7** | `/api/product/:id` | GET | `readAprod` | ViewProdPage | 1-3 |
| **6** | `/api/display-prod-by` (sold) | POST | `displayProdBy` | Home → BestSeller | 0-1 |
| **6** | `/api/display-prod-by` (updatedAt) | POST | `displayProdBy` | Home → NewProd | 0-1 |
| **5** | `/api/product/:id/images` | GET | `readProductImages` | Home → CarouselBanner | 0-1 |
| **4** | `/api/sse` | GET | `subscribeStock` | SSE connection | 1 |
| **3** | `/api/login` | POST | `logIn` | Login page | 0-1 |
| **2** | `/api/register` | POST | `register` | Register page | 0-1 |

**Guest Total Score: 78 points**

---

## 2. API Frequency Scoring (User Routes)

### Routes ที่วิเคราะห์ (เรียงตามความถี่ใช้งาน):
```
/user/shop              → ShopUser (ค้นหาสินค้า) ★ PRIMARY
/user/view-product/:id  → ViewProdPageUser (ดูรายละเอียด + ซื้อ)
/user/cart              → CartUser
/user                   → HomeUser (หน้าแรก)
/user/payment           → Payment
/user/history           → HistoryUser
/user/favorite          → FavoriteUser
/user/editprofile       → EditProfileUser
```

### คะแนนความถี่ (Scale: 1-10)

| Score | API Endpoint | Method | Service Function | Triggered By | Est. Calls/Session |
|-------|--------------|--------|------------------|--------------|-------------------|
| **10** | `/api/products/:count` | GET | `listProd` | ShopUser.jsx load, Favorite load | 3-8 |
| **10** | `/api/products-paginated` | GET | `listProdPaginated` | ShopUser.jsx Load More | 2-5 |
| **10** | `/api/user/cart` | POST | `createUserCart` | ViewProdUser Add to cart, Buy now | 2-10 |
| **9** | `/api/search-filters` | POST | `searchFilters` | SearchForProd submit | 1-5 |
| **9** | `/api/product/:id` | GET | `readAprod` | ViewProdPageUser | 2-5 |
| **8** | `/api/category` | GET | `listCategory` | SearchForProd init, ViewProdUser | 1-3 |
| **8** | `/api/brand` | GET | `listBrand` | SearchForProd init | 1-2 |
| **8** | `/api/user/cart` | GET | `getUserCart` | HomeUser fetchUserCart | 1-2 |
| **7** | `/api/user/favorite` | POST | `favoriteProduct` | ViewProdUser toggle heart | 0-5 |
| **6** | `/api/display-prod-by` (sold) | POST | `displayProdBy` | HomeUser → BestSeller | 0-1 |
| **6** | `/api/display-prod-by` (updatedAt) | POST | `displayProdBy` | HomeUser → NewProd | 0-1 |
| **6** | `/api/display-prod-by-user` | GET | `displayProdByUser` | HomeUser → UserFavprod | 0-1 |
| **5** | `/api/product/:id/images` | GET | `readProductImages` | HomeUser → CarouselBanner | 0-1 |
| **5** | `/api/user/order` | GET | `getOrder` | HistoryUser | 0-1 |
| **5** | `/api/user/order-paginated` | GET | `getOrderPaginated` | HistoryUser Load More | 0-2 |
| **5** | `/api/products-by-ids` | POST | `getProductsByIds` | Cart sync | 0-1 |
| **4** | `/api/user/order` | POST | `saveOrder` | Payment confirmation | 0-1 |
| **4** | `/api/user/create-payment-intent` | POST | `createPayment` | Payment page | 0-1 |
| **4** | `/api/user/address` | POST | `saveAddress` | CartCheckout | 0-1 |
| **3** | `/api/user/rating` | POST | `addProdRating` | After purchase | 0-1 |
| **3** | `/api/user/update-profile` | PATCH | `updateUserProfile` | EditProfileUser | 0-1 |
| **2** | `/api/user/cart` | DELETE | `clearCart` | Remove all items | 0-1 |
| **2** | `/api/profile-user` | POST | `currUserProfile` | Auth verify | 1 |

**User Total Score: 139 points**

---

## 3. Summary by Page Priority

| Priority | Page (Guest) | Page (User) | Main API Endpoints |
|----------|-------------|-------------|-------------------|
| ⭐⭐⭐ HIGH | `/shop` | `/user/shop` | listProd, listProdPaginated, searchFilters, listCategory, listBrand |
| ⭐⭐⭐ HIGH | `/view-product/:id` | `/user/view-product/:id` | readAprod, createUserCart, favoriteProduct |
| ⭐⭐ MEDIUM | `/` | `/user` | displayProdBy, readProductImages, getUserCart, displayProdByUser |
| ⭐ LOW | `/login`, `/register` | `/user/cart`, `/user/payment`, `/user/history` | Various cart/order operations |

---

## 4. Index Candidates (Rule-Based Analysis)

### จาก Query Analysis ใน Service Code:

#### 4.1 `productService.js` - listProd / listProdPaginated ⭐ (CRITICAL - Shop page)
```javascript
// Query Pattern
where: { quantity: { gte: leastStock } }
orderBy: { createdAt: "desc" }
```
**Candidates:**
- `idx_product_quantity` (WHERE)
- `idx_product_createdAt` (ORDER BY)
- `idx_product_quantity_createdAt` (Composite - covering)

---

#### 4.2 `productService.js` - searchFilters ⭐ (CRITICAL - Shop search)
```javascript
// Query Pattern - Complex WHERE
whereConditions.title = { contains: query, mode: "insensitive" }
whereConditions.categoryId = { in: category }
whereConditions.price = { gte: price[0], lte: price[1] }
whereConditions.brandId = { in: brand }
```
**Candidates:**
- `idx_product_title` (GIN index for full-text search)
- `idx_product_categoryId` (IN query)
- `idx_product_price` (Range query)
- `idx_product_brandId` (IN query)
- `idx_product_categoryId_price` (Composite - common filter)

---

#### 4.3 `productService.js` - readAprod ⭐ (HIGH - Product detail)
```javascript
// Query Pattern
where: { id: parseInt(id) }  // Primary Key - auto indexed
// Related query
prisma.productOnOrder.findMany({
   where: { productId: parseInt(id) }
})
```
**Candidates:**
- `idx_productOnOrder_productId` (FK join)

---

#### 4.4 `productService.js` - displayProdBy (Home page)
```javascript
// Query Pattern
where: { quantity: { gt: 0 } }
orderBy: { [sort]: order }  // sort = "sold" | "updatedAt"
take: limit
```
**Candidates:**
- `idx_product_sold` (ORDER BY - BestSeller)
- `idx_product_updatedAt` (ORDER BY - NewProd)
- `idx_product_quantity_sold` (Composite - WHERE + ORDER)

---

#### 4.5 `userService.js` - createUserCart ⭐ (CRITICAL - Add to cart)
```javascript
// Query Pattern
prisma.user.findFirst({ where: { id: Number(req.user.id) } })
prisma.product.findUnique({ where: { id: item.id } })
prisma.cart.findFirst({ where: { orderedById: user.id } })
prisma.productOnCart.upsert({
   where: { cartId_productId: { cartId, productId } }
})
```
**Candidates:**
- `idx_cart_orderedById` (Unique per user - high selectivity)
- `ProductOnCart(cartId_productId)` - มี @@unique อยู่แล้ว (auto-indexed)

---

#### 4.6 `userService.js` - getUserCart
```javascript
// Query Pattern
prisma.cart.findFirst({
   where: { orderedById: Number(req.user.id) }
})
```
**Candidates:**
- `idx_cart_orderedById` (WHERE)

---

#### 4.7 `userService.js` - getOrder / getOrderPaginated
```javascript
// Query Pattern
where: { orderedById: Number(req.user.id) }
orderBy: { createdAt: "desc" }
```
**Candidates:**
- `idx_order_orderedById` (WHERE)
- `idx_order_createdAt` (ORDER BY)
- `idx_order_orderedById_createdAt` (Composite - covering)

---

#### 4.8 `userService.js` - favoriteProduct
```javascript
// Query Pattern
prisma.favorite.findMany({ where: { userId: id } })
prisma.favorite.findFirst({ where: { userId: id, productId: productId } })
```
**Candidates:**
- `idx_favorite_userId` (Limit check query)
- `Favorite(userId_productId)` - มี @@unique อยู่แล้ว (auto-indexed)

---

#### 4.9 `productService.js` - displayProdByUser (User Recommendations)
```javascript
// Query Pattern - Complex
prisma.order.findMany({
   where: { orderedById: id, OR: [...] }
})
prisma.product.findMany({
   where: { categoryId: catId, quantity: { gt: 0 } }
})
```
**Candidates:**
- `idx_order_orderedById_status` (Composite)
- `idx_product_categoryId_quantity` (Composite)

---

## 5. Top 20 Index Candidates Summary

| Rank | Index Name | Table | Column(s) | Freq Score | Query Pattern |
|------|------------|-------|-----------|------------|---------------|
| 1 | `idx_product_quantity` | Product | quantity | 20 | WHERE gte |
| 2 | `idx_product_createdAt` | Product | createdAt | 20 | ORDER BY desc |
| 3 | `idx_product_categoryId` | Product | categoryId | 18 | WHERE in |
| 4 | `idx_product_price` | Product | price | 18 | WHERE range |
| 5 | `idx_product_brandId` | Product | brandId | 17 | WHERE in |
| 6 | `idx_cart_orderedById` | Cart | orderedById | 18 | WHERE eq |
| 7 | `idx_order_orderedById` | Order | orderedById | 11 | WHERE eq |
| 8 | `idx_product_sold` | Product | sold | 12 | ORDER BY desc |
| 9 | `idx_product_updatedAt` | Product | updatedAt | 12 | ORDER BY desc |
| 10 | `idx_order_createdAt` | Order | createdAt | 10 | ORDER BY desc |
| 11 | `idx_productOnOrder_productId` | ProductOnOrder | productId | 16 | WHERE eq |
| 12 | `idx_favorite_userId` | Favorite | userId | 7 | WHERE eq |
| 13 | `idx_product_quantity_createdAt` | Product | (quantity, createdAt) | 20 | Composite |
| 14 | `idx_product_categoryId_price` | Product | (categoryId, price) | 18 | Composite |
| 15 | `idx_order_orderedById_createdAt` | Order | (orderedById, createdAt) | 11 | Composite |
| 16 | `idx_product_categoryId_quantity` | Product | (categoryId, quantity) | 12 | Composite |
| 17 | `idx_discount_productId` | Discount | productId | 10 | FK join |
| 18 | `idx_discount_endDate_isActive` | Discount | (endDate, isActive) | 10 | WHERE combo |
| 19 | `idx_rating_productId` | Rating | productId | 9 | groupBy |
| 20 | `idx_product_title` | Product | title | 9 | LIKE/contains |

---

## 6. Prisma Schema Index Syntax (For Phase 2)

```prisma
// === CRITICAL PRIORITY (Shop page queries) ===
model Product {
  // Single indexes
  @@index([quantity])           // listProd WHERE
  @@index([createdAt])          // listProd ORDER BY
  @@index([categoryId])         // searchFilters WHERE
  @@index([price])              // searchFilters WHERE
  @@index([brandId])            // searchFilters WHERE
  @@index([sold])               // displayProdBy ORDER BY
  @@index([updatedAt])          // displayProdBy ORDER BY
  
  // Composite indexes
  @@index([quantity, createdAt])   // listProd covering
  @@index([categoryId, price])     // searchFilters common
  @@index([categoryId, quantity])  // displayProdByUser
}

model Cart {
  @@index([orderedById])        // createUserCart, getUserCart
}

// === HIGH PRIORITY (Product detail + Order) ===
model Order {
  @@index([orderedById])
  @@index([createdAt])
  @@index([orderedById, createdAt])
}

model ProductOnOrder {
  @@index([productId])          // readAprod related query
}

// === MEDIUM PRIORITY ===
model Discount {
  @@index([productId])
  @@index([endDate, isActive])
}

model Favorite {
  @@index([userId])
}

model Rating {
  @@index([productId])
}
```

---

## 7. Notes สำหรับ Phase 2 & 3

### HypoPG Usage (Phase 2)
```sql
-- ติดตั้ง HypoPG extension
CREATE EXTENSION hypopg;

-- สร้าง virtual indexes ตาม priority
SELECT * FROM hypopg_create_index('CREATE INDEX ON "Product"(quantity)');
SELECT * FROM hypopg_create_index('CREATE INDEX ON "Product"(quantity, "createdAt" DESC)');
SELECT * FROM hypopg_create_index('CREATE INDEX ON "Product"("categoryId")');
SELECT * FROM hypopg_create_index('CREATE INDEX ON "Product"(price)');
SELECT * FROM hypopg_create_index('CREATE INDEX ON "Cart"("orderedById")');

-- ทดสอบ query จาก Shop page (ใช้บ่อยที่สุด)
EXPLAIN ANALYZE SELECT * FROM "Product" WHERE quantity >= 1 ORDER BY "createdAt" DESC LIMIT 20;

-- ดู index ที่ถูกใช้
SELECT * FROM hypopg_list_indexes();

-- ลบ virtual indexes ทั้งหมด
SELECT hypopg_reset();
```

### XGBoost Features (Phase 3)
```python
features = {
    'freq_score': 20,                    # จากตารางด้านบน
    'page_priority': 3,                  # 3=Shop, 2=ProductDetail, 1=Home, 0=Other
    'column_cardinality': 1000,          # SELECT COUNT(DISTINCT col) FROM table
    'table_row_count': 50000,            # SELECT COUNT(*) FROM table  
    'query_pattern': 'WHERE_GTE',        # WHERE_EQ, WHERE_IN, WHERE_RANGE, ORDER_BY
    'is_composite': False,               # Single vs Composite
    'current_query_cost': 1500.5,        # EXPLAIN ANALYZE cost
    'with_index_query_cost': 120.3,      # HypoPG EXPLAIN cost
    'cost_reduction_ratio': 12.48        # current / with_index
}
```

---

## Summary

| Category | Total Score | Top Page | Top API |
|----------|-------------|----------|---------|
| Guest Routes | 78 | `/shop` | listProd, searchFilters |
| User Routes | 139 | `/user/shop` | listProd, createUserCart |
| **Combined** | **217** | Shop pages | Product listing + Cart |

**Key Insight**: ควรให้ priority กับ:
1. **Shop page queries**: `Product` table indexes (quantity, createdAt, categoryId, price, brandId)
2. **Cart operations**: `Cart.orderedById` (unique per user, high selectivity)
3. **Product detail**: `ProductOnOrder.productId` (order history lookup)
