# Workload Analysis (Guest + User Only)

## Scope
วิเคราะห์ workload เฉพาะ **Guest** และ **User** routes (ไม่รวม Admin)  
รองรับ **Dynamic Indexing Research** โดยแบ่งตามช่วงเวลาใช้งาน

---

## 1. Workload Type: **OLTP (Read-Heavy)**

| Metric | Value |
|--------|-------|
| **Type** | OLTP (Online Transaction Processing) |
| **Read/Write Ratio** | ~85:15 (by frequency) |
| **Transaction Size** | Small (1-20 rows) |
| **Latency Requirement** | Low (<100ms) |

---

## 2. Workload Periods (สำหรับ Dynamic Indexing)

### Period 1: วันปกติ (Normal Days) → เน้นหน้า Shop

| ช่วงเวลา | Traffic | Primary Page | Primary APIs |
|----------|---------|--------------|--------------|
| **เช้า (06:00-12:00)** | Low-Medium | `/shop`, `/user/shop` | listProd, searchFilters |
| **Peak (17:00-22:00)** | High | `/shop`, `/user/shop` | listProd, searchFilters, createUserCart |
| **กลางคืน (00:00-06:00)** | Very Low | `/shop` | listProd |

**User Behavior**:
- เข้าใช้หน้า Shop เป็นหลัก
- ค้นหาสินค้า, เปรียบเทียบราคา
- Add to cart ช่วง peak
- การ checkout มักเกิดช่วง peak

### Period 2: Flash Sale → เน้นหน้า Home

| ช่วงเวลา | Traffic | Primary Page | Primary APIs |
|----------|---------|--------------|--------------|
| **Flash Sale (ตลอด event)** | Very High | `/`, `/user` | **listFlashSaleProducts**, displayProdBy, listProd |

**User Behavior**:
- เข้าหน้า Home เพื่อดู Flash Sale banner
- กด Flash Sale products โดยตรง
- ตัดสินใจซื้อเร็ว (impulse buying)
- Cart operations สูงกว่าปกติ

---

## 3. API Priority by Workload Period

### Normal Days (Shop-focused)

| Priority | Endpoint | Function | Freq |
|----------|----------|----------|------|
| ⭐⭐⭐ | `/api/products/:count` | listProd | ★★★★★ |
| ⭐⭐⭐ | `/api/products-paginated` | listProdPaginated | ★★★★★ |
| ⭐⭐⭐ | `/api/search-filters` | searchFilters | ★★★★☆ |
| ⭐⭐ | `/api/category` | listCategory | ★★★☆☆ |
| ⭐⭐ | `/api/brand` | listBrand | ★★★☆☆ |
| ⭐⭐ | `/api/user/cart` POST | createUserCart | ★★★☆☆ |
| ⭐ | `/api/product/:id` | readAprod | ★★★☆☆ |

### Flash Sale Period (Home-focused)

| Priority | Endpoint | Function | Freq |
|----------|----------|----------|------|
| ⭐⭐⭐ | `/api/products/flash-sale` | listFlashSaleProducts | ★★★★★ |
| ⭐⭐⭐ | `/api/display-prod-by` (sold) | displayProdBy | ★★★★☆ |
| ⭐⭐⭐ | `/api/user/cart` POST | createUserCart | ★★★★☆ |
| ⭐⭐ | `/api/product/:id` | readAprod | ★★★★☆ |
| ⭐⭐ | `/api/product/:id/images` | getProductImages | ★★★☆☆ |
| ⭐ | `/api/products/:count` | listProd | ★★★☆☆ |

---

## 4. Included API Endpoints (Guest + User)

### products.js
| Endpoint | Method | Type | Function |
|----------|--------|------|----------|
| `/api/products/flash-sale` | GET | READ | listFlashSaleProducts |
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

### auth.js & paymentStripe.js
| Endpoint | Method | Type | Function |
|----------|--------|------|----------|
| `/api/register` | POST | WRITE | register |
| `/api/login` | POST | WRITE | logIn |
| `/api/profile-user` | POST | READ | currUserProfile |
| `/api/user/create-payment-intent` | POST | WRITE | createPayment |
| `/api/user/cancel-payment-intent` | POST | WRITE | cancelPayment |
| `/api/user/refund-payment` | POST | WRITE | reqRefund |

### category.js & brand.js
| Endpoint | Method | Type | Function |
|----------|--------|------|----------|
| `/api/category` | GET | READ | listCategory |
| `/api/brand` | GET | READ | listBrand |

---

## 5. Index Recommendations by Period

### Normal Days (Shop-focused)
| Priority | Index | Table | Query Source |
|----------|-------|-------|--------------|
| ⭐⭐⭐ | `(quantity, createdAt)` | Product | listProd |
| ⭐⭐⭐ | `(categoryId)` | Product | searchFilters |
| ⭐⭐⭐ | `(price)` | Product | searchFilters |
| ⭐⭐⭐ | `(brandId)` | Product | searchFilters |
| ⭐⭐ | `(orderedById)` | Cart | createUserCart |

### Flash Sale Period (Home-focused)
| Priority | Index | Table | Query Source |
|----------|-------|-------|--------------|
| ⭐⭐⭐ | `(endDate, isActive)` | Discount | listFlashSaleProducts |
| ⭐⭐⭐ | `(productId)` | Discount | listFlashSaleProducts JOIN |
| ⭐⭐⭐ | `(orderedById)` | Cart | createUserCart (high volume) |
| ⭐⭐ | `(sold)` | Product | displayProdBy |
| ⭐⭐ | `(quantity)` | Product | flash sale filter |

---

## 6. Read/Write Summary

| Type | Count | % |
|------|-------|---|
| **READ** | 17 endpoints | 59% |
| **WRITE** | 12 endpoints | 41% |

**Actual Frequency Ratio**: ~85:15 (READ ถูกเรียกบ่อยกว่ามาก)

---

## 7. Dynamic Indexing Strategy

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Dynamic Indexing Framework                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  [Normal Days]              [Flash Sale Period]                      │
│  Shop-focused               Home-focused                             │
│                                                                      │
│  Active Indexes:            Active Indexes:                          │
│  ├── idx_product_qty_date   ├── idx_discount_enddate_active         │
│  ├── idx_product_categoryId ├── idx_discount_productId              │
│  ├── idx_product_price      ├── idx_product_sold                    │
│  ├── idx_product_brandId    ├── idx_cart_orderedById                │
│  └── idx_cart_orderedById   └── idx_product_quantity                │
│                                                                      │
│  Switch Trigger:            Switch Trigger:                          │
│  Manual / Scheduled         Flash Sale Start Event                   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```
