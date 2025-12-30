# API Endpoints Summary

## Authentication

| Endpoint                            | Method | Description        | Body                                                 |
|-------------------------------------|--------|--------------------|------------------------------------------------------|
| `/api/login`                        | POST   | Login user/admin         | `{ "email": "admin@gmail.com", "password": "123admin" }`         |
| `/api/register`                     | POST   | Register user      | `{ "email":"testFromFrontend@gmail.com", "name":"test", "password":"1234" }`         |
| `/api/profile-user`                 | POST   | Get current user   | None                                                 |
| `/api/profile-admin`                | POST   | Get current admin  | None                                                 |

## Category

| Endpoint                            | Method | Description            | Body                        |
|-------------------------------------|--------|------------------------|-----------------------------|
| `/api/category`                     | POST   | Create category         | `{ "name":"Sneakers" }`       |
| `/api/category`                     | GET    | Get categories          | None                        |
| `/api/category/:id`                 | DELETE | Delete category by ID   | None                        |

## Product

| Endpoint                            | Method | Description            | Body                                                                                  |
|-------------------------------------|--------|------------------------|---------------------------------------------------------------------------------------|
| `/api/products/:count`              | POST  | Get all product          | `{"leastStock":0}` or `{"leastStock":1}`   |
| `/api/product`                      | POST   | Create product          | `{ "title":"ขาหมูเยอรมัน","description":"desc","price":250,"quantity":100,"categoryId":3,"images":[ {"asset_id":"6e2a", "public_id":"Ecom_fullstack_app_msc_products/pr", "url":"http://res.cloudinary.com/product-81.jpg", "secure_url":"https://res.cloudinary.com/product-888.jpg"}, {...} ] }` |
| `/api/product/:id`                  | PATCH    | Update a product       | `{ "tilte": "ขาหมูเยอรมัน", "description": "desc", "price": 250, "quantity": 100, "categoryId": 3, "images": [ {"asset_id":"6e2a", "public_id":"Ecom_fullstack_app_msc_products/pr", "url":"http://res.cloudinary.com/product-81.jpg", "secure_url":"https://res.cloudinary.com/product-888.jpg"}, {...} ] }`                                                                                 |
| `/api/product/:id`                  | GET    | Get a product        | None                                                                                  |
| `/api/product/:id`                  | DELETE | Delete a product    | None                                                                                  |
| `/api/display-prod-by`              | POST   | Get products by filters | `{ "sort":"sold", "order":"desc", "limit": 10 }` |
| `/api/display-prod-by-user`         | GET   | Get products by user's favorites | None |
| `/api/search-filters`               | POST   | Narrow search with filters     | `{ "category": [7,1], "query": "tes", "price": [0,100] }`        |
| `/api/bulk-discount`               | POST   | Manage product promotion | `{ "products":[ { "id":1, "title":"LG Laptop" }, { "id":2,..} ], "amount":10, "startDate":"2025-01-17T21:58:44.063Z", "endDate":"2025-02-17T21:58:44.063Z", "description":"New year sale", "isPromotion":false }` or `{ "products":[ { "id":1, "title":"LG Laptop" }, { "id":2,..} ], "amount":10, "startDate":"2025-01-17T21:58:44.063Z", "endDate":"2025-01-17T21:58:44.063Z", "description":"", "isPromotion":true }`       |
| `/api/images`                       | POST | Upload image to the cloud service   |  `{"image": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/..."}`  |
| `/api/removeimage`                  | POST | Remove image from the clound service  |  `{"public_id": "Ecom_fullstack_app_msc_products/product-173..."}`  |

## User

| Endpoint                            | Method | Description               | Body                                                       |
|-------------------------------------|--------|---------------------------|------------------------------------------------------------|
| `/api/user/cart`                    | POST   | Add to user cart          | `{ "carts": [{ "id": 1, "countCart": 2, "price": 100, "buyPriceNum": 95,"preferDiscount": 5}, {...}] }` |
| `/api/user/cart`                    | GET    | Get user cart             | None                                                       |
| `/api/user/cart`                    | DELETE | Clear user cart           | None                                                       |
| `/api/user/address`                 | POST   | Add user address          | `{ "address": "kku" }`                                   |
| `/api/user/order`                   | POST   | Place an order            | `{ "paymentIntent": {"id": "pi_123456789", "amount": 100.00, "currency": "thb", "status": "succeeded"} }`|
| `/api/user/order`                   | GET    | Get user orders           | None                                                       |
| `/api/user/rating`                  | POST   | Add user rating and comment to products | `{ "ratings": [ {"productId": 1, "orderId": 123, "rating": 5, "comment": "Good quality product!"}, {"productId": 2, "orderId": 123,...} ] }`|
| `/api/user/update-profile`          | POST   | Update user profile      | `{ "name": "test2", "email": "test@example.com", "password": "1234","image": { "url": "https://res.cloudinary.com/...","public_id": "Ecom_fullstack_app_msc_products/product-173..."} }` |

## Admin

| Endpoint                            | Method | Description               | Body                              |
|-------------------------------------|--------|---------------------------|-----------------------------------|
| `/api/all-users`                    | GET    | Get all users             | None                                                       |
| `/api/change-status`                | PUT   | Update user status        | `{ "userIdArr": [123, 456, 789], "userEnabled": true, "userRole": "admin" }`|
| `/api/admin/orders`                 | GET    | Get all orders            | None                              |
| `/api/user/order-status`            | PUT    | Update order status       | `{ "orderIdArr": [123, 456, 789], "orderStatus": "Not Process" }` |

## Payment

| Endpoint                            | Method | Description               | Body                              |
|-------------------------------------|--------|---------------------------|-----------------------------------|
| `/api/user/create-payment-intent`   | POST   | Create payment-intent     | `{"id":1}`                        |
| `/api/user/cancel-payment-intent`   | POST   | Cancel payment-intent     | `{"id":"pi_32AkjQ5H4Bas2..."}`                        |
| `/api/user/refund-payment`          | POST   | Request for refunding after purchase success    | `{"orderId": 1}`                  |


