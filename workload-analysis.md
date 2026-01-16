# Workload Analysis for E-commerce Application

## วัตถุประสงค์
วิเคราะห์ workload characteristics สำหรับ **Guest + User** (ไม่รวม Admin)  
รองรับ **Dynamic Indexing Research** โดยแบ่งตามช่วงเวลา

---

## 1. Workload Type: **OLTP (Read-Heavy)**

| Metric | Value |
|--------|-------|
| **Type** | OLTP (Online Transaction Processing) |
| **Read/Write Ratio** | ~85:15 (by frequency) |
| **Transaction Size** | Small (1-20 rows) |
| **Latency Requirement** | Low (<100ms) |

---

## 2. Workload Periods

### Period 1: วันปกติ (Normal Days)

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Normal Days Timeline                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  00:00 ──────── 06:00 ──────── 12:00 ──────── 18:00 ──────── 24:00  │
│  ▓▓░░░░░░░░░░░░░░░▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓████████████████▓▓▓▓▓▓▓   │
│  Very Low        Low-Medium                 PEAK   ←17:00-22:00     │
│  (5-15%)         (20-40%)                   (80-100%)               │
│                                                                      │
│  Primary Page: /shop, /user/shop                                     │
│  Primary APIs: listProd, searchFilters, createUserCart              │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

| ช่วง | เวลา | Traffic | Primary Actions |
|------|------|---------|-----------------|
| กลางคืน | 00:00-06:00 | Very Low (5-15%) | Browsing only |
| เช้า | 06:00-12:00 | Low-Medium (20-40%) | Search, Compare |
| บ่าย | 12:00-17:00 | Medium (40-60%) | Search, Add to cart |
| **Peak** | 17:00-22:00 | **High (80-100%)** | Buy, Checkout |
| ค่ำ | 22:00-24:00 | Medium (40-60%) | Browse, Compare |

### Period 2: Flash Sale

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Flash Sale Timeline                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Event Start ─────────────────────────────────────── Event End      │
│  ██████████████████████████████████████████████████████████████████ │
│  VERY HIGH (100-150% of normal peak)                                │
│                                                                      │
│  Primary Page: /, /user (Home)                                       │
│  Primary APIs: listFlashSaleProducts, displayProdBy, createUserCart │
│                                                                      │
│  User Behavior:                                                      │
│  ├── Visit Home first → See Flash Sale banner                       │
│  ├── Click Flash Sale products directly                             │
│  ├── Quick decision making (impulse buying)                         │
│  └── High cart/checkout operations                                  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Query Type Distribution

### Normal Days (Shop-focused)

```
READ Patterns (85%):
├── Range + Sort (45%): listProd, listProdPaginated
├── Complex WHERE (30%): searchFilters (category, price, brand)
├── Point Query (8%): readAprod, getUserCart
└── Full Scan (2%): listCategory, listBrand

WRITE Patterns (15%):
├── Upsert (10%): createUserCart
├── Insert (3%): saveOrder
└── Update/Delete (2%): favoriteProduct, clearCart
```

### Flash Sale (Home-focused)

```
READ Patterns (80%):
├── Time-based Filter (35%): listFlashSaleProducts (discount.endDate, isActive)
├── Sort by Popularity (25%): displayProdBy (sold, updatedAt)
├── Point Query (15%): readAprod
└── Range Query (5%): listProd (secondary)

WRITE Patterns (20%):
├── Upsert (15%): createUserCart (high volume)
├── Insert (4%): saveOrder
└── Payment (1%): createPaymentIntent
```

---

## 4. Primary APIs by Period

### Normal Days

| Rank | API | Function | Query Pattern |
|------|-----|----------|---------------|
| 1 | `/api/products/:count` | listProd | Range + Sort |
| 2 | `/api/search-filters` | searchFilters | Complex WHERE |
| 3 | `/api/products-paginated` | listProdPaginated | Range + Sort |
| 4 | `/api/user/cart` POST | createUserCart | Upsert |
| 5 | `/api/category` | listCategory | Full Scan |

### Flash Sale

| Rank | API | Function | Query Pattern |
|------|-----|----------|---------------|
| 1 | `/api/products/flash-sale` | listFlashSaleProducts | Time Filter + JOIN |
| 2 | `/api/user/cart` POST | createUserCart | Upsert (high volume) |
| 3 | `/api/display-prod-by` | displayProdBy | Sort (sold/updatedAt) |
| 4 | `/api/product/:id` | readAprod | Point Query |
| 5 | `/api/user/order` POST | saveOrder | Insert + Transaction |

---

## 5. Index Strategy by Period

### Normal Days (Activate These)

| Index | Table | Columns | Purpose |
|-------|-------|---------|---------|
| `idx_product_qty_date` | Product | (quantity, createdAt) | listProd |
| `idx_product_category` | Product | categoryId | searchFilters |
| `idx_product_price` | Product | price | searchFilters |
| `idx_product_brand` | Product | brandId | searchFilters |
| `idx_cart_user` | Cart | orderedById | cart operations |

### Flash Sale (Activate These Additionally)

| Index | Table | Columns | Purpose |
|-------|-------|---------|---------|
| `idx_discount_time` | Discount | (endDate, isActive) | Flash sale filter |
| `idx_discount_product` | Discount | productId | JOIN optimization |
| `idx_product_sold` | Product | sold | BestSeller |
| `idx_product_updated` | Product | updatedAt | NewProd |

---

## 6. Dynamic Indexing Framework

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Dynamic Index Switching                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Baseline Indexes (Always Active):                                   │
│  ├── Primary Keys (auto)                                            │
│  ├── Unique Constraints (auto)                                       │
│  └── Foreign Key Relations (auto)                                   │
│                                                                      │
│  ┌─────────────────────┐    ┌─────────────────────┐                │
│  │   Normal Days       │    │   Flash Sale        │                │
│  │                     │    │                     │                │
│  │ + idx_product_qty   │    │ + idx_discount_time │                │
│  │ + idx_product_cat   │    │ + idx_discount_prod │                │
│  │ + idx_product_price │    │ + idx_product_sold  │                │
│  │ + idx_product_brand │    │ + idx_cart_user(↑)  │                │
│  │ + idx_cart_user     │    │                     │                │
│  └─────────────────────┘    └─────────────────────┘                │
│           │                           │                            │
│           └───────────┬───────────────┘                            │
│                       │                                            │
│                       ▼                                            │
│               [Index Switching]                                    │
│               Trigger: Flash Sale Start/End Event                  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 7. Summary

| Metric | Normal Days | Flash Sale |
|--------|-------------|------------|
| Primary Page | Shop | Home |
| Traffic Pattern | Peak evening | Constant high |
| Read/Write | 85:15 | 80:20 |
| Critical Table | Product | Discount, Product |
| Critical Index | (qty, createdAt) | (endDate, isActive) |
