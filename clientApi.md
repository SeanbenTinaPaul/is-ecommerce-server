# API Endpoints Summary

## Authentication

| Endpoint                            | Method | Description        | Body                                                 |
|-------------------------------------|--------|--------------------|------------------------------------------------------|
| `/api/login`                        | POST   | Login user/admin         | `{ email: string, password: string }`         |
| `/api/register`                     | POST   | Register user      | `{ email: string, name: string, password: string }`         |
| `/api/profile-user`                 | POST   | Get current user profile   | None                                                 |
| `/api/profile-admin`                | POST   | Get current admin profile  | None                                                 |

---

## Category

| Endpoint                            | Method | Description            | Body                        |
|-------------------------------------|--------|------------------------|-----------------------------| 
| `/api/category`                     | GET    | Get all categories          | None                        |
| `/api/category`                     | POST   | Create category         | `{ name: string }`       |
| `/api/category/:id`                 | PATCH  | Update category by ID   | `{ name: string }`       |
| `/api/category/:id`                 | DELETE | Delete category by ID   | None                        |

---

## Brand

| Endpoint                            | Method | Description            | Body                        |
|-------------------------------------|--------|------------------------|-----------------------------| 
| `/api/brand`                        | GET    | Get all brands          | None                        |
| `/api/brand`                        | POST   | Create brand            | `{ name: string }`       |
| `/api/brand`                        | PATCH  | Update brand            | `{ id: number, name: string }`       |
| `/api/brand/:id`                    | DELETE | Delete brand by ID      | None                        |

---

## Product

| Endpoint                            | Method | Description            | Body / Query Params                                  |
|-------------------------------------|--------|------------------------|------------------------------------------------------|
| `/api/products/:count`              | GET    | Get products (Guest/User) | Query: `?leastStock=0` or `?leastStock=1`   |
| `/api/products-paginated`           | GET    | Get products paginated (Load More) | Query: `?skip=0&take=20&leastStock=1`   |
| `/api/products-admin/:count`        | GET    | Get products for Admin  | None   |
| `/api/products-admin-paginated`     | GET    | Get products for Admin (table pagination) | Query: `?page=1&limit=10`   |
| `/api/products-admin-search`        | GET    | Search products by title (Admin) | Query: `?q=searchTerm`   |
| `/api/products/flash-sale`          | GET    | Get active flash sale products (Guest/User) | None |
| `/api/product/:id`                  | GET    | Get a single product    | None                                                 |
| `/api/product/:id/images`           | GET    | Get product images only (lightweight) | None                                   |
| `/api/products-by-ids`              | POST   | Get products by IDs (cart sync) | `{ ids: number[] }`                           |
| `/api/product`                      | POST   | Create product          | `{ title: string, description: string, price: number, quantity: number, categoryId: number, brandId?: number, images: ImageObject[] }` |
| `/api/product/:id`                  | PATCH  | Update a product        | `{ title?: string, description?: string, price?: number, quantity?: number, categoryId?: number, brandId?: number, images?: ImageObject[] }` |
| `/api/product/:id`                  | DELETE | Delete a product        | None                                                 |
| `/api/display-prod-by`              | POST   | Get products by filters | `{ sort: string, order: string, limit: number }` |
| `/api/display-prod-by-user`         | GET    | Get products by user's favorites | None |
| `/api/search-filters`               | POST   | Narrow search with filters     | `{ category?: number[], query?: string, price?: [min, max] }`        |
| `/api/bulk-discount`                | POST   | Manage product promotion | `{ products: ProductItem[], amount: number, startDate: string, endDate: string, description: string, isPromotion: boolean }` |
| `/api/images`                       | POST   | Upload image to cloud   |  `{ image: string (base64) }`  |
| `/api/removeimage`                  | POST   | Remove image from cloud |  `{ public_id: string }`  |
| `/api/get-folder-images`            | POST   | Get images from cloud folder | `{ folderName: string }`  |

---

## Stock & SSE (Real-time)

| Endpoint                            | Method | Description            | Body                        |
|-------------------------------------|--------|------------------------|-----------------------------| 
| `/api/stock/:id`                    | GET    | Get product stock info by ID | None |
| `/api/sse`                          | GET    | Subscribe to real-time stock updates (SSE) | None |

---

## User

| Endpoint                            | Method | Description               | Body                                                       |
|-------------------------------------|--------|---------------------------|------------------------------------------------------------| 
| `/api/user/cart`                    | POST   | Create/Update user cart   | `{ carts: CartItem[] }` |
| `/api/user/cart`                    | GET    | Get user cart             | None                                                       |
| `/api/user/cart`                    | DELETE | Clear user cart           | None                                                       |
| `/api/user/address`                 | POST   | Add user address          | `{ address: string }`                                   |
| `/api/user/order`                   | POST   | Place an order            | `{ paymentIntent: PaymentIntentObject }`|
| `/api/user/order`                   | GET    | Get user orders           | None                                                       |
| `/api/user/order-paginated`         | GET    | Get user orders (paginated) | Query: `?skip=0&take=10`                                    |
| `/api/user/rating`                  | POST   | Add user rating and comment | `{ ratings: RatingItem[] }`|
| `/api/user/update-profile`          | PATCH  | Update user profile      | `{ name?: string, email?: string, password?: string, image?: ImageObject }` |
| `/api/user/favorite`                | POST   | Toggle favorite product  | `{ productId: number }` |

---

## Admin

| Endpoint                            | Method | Description               | Body                              |
|-------------------------------------|--------|---------------------------|-----------------------------------|
| `/api/admin/all-users`              | GET    | Get all users             | None                              |
| `/api/admin/change-status`          | PUT    | Update user status/role   | `{ userIdArr: number[], userEnabled: boolean, userRole: string }`|
| `/api/admin/orders`                 | GET    | Get all orders            | None                              |
| `/api/admin/orders-paginated`       | GET    | Get orders paginated (Load More) | Query: `?skip=0&take=20`          |
| `/api/admin/order-status`           | PUT    | Update order status       | `{ orderIdArr: number[], orderStatus: string }` |

---

## Payment (Stripe)

| Endpoint                            | Method | Description               | Body                              |
|-------------------------------------|--------|---------------------------|-----------------------------------|
| `/api/user/create-payment-intent`   | POST   | Create payment-intent     | `{ id: number }`                  |
| `/api/user/cancel-payment-intent`   | POST   | Cancel payment-intent     | `{ id: string }`                  |
| `/api/user/refund-payment`          | POST   | Request refund after purchase | `{ orderId: number }`          |

---

## Data Types Reference

```typescript
// ImageObject
{ asset_id: string, public_id: string, url: string, secure_url: string }

// CartItem
{ id: number, countCart: number, price: number, buyPriceNum: number, preferDiscount: number }

// ProductItem (for bulk-discount)
{ id: number, title: string }

// RatingItem
{ productId: number, orderId: number, rating: number, comment: string }

// PaymentIntentObject
{ id: string, amount: number, currency: string, status: string }
```

