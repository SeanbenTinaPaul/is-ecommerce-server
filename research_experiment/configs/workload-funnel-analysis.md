# Funnel-Based Workload Analysis — WeStride E-commerce

## Research Context
This document provides a **Funnel-Based Workload Analysis** for the WeStride E-commerce application, designed for k6 load testing weight configuration. The analysis focuses on **authenticated user journeys** starting with the `/user` path.

**Methodology**: Conversion Funnel Model (Baymard 2023, Shopify 2023) + TPC-W Workload Calibration (TPC Council)

> Theory & references: `server/research_experiment/theory_conceptual/funnel_workload_modeling.md`

---

## Output 1: Conversion Funnel Definition

### Scenario A: Standard Shopping (Off-peak, Normal, Peak)

| Tier | Stage | Funnel Rate | Source |
|------|-------|-------------|--------|
| 1 | Discovery (Home/Shop) | **100%** | Baseline — ทุก session เริ่มที่นี่ |
| 2 | Product Viewing | **50%** | Shopify Global Benchmark 2023 |
| 3 | Add to Cart | **7.5%** (15% of viewers) | Blend Commerce / Shopify |
| 4 | Checkout & Payment | **2.17%** | 29.78% checkout rate × 97.2% success |

**Conversion Math:**
```
Overall Conversion = 50% × 15% × 29.78% × 97.2% = 2.17%
                     (view)  (ATC) (checkout) (pay success)
```

**Secondary Pages** (not in main funnel):
- History: ~2.17% (post-purchase page view)
- Favorite: ~5% (secondary browsing feature)

---

### Scenario B: Flash Sale

| Tier | Stage | Funnel Rate | Source |
|------|-------|-------------|--------|
| 1 | Discovery (Home) | **30%** of users (70% bypass) | Pre-loaded cart mechanics |
| 2 | Product Viewing (Flash Item) | **100%** (all users view flash item) | Direct from Home/notification |
| 3 | Add to Cart | **75%** of viewers (panic buying) | SaleCycle 2023 |
| 4 | Checkout & Payment | **6.5%** peak conversion | Black Friday peak benchmarks |

```
Normal flow (30%) : Home → ViewProduct → Cart → Payment
Pre-loaded (70%) : Direct → Cart → Payment (skip browsing)
P(Success | Checkout) = 36.8% (under DB lock contention)
```

---

## Output 2: Page-to-API Mapping Table

### Frontend Component to Backend API Mapping

| Frontend Component | Route Path | Likely API Calls (per page load) | Backend Functions |
|-------------------|------------|----------------------------------|-------------------|
| `<HomeUser />` | `/user` | Flash sale products, Best sellers, New products, User favorites, User cart | `listFlashSaleProducts`, `displayProdBy` ×2, `displayProdByUser`, `getUserCart` |
| `<ShopUser />` | `/user/shop` | Product listing, Load more products, Search with filters | `listProd`, `listProdPaginated` (on scroll), `searchFilters`, `listCategory`, `listBrand` |
| `<ViewProdPageUser />` | `/user/view-product/:id` | Single product details, Toggle favorite, Add to cart | `readAprod`, `toggleFavoriteUser` (optional), `createUserCart` (on action) |
| `<CartUser />` | `/user/cart` | Create/update cart in DB | `createUserCart`, `getProductsByIds` (cart sync) |
| `<Payment />` | `/user/payment` | Get cart, Save address, Create payment intent, Confirm order | `getCartUser`, `saveAddressUser`, `createPaymentUser`, `saveOrderUser` |
| `<HistoryUser />` | `/user/history` | Order history (paginated), Add rating, Refund request | `getOrderUserPaginated`, `addRatingUser` (on action), `reqRefund` (on action) |
| `<FavoriteUser />` | `/user/favorite` | Full product list for filtering | `listProd` |
| `<EditProfileUser />` | `/user/editprofile` | Update user profile | `updateUserProfile` |

### API Endpoint Reference

| API Endpoint | Method | Function Name | Service File | Trigger Type |
|-------------|--------|---------------|--------------|--------------|
| `/api/products/:count` | GET | `listProd` | productService.js | Page Load |
| `/api/products-paginated` | GET | `listProdPaginated` | productService.js | On Scroll/Button |
| `/api/products/flash-sale` | GET | `listFlashSaleProducts` | productService.js | Page Load |
| `/api/product/:id` | GET | `readAprod` | productService.js | Page Load |
| `/api/display-prod-by` | POST | `displayProdBy` | productService.js | Page Load |
| `/api/display-prod-by-user` | GET | `displayProdByUser` | productService.js | Page Load |
| `/api/search-filters` | POST | `searchFilters` | productService.js | User Action |
| `/api/category` | GET | `listCategory` | productService.js | Page Load |
| `/api/brand` | GET | `listBrand` | brandService.js | Page Load |
| `/api/products-by-ids` | POST | `getProductsByIds` | productService.js | Cart Sync |
| `/api/user/cart` | POST | `createUserCart` | userService.js | User Action |
| `/api/user/cart` | GET | `getUserCart` | userService.js | Page Load |
| `/api/user/address` | POST | `saveAddressUser` | userService.js | User Action |
| `/api/user/order` | POST | `saveOrderUser` | userService.js | User Action |
| `/api/user/order-paginated` | GET | `getOrderUserPaginated` | userService.js | Page Load |
| `/api/user/rating` | POST | `addRatingUser` | userService.js | User Action |
| `/api/user/favorite` | POST | `toggleFavoriteUser` | userService.js | User Action |
| `/api/user/create-payment-intent` | POST | `createPaymentUser` | paymentService.js | Page Load (conditional) |
| `/api/user/cancel-payment-intent` | POST | `reqCancelPayment` | paymentService.js | User Action |
| `/api/user/refund-payment` | POST | `reqRefund` | paymentService.js | User Action |

---

## Output 3: Calibrated API Weights for k6 (k6-ready)

### Calculation Methodology

Weights are calculated in 3 steps:

1. **Raw Funnel Weight** = `Funnel_Rate × P(trigger) × Calls_Per_Visit`
2. **TPC-W Calibration** = Scale all Write weights by a factor to match target R:W ratio
3. **Normalization** = Scale all weights so max ≈ 100

> **Calibration reference**: TPC-W Benchmark (TPC Council) — the industry-standard e-commerce benchmark that defines parameterizable workload profiles (WIPSb, WIPS, WIPSo) to target specific R:W ratios.

---

### Scenario A: Standard Shopping — TPC-W "WIPS" (80:20)

**Funnel Rates Applied:**

| Funnel Tier | Pages | Rate | Primary APIs Called |
|-------------|-------|------|---------------------|
| Tier 1: Discovery | Home, Shop | 100% | getUserCart, listFlashSaleProducts, displayProdBy×2, listProd, listCategory, listBrand |
| Tier 2: Product Viewing | ViewProduct | 50% | readAprod |
| Tier 3: Add to Cart | Cart | 7.5% | createUserCart, getProductsByIds |
| Tier 4: Checkout & Payment | Payment | 2.17% | getCartUser, saveAddressUser, createPaymentUser, saveOrderUser |
| Secondary | History | 2.17% | getOrderUserPaginated |
| Secondary | Favorite | 5% | listProd |

**Raw Weights → Calibrated (Write ×8.77) → Normalized (max=100):**

| API | Type | Raw Weight Calculation | Raw | Calibrated | Normalized |
|-----|------|----------------------|-----|-----------|-----------|
| `displayProdBy` | READ | Home(100%×1.0×2) | 2.000 | 2.000 | **100** |
| `listProd` | READ | Shop(100%×1.0×1)+Fav(5%×1.0×1) | 1.050 | 1.050 | **53** |
| `listFlashSaleProducts` | READ | Home(100%×1.0×1) | 1.000 | 1.000 | **50** |
| `displayProdByUser` | READ | Home(100%×1.0×1) | 1.000 | 1.000 | **50** |
| `listCategory` | READ | Shop(100%×1.0×1) | 1.000 | 1.000 | **50** |
| `listBrand` | READ | Shop(100%×1.0×1) | 1.000 | 1.000 | **50** |
| `getUserCart` | READ | Home(100%×1.0×1) | 1.000 | 1.000 | **50** |
| `readAprod` | READ | ViewProd(50%×1.0×1) | 0.500 | 0.500 | **25** |
| `listProdPaginated` | READ | Shop(100%×0.5×1) | 0.500 | 0.500 | **25** |
| `searchFilters` | READ | Shop(100%×0.3×1) | 0.300 | 0.300 | **15** |
| `getProductsByIds` | READ | Cart(7.5%×1.0×1) | 0.075 | 0.075 | **4** |
| `getCartUser` | READ | Payment(2.17%×1.0×1) | 0.022 | 0.022 | **1** |
| `getOrderUserPaginated` | READ | History(2.17%×1.0×1) | 0.022 | 0.022 | **1** |
| `createUserCart` | WRITE | ViewProd(50%×0.15)+Cart(7.5%×1.0) | 0.150 | 1.316 | **66** |
| `toggleFavoriteUser` | WRITE | ViewProd(50%×0.1×1) | 0.050 | 0.439 | **22** |
| `saveAddressUser` | WRITE | Payment(2.17%×1.0×1) | 0.022 | 0.190 | **10** |
| `createPaymentUser` | WRITE | Payment(2.17%×1.0×1) | 0.022 | 0.190 | **10** |
| `saveOrderUser` | WRITE | Payment(2.17%×1.0×1) | 0.022 | 0.190 | **10** |
| `addRatingUser` | WRITE | History(2.17%×0.1×1) | 0.002 | 0.019 | **1** |
| `reqCancelPayment` | WRITE | Payment(2.17%×0.05×1) | 0.001 | 0.010 | **1** |
| `reqRefund` | WRITE | History(2.17%×0.02×1) | 0.000 | 0.004 | **1** |

**Write Scale Factor**: `(20/80) / (0.27/9.47) = 0.25 / 0.0285 = 8.77`

---

### Scenario B: Flash Sale — TPC-W "WIPSo" (50:50)

**Funnel Rates Applied:**

| Funnel Tier | Pages | Rate | Primary APIs Called |
|-------------|-------|------|---------------------|
| Tier 1: Discovery | Home | 30% (70% bypass) | getUserCart, listFlashSaleProducts |
| Tier 2: Product Viewing | ViewProduct (flash item) | 100% | readAprod |
| Tier 3: Add to Cart | Cart | 75% | createUserCart, getProductsByIds |
| Tier 4: Checkout & Payment | Payment | 6.5% | getCartUser, saveAddressUser, createPaymentUser, saveOrderUser |

**Raw Weights → Calibrated (Write ×3.63) → Normalized (max=100):**

| API | Type | Raw Weight Calculation | Raw | Calibrated | Normalized |
|-----|------|----------------------|-----|-----------|-----------|
| `readAprod` | READ | ViewProd(100%×1.0×1) | 1.000 | 1.000 | **37** |
| `getProductsByIds` | READ | Cart(75%×1.0×1) | 0.750 | 0.750 | **28** |
| `displayProdBy` | READ | Home(30%×1.0×2) | 0.600 | 0.600 | **22** |
| `listFlashSaleProducts` | READ | Home(30%×1.0×1) | 0.300 | 0.300 | **11** |
| `displayProdByUser` | READ | Home(30%×1.0×1) | 0.300 | 0.300 | **11** |
| `getUserCart` | READ | Home(30%×1.0×1) | 0.300 | 0.300 | **11** |
| `getCartUser` | READ | Payment(6.5%×1.0×1) | 0.065 | 0.065 | **2** |
| `getOrderUserPaginated` | READ | Post-purchase(6.5%×1.0×1) | 0.065 | 0.065 | **2** |
| `listProd` | READ | Minimal browsing | 0.050 | 0.050 | **2** |
| `listCategory` | READ | Minimal | 0.050 | 0.050 | **2** |
| `listBrand` | READ | Minimal | 0.050 | 0.050 | **2** |
| `searchFilters` | READ | Almost no searching | 0.030 | 0.030 | **1** |
| `listProdPaginated` | READ | Minimal | 0.020 | 0.020 | **1** |
| `createUserCart` | WRITE | ViewProd(100%×0.75×1) | 0.750 | 2.723 | **100** |
| `saveAddressUser` | WRITE | Payment(6.5%×1.0×1) | 0.065 | 0.236 | **9** |
| `createPaymentUser` | WRITE | Payment(6.5%×1.0×1) | 0.065 | 0.236 | **9** |
| `saveOrderUser` | WRITE | Payment(6.5%×1.0×1) | 0.065 | 0.236 | **9** |
| `toggleFavoriteUser` | WRITE | ViewProd(100%×0.02×1) | 0.020 | 0.073 | **3** |
| `reqCancelPayment` | WRITE | Payment(6.5%×0.3×1) | 0.020 | 0.071 | **3** |
| `addRatingUser` | WRITE | Minimal | 0.002 | 0.007 | **1** |
| `reqRefund` | WRITE | Minimal | 0.001 | 0.004 | **1** |

**Write Scale Factor**: `(50/50) / (0.99/3.58) = 1.0 / 0.276 = 3.63`

---

### Read:Write Ratio Verification

| Scenario | Total Read | Total Write | Ratio | TPC-W Target | Match? |
|----------|-----------|-------------|-------|-------------|--------|
| Standard Shopping | 474 | 121 | **80:20** | WIPS (80:20) | ✅ |
| Flash Sale | 132 | 135 | **50:50** | WIPSo (50:50) | ✅ |

---

### k6 Weight Configuration (Copy-Ready)

```javascript
// Scenario A: Standard Shopping (TPC-W WIPS 80:20)
// Phases: Off-peak (20 VU), Normal (100 VU), Peak (300 VU)
const STANDARD_WEIGHTS = {
  // READ Operations (Tier 1-2 heavy)
  displayProdBy: 100,        // Home ×2 calls
  listProd: 53,              // Shop + Favorite
  listFlashSaleProducts: 50, // Home
  displayProdByUser: 50,     // Home
  listCategory: 50,          // Shop
  listBrand: 50,             // Shop
  getUserCart: 50,            // Home
  readAprod: 25,             // ViewProduct (Tier 2: 50%)
  listProdPaginated: 25,     // Shop (on scroll)
  searchFilters: 15,         // Shop (30% trigger)
  getProductsByIds: 4,       // Cart (Tier 3: 7.5%)
  getCartUser: 1,            // Payment (Tier 4: 2.17%)
  getOrderUserPaginated: 1,  // History

  // WRITE Operations (calibrated ×8.77 for WIPS 80:20)
  createUserCart: 66,        // ViewProduct ATC + Cart sync
  toggleFavoriteUser: 22,    // ViewProduct (10% trigger)
  saveAddressUser: 10,       // Payment (Tier 4)
  createPaymentUser: 10,     // Payment (Tier 4)
  saveOrderUser: 10,         // Payment (Tier 4)
  addRatingUser: 1,          // History (rare)
  reqCancelPayment: 1,       // Payment (rare)
  reqRefund: 1               // History (rare)
};

// Scenario B: Flash Sale (TPC-W WIPSo 50:50)
// Phase: Flash Sale (1000 VU)
const FLASH_SALE_WEIGHTS = {
  // READ Operations (ViewProduct dominant, minimal browsing)
  readAprod: 37,             // ViewProduct (Tier 2: 100%)
  getProductsByIds: 28,      // Cart sync (Tier 3: 75%)
  displayProdBy: 22,         // Home (30% non-bypass)
  listFlashSaleProducts: 11, // Home (30%)
  displayProdByUser: 11,     // Home (30%)
  getUserCart: 11,            // Home (30%)
  getCartUser: 2,            // Payment (Tier 4: 6.5%)
  getOrderUserPaginated: 2,  // Post-purchase
  listProd: 2,               // Minimal browsing
  listCategory: 2,           // Minimal
  listBrand: 2,              // Minimal
  searchFilters: 1,          // Almost no searching
  listProdPaginated: 1,      // Minimal

  // WRITE Operations (calibrated ×3.63 for WIPSo 50:50)
  createUserCart: 100,       // Panic buying ATC (75%)
  saveAddressUser: 9,        // Payment (Tier 4: 6.5%)
  createPaymentUser: 9,      // Payment (Tier 4: 6.5%)
  saveOrderUser: 9,          // Payment (Tier 4: 6.5%)
  toggleFavoriteUser: 3,     // Minimal
  reqCancelPayment: 3,       // Failed payment retry
  addRatingUser: 1,          // Rare
  reqRefund: 1               // Rare
};
```

---

### Empirical Data & Calibration Sources

| Parameter | Value | Reference |
|-----------|-------|-----------|
| Cart Abandonment Rate | 70.19% | Baymard Institute, 2023 (meta-analysis of 49 studies, 2006-2023) |
| Add-to-Cart Rate | 7.5% overall | Blend Commerce / Shopify Benchmarks, 2023 |
| Overall Conversion Rate | 1.89-3.0% | Shopify / Dynamic Yield, 2023 |
| Flash Sale Peak Conversion | 6.5% | SaleCycle Black Friday Report, 2023 |
| Flash Sale DB R:W Ratio | 3.5:1 | Li et al., VLDB 2018 (PolarDB — Double 11) |
| Pre-loaded Cart Bypass | 60-80% | Industry observation of pre-sale mechanics |
| **TPC-W WIPS (Shopping)** | **80:20 R:W** | TPC-W Specification (TPC Council) |
| **TPC-W WIPSo (Ordering)** | **50:50 R:W** | TPC-W Specification (TPC Council) |
| **DeathStarBench E-commerce** | **60:40 R:W** | Gan et al., ASPLOS 2019 |
