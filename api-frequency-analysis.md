# API Frequency Analysis for Database Indexing

## วัตถุประสงค์
วิเคราะห์ความถี่ API requests สำหรับ **Guest + User** routes เพื่อใช้ในงานวิจัย DB Indexing
แบ่งตาม 2 ช่วงหลัก: **Normal Days** และ **Flash Sale**

---

## 1. Workload Periods Summary

| Period | Primary Page | User Behavior | Index Focus |
|--------|--------------|---------------|-------------|
| **Normal Days** | Shop | ค้นหา, เปรียบเทียบ, เลือกซื้อ | Product (qty, cat, price, brand) |
| **Flash Sale** | Home | ดู banner, ซื้อเร็ว | Discount (time), Product (sold) |

---

## 2. Normal Days - API Analysis

### ช่วงเวลาและ Traffic

| ช่วง | Traffic | Primary APIs |
|------|---------|--------------|
| เช้า (06:00-12:00) | 20-40% | listProd, searchFilters |
| Peak (17:00-22:00) | 80-100% | listProd, searchFilters, createUserCart |
| กลางคืน (00:00-06:00) | 5-15% | listProd |

### Top APIs

| Rank | Endpoint | Method | Function | Score |
|------|----------|--------|----------|-------|
| 1 | `/api/products/:count` | GET | listProd | 10 |
| 2 | `/api/search-filters` | POST | searchFilters | 10 |
| 3 | `/api/user/cart` | POST | createUserCart | 9 |
| 4 | `/api/category` | GET | listCategory | 8 |
| 5 | `/api/brand` | GET | listBrand | 8 |

### Query Patterns

| Pattern | % | Example |
|---------|---|---------|
| Range + Sort | 45% | `WHERE qty >= 1 ORDER BY createdAt DESC` |
| Complex WHERE | 30% | `WHERE categoryId IN (...) AND price BETWEEN ...` |
| Upsert | 10% | `createUserCart` |
| Point Query | 8% | `WHERE id = ?` |

---

## 3. Flash Sale - API Analysis

### Traffic Pattern

| ช่วง | Traffic | Primary APIs |
|------|---------|--------------|
| ตลอด Event | 100-150% | listFlashSaleProducts, createUserCart |

### Top APIs

| Rank | Endpoint | Method | Function | Score |
|------|----------|--------|----------|-------|
| 1 | `/api/products/flash-sale` | GET | listFlashSaleProducts | 10 |
| 2 | `/api/user/cart` | POST | createUserCart | 10 |
| 3 | `/api/display-prod-by` | POST | displayProdBy | 9 |
| 4 | `/api/product/:id` | GET | readAprod | 8 |
| 5 | `/api/user/order` | POST | saveOrder | 7 |

### Query Patterns

| Pattern | % | Example |
|---------|---|---------|
| Time Filter | 35% | `WHERE endDate > NOW() AND isActive = true` |
| Sort | 25% | `ORDER BY sold DESC` |
| Upsert | 15% | `createUserCart` (high volume) |
| Point Query | 15% | `WHERE id = ?` |

---

## 4. Index Candidates by Period

### Normal Days

| Index | Table | Columns | Purpose |
|-------|-------|---------|---------|
| `idx_product_qty_date` | Product | (quantity, createdAt) | listProd |
| `idx_product_category` | Product | categoryId | searchFilters |
| `idx_product_price` | Product | price | searchFilters |
| `idx_product_brand` | Product | brandId | searchFilters |
| `idx_cart_user` | Cart | orderedById | cart ops |

### Flash Sale

| Index | Table | Columns | Purpose |
|-------|-------|---------|---------|
| `idx_discount_time` | Discount | (endDate, isActive) | Flash sale filter |
| `idx_discount_product` | Discount | productId | JOIN |
| `idx_product_sold` | Product | sold | BestSeller |
| `idx_cart_user` | Cart | orderedById | High volume |

---

## 5. Full API List (Guest + User Only)

### READ APIs (17)

| Endpoint | Function | Normal | Flash |
|----------|----------|--------|-------|
| `/api/products/flash-sale` | listFlashSaleProducts | Low | High |
| `/api/products/:count` | listProd | High | Medium |
| `/api/products-paginated` | listProdPaginated | High | Low |
| `/api/search-filters` | searchFilters | High | Low |
| `/api/product/:id` | readAprod | Medium | High |
| `/api/product/:id/images` | getProductImages | Low | Medium |
| `/api/display-prod-by` | displayProdBy | Low | High |
| `/api/display-prod-by-user` | displayProdByUser | Low | Medium |
| `/api/category` | listCategory | High | Low |
| `/api/brand` | listBrand | High | Low |
| `/api/user/cart` GET | getUserCart | Medium | Medium |
| `/api/user/order` GET | getOrder | Low | Low |
| `/api/user/order-paginated` | getOrderPaginated | Low | Low |
| `/api/profile-user` | currUserProfile | Low | Low |
| `/api/products-by-ids` | getProductsByIds | Low | Low |
| `/api/stock/:id` | getStock | Low | Low |
| `/api/sse` | subscribeStock | Low | Low |

### WRITE APIs (12)

| Endpoint | Function | Normal | Flash |
|----------|----------|--------|-------|
| `/api/user/cart` POST | createUserCart | High | Very High |
| `/api/user/order` POST | saveOrder | Medium | High |
| `/api/user/create-payment-intent` | createPayment | Medium | High |
| `/api/login` | logIn | Low | Low |
| `/api/register` | register | Low | Low |
| `/api/user/cart` DELETE | clearCart | Low | Low |
| `/api/user/address` | saveAddress | Low | Medium |
| `/api/user/rating` | addProdRating | Low | Low |
| `/api/user/favorite` | favoriteProduct | Low | Low |
| `/api/user/update-profile` | updateUserProfile | Low | Low |
| `/api/user/cancel-payment-intent` | cancelPayment | Low | Low |
| `/api/user/refund-payment` | reqRefund | Low | Low |

---

## 6. Summary Metrics

| Metric | Normal Days | Flash Sale |
|--------|-------------|------------|
| Read/Write Ratio | 85:15 | 80:20 |
| Primary Table | Product | Discount |
| Primary Index | (qty, createdAt) | (endDate, isActive) |
| Peak Traffic | 17:00-22:00 | Throughout event |
