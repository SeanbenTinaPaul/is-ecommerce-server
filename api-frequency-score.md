# API Frequency Score Analysis for DB Indexing Research

## วัตถุประสงค์
วิเคราะห์ความถี่ของ API requests สำหรับ **Guest + User** routes (ไม่รวม Admin)  
รองรับ **Dynamic Indexing Research** โดยแบ่งตามช่วงเวลาใช้งาน

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

## 1. Workload Periods

### Period 1: วันปกติ (Normal Days)
- **Primary Page**: `/shop`, `/user/shop`
- **User Behavior**: ค้นหา, เปรียบเทียบ, เลือกซื้อ

| ช่วงเวลา | Traffic | Est. Load |
|----------|---------|-----------|
| เช้า (06:00-12:00) | Low-Medium | 20-40% |
| Peak (17:00-22:00) | High | 80-100% |
| กลางคืน (00:00-06:00) | Very Low | 5-15% |

### Period 2: Flash Sale
- **Primary Page**: `/`, `/user` (Home)
- **User Behavior**: ดู Flash Sale, ตัดสินใจเร็ว, ซื้อทันที

| ช่วงเวลา | Traffic | Est. Load |
|----------|---------|-----------|
| Flash Sale Event | Very High | 100-150% |

---

## 2. API Frequency Scoring (Normal Days - Shop Focus)

### Guest Routes

| Score | API Endpoint | Method | Function | Triggered By |
|-------|--------------|--------|----------|--------------|
| **10** | `/api/products/:count` | GET | listProd | Shop load |
| **10** | `/api/products-paginated` | GET | listProdPaginated | Load More |
| **9** | `/api/search-filters` | POST | searchFilters | Search submit |
| **8** | `/api/category` | GET | listCategory | SearchForProd |
| **8** | `/api/brand` | GET | listBrand | SearchForProd |
| **7** | `/api/product/:id` | GET | readAprod | ViewProdPage |
| **5** | `/api/display-prod-by` | POST | displayProdBy | Home (less priority) |
| **4** | `/api/product/:id/images` | GET | getProductImages | Home |
| **3** | `/api/login` | POST | logIn | Login page |
| **2** | `/api/register` | POST | register | Register page |

### User Routes

| Score | API Endpoint | Method | Function | Triggered By |
|-------|--------------|--------|----------|--------------|
| **10** | `/api/products/:count` | GET | listProd | ShopUser load |
| **10** | `/api/products-paginated` | GET | listProdPaginated | Load More |
| **10** | `/api/user/cart` | POST | createUserCart | Add to cart |
| **9** | `/api/search-filters` | POST | searchFilters | Search submit |
| **9** | `/api/product/:id` | GET | readAprod | ViewProdPageUser |
| **8** | `/api/category` | GET | listCategory | SearchForProd |
| **8** | `/api/brand` | GET | listBrand | SearchForProd |
| **8** | `/api/user/cart` | GET | getUserCart | HomeUser |
| **6** | `/api/user/order` | GET | getOrder | HistoryUser |
| **5** | `/api/display-prod-by` | POST | displayProdBy | HomeUser |

**Normal Days Total Score: ~150 pts**

---

## 3. API Frequency Scoring (Flash Sale - Home Focus)

### Guest + User Routes (Combined)

| Score | API Endpoint | Method | Function | Triggered By |
|-------|--------------|--------|----------|--------------|
| **10** | `/api/products/flash-sale` | GET | listFlashSaleProducts | Home/HomeUser |
| **10** | `/api/user/cart` | POST | createUserCart | Quick buy |
| **9** | `/api/display-prod-by` (sold) | POST | displayProdBy | Home BestSeller |
| **9** | `/api/display-prod-by` (updatedAt) | POST | displayProdBy | Home NewProd |
| **8** | `/api/product/:id` | GET | readAprod | Flash Sale item click |
| **8** | `/api/user/cart` | GET | getUserCart | HomeUser |
| **7** | `/api/product/:id/images` | GET | getProductImages | Banner |
| **6** | `/api/products/:count` | GET | listProd | Shop (secondary) |
| **5** | `/api/user/order` | POST | saveOrder | Checkout |
| **5** | `/api/user/create-payment-intent` | POST | createPayment | Payment |

**Flash Sale Total Score: ~140 pts**

---

## 4. Index Candidates by Period

### Normal Days (Shop-focused)

| Rank | Index | Table | Column(s) | Score | Query |
|------|-------|-------|-----------|-------|-------|
| 1 | `idx_product_qty_date` | Product | (quantity, createdAt) | 20 | listProd |
| 2 | `idx_product_categoryId` | Product | categoryId | 18 | searchFilters |
| 3 | `idx_product_price` | Product | price | 18 | searchFilters |
| 4 | `idx_product_brandId` | Product | brandId | 17 | searchFilters |
| 5 | `idx_cart_orderedById` | Cart | orderedById | 18 | cart ops |

### Flash Sale (Home-focused)

| Rank | Index | Table | Column(s) | Score | Query |
|------|-------|-------|-----------|-------|-------|
| 1 | `idx_discount_enddate_active` | Discount | (endDate, isActive) | 20 | listFlashSaleProducts |
| 2 | `idx_discount_productId` | Discount | productId | 18 | JOIN products |
| 3 | `idx_cart_orderedById` | Cart | orderedById | 20 | high cart volume |
| 4 | `idx_product_sold` | Product | sold | 18 | displayProdBy |
| 5 | `idx_product_quantity` | Product | quantity | 14 | stock filter |

---

## 5. Prisma Schema Index Syntax

### For Normal Days
```prisma
model Product {
  @@index([quantity, createdAt])   // listProd
  @@index([categoryId])            // searchFilters
  @@index([price])                 // searchFilters
  @@index([brandId])               // searchFilters
}

model Cart {
  @@index([orderedById])           // cart operations
}
```

### For Flash Sale (Additional)
```prisma
model Discount {
  @@index([endDate, isActive])     // flash sale query
  @@index([productId])             // JOIN optimization
}

model Product {
  @@index([sold])                  // BestSeller
  @@index([updatedAt])             // NewProd
}
```

---

## 6. Summary

| Period | Primary Page | Top APIs | Critical Indexes |
|--------|--------------|----------|-----------------|
| Normal Days | Shop | listProd, searchFilters | Product(qty,date), Product(categoryId) |
| Flash Sale | Home | listFlashSaleProducts, displayProdBy | Discount(endDate,isActive), Product(sold) |
