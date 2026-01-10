# Workload Analysis (Guest + User Only)

## Scope
วิเคราะห์ workload เฉพาะ **Guest** และ **User** routes เท่านั้น (ไม่รวม Admin)

---

## 1. Workload Type: **OLTP (Read-Heavy)**

| Metric | Value |
|--------|-------|
| **Type** | OLTP (Online Transaction Processing) |
| **Read/Write Ratio** | ~85:15 (by frequency) |
| **Transaction Size** | Small (1-20 rows) |
| **Latency Requirement** | Low (<100ms) |

---

## 2. Included API Endpoints

### products.js (Guest + User)
| Endpoint | Method | Type | Function |
|----------|--------|------|----------|
| `/api/products/:count` | GET | READ | listProd |
| `/api/products-paginated` | GET | READ | listProdPaginated |
| `/api/product/:id` | GET | READ | readAprod |
| `/api/product/:id/images` | GET | READ | getProductImages |
| `/api/products-by-ids` | POST | READ | getProductsByIds |
| `/api/display-prod-by` | POST | READ | displayProdBy |
| `/api/display-prod-by-user` | GET | READ | displayProdByUser |
| `/api/search-filters` | POST | READ | searchFilters |
| `/api/stock/:id` | GET | READ | getStock |
| `/api/sse` | GET | READ | subscribeStock |
| `/api/images` | POST | WRITE | uploadImages |
| `/api/removeimage` | POST | WRITE | removeImage |

### user.js
| Endpoint | Method | Type | Function |
|----------|--------|------|----------|
| `/api/user/cart` | POST | WRITE | createUserCart |
| `/api/user/cart` | GET | READ | getUserCart |
| `/api/user/cart` | DELETE | WRITE | clearCart |
| `/api/user/address` | POST | WRITE | saveAddress |
| `/api/user/order` | POST | WRITE | saveOrder |
| `/api/user/order` | GET | READ | getOrder |
| `/api/user/order-paginated` | GET | READ | getOrderPaginated |
| `/api/user/rating` | POST | WRITE | addProdRating |
| `/api/user/favorite` | POST | WRITE | favoriteProduct |
| `/api/user/update-profile` | PATCH | WRITE | updateUserProfile |

### auth.js (Guest + User)
| Endpoint | Method | Type | Function |
|----------|--------|------|----------|
| `/api/register` | POST | WRITE | register |
| `/api/login` | POST | WRITE | logIn |
| `/api/profile-user` | POST | READ | currUserProfile |

### paymentStripe.js
| Endpoint | Method | Type | Function |
|----------|--------|------|----------|
| `/api/user/create-payment-intent` | POST | WRITE | createPayment |
| `/api/user/cancel-payment-intent` | POST | WRITE | cancelPayment |
| `/api/user/refund-payment` | POST | WRITE | reqRefund |

### category.js & brand.js (Read Only)
| Endpoint | Method | Type | Function |
|----------|--------|------|----------|
| `/api/category` | GET | READ | listCategory |
| `/api/brand` | GET | READ | listBrand |

---

## 3. Read/Write Summary

| Type | Count | % |
|------|-------|---|
| **READ** | 16 endpoints | 57% |
| **WRITE** | 12 endpoints | 43% |

**Actual Frequency Ratio: ~85:15** (READ endpoints ถูกเรียกบ่อยกว่ามาก)

---

## 4. Top 10 Request Patterns

| Rank | Pattern | Endpoint | Method | Type | Frequency |
|------|---------|----------|--------|------|-----------|
| 1 | Product Listing | `/api/products/:count` | GET | READ | ★★★★★ |
| 2 | Product Pagination | `/api/products-paginated` | GET | READ | ★★★★★ |
| 3 | Search/Filter | `/api/search-filters` | POST | READ | ★★★★☆ |
| 4 | Save Cart | `/api/user/cart` | POST | WRITE | ★★★★☆ |
| 5 | Product Detail | `/api/product/:id` | GET | READ | ★★★★☆ |
| 6 | Get Cart | `/api/user/cart` | GET | READ | ★★★☆☆ |
| 7 | Display Products | `/api/display-prod-by` | POST | READ | ★★★☆☆ |
| 8 | List Categories | `/api/category` | GET | READ | ★★★☆☆ |
| 9 | List Brands | `/api/brand` | GET | READ | ★★★☆☆ |
| 10 | Product Images | `/api/product/:id/images` | GET | READ | ★★☆☆☆ |

---

## 5. Query Type Distribution

```
READ Patterns (85%):
├── Range + Sort (40%): listProd, listProdPaginated, displayProdBy
├── Complex WHERE (25%): searchFilters
├── Point Query (15%): readAprod, getUserCart, getOrder
└── Full Scan (5%): listCategory, listBrand (small tables)

WRITE Patterns (15%):
├── Upsert (8%): createUserCart
├── Insert (4%): saveOrder, register, addProdRating
├── Update (2%): updateUserProfile, saveAddress
└── Delete (1%): clearCart, favoriteProduct (toggle)
```

---

## 6. Frontend Trigger Points

### Guest Layout (Layout.jsx)
- ไม่มี API call โดยตรง → delegate ให้ child pages

### User Layout (LayoutUser.jsx)
- `syncCartProductsFromDB()` → `/api/products-by-ids` (on mount)

### Primary Pages (Shop > Home):
| Page | APIs Triggered |
|------|----------------|
| Shop/ShopUser | listProd, listProdPaginated, listCategory, listBrand, searchFilters |
| ViewProdPage | readAprod, getCategory, createUserCart, favoriteProduct |
| Home/HomeUser | displayProdBy, getProductImages, fetchUserCart, displayProdByUser |
| Cart | createUserCart, getUserCart |
| History | getOrder, getOrderPaginated |

---

## 7. Index Recommendations for Guest + User

| Priority | Index | Table | Query Source |
|----------|-------|-------|--------------|
| ⭐⭐⭐ | `(quantity, createdAt)` | Product | listProd, listProdPaginated |
| ⭐⭐⭐ | `(categoryId)` | Product | searchFilters |
| ⭐⭐⭐ | `(price)` | Product | searchFilters |
| ⭐⭐⭐ | `(brandId)` | Product | searchFilters |
| ⭐⭐⭐ | `(orderedById)` | Cart | createUserCart, getUserCart |
| ⭐⭐ | `(sold)` | Product | displayProdBy |
| ⭐⭐ | `(updatedAt)` | Product | displayProdBy |
| ⭐⭐ | `(orderedById)` | Order | getOrder, getOrderPaginated |
| ⭐ | `(productId)` | ProductOnOrder | readAprod |
| ⭐ | `(userId)` | Favorite | favoriteProduct |
