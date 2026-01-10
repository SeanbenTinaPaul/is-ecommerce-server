# API Frequency Analysis for Database Indexing

## วัตถุประสงค์
วิเคราะห์ความถี่ของ API requests ที่ส่งมาจาก client เพื่อระบุคอลัมน์ที่เหมาะแก่การทำ DB indexing ใน `schema.prisma`

---

## 1. Guest Routes (ไม่ต้อง Login)

### ความถี่สูงมาก ⭐⭐⭐⭐⭐

| API Endpoint | Method | Service Function | Query Pattern | Columns ที่ใช้ |
|--------------|--------|------------------|---------------|----------------|
| `/api/products/:count` | GET | `listProd` | `findMany` with filter | `quantity`, `createdAt` |
| `/api/products-paginated` | GET | `listProdPaginated` | `findMany` with skip/take | `quantity`, `createdAt` |
| `/api/products/flash-sale` | GET | `listFlashSaleProducts` | `findMany` with discount filter | `Discount.endDate`, `Discount.isActive`, `Product.quantity` |
| `/api/display-prod-by` | POST | `displayProdBy` | `findMany` with orderBy | `quantity`, `sold`, `createdAt`, `updatedAt` |
| `/api/search-filters` | POST | `searchFilters` | `findMany` with complex where | `title`, `categoryId`, `price`, `brandId` |
| `/api/product/:id` | GET | `readAprod` | `findFirst` by id | `Product.id`, `ProductOnOrder.productId` |
| `/api/product/:id/images` | GET | `getProductImages` | `findUnique` by id | `Product.id` |
| `/api/products-by-ids` | POST | `getProductsByIds` | `findMany` with `in` | `Product.id` |

### ความถี่ปานกลาง ⭐⭐⭐
| API Endpoint | Method | Service Function | Query Pattern | Columns ที่ใช้ |
|--------------|--------|------------------|---------------|----------------|
| `/api/category` | GET | `listCategory` | `findMany` | - |
| `/api/brand` | GET | `listBrand` | `findMany` | - |
| `/api/sse` | GET | `subscribeStock` | SSE connection | - |
| `/api/stock/:id` | GET | `getStock` | `findUnique` | `Product.id` |

### ความถี่ต่ำ ⭐
| API Endpoint | Method | Service Function | Query Pattern | Columns ที่ใช้ |
|--------------|--------|------------------|---------------|----------------|
| `/api/login` | POST | `logIn` | `findFirst` by email | `User.email` |
| `/api/register` | POST | `register` | `findFirst` + `create` | `User.email` |

---

## 2. User Routes (ต้อง Login)

### ความถี่สูงมาก ⭐⭐⭐⭐⭐

| API Endpoint | Method | Service Function | Query Pattern | Columns ที่ใช้ |
|--------------|--------|------------------|---------------|----------------|
| `/api/user/cart` | GET | `getUserCart` | `findFirst` + include | `Cart.orderedById` |
| `/api/user/cart` | POST | `createUserCart` | `findFirst`, `upsert`, `deleteMany` | `Cart.orderedById`, `ProductOnCart.cartId_productId` |
| `/api/display-prod-by-user` | GET | `displayProdByUser` | Complex join queries | `Order.orderedById`, `Product.categoryId`, `Product.quantity` |
| `/api/user/favorite` | POST | `favoriteProduct` | `findFirst`, `findMany`, `create/delete` | `Favorite.userId`, `Favorite.productId`, `Product.id` |

### ความถี่ปานกลาง ⭐⭐⭐
| API Endpoint | Method | Service Function | Query Pattern | Columns ที่ใช้ |
|--------------|--------|------------------|---------------|----------------|
| `/api/user/order` | GET | `getOrder` | `findMany` with include | `Order.orderedById`, `Order.createdAt` |
| `/api/user/order-paginated` | GET | `getOrderPaginated` | `findMany` + count | `Order.orderedById`, `Order.createdAt` |
| `/api/user/order` | POST | `saveOrder` | Complex transaction | `Cart.orderedById`, `Product.id` |
| `/api/profile-user` | POST | `currUserProfile` | `findFirst` by email | `User.email` |

### ความถี่ต่ำ ⭐
| API Endpoint | Method | Service Function | Query Pattern | Columns ที่ใช้ |
|--------------|--------|------------------|---------------|----------------|
| `/api/user/address` | POST | `saveAddress` | `update` | `User.id` |
| `/api/user/update-profile` | PATCH | `updateUserProfile` | `findFirst` + `update` | `User.id` |
| `/api/user/rating` | POST | `addProdRating` | `create` + `groupBy` | `Rating.productId`, `Product.id` |
| `/api/user/cart` | DELETE | `clearCart` | `deleteMany` | `Cart.orderedById`, `ProductOnCart.cartId` |
| `/api/user/create-payment-intent` | POST | `createPayment` | - | - |

---

## 3. คอลัมน์ที่แนะนำให้ทำ DB Indexing

### 🔴 Priority HIGH (ใช้บ่อยมากทั้ง Guest + User)

| Table | Column(s) | Index Type | เหตุผล |
|-------|-----------|------------|--------|
| **Product** | `quantity` | Single | ใช้ในทุก product listing (`gte leastStock`) |
| **Product** | `createdAt` | Single | ใช้ใน `orderBy` ทุก listing |
| **Product** | `categoryId` | Single | ใช้ใน `searchFilters`, `displayProdByUser` |
| **Product** | `price` | Single | ใช้ใน `searchFilters` (range query) |
| **Product** | `sold` | Single | ใช้ใน `displayProdBy` (best seller) |
| **Order** | `orderedById` | Single | ใช้ในทุก user order queries |
| **Cart** | `orderedById` | Single | ใช้ในทุก cart operations (unique per user) |

### 🟠 Priority MEDIUM

| Table | Column(s) | Index Type | เหตุผล |
|-------|-----------|------------|--------|
| **Product** | `title` | GIN (full-text) | ใช้ใน search (`contains`, `insensitive`) |
| **Product** | `brandId` | Single | ใช้ใน `searchFilters` |
| **Order** | `createdAt` | Single | ใช้ใน `orderBy` สำหรับ order history |
| **Favorite** | `userId` | Single | ใช้ใน limit check (5 favorites) |
| **ProductOnOrder** | `productId` | Single | ใช้ใน `readAprod` เพื่อดู order history |
| **Discount** | `endDate`, `isActive` | Composite | ใช้ใน `updateDiscount()` ทุกครั้งที่ fetch products |
| **Discount** | `productId` | Single | ใช้ใน cascade delete และ bulk operations |

### 🟢 Priority LOW (มี @unique หรือใช้ไม่บ่อย)

| Table | Column(s) | Index Type | เหตุผล |
|-------|-----------|------------|--------|
| **User** | `email` | - | มี `@unique` อยู่แล้ว (auto-indexed) |
| **ProductOnCart** | `cartId_productId` | - | มี `@@unique` อยู่แล้ว (composite) |
| **Favorite** | `userId_productId` | - | มี `@@unique` อยู่แล้ว |
| **Brand** | `title` | - | มี `@unique` อยู่แล้ว |

---

## 4. Composite Index ที่แนะนำ

| Table | Columns | เหตุผล |
|-------|---------|--------|
| **Product** | `(quantity, createdAt)` | Query pattern: `where quantity >= X orderBy createdAt DESC` |
| **Product** | `(categoryId, quantity)` | Query pattern: `where categoryId = X AND quantity > 0` |
| **Order** | `(orderedById, createdAt)` | Query pattern: `where orderedById = X orderBy createdAt DESC` |

---

## 5. สรุป Index ที่ควรเพิ่มใน schema.prisma

```prisma
model Product {
  // ... existing fields ...
  
  @@index([quantity])           // HIGH: listing filters
  @@index([createdAt])          // HIGH: sorting
  @@index([categoryId])         // HIGH: search filters
  @@index([price])              // HIGH: price range
  @@index([sold])               // HIGH: best seller
  @@index([brandId])            // MEDIUM: brand filter
  @@index([quantity, createdAt]) // COMPOSITE: common query pattern
}

model Order {
  // ... existing fields ...
  
  @@index([orderedById])        // HIGH: user orders
  @@index([createdAt])          // MEDIUM: sorting
  @@index([orderedById, createdAt]) // COMPOSITE: common pattern
}

model Cart {
  // ... existing fields ...
  
  @@index([orderedById])        // HIGH: cart lookup
}

model Discount {
  // ... existing fields ...
  
  @@index([productId])          // MEDIUM: cascade/bulk
  @@index([endDate, isActive])  // MEDIUM: expiry check
}

model ProductOnOrder {
  // ... existing fields ...
  
  @@index([productId])          // MEDIUM: product order history
}

model Favorite {
  // ... existing fields ...
  
  @@index([userId])             // MEDIUM: limit check
}
```

---

## 6. หมายเหตุ

1. **Indexes ที่มีอยู่แล้ว (Auto-created)**:
   - `@id` fields ทุกตาราง (primary key)
   - `@unique` fields: `User.email`, `Brand.title`
   - `@@unique` constraints: `ProductOnCart(cartId_productId)`, `Favorite(userId_productId)`, `Rating(userId_productId_orderId_comment)`
   - Foreign key relations: Prisma สร้าง index ให้อัตโนมัติสำหรับ `@relation` fields

2. **Trade-off ของ Indexing**:
   - ✅ เร่งความเร็ว READ queries
   - ❌ ช้าลงในการ INSERT/UPDATE (ต้อง update index ด้วย)
   - ❌ ใช้ storage เพิ่ม

3. **Priority ควรทดสอบก่อน**:
   - `Product.quantity` + `Product.createdAt` (ใช้ทุก page load)
   - `Order.orderedById` (ใช้ทุก user action)
   - `Cart.orderedById` (ใช้ทุก cart operation)
