/**
 * Seed Script: สร้าง 20,000 Product records สำหรับ Indexing Research
 * ใช้ @faker-js/faker สำหรับ generate ข้อมูล
 * ใช้ placeholder URLs จาก picsum.photos สำหรับรูปภาพ
 * 
 * Usage:
 *   node prisma/seed-products.js              # seed 20,000 products
 *   node prisma/seed-products.js --count=10   # seed 10 products (for testing)
 *   node prisma/seed-products.js --count=1000 # seed 1,000 products
 */

const { faker } = require("@faker-js/faker");
const prisma = require("../config/prisma");

// ===== Configuration =====
const DEFAULT_COUNT = 20000;
const BATCH_SIZE = 500; // จำนวน records ต่อ batch เพื่อหลีกเลี่ยง connection timeout
const LOG_INTERVAL = 1000; // log progress ทุกกี่ records

// Email สำหรับ createdBy field
const SEED_CREATOR_EMAIL = "seed-script@demo.com";

// ===== Categories ที่จะเพิ่มใหม่ (นอกเหนือจากที่มีอยู่) =====
const NEW_CATEGORIES = [
   { name: "Tablet" },
   { name: "Camera" },
   { name: "Headphone" },
   { name: "Smart Watch" },
   { name: "Gaming Console" },
   { name: "Keyboard" },
   { name: "Mouse" },
   { name: "Monitor" },
   { name: "Speaker" },
   { name: "Printer" },
   { name: "Router" },
   { name: "Power Bank" },
   { name: "USB Drive" },
   { name: "External HDD" },
   { name: "SSD" },
   { name: "RAM" },
   { name: "Graphics Card" },
   { name: "Motherboard" },
   { name: "Case" },
   { name: "PSU" },
   { name: "Cooling Fan" },
   { name: "Cable & Adapter" },
   { name: "Software" },
   { name: "Office Supplies" },
   { name: "Furniture" }
];

// ===== Brands ที่จะเพิ่มใหม่ (นอกเหนือจากที่มีอยู่) =====
const NEW_BRANDS = [
   { title: "Apple", description: "Electronics and computers" },
   { title: "Dell", description: "Computers and accessories" },
   { title: "HP", description: "Computers and printers" },
   { title: "Lenovo", description: "Computers and tablets" },
   { title: "Asus", description: "Electronics and gaming" },
   { title: "Acer", description: "Computers and monitors" },
   { title: "Sony", description: "Electronics and entertainment" },
   { title: "Logitech", description: "Peripherals and accessories" },
   { title: "Razer", description: "Gaming peripherals" },
   { title: "Corsair", description: "Gaming and PC components" },
   { title: "Kingston", description: "Memory and storage" },
   { title: "Western Digital", description: "Storage solutions" },
   { title: "Seagate", description: "Storage solutions" },
   { title: "Crucial", description: "Memory and SSD" },
   { title: "NVIDIA", description: "Graphics cards and AI" },
   { title: "Intel", description: "Processors and chipsets" },
   { title: "Gigabyte", description: "Motherboards and graphics cards" },
   { title: "EVGA", description: "Graphics cards and PSU" },
   { title: "Cooler Master", description: "PC cooling and cases" },
   { title: "NZXT", description: "PC cases and cooling" },
   { title: "Anker", description: "Chargers and power banks" },
   { title: "JBL", description: "Audio and speakers" },
   { title: "Bose", description: "Audio and headphones" },
   { title: "SteelSeries", description: "Gaming peripherals" },
   { title: "HyperX", description: "Gaming peripherals and memory" }
];

// ===== Helper Functions =====

/**
 * Parse command line arguments
 */
function parseArgs() {
   const args = process.argv.slice(2);
   let count = DEFAULT_COUNT;

   for (const arg of args) {
      if (arg.startsWith("--count=")) {
         count = parseInt(arg.split("=")[1], 10);
         if (isNaN(count) || count <= 0) {
            console.error("Invalid count value. Using default:", DEFAULT_COUNT);
            count = DEFAULT_COUNT;
         }
      }
   }

   return { count };
}

/**
 * สร้าง placeholder image URL จาก picsum.photos
 */
function generatePlaceholderImageUrl(productId) {
   // picsum.photos ใช้ seed เพื่อให้ได้รูปเดิมเสมอสำหรับ productId เดียวกัน
   return `https://picsum.photos/seed/prod${productId}/800/800`;
}

/**
 * สุ่มเลือก item จาก array
 */
function randomFromArray(arr) {
   return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * สุ่ม promotion (20% chance ที่จะมี promotion)
 */
function randomPromotion() {
   if (Math.random() < 0.2) {
      return faker.number.float({ min: 5, max: 30, fractionDigits: 0 });
   }
   return null;
}

/**
 * Generate product data object
 */
function generateProductData(categoryIds, brandIds) {
   const price = faker.number.float({ min: 100, max: 50000, fractionDigits: 2 });
   
   // สร้าง description อย่างน้อย 500 ตัวอักษร โดยใช้ paragraphs + productDescription
   const baseDesc = faker.commerce.productDescription();
   const extraParagraphs = faker.lorem.paragraphs(3);
   const description = `${baseDesc}\n\n${extraParagraphs}`;
   
   return {
      title: faker.commerce.productName(),
      description: description,
      price: price,
      quantity: faker.number.int({ min: 1, max: 500 }),
      sold: faker.number.int({ min: 0, max: 100 }),
      categoryId: randomFromArray(categoryIds),
      brandId: randomFromArray(brandIds),
      avgRating: faker.number.float({ min: 1, max: 5, fractionDigits: 1 }),
      promotion: randomPromotion(),
      createdBy: SEED_CREATOR_EMAIL
   };
}


/**
 * Generate image data object สำหรับ product
 */
function generateImageData(productId) {
   const imageUrl = generatePlaceholderImageUrl(productId);
   return {
      asset_id: `seed_asset_${productId}`,
      public_id: `seed_products/product_${productId}`,
      url: imageUrl,
      secure_url: imageUrl.replace("http://", "https://"),
      productId: productId
   };
}

// ===== Main Seed Functions =====

/**
 * เพิ่ม Categories ใหม่ (skip ถ้ามีอยู่แล้ว)
 */
async function seedCategories() {
   console.log("📁 Seeding new categories...");
   let added = 0;

   for (const cat of NEW_CATEGORIES) {
      try {
         // ตรวจสอบว่ามีอยู่แล้วหรือไม่
         const existing = await prisma.category.findFirst({
            where: { name: cat.name }
         });

         if (!existing) {
            await prisma.category.create({
               data: {
                  name: cat.name,
                  createdBy: SEED_CREATOR_EMAIL
               }
            });
            added++;
         }
      } catch (err) {
         console.warn(`⚠️ Could not create category "${cat.name}":`, err.message);
      }
   }

   console.log(`✅ Added ${added} new categories`);
}

/**
 * เพิ่ม Brands ใหม่ (skip ถ้ามีอยู่แล้ว)
 */
async function seedBrands() {
   console.log("🏷️ Seeding new brands...");
   let added = 0;
   let brandIndex = 0;

   for (const brand of NEW_BRANDS) {
      brandIndex++;
      try {
         // ตรวจสอบว่ามีอยู่แล้วหรือไม่ (by title)
         const existing = await prisma.brand.findFirst({
            where: { title: brand.title }
         });

         if (!existing) {
            // สร้าง placeholder image URL สำหรับ brand
            const imgUrl = `https://picsum.photos/seed/brand${brandIndex}/200/200`;
            const publicId = `seed_brands/brand_${brandIndex}`;
            
            await prisma.brand.create({
               data: {
                  title: brand.title,
                  description: brand.description,
                  img_url: imgUrl,
                  public_id: publicId,
                  createdBy: SEED_CREATOR_EMAIL
               }
            });
            added++;
         }
      } catch (err) {
         console.warn(`⚠️ Could not create brand "${brand.title}":`, err.message);
      }
   }

   console.log(`✅ Added ${added} new brands`);

}

/**
 * ดึง Category IDs ทั้งหมด (ยกเว้น Banner)
 */
async function getCategoryIds() {
   const categories = await prisma.category.findMany({
      where: {
         name: { not: "Banner(not for sale)" }
      },
      select: { id: true }
   });
   return categories.map((c) => c.id);
}

/**
 * ดึง Brand IDs ทั้งหมด
 */
async function getBrandIds() {
   const brands = await prisma.brand.findMany({
      select: { id: true }
   });
   return brands.map((b) => b.id);
}

/**
 * Seed products in batches
 */
async function seedProducts(totalCount) {
   console.log(`\n📦 Starting to seed ${totalCount.toLocaleString()} products...`);
   console.log(`   Batch size: ${BATCH_SIZE}`);
   console.log(`   Estimated batches: ${Math.ceil(totalCount / BATCH_SIZE)}\n`);

   // ดึง category และ brand IDs
   const categoryIds = await getCategoryIds();
   const brandIds = await getBrandIds();

   if (categoryIds.length === 0) {
      throw new Error("No categories found. Please create categories first.");
   }
   if (brandIds.length === 0) {
      throw new Error("No brands found. Please create brands first.");
   }

   console.log(`   Using ${categoryIds.length} categories and ${brandIds.length} brands\n`);

   const startTime = Date.now();
   let totalCreated = 0;
   let batchNumber = 0;

   // Process in batches
   for (let i = 0; i < totalCount; i += BATCH_SIZE) {
      batchNumber++;
      const batchSize = Math.min(BATCH_SIZE, totalCount - i);
      
      // Generate batch of products
      const productDataBatch = [];
      for (let j = 0; j < batchSize; j++) {
         productDataBatch.push(generateProductData(categoryIds, brandIds));
      }

      try {
         // Insert products batch
         const createdProducts = await prisma.product.createManyAndReturn({
            data: productDataBatch,
            select: { id: true }
         });

         // Generate และ insert images batch
         const imageDataBatch = createdProducts.map((p) => generateImageData(p.id));
         await prisma.image.createMany({
            data: imageDataBatch
         });

         totalCreated += createdProducts.length;

         // Log progress
         if (totalCreated % LOG_INTERVAL === 0 || totalCreated === totalCount) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const percent = ((totalCreated / totalCount) * 100).toFixed(1);
            const rate = (totalCreated / elapsed).toFixed(0);
            console.log(
               `   [Batch ${batchNumber}] Created: ${totalCreated.toLocaleString()}/${totalCount.toLocaleString()} (${percent}%) - ${elapsed}s elapsed - ${rate} products/sec`
            );
         }
      } catch (err) {
         console.error(`❌ Error in batch ${batchNumber}:`, err.message);
         // Continue with next batch instead of failing completely
      }
   }

   const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
   console.log(`\n✅ Seeding completed!`);
   console.log(`   Total products created: ${totalCreated.toLocaleString()}`);
   console.log(`   Total time: ${totalTime} seconds`);
   console.log(`   Average rate: ${(totalCreated / totalTime).toFixed(0)} products/sec`);

   return totalCreated;
}

// ===== Main Entry Point =====
async function main() {
   console.log("🌱 Product Seed Script Started\n");
   console.log("=".repeat(50));

   const { count } = parseArgs();
   console.log(`   Target: ${count.toLocaleString()} products\n`);

   try {
      // Step 1: Seed Categories
      await seedCategories();

      // Step 2: Seed Brands
      await seedBrands();

      // Step 3: Seed Products
      await seedProducts(count);

      console.log("\n" + "=".repeat(50));
      console.log("🎉 All done!");
   } catch (err) {
      console.error("\n❌ Fatal error:", err);
      process.exit(1);
   } finally {
      await prisma.$disconnect();
   }
}

// Run the script
main();
