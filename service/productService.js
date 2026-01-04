const prisma = require("../config/prisma");
const cloudinary = require("cloudinary").v2; // import { v2 as cloudinary } from 'cloudinary';
// import { v2 as cloudinary } from 'cloudinary';

exports.createProd = async (req, res) => {
   try {
      const { email } = req.user;
      const { title, description, price, quantity, categoryId, images, brandId } = req.body;
      // console.log('req.body.images->', images)
      //verify res.body data if they are not null or undefined
      if (!title || !price || !quantity || !categoryId || Number(categoryId) === 0) {
         return res.status(400).json({ message: "All fields are required" });
      }

      const product = await prisma.product.create({
         //data === insert into
         data: {
            title: title,
            description: description ? description : "",
            price: parseFloat(price),
            quantity: parseInt(quantity),
            categoryId: parseInt(categoryId),
            //เป็น one-to-many จึงต้องใช้ object ในการเก็บค่า ***เดี๋ยวกลับมาทำ
            // 1 product มีหลาย images
            // ถ้าเพิ่มรูปใน table 'Product' จะเพิ่มใน table 'Image' ด้วย
            images: {
               create: images.map((obj) => ({
                  asset_id: obj.asset_id,
                  public_id: obj.public_id,
                  url: obj.url,
                  secure_url: obj.secure_url
               }))
            },
            createdBy: email,
            brandId: parseInt(brandId)
         }
      });

      res.send(product);
   } catch (err) {
      console.log(err);
      res.status(500).json({ message: "Server Error" });
   }
};

// --- SSE & Stock Logic ---
let clients = [];

// Helper to send events to all connected clients
const notifyClients = (data) => {
   clients.forEach((client) => {
      client.res.write(`data: ${JSON.stringify(data)}\n\n`);
   });
};

exports.subscribeStock = (req, res) => {
   const headers = {
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "Cache-Control": "no-cache"
   };
   res.writeHead(200, headers);

   const clientId = Date.now();
   const newClient = {
      id: clientId,
      res
   };
   clients.push(newClient);

   req.on("close", () => {
      console.log(`${clientId} Connection closed`);
      clients = clients.filter((client) => client.id !== clientId);
   });
};

exports.getStock = async (req, res) => {
   try {
      const { id } = req.params;
      const product = await prisma.product.findUnique({
         where: { id: parseInt(id) },
         select: {
            id: true,
            quantity: true,
            price: true,
            promotion: true
         }
      });

      if (!product) {
         return res.status(404).json({ message: "Product not found" });
      }

      res.json(product);
   } catch (err) {
      console.log(err);
      res.status(500).json({ message: "Server Error" });
   }
};
// -------------------------

// Get only product images (for CarouselBanner)
exports.getProductImages = async (req, res) => {
   try {
      const { id } = req.params;
      const product = await prisma.product.findUnique({
         where: { id: parseInt(id) },
         select: {
            images: {
               select: {
                  id: true,
                  url: true
               }
            }
         }
      });

      if (!product) {
         return res.status(404).json({ message: "Product not found" });
      }

      res.json({
         success: true,
         data: product.images
      });
   } catch (err) {
      console.log(err);
      res.status(500).json({ message: "Server Error" });
   }
};

const updateDiscount = async () => {
   try {
      //auto check and update expired seasonal discount everytime frontend fetch product
      //use UTC time
      const now = new Date();
      const result = await prisma.discount.updateMany({
         where: {
            endDate: { lt: now }, //if endDate gte now → not expired
            isActive: true
         },
         data: {
            isActive: false
         }
      });

      if (result.count > 0) {
         console.log(`Expired discounts deactivated: ${result.count}`);
      }
   } catch (err) {
      console.log(err);
   }
};

// คำนวณ buyPriceNum และ preferDiscount สำหรับแต่ละ product
const calculateProductDiscount = (product) => {
   let buyPriceNum = product.price;
   let preferDiscount = null;

   // ตรวจสอบ discount ที่ยังใช้งานได้
   const today = new Date();
   let discountAmount = null;

   if (product.discounts && product.discounts.length > 0) {
      const discount = product.discounts[0];
      const startDate = new Date(discount.startDate);
      const endDate = new Date(discount.endDate);

      if (discount.isActive && today >= startDate && today < endDate) {
         discountAmount = discount.amount;
      }
   }

   // เปรียบเทียบ promotion vs discount → ใช้ตัวที่มากกว่า
   if (product.promotion > discountAmount) {
      preferDiscount = product.promotion;
      buyPriceNum = product.price * (1 - product.promotion / 100);
   } else if (discountAmount) {
      preferDiscount = discountAmount;
      buyPriceNum = product.price * (1 - discountAmount / 100);
   }

   return { buyPriceNum, preferDiscount };
};

exports.listProd = async (req, res) => {
   // console.log("req to list", req);
   // console.log("req.user to list", req.user);//undefined when NO <token> sent in req.header
   try {
      await updateDiscount();
      //----------------------------------------------------------------------------
      //findMany === SELECT * from TableName
      //take === LIMIT
      const { count } = req.params;
      const { leastStock } = req.query;
      console.log("leastStock->", leastStock);
      const products = await prisma.product.findMany({
         where: {
            quantity: { gte: parseInt(leastStock) }
         },
         take: parseInt(count),
         orderBy: {
            createdAt: "desc"
         },
         //include === JOIN
         //เพิ่มเพื่อดึงข้อมูลจากตาราง category
         include: {
            category: true,
            images: true,
            discounts: true,
            favorites: true,
            ratings: true,
            brand: true

            /*
                model Product {
                    category Category? @relation(fields: [categoryId], references: [id])  // Points to one category
                    images   Image[]  // Has many images
                }
                */
         }
      });

      // คำนวณ buyPriceNum และ preferDiscount สำหรับแต่ละ product
      const productsWithDiscount = [];
      for (const product of products) {
         const { buyPriceNum, preferDiscount } = calculateProductDiscount(product);
         productsWithDiscount.push({
            ...product,
            buyPriceNum,
            preferDiscount
         });
      }

      res.send(productsWithDiscount);
   } catch (err) {
      console.log(err);
      res.status(500).json({ message: "Server Error" });
   }
};

//อ่านข้อมูลเดียว ตาม id
exports.readAprod = async (req, res) => {
   // console.log("req.user to read", req.user);
   try {
      //findFirst === SELECT * from TableName WHERE id = ?
      //take === LIMIT
      const { id } = req.params;
      const aProduct = await prisma.product.findFirst({
         where: {
            id: parseInt(id)
         },
         //include === JOIN
         //เลือกเฉพาะคอลัมน์ที่ใช้จริงเพื่อลด payload
         include: {
            // ❌ category: true - ไม่ได้ใช้ใน frontend
            discounts: {
               select: {
                  startDate: true,
                  endDate: true,
                  isActive: true,
                  amount: true
               }
            },
            // images ใช้ full fields สำหรับ admin edit (asset_id, public_id, secure_url)
            images: true,
            ratings: {
               orderBy: {
                  order: {
                     createdAt: "desc"
                  }
               },
               select: {
                  rating: true,
                  comment: true,
                  orderId: true,
                  user: {
                     select: {
                        name: true,
                        picture: true
                     }
                  }
               }
            },
            brand: {
               select: {
                  img_url: true,
                  title: true
               }
            },
            favorites: {
               select: {
                  userId: true,
                  productId: true
               }
            }
         }
      });

      const prodOnOrder = await prisma.productOnOrder.findMany({
         where: {
            productId: parseInt(id)
         },
         orderBy: {
            order: {
               createdAt: "desc"
            }
         },
         include: {
            order: {
               select: {
                  createdAt: true
               }
            }
         }
      });
      //cal percent of ratings from 1 to 5
      //cal percent dominant of ratings 1 to 5
      const ratingArr = aProduct.ratings;
      let score1 = 0,
         score2 = 0,
         score3 = 0,
         score4 = 0,
         score5 = 0;
      let percent1 = 0,
         percent2 = 0,
         percent3 = 0,
         percent4 = 0,
         percent5 = 0;
      // ประกาศ rateArrLen นอก if block เพื่อใช้ใน response
      const rateArrLen = ratingArr.length;
      if (ratingArr.length > 0) {
         for (const ratings of ratingArr) {
            if (ratings?.rating === 5) {
               score5++;
            } else if (ratings?.rating === 4) {
               score4++;
            } else if (ratings?.rating === 3) {
               score3++;
            } else if (ratings?.rating === 2) {
               score2++;
            } else if (ratings?.rating === 1) {
               score1++;
            }
         }
         percent5 = score5 > 0 ? (score5 / rateArrLen) * 100 : 0;
         percent4 = score4 > 0 ? (score4 / rateArrLen) * 100 : 0;
         percent3 = score3 > 0 ? (score3 / rateArrLen) * 100 : 0;
         percent2 = score2 > 0 ? (score2 / rateArrLen) * 100 : 0;
         percent1 = score1 > 0 ? (score1 / rateArrLen) * 100 : 0;

         // const totalRatingCount = ratingArr.reduce((acc, curr) => acc + curr.rating, 0);
         // aProduct.ratingPercent = (totalRatingCount / rateArrLen) * 100;
      }
      // คำนวณ buyPriceNum และ preferDiscount
      const { buyPriceNum, preferDiscount } = calculateProductDiscount(aProduct);

      res.status(200).json({
         success: true,
         data: {
            ...aProduct,
            buyPriceNum,
            preferDiscount
         },
         prodOnOrder: prodOnOrder,
         globalRatingCount: rateArrLen,
         ratingInfo: {
            score1,
            score2,
            score3,
            score4,
            score5,
            percent1,
            percent2,
            percent3,
            percent4,
            percent5
         }
      });
      // res.send(products);
   } catch (err) {
      console.log(err);
      res.status(500).json({ message: "Server Error" });
   }
};

/* แบบย่อ
const product = await prisma.product.update({
    where: { id: parseInt(req.params.id) },
    data: {
        ...existingProduct,
        ...req.body, // แทนค่าที่ส่งมาเท่านั้น
    },
});
*/
//update → ไป copy try ของ create มา → เปลี่ยน .create เป็น .update
exports.updateProd = async (req, res) => {
   try {
      //req.body === inputForm → form in Frontend
      const { email } = req.user;
      const { title, description, price, quantity, categoryId, images, brandId } = req.body;

      // ดึงข้อมูลปัจจุบันจากฐานข้อมูล
      //findUnique === SELECT * from TableName WHERE id = ?
      const existingProduct = await prisma.product.findUnique({
         where: { id: parseInt(req.params.id) },
         include: { images: true } // ดึงข้อมูล images ด้วย
      });
      /*
      existingProduct==={
         id: number,
         title: string,
         description: string,
         price: number,
         sold: number,..,
         images: [  // Array of image objects
                  {
                     id: number,
                     asset_id: string,
                     public_id: string,
                     url: string,
                     productId: number
                  },...
                ]
               };
      */
      if (!existingProduct) {
         return res.status(404).json({ message: "Product not found" });
      }
      //verify if user sent the same images.id → not delete that image in DB

      /*
      // Create a set of existing image IDs for faster lookup
         const existingImageIds = new Set(existingProduct.images.map(img => img.id));

      // Filter out images that are not in the existing images
         const imgIdNotDel = images.filter(img => !existingImageIds.has(img.id));
      */

      //ลบรูปเก่า(เฉพาะใน DB) ออกก่อนเพื่อ insert รูปใหม่
      //ต้องเพิ่ม list product ใน req path ด้วยเพื่อแสดงรายละเอียดของ product ที่ต้องการแก้ไข
      await prisma.image.deleteMany({
         where: {
            productId: parseInt(req.params.id)
         }
      });
      const product = await prisma.product.update({
         where: {
            id: parseInt(req.params.id)
         },
         //data === INSERT INTO
         //ถ้าไม่ได้ส่งfieldใดใน req.body มา จะใช้ข้อมูลเดิม
         data: {
            title: title || existingProduct.title,
            description: description || existingProduct.description,
            price: price !== undefined ? parseFloat(price) : existingProduct.price,
            quantity: quantity !== undefined ? parseInt(quantity) : existingProduct.quantity,
            categoryId:
               categoryId !== undefined ? parseInt(categoryId) : existingProduct.categoryId,
            updatedBy: email,
            brandId: brandId !== undefined ? parseInt(brandId) : existingProduct.brandId,
            //เป็น one-to-many จึงต้องใช้ object ในการเก็บค่า ***เดี๋ยวกลับมาทำ
            // 1 product มีหลาย images
            // ถ้าเพิ่มรูปใน table 'Product' จะเพิ่มใน table 'Image' ด้วย
            images: images
               ? {
                    create: images.map((img) => ({
                       asset_id: img.asset_id,
                       public_id: img.public_id,
                       url: img.url,
                       secure_url: img.secure_url
                    }))
                 }
               : undefined // ถ้าไม่มีการส่ง images จะไม่อัปเดต images
         }
      });

      // Notify clients about the update
      notifyClients({
         type: "UPDATE_PRODUCT",
         productId: product.id,
         data: {
            quantity: product.quantity,
            price: product.price,
            promotion: product.promotion
         }
      });

      res.status(200).json({
         success: true,
         data: product
      });
      // res.send(product);
   } catch (err) {
      console.log(err);
      res.status(500).json({ message: "Server Error" });
   }
};

//del a product in db
//ต้อง Del รูปทั้งใน table 'Image' และใน cloud ด้วย
exports.removeProd = async (req, res) => {
   try {
      const { id } = req.params;
      //for sending res.title to frontend
      const productToRm = await prisma.product.findUnique({
         where: {
            id: Number(id)
         },
         include: {
            images: true
         }
      });
      console.log("productToRm->", productToRm);
      //del process: del record from table 'Product' + del images from table 'Image' + del img from cloudinary
      await prisma.product.delete({
         where: {
            id: Number(id)
         }
      });

      /*
      productToRm.images === [
                              {
                              "id": 900,
                              "asset_id": "788964f30ee2768df55f6539c039f649",
                              "public_id": "Ecom_fullstack_app_msc_products/product-1736767026915",
                              "url": "http://res.cloudinary.com/dvzlnabwf.jpg",
                              "secure_url": "https://res.cloudinary.com/dvzlnabwf/image/.jpg",
                              "createdAt": "2025-01-13T11:17:12.276Z",
                              "updatedAt": "2025-01-13T11:17:12.276Z",
                              "productId": 31
                              }, {..}
                           ]
      */
      // Delete the images from Cloudinary
      let imgToRm = [];
      for (const image of productToRm.images) {
         imgToRm.push(
            new Promise((resolve, reject) => {
               cloudinary.uploader.destroy(image.public_id, (error, result) => {
                  if (error) reject(error);
                  else resolve(result);
               });
            })
         );
      }
      await Promise.all(imgToRm);
      /*
      for (const image of productToRm.images) {
         await cloudinary.uploader.destroy(image.public_id);
      }
      */

      res.status(200).json({
         success: true,
         message: "Remove success",
         data: productToRm
      });
   } catch (err) {
      console.log(err);
      res.status(500).json({ message: "Server Error" });
   }
};

//ใช้แสดงสินค้าเรียงตามความนิยม
exports.displayProdBy = async (req, res) => {
   try {
      //auto-update expired discount
      await updateDiscount();
      //------------------------------------------------------------------------
      //ต้องการ req 3 อย่าง: sort<col?>, order<มากไปน้อย?>, limit<จำนวนที่ต้องการ?>
      const { sort, order, limit } = req.body;
      const products = await prisma.product.findMany({
         where: {
            quantity: { gt: 0 }
         },
         take: limit,
         orderBy: { [sort]: order },
         include: {
            category: true,
            images: true,
            discounts: true,
            favorites: true,
            ratings: true,
            brand: true
         }
      });

      // คำนวณ buyPriceNum และ preferDiscount สำหรับแต่ละ product
      const productsWithDiscount = [];
      for (const product of products) {
         const { buyPriceNum, preferDiscount } = calculateProductDiscount(product);
         productsWithDiscount.push({
            ...product,
            buyPriceNum,
            preferDiscount
         });
      }

      res.status(200).json({
         success: true,
         data: productsWithDiscount
      });
   } catch (err) {
      console.log(err);
      res.status(500).json({ message: "Server Error" });
   }
};

exports.displayProdByUser = async (req, res) => {
   const { id } = req.user;
   //to get 2-5 products from user's most frequently purchased categories
   try {
      const favCatArr = await prisma.order.findMany({
         where: {
            orderedById: id,
            OR: [{ status: "succeeded" }, { orderStatus: "Completed" }]
         },
         include: {
            products: {
               include: {
                  product: {
                     include: {
                        category: true
                     }
                  }
               }
            }
         }
      });

      //{'1': 5, '2': 3} count categoryId found  in table Order
      const catcount = {};
      //order === each records in table Order
      for (const order of favCatArr) {
         //const product === each ProductOnOrder
         for (const product of order.products) {
            //.product → table Product
            const catId = product.product.categoryId;
            if (catId) {
               catcount[catId] = (catcount[catId] || 0) + 1;
            }
         }
      }

      //get top 5 catId | topCat===[1, 2, 3, 4, 5]
      const topCat = Object.entries(catcount)
         .sort(([, a], [, b]) => b - a) //sort by value
         .slice(0, 5) //[['1', 5], ['2', 3], [], [], []]
         .map(([catId]) => parseInt(catId)); //[catId] = pair[0] | [, a] = pair[1]

      if (topCat.length === 0) {
         return res.status(200).json({
            success: true,
            message: "No purchase history found",
            data: []
         });
      }

      //get 2 or 5 products from each category and group them
      const recomProdsInCat = {}; //{ "1": [{prod1}, {prod2}], "2": [{prod3}, {prod4}] }
      //need at least 5 total products
      const prodsPerCat = topCat.length > 2 ? 2 : 5;

      for (const catId of topCat) {
         const products = await prisma.product.findMany({
            where: {
               categoryId: catId,
               quantity: { gt: 0 }
            },
            take: prodsPerCat,
            orderBy: {
               updatedAt: "desc"
            },
            include: {
               category: true,
               images: true,
               discounts: true,
               favorites: true,
               ratings: true,
               brand: true
            }
         });

         // Store directly in the grouped format
         // คำนวณ buyPriceNum และ preferDiscount สำหรับแต่ละ product
         const productsWithDiscount = [];
         for (const product of products) {
            const { buyPriceNum, preferDiscount } = calculateProductDiscount(product);
            productsWithDiscount.push({
               ...product,
               buyPriceNum,
               preferDiscount
            });
         }
         recomProdsInCat[catId] = productsWithDiscount;
      }
      //recomProdArr===[{prod1},{prod2}]
      const recomProdArr = Object.values(recomProdsInCat).flat();
      res.status(200).json({
         success: true,
         data: { recomProdsInCat: recomProdsInCat, topCat: topCat, recomProdArr: recomProdArr }
      });
      /*
      data: {
         topCat: [1, 2, 3, 4, 5], // category IDs
         recomProdsInCat: {
            "1": [{product1}, {product2}],
            "2": [{product3}, {product4}],
                          },
            recomProdArr: [{product1}, {product2},..]              
            }
      */
   } catch (err) {
      console.log(err);
      res.status(500).json({
         success: false,
         message: "Error retrieving personalized recommendations"
      });
   }
};

/*อยากให้ search 3 วิธี
1. ตามที่พิมพ์ลงช่อง input
2. ตามติ๊ก ✔ ช่อง category
3. ตามราคา */
//req.body === {category: [7,1], query: 'tes', price: [0, 100]}
exports.searchFilters = async (req, res) => {
   try {
      const { query, category, price, brand } = req.body;

      /*1. สร้าง obj เก็บค่าล่วงหน้า สำหรับส่งไป query DB โดย
      ตั้งชื่อ key ให้เหมือนชื่อคอลัมน์ใน DB และ method ของ prisma
        whereConditions =  {
         title: { contains: "tes" },
         categoryId: { in: [7,1] },
         price: { gte: 0, lte: 100 }
         }
      */
      const whereConditions = {};
      //2. เก็บตาม key ใน req.body ที่ส่งมา
      if (query.toString().trim() !== "") {
         whereConditions.title = {
            contains: query.toString().trim(),
            mode: "insensitive" //to ignore case → .toLowerCase() didnt work.
         };
      }
      if (category && category.length > 0) {
         whereConditions.categoryId = {
            in: category.map((id) => {
               const intId = parseInt(id);
               if (isNaN(intId)) {
                  throw new Error(`Invalid category id: ${id}`); //=== return console.log(err) in json
               } else {
                  return intId;
               }
            })
         };
      }
      if (price && price.length === 2) {
         whereConditions.price = {
            gte: parseFloat(price[0]),
            lte: parseFloat(price[1])
         };
      }
      if (brand && brand.length > 0) {
         whereConditions.brandId = {
            in: brand.map((id) => {
               const intId = parseInt(id);
               if (isNaN(intId)) {
                  throw new Error(`Invalid brand id: ${id}`); //=== return console.log(err) in json
               } else {
                  return intId;
               }
            })
         };
      }

      const products = await prisma.product.findMany({
         where: whereConditions,
         include: {
            category: true,
            images: true,
            discounts: true,
            favorites: true,
            ratings: true,
            brand: true
         }
      });

      // คำนวณ buyPriceNum และ preferDiscount สำหรับแต่ละ product
      const productsWithDiscount = [];
      for (const product of products) {
         const { buyPriceNum, preferDiscount } = calculateProductDiscount(product);
         productsWithDiscount.push({
            ...product,
            buyPriceNum,
            preferDiscount
         });
      }

      res.send(productsWithDiscount);
   } catch (err) {
      console.log(err);
      res.status(500).json({ message: "Server Error" });
   }
};

// manage image file on cloudinary ONLY !!!
cloudinary.config({
   cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
   api_key: process.env.CLOUDINARY_API_KEY,
   api_secret: process.env.CLOUDINARY_API_SECRET
});

//accroding to Frontend, uploadImages() is called before create()
exports.uploadImages = async (req, res) => {
   try {
      // console.log('req.body ->',req.body);
      // console.log('req.body img ->',req.body.image);
      const result = await cloudinary.uploader.upload(req.body.image, {
         public_id: `product-${Date.now()}`,
         resource_type: "auto",
         folder: "Ecom_fullstack_app_msc_products" // create this folder in cloudinary automatically
      });
      res.status(200).json({
         success: true,
         message: "Upload success",
         data: result
      });
   } catch (err) {
      console.log(err);
      res.status(500).json({ message: "Server Error" });
   }
};

exports.removeImage = async (req, res) => {
   //if method doesn't return Promise by default → use new Promise
   try {
      // table Image in db also has public_id col
      // console.log("public_id-->", req.body.public_id);
      await new Promise((resolve, reject) => {
         cloudinary.uploader.destroy(req.body.public_id, (error, result) => {
            if (error) reject(error); //trigger .catch() or catch(err){..}
            else resolve(result); //trigger .then() method or do next code in try{..}
         });
      });
      res.status(200).json({
         success: true,
         message: "Remove img from cloud success"
      });
   } catch (err) {
      console.log(err);
      res.status(500).json({ message: "Server Error" });
   }
};

/*
//in case Cloudinary support return Promise by default ▼
exports.removeImage = async (req, res) => {
   try {
      await cloudinary.uploader.destroy(req.body.public_id, (err, resolve) => {
         if (err) return res.status(500).json({ message: "Server Error" });
         else return res.status(200).json({ message: "Remove img from cloud success" });
      });
   } catch (err) {
      console.log(err);
      res.status(500).json({ message: "Server Error" });
   }
};
*/

/*
req.body === 
   {
      products:[ {id:1, title:test ,... images:[]}, {..} ],
      amount:10,
      startDate: "2025-01-17T21:58:44.063Z",
      endDate: "2025-02-17T21:58:44.063Z",
      description: "",
      isPromotion: false
   }

   isPromotion===true for promotion
   isPromotion===false for discount
*/
exports.bulkDiscount = async (req, res) => {
   const { products, amount, startDate, endDate, description, isPromotion } = req.body;
   const { email } = req.user; //can access req.user bc <token> sent in req.headers.authorization
   // console.log("req.user to handleBulkDiscount", req.user);
   // console.log("isPromotion", isPromotion);
   try {
      const productIds = products.map((obj) => obj.id);
      
      //if isPromotion === true → update col promotion in Product and go to res.status(200)
      if (isPromotion) {
         //อัพเดตฟิลด์ promotion ในตาราง Product
         await prisma.product.updateMany({
            where: {
               id: { in: productIds }
            },
            data: {
               promotion: amount
            }
         });
      } else {
         // Step 1: Delete all existing discounts for the selected products
         await prisma.discount.deleteMany({
            where: {
               productId: { in: productIds }
            }
         });
         console.log("Deleted old discounts for products:", productIds);

         // Step 2: Create new discounts for all selected products
         await prisma.discount.createMany({
            data: productIds.map((id) => ({
               productId: id,
               amount: amount,
               startDate: new Date(startDate),
               endDate: new Date(endDate),
               description: description,
               isActive: true,
               createdBy: email
            }))
         });
         console.log("Created new discounts for products:", productIds);
      }
      // Notify clients about bulk update (simplified: just tell them to refresh or send specific IDs if possible)
      // For now, we'll send a generic update or list of IDs if we tracked them.
      // Since we have `products` array with IDs:
      notifyClients({
         type: "BULK_UPDATE",
         productIds: products.map((p) => p.id),
         // In a real app, you might want to fetch the fresh data for these IDs and send it,
         // or just let the client re-fetch.
         // Sending the new promotion/discount info:
         promotion: isPromotion ? amount : undefined,
         discount: !isPromotion ? { amount, startDate, endDate } : undefined
      });
      return res.status(200).json({
         message: `Discount applied on ${products.length} products successfully`
      });
   } catch (error) {
      console.log(error);
      return res.status(500).json({ error: "Failed to apply discount" });
   }
};

//for toggle isActive seasonal discount of prod
//pending...
/*
Need req.body:
1. productId
2. status (true or false)
*/
//pending...
exports.changeStatusDiscount = async (req, res) => {
   try {
      const { productIdArr, status } = req.body;
      await prisma.discount.updateMany({
         where: { productId: { in: productIdArr } },
         data: { isActive: status }
      });

      res.status(200).json({
         success: true,
         message: `Update productID: ${productIdArr} status to ${status}.`
      });
   } catch (err) {
      console.log(err);
      res.status(500).json({
         success: false,
         message: "Error!!! Cannot change status."
      });
   }
};
