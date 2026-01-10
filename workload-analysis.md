# Workload Analysis for E-commerce Application

## วัตถุประสงค์
วิเคราะห์ workload characteristics ของระบบเพื่อใช้ประกอบงานวิจัย DB Indexing

---

## 1. Workload Type Classification

### Primary Type: **OLTP (Read-Heavy)**

| Metric | Value | Rationale |
|--------|-------|-----------|
| **Category** | OLTP | Transaction-based e-commerce, latency-sensitive |
| **Read/Write Ratio** | ~90:10 | ส่วนใหญ่เป็น SELECT queries |
| **Transaction Size** | Small | 1-10 rows per operation |
| **Latency Requirement** | Low (<100ms) | User-facing web application |
| **Concurrency** | Medium-High | Multiple users browsing simultaneously |

### OLTP vs OLAP Comparison:

| Aspect | This System | OLTP | OLAP |
|--------|-------------|------|------|
| Query Type | Simple + JOINs | ✅ Simple | ❌ Complex aggregates |
| Data Volume per Query | Small (10-100 rows) | ✅ Small | ❌ Large (millions) |
| Response Time | < 100ms | ✅ Fast | ❌ Minutes/hours |
| Concurrent Users | Many | ✅ High | ❌ Few analysts |
| Write Pattern | Frequent, small | ✅ Yes | ❌ Bulk loads |

**Conclusion**: ระบบนี้เป็น **OLTP Read-Heavy** ชัดเจน

---

## 2. Workload หลัก (Primary Request Patterns)

### Top 5 Most Frequent Patterns:

| Rank | Pattern Name | SQL Equivalent | Frequency | Type |
|------|-------------|----------------|-----------|------|
| **1** | Product Listing | `SELECT ... WHERE quantity >= 1 ORDER BY createdAt DESC LIMIT 20` | ★★★★★ | Range + Sort |
| **2** | Product Search | `SELECT ... WHERE categoryId IN (...) AND price BETWEEN ... AND ...` | ★★★★☆ | Complex WHERE |
| **3** | Product Detail | `SELECT ... WHERE id = ? (+JOINs to Image, Discount, Rating, Brand)` | ★★★★☆ | Point + JOIN |
| **4** | Cart Operations | `SELECT/UPSERT ... WHERE orderedById = ? AND productId = ?` | ★★★☆☆ | Point Query |
| **5** | Order History | `SELECT ... WHERE orderedById = ? ORDER BY createdAt DESC` | ★★☆☆☆ | Point + Sort |

---

## 3. Query Type Distribution

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Query Type Distribution                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Range + Sort Queries ████████████████████████████████████ 40%      │
│  (listProd, listProdPaginated, displayProdBy)                       │
│                                                                      │
│  Complex WHERE Queries █████████████████████████████ 30%            │
│  (searchFilters - categoryId, price, brandId, title)                │
│                                                                      │
│  Point Queries ██████████████████ 20%                               │
│  (readAprod, getUserCart, getOrder by userId)                       │
│                                                                      │
│  Write Operations ████████ 10%                                      │
│  (createUserCart, saveOrder, addProdRating, favoriteProduct)        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. Read vs Write Operations Detail

### READ Operations (~90%)

| Operation | Service Function | Query Pattern | Est. % of Total |
|-----------|-----------------|---------------|-----------------|
| Product Listing | `listProd`, `listProdPaginated` | Range + Sort + Limit | 25% |
| Product Search | `searchFilters` | Complex WHERE | 20% |
| Product Detail | `readAprod` | Point + JOINs | 15% |
| Display By Criteria | `displayProdBy`, `displayProdByUser` | Range + Sort | 10% |
| Get Cart | `getUserCart` | Point + JOINs | 8% |
| Get Orders | `getOrder`, `getOrderPaginated` | Point + Sort | 5% |
| Get Categories/Brands | `listCategory`, `listBrand` | Full Scan (small tables) | 5% |
| Get Product Images | `getProductImages` | Point Query | 2% |

### WRITE Operations (~10%)

| Operation | Service Function | Query Pattern | Est. % of Total |
|-----------|-----------------|---------------|-----------------|
| Add/Update Cart | `createUserCart` | Upsert | 4% |
| Save Order | `saveOrder` | Insert + Update (Transaction) | 2% |
| Toggle Favorite | `favoriteProduct` | Insert/Delete | 2% |
| Add Rating | `addProdRating` | Insert + Update | 1% |
| Update Profile | `updateUserProfile` | Update | 0.5% |
| Clear Cart | `clearCart` | Delete | 0.5% |

---

## 5. User Journey & API Call Sequence

### Typical Guest User Flow:
```
1. Visit Home (/)
   └─ displayProdBy(sold) + displayProdBy(updatedAt) + readProductImages
   
2. Navigate to Shop (/shop) ← PRIMARY WORKLOAD
   └─ listProd(20) + listCategory + listBrand
   
3. Search Products
   └─ searchFilters (multiple times)
   
4. View Product Detail (/view-product/:id)
   └─ readAprod
   
5. Login → Redirect to User area
```

### Typical Logged-in User Flow:
```
1. Visit HomeUser (/user)
   └─ fetchUserCart → getUserCart + getProduct
   └─ displayProdBy + displayProdByUser
   
2. Navigate to ShopUser (/user/shop) ← PRIMARY WORKLOAD
   └─ listProd(20) + listCategory + listBrand
   
3. Search & Browse
   └─ searchFilters + loadMoreProducts (multiple)
   
4. View Product & Add to Cart (/user/view-product/:id)
   └─ readAprod + getCategory
   └─ createUserCart (on Add to Cart / Buy Now)
   
5. Checkout (/user/cart → /user/payment)
   └─ createPaymentIntent + saveOrder
   
6. View History (/user/history)
   └─ getOrder / getOrderPaginated
```

---

## 6. Peak Load Characteristics

| Time Period | Expected Load | Primary Operations |
|-------------|---------------|-------------------|
| Browsing (anytime) | High | listProd, searchFilters |
| Promotion Period | Very High | searchFilters, readAprod |
| Checkout Time | Medium | createUserCart, saveOrder |
| After Purchase | Low | getOrder, addProdRating |

---

## 7. Index Strategy Recommendations

Based on workload analysis:

| Workload Pattern | Recommended Index | Priority |
|------------------|-------------------|----------|
| Range + Sort (40%) | `Product(quantity, createdAt)` | ⭐⭐⭐ CRITICAL |
| Complex WHERE (30%) | `Product(categoryId)`, `Product(price)`, `Product(brandId)` | ⭐⭐⭐ CRITICAL |
| Point Query (20%) | `Cart(orderedById)`, `Order(orderedById)` | ⭐⭐ HIGH |
| Full-text Search | `Product(title)` GIN index | ⭐ MEDIUM |

---

## 8. Summary Table

| Metric | Value |
|--------|-------|
| **Workload Type** | OLTP (Read-Heavy) |
| **Read/Write Ratio** | 90:10 |
| **Primary Query Pattern** | Range + Sort (Product Listing) |
| **Secondary Query Pattern** | Complex WHERE (Product Search) |
| **Avg Response Time Target** | < 100ms |
| **Peak Concurrent Users** | Medium-High |
| **Transaction Size** | Small (1-10 rows) |
| **Critical Tables** | Product, Cart, Order |
| **Critical Columns** | quantity, createdAt, categoryId, price, orderedById |
