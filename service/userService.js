const prisma = require("../config/prisma");
const bcrypt = require("bcryptjs"); //ใช้ในการเข้ารหัส password
const jwt = require("jsonwebtoken"); //ใช้ในการสร้าง token

//ข้อมูลการสั่งซื้อในตะกร้าของ users
//Feature/Button: "Add to Cart", "Update Cart", "Save Cart"
exports.createUserCart = async (req, res) => {
   try {
      const carts = req.body.carts;
      // console.log("req.body carts->", req.body.carts);
      console.log("carts->", carts); // [{id:, countCart:, price:, buyPriceNum:,preferDiscount,promotion:,discounts: [ [Object] ]}, {}]
      //1. check ว่า user มีข้อมมูลอยู่ในตาราง User หรือไม่
      const user = await prisma.user.findFirst({
         where: { id: Number(req.user.id) }
      });
      //3. Compare: product quantity in cart (userCart.products) vs  product quantity in stock (product.quantity)
      let outStockProd = {}; //เก็บ product ที่ไม่มี stock พอ
      for (const item of carts) {
         const product = await prisma.product.findUnique({
            where: { id: item.id },
            select: { quantity: true, title: true }
         });
         /*
          item   { cartId: 15, productId: 5, countCart: 2, price: 40000 }
          product{ quantity: 1000, title: 'Core i9-11800K' }
          item   { cartId: 15, productId: 7, countCart: 10, price: 250 }
          product{ quantity: 10, title: 'ขาหมูเยอรมัน' }
          */
         if (!product || item.countCart > product.quantity) {
            // outStockProd.push(`${product?.title || 'product'} Stock:${product.quantity}`);
            outStockProd[product?.title] = product.quantity;
         }
      }
      console.log("outStockProd->", outStockProd);
      const outStockProdArr = Object.entries(outStockProd);
      const outStockTitle = Object.keys(outStockProd);
      //4. if outStockProd.length > 0, return 400
      if (outStockProdArr.length > 0) {
         return res.status(202).json({
            message: `${outStockTitle} currently low in stock. Please remove or adjust quantity to proceed with the checkout.`,
            stock: outStockProdArr
         });
      }
      //2. Delete old cart to INSERT new cart
      //table'ProductOnCart' เป็นตารางกลางระหว่าง 'Product' กับ 'Cart'
      /*
          DELETE FROM "ProductOnCart"
              WHERE "cartId" IN (
              SELECT "id" FROM "Cart" 
              WHERE "orderedById" = user.id
              );
          */
      await prisma.productOnCart.deleteMany({
         where: {
            //cart หมายถึง เอา productOnCart.cartId ซึ่งเท่ากับ Cart.id, เมื่อพบว่า Cart.orderedById เท่ากับ user.id
            cart: { orderedById: user.id }
         }
      });
      await prisma.cart.deleteMany({
         where: {
            orderedById: user.id
         }
      });

      //3. เตรียมสินค้าใหม่สำหรับ insert ลงในตาราง ProductOnCart[]
      //req.body.cart ===[{},{},...]
      let products = carts.map((item) => ({
         productId: item.id,
         count: item.countCart,
         price: item.price,
         buyPriceNum: item.buyPriceNum,
         discount: item.preferDiscount
      }));

      //4. หาราคารวมของสินค้าในตะกร้า ลงในตาราง Cart
      let cartTotal = products.reduce((sum, item) => {
         return sum + item.buyPriceNum * item.count;
      }, 0);

      //5. Insert ข้อมูลลงในตาราง Cart
      //data: === INSERT INTO Cart (products, cartTotal, orderById) VALUES (products, cartTotal, orderById)
      // products is ProductOnCart[] in Model Cart
      const newCart = await prisma.cart.create({
         data: {
            products: {
               create: products //add products to ProductOnCart[]
            },
            cartTotal: cartTotal, //add to Cart.cartTotal
            orderedById: user.id //add to Cart.orderedById
         }
      });
      res.status(200).json({
         success: true,
         message: "Add product to cart success",
         productOnCart: products,
         cart: newCart
      });
   } catch (err) {
      console.log(err);
      res.status(500).json({
         success: false,
         message: "Error!!! Cannot add product to cart."
      });
   }
};
//---------------------------------------------------------------------------
//obj.product.discounts[0].isActive
//obj.product.discounts[0].endDate
//obj.product.discounts[0].amount
//obj.product.promotion
//obj.product.price
const getDiscountAmount = (obj) => {
   //check if isAtive === true (not expired)
   //isAtive === true → can use discount
   // Check if there are any discounts
   if (!obj.product.discounts || obj.product.discounts.length === 0) {
      return null;
   }
   let today = new Date();
   let startDate = new Date(obj.product.discounts[0].startDate);
   let endDate = new Date(obj.product.discounts[0].endDate);
   const discount = obj.product.discounts[0];
   console.log("today", today);
   console.log("endDate", endDate);
   if (discount.isActive && today >= startDate && today < endDate) {
      return discount.amount;
   }
   return null;
};
const calBuyPriceNum = (obj) => {
   const discountAmount = getDiscountAmount(obj);
   let buyPriceNum = obj.product.price;
   let preferDiscount = null;

   if (obj.product.promotion > discountAmount) {
      preferDiscount = obj.product.promotion;
      buyPriceNum = obj.product.price * (1 - obj.product.promotion / 100);
   } else if (obj.product.promotion < discountAmount) {
      preferDiscount = discountAmount;
      buyPriceNum = obj.product.price * (1 - discountAmount / 100);
   }
   // Update the object
   obj.buyPriceNum = buyPriceNum;
   obj.discount = preferDiscount;
   // obj((prev) => ({
   //    ...prev,
   //    buyPriceNum: buyPriceNum,
   //    discount: preferDiscount
   // }));
};
//Feature/Button: "View Cart", "My Cart", "Cart Details"
exports.getUserCart = async (req, res) => {
   try {
      //0. ลองไม่ check user ว่ามีในตาราง User หรือไม่ ก่อน
      //1. หา cart ของ user นั้น
      const cart = await prisma.cart.findFirst({
         where: {
            orderedById: Number(req.user.id)
         },
         // include === JOIN
         include: {
            //products คือ ProductOnCart[]
            products: {
               include: {
                  // ProductOnCart join กับ Product ด้วย productId
                  product: {
                     include: {
                        discounts: true,
                        ratings: true,
                        favorites: true,
                        images: true,
                        category: true
                     }
                  }
               }
            }
         }
      });
      if (!cart) {
         return res.status(200).json({
            success: true,
            message: "No cart yet."
         });
      }
      //need to validate promotion vs discount → discount needs: isActive, startDate, endDate
      //ต้องการให้ promotion + discount ที่่อยู่ใน Cart + ProductOnCart up-to-date ตลอดเวลา
      /*
      1. discount expired → promotion
      2. discount > promotion → discount
      3. discount < promotion → promotion
      4. promotion: null && discount: null → no promotion, no discount
      */
      //obj.product.discounts[0].isActive
      //obj.product.promotion
      //obj.product.price
      let totalCartDiscount = 0;
      let totalPriceNoDiscount = 0;
      for (const obj of cart.products) {
         calBuyPriceNum(obj);
         totalCartDiscount += obj.product.price * obj.count - obj.buyPriceNum * obj.count;
         totalPriceNoDiscount += obj.product.price * obj.count;
      }
      //cal promotion vs discount และ to send res with ราคาสุทธิ
      //get promotion from table Product, join to Discount with productId
      // res.send(cart);

      // คำนวณราคาสุทธิ (totalNet)
      const totalNet = totalPriceNoDiscount - totalCartDiscount;

      res.status(200).json({
         success: true,
         message: "This is your cart.",
         ProductOnCart: cart.products,
         carts: cart,
         "Total price": cart.cartTotal,
         totalCartDiscount: totalCartDiscount,
         totalPriceNoDiscount: totalPriceNoDiscount,
         totalNet: totalNet
      });
   } catch (err) {
      console.log(err);
      res.status(500).json({
         success: false,
         message: "Error!!! Cannot get product in cart."
      });
   }
};

//Feature/Button: "Empty Cart", "Clear Cart", "Remove All Items from Cart"
exports.clearCart = async (req, res) => {
   const { id } = req.user;
   try {
      //1. หา cart ของ user นั้นว่ามีหรือไม่
      const cart = await prisma.cart.findFirst({
         where: { orderedById: Number(id) }
      });
      console.log("clearCart->", cart);
      //2. ถ้าไม่มี cart ใน DB ก็ถือว่า cart ว่างอยู่แล้ว → return 200
      if (!cart) return res.status(200).json({ success: true, message: "Cart is already empty." });

      //3. ถ้ามีให้ลบข้อมูลในตาราง ProductOnCart และ Cart ทั้งหมด
      const delCart = await prisma.$transaction(async (prisma) => {
         await prisma.productOnCart.deleteMany({
            where: { cartId: cart.id }
         });
         await prisma.cart.deleteMany({
            where: { orderedById: Number(id) }
         });
      });

      res.status(200).json({
         success: true,
         message: "Success!!! Your cart is now empty.",
         // deletedCount: delCart.count,
         deletedCart: delCart
      });
   } catch (err) {
      console.log(err);
      res.status(500).json({
         success: false,
         message: "Error!!! Cannot empty a cart."
      });
   }
};

//Feature/Button: "Save Address", "Update Address", "Add/Edit Address"
exports.saveAddress = async (req, res) => {
   try {
      const { address } = req.body;
      const addressUser = await prisma.user.update({
         where: { id: Number(req.user.id) },
         data: { address: address.trim() },
         select: { address: true, name: true, email: true, role: true, picture: true, id: true }
      });
      res.status(200).json({
         success: true,
         message: "Update Address Success",
         address: addressUser.address,
         profile: addressUser
      });
   } catch (err) {
      console.log(err);
      res.status(500).json({
         success: false,
         message: "Error!!! Cannot update address."
      });
   }
};

/*เท่ากับ
where: {
    orderedBy : {
        id: Number(req.user.id)
    }
}
*/
//Feature/Button: "Place Order", "Checkout", "Confirm Order"
exports.saveOrder = async (req, res) => {
   try {
      console.log("save order ->", req.body);
      const { id, amount, currency, status } = req.body.paymentIntent;
      if (status !== "succeeded")
         return res.status(400).json({ message: "Error!!! Payment failed." });

      //1. หา cart ของ user นั้นว่ามีหรือไม่
      // userCart จะดึง record แรก(ที่...) ทุกคอลัมน์จาก table 'Cart' และบางส่วนจาก 'ProductOnCart' ที่มี cartId กับ Cart.id
      const userCart = await prisma.cart.findFirst({
         where: {
            orderedById: Number(req.user.id)
         },
         include: {
            //products    ProductOnCart[]
            products: {
               select: {
                  cartId: true,
                  productId: true,
                  count: true,
                  price: true,
                  buyPriceNum: true,
                  discount: true
               }
            }
         }
      });

      //2. ถ้าไม่มีให้ return 400
      if (!userCart || userCart.products.length === 0)
         return res
            .status(400)
            .json({ message: "Your cart is empty. Please add some product to a cart." });

      //3. Compare: product quantity in cart (userCart.products) vs  product quantity in stock (product.quantity)
      let outStockProd = []; //เก็บ product ที่ไม่มี stock พอ
      for (const item of userCart.products) {
         const product = await prisma.product.findUnique({
            where: { id: item.productId },
            select: { quantity: true, title: true }
         });
         /*
         item   { cartId: 15, productId: 5, count: 2, price: 40000 }
         product{ quantity: 1000, title: 'Core i9-11800K' }
         item   { cartId: 15, productId: 7, count: 10, price: 250 }
         product{ quantity: 10, title: 'ขาหมูเยอรมัน' }
         */
         if (!product || item.count > product.quantity) {
            outStockProd.push(product?.title || "product");
         }
      }
      //4. if outStockProd.length > 0, return 400
      if (outStockProd.length > 0) {
         return res
            .status(400)
            .json({ message: `Sorry. Product: ${outStockProd.join(", ")} out of stock.` });
      }

      //5. create new record in table Order + ProductOnOrder
      const convertToTHBforDB = parseFloat(amount) / 100;
      const order = await prisma.order.create({
         data: {
            //products    ProductOnOrder[] | create: method === data: for related table
            products: {
               create: userCart.products.map((item) => ({
                  productId: item.productId,
                  count: item.count,
                  price: item.buyPriceNum,//ราคา 1 ชิ้นหลังหักส่วนลด
                  discount: (item.price * item.discount) / 100//ราคาส่วนลด 1 ชิ้น (ไม่ใช่ %)
                  // (price + discount) * count == ราคารวมแบบไม่มีส่วนลด
               }))
            },
            //connect คือไปดึง record ของ User.id(มีอยู่แล้ว) มาเติมใน record ตัวเอง
            /*
             INSERT INTO "Order" (orderedById, ...)
             VALUES ((SELECT id FROM "User" WHERE id = req.user.id), ...);
             */
            orderedBy: {
               connect: {
                  id: Number(req.user.id) //=== id: userCart.orderedById
               }
            },
            cartTotal: userCart.cartTotal, // ราคาหลังหักส่วนลด * จำนวนชิ้น
            paymentId: id,
            amount: convertToTHBforDB, // ราคาหลังหักส่วนลด * จำนวนชิ้น | ควรเท่ากันกับ cartTotal
            status: status,
            currency: currency,
            orderStatus: "Completed"
         }
      });
      // paymentId   String
      // amount      Float
      // status      String
      // currency    String

      //6. ลบข้อมูลในตาราง ProductOnCart และ Cart ทั้งหมด
      /*
       กระบวนการ:
       - ถ้า create ในตาราง Order แล้วก็ต้องลบในตาราง Cart และ ProductOnCart
       - ในตาราง Product ต้องลบจำนวนสินค้าที่ถูกสั่งซื้อออกจาก stock
       */
      //6.1 เตรียมข้อมูลสำหรับ update จำนวนสินค้าในตาราง Product.sold และ Product.quantity
      const updateProduct = userCart.products.map((item) => ({
         where: { id: item.productId },
         data: {
            sold: { increment: item.count },
            quantity: { decrement: item.count }
         }
      }));
      let prodIdPaid = [];
      for (const item of updateProduct) {
         prodIdPaid.push(item.where.id);
      }
      //6.2 ส่ง updateProduct ไป update ในตาราง Product
      //The key is to collect the promises in an array and then use Promise.all() to wait for all the promises to resolve.
      // await Promise.all([promise1, promise2, ...]) | when promise = {..}
      await Promise.all(updateProduct.map((promise) => prisma.product.update(promise)));

      //** check anti-pattern ของการลบตาราง Cart อีกที */
      //6.3 ลบข้อมูลในตาราง ProductOnCart และ Cart ทั้งหมด
      // ติด onDelete: Cascade ในตาราง ProductOnCart.cartId ไว้ → ถ้าลบ record ในตาราง Cart จะลบ record ในตาราง ProductOnCart ด้วย
      await prisma.cart.deleteMany({
         where: { orderedById: Number(req.user.id) }
      });

      res.status(200).json({
         success: true,
         message: "save Order Success",
         data: userCart,
         updateProduct: updateProduct,
         order: order,
         prodIdPaid: prodIdPaid
      });
      //7. records ในตาราง Order และ ProductOnOrder จะไม่ถูกลบ → ใช้เก็บ log การสั่งซื้อทั้งหมดของ users
   } catch (err) {
      console.log(err);
      res.status(500).json({
         success: false,
         message: "Error!!! Cannot save order."
      });
   }
};

//ข้อมูลประวัติการสั่งซื้อของ users
/*
Order.products    ProductOnOrder[]
ProductOnOrder.product   Product
*/
//Feature/Button: "View Orders", "Order History", "My Orders"
exports.getOrder = async (req, res) => {
   try {
      const orders = await prisma.order.findMany({
         where: { orderedById: Number(req.user.id) },
         orderBy: { createdAt: "desc" },
         include: {
            products: {
               include: { product: { include: { ratings: true } } }
            }
         }
      });

      if (orders.length === 0)
         return res.status(400).json({ success: false, message: "No order found." });

      res.status(200).json({
         success: true,
         message: "This is your history order.",
         data: orders
      });
   } catch (err) {
      console.log(err);
      res.status(500).json({
         success: false,
         message: "Get to getOrder Error",
         error: err.message
      });
   }
};

/*
req.body
{
  "ratings": [
    {
      "productId": 1,
      "orderId": 123,
      "rating": 4,
      "comment": "Good quality product!"
    },
    {
      "productId": 2,
      "orderId": 123,
      "rating": 5,
      "comment": "Excellent service and fast delivery"
    },
*/
exports.addProdRating = async (req, res) => {
   try {
      const { ratings } = req.body;
      const userId = req.user.id;
      console.log("ratings->", ratings);
      // return;
      //validate if rating star < 1 or > 5 → reject
      if (ratings.some((r) => r.rating < 1 || r.rating > 5)) {
         return res.status(400).json({
            success: false,
            message: "Rating star must be between 1 and 5."
         });
      }

      //add all rating
      const transactionResult = await prisma.$transaction(async (prisma) => {
         //1. create all rating
         const createRating = await Promise.all(
            ratings.map((rating) => {
               return prisma.rating.create({
                  data: {
                     rating: rating.rating,
                     comment: rating.comment,
                     productId: rating.productId,
                     orderId: rating.orderId,
                     userId: userId
                  }
               });
            })
         );
         /*
         // Input ratings
         ratings === [
            { productId: 1, rating: 5 },
            { productId: 1, rating: 4 },
            { productId: 2, rating: 3 }
         ];

         // After groupBy
         productRatings === [
            { productId: 1, _avg: { rating: 4.5 }, _count: { _all: 2 } },
            { productId: 2, _avg: { rating: 3.0 }, _count: { _all: 1 } }
         ];
         */
         //2. get updated avg rating for affected products
         const prodRating = await prisma.rating.groupBy({
            by: ["productId"], //group records by productId
            where: {
               productId: { in: ratings.map((r) => r.productId) }
            },
            _avg: {
               //cal avg
               rating: true //..of grouped rating col
            },
            _count: true //cal row count of each productId groups
         });
         //3. update avgRAting in Product table (each productId)
         await Promise.all(
            prodRating.map((prodRating) => {
               return prisma.product.update({
                  where: { id: prodRating.productId },
                  data: {
                     avgRating: prodRating._avg.rating
                  }
               });
            })
         );
         return createRating;
         //return this to save to transactionResult | without this, transactionResult===undefinded
      });

      res.status(200).json({
         success: true,
         message: "Add rating success",
         data: transactionResult
      });
   } catch (err) {
      console.log(err);
      res.status(500).json({
         success: false,
         message: "Add rating error"
      });
   }
};

//req.body ► picture ,name, email, password
//req.user.id
//{ "name": "test2", "email": "test@example.com", "password": "567","image": { "url": "https://res.cloudinary.com/...","public_id": "Ecom_fullstack_app_msc_products/product-173..."} }
exports.updateUserProfile = async (req, res) => {
   const { name, email, password, image } = req.body;
   const { id } = req.user;
   // console.log("pic update profile->", image);
   //1. check email
   try {
      const user = await prisma.user.findFirst({
         where: {
            id: id
         }
      });

      //if (!user || !user.enabled)
      if (!user) return res.status(200).json({ success: false, message: "Unauthorized" });

      //2. check password
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch)
         return res.status(200).json({ success: false, message: "Password incorrect 555" });
      // return res.status(200).json({ success: true, message: "Password correct" });
      const updateUser = await prisma.user.update({
         where: {
            id: id
         },
         data: {
            email: email,
            picture: image?.url,
            picturePub: image?.public_id,
            name: name
         }
      });
      //3. create payload
      const payload = {
         id: user.id,
         email: updateUser.email,
         role: user.role,
         name: updateUser.name
      };

      //4. generate token
      jwt.sign(
         payload,
         process.env.JWT_SECRET,
         { expiresIn: process.env.JWT_EXPIRE },
         (err, token) => {
            if (err) {
               return res.status(500).json({ message: "Server Error" });
            } else {
               // console.log("token update", token);
               // console.log("paylod upadate", payload);
               //front need payload.role and token to access
               return res.status(200).json({
                  success: true,
                  message: "update profile success ☻",
                  payload,
                  token,
                  picture: updateUser.picture,
                  picturePub: updateUser.picturePub
               });
            }
         }
      );

      // res.status(200).json({ success: true, message: "Login success☻", data: user });
      // res.send("login success ☻");
   } catch (err) {
      console.log(err);
      return res.status(500).json({ success: false, message: "Server Error ╬" });
   }
};

exports.favoriteProduct = async (req, res) => {
   const { productId } = req.body;
   const { id } = req.user;
   try {
      const hasProduct = await prisma.product.findFirst({
         where: {
            id: parseInt(productId)
         }
      });
      if (!hasProduct) {
         return res.status(400).json({ message: "Product not found" });
      }
      //allow only 5 favorite/userId
      const isExceedLimit = await prisma.favorite.findMany({
         where: {
            userId: id
         },
         take: 5 //LIMIT
      });
      const isUserSendToUnFav = isExceedLimit.find((fav) => fav.productId === parseInt(productId));
      if (isExceedLimit.length >= 5 && !isUserSendToUnFav) {
         return res.status(200).json({
            success: false,
            message: "You can only add up to 5 favorite products"
         });
      }
      //use delete and create a new record instead

      const existFav = await prisma.favorite.findFirst({
         where: {
            userId: id,
            productId: parseInt(productId)
         },
         select: {
            id: true,
            product: {
               select: {
                  title: true
               }
            }
         }
      });
      console.log("existFav->", existFav);
      if (existFav) {
         //user send to unfav
         await prisma.favorite.delete({
            where: {
               id: existFav.id
            }
         });
         return res.status(200).json({
            success: true,
            message: `Removed ${existFav.product.title} from favorites`,
            isFavorited: false
         });
      } else {
         //user send to fav
         const newFav = await prisma.favorite.create({
            data: {
               userId: id,
               productId: parseInt(productId)
            },
            select: {
               product: {
                  select: {
                     title: true
                  }
               }
            }
         });
         return res.status(200).json({
            success: true,
            message: `Added ${newFav.product.title} to favorites`,
            isFavorited: true
         });
      }
   } catch (error) {
      console.log(error);
      res.status(500).json({ message: "Server Error" });
   }
};
