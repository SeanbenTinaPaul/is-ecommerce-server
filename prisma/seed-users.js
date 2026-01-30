/**
 * Seed Script: สร้าง 10,000 User records สำหรับ k6 Load Testing
 * ใช้ @faker-js/faker สำหรับ generate ข้อมูล
 * ใช้ pre-hashed password เดียวกันทุก user สำหรับ k6 testing
 *
 * Usage:
 *   node prisma/seed-users.js              # seed 10,000 users
 *   node prisma/seed-users.js --count=10   # seed 10 users (for testing)
 *   node prisma/seed-users.js --count=1000 # seed 1,000 users
 *
 * Login credentials for k6:
 *   - Email: ใช้ email ที่ seed (ดูใน database)
 *   - Password: Test@1234
 */

const { faker } = require("@faker-js/faker");
const bcrypt = require("bcryptjs");
const prisma = require("../config/prisma");

// ===== Configuration =====
const DEFAULT_COUNT = 10000;
const BATCH_SIZE = 500; // จำนวน records ต่อ batch
const LOG_INTERVAL = 1000; // log progress ทุกกี่ records
const FAVORITES_PER_USER = 2; // จำนวน favorites ต่อ user

// Password ที่ใช้สำหรับทุก test user (สำหรับ k6 login)
const TEST_PASSWORD = "Test@1234";

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
 * สร้าง placeholder image URL จาก picsum.photos สำหรับ user
 */
function generateUserPictureUrl(userId) {
   return `https://picsum.photos/seed/user${userId}/200/200`;
}

/**
 * สร้าง picturePub ในรูปแบบเหมือน Cloudinary
 */
function generatePicturePub(userId) {
   const timestamp = Date.now() + userId; // unique timestamp per user
   return `Ecom_fullstack_app_msc_products/user-${timestamp}`;
}

/**
 * สุ่มเลือก n items จาก array (ไม่ซ้ำกัน)
 */
function randomSampleFromArray(arr, n) {
   const shuffled = [...arr].sort(() => 0.5 - Math.random());
   return shuffled.slice(0, Math.min(n, arr.length));
}

/**
 * Generate user data object
 */
function generateUserData(hashedPassword) {
   return {
      email: faker.internet.email().toLowerCase(),
      password: hashedPassword,
      name: faker.person.fullName(),
      role: "user",
      enabled: true,
      address: faker.location.streetAddress({ useFullAddress: true })
   };
}

// ===== Main Seed Functions =====

/**
 * ดึง Product IDs ทั้งหมดจาก database
 */
async function getProductIds() {
   const products = await prisma.product.findMany({
      where: { id: { not: 46 } },
      select: { id: true }
   });
   return products.map((p) => p.id);
}

/**
 * Seed users in batches
 */
async function seedUsers(totalCount) {
   console.log(`\n👥 Starting to seed ${totalCount.toLocaleString()} users...`);
   console.log(`   Batch size: ${BATCH_SIZE}`);
   console.log(`   Favorites per user: ${FAVORITES_PER_USER}`);
   console.log(`   Estimated batches: ${Math.ceil(totalCount / BATCH_SIZE)}\n`);

   // Pre-hash password ครั้งเดียว (Option A - เร็วกว่ามาก)
   console.log("   🔐 Pre-hashing password...");
   const hashedPassword = await bcrypt.hash(TEST_PASSWORD, 10);
   console.log(`   ✓ Password hash ready (use "${TEST_PASSWORD}" for k6 login)\n`);

   // ดึง product IDs สำหรับ random favorites
   const productIds = await getProductIds();
   if (productIds.length < FAVORITES_PER_USER) {
      console.warn(`⚠️ Warning: Only ${productIds.length} products available for favorites`);
   }
   console.log(`   Using ${productIds.length} products for favorites\n`);

   const startTime = Date.now();
   let totalUsersCreated = 0;
   let totalFavoritesCreated = 0;
   let batchNumber = 0;

   // Process in batches
   for (let i = 0; i < totalCount; i += BATCH_SIZE) {
      batchNumber++;
      const batchSize = Math.min(BATCH_SIZE, totalCount - i);

      // Generate batch of users
      const userDataBatch = [];
      for (let j = 0; j < batchSize; j++) {
         userDataBatch.push(generateUserData(hashedPassword));
      }

      try {
         // Insert users batch และ return IDs
         const createdUsers = await prisma.user.createManyAndReturn({
            data: userDataBatch,
            select: { id: true }
         });

         // อัปเดต picture และ picturePub สำหรับแต่ละ user
         // (ต้องทำแยกเพราะ createMany ไม่รองรับ computed values)
         for (const user of createdUsers) {
            await prisma.user.update({
               where: { id: user.id },
               data: {
                  picture: generateUserPictureUrl(user.id),
                  picturePub: generatePicturePub(user.id)
               }
            });
         }

         totalUsersCreated += createdUsers.length;

         // Generate favorites สำหรับแต่ละ user
         if (productIds.length >= FAVORITES_PER_USER) {
            const favoriteDataBatch = [];
            for (const user of createdUsers) {
               // สุ่ม 2 products ที่ไม่ซ้ำกัน
               const randomProductIds = randomSampleFromArray(productIds, FAVORITES_PER_USER);
               for (const productId of randomProductIds) {
                  favoriteDataBatch.push({
                     userId: user.id,
                     productId: productId
                  });
               }
            }

            // Insert favorites batch
            const favResult = await prisma.favorite.createMany({
               data: favoriteDataBatch,
               skipDuplicates: true // skip ถ้า user-product pair ซ้ำ
            });
            totalFavoritesCreated += favResult.count;
         }

         // Log progress
         if (totalUsersCreated % LOG_INTERVAL === 0 || totalUsersCreated >= totalCount) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const percent = ((totalUsersCreated / totalCount) * 100).toFixed(1);
            const rate = (totalUsersCreated / elapsed).toFixed(0);
            console.log(
               `   [Batch ${batchNumber}] Users: ${totalUsersCreated.toLocaleString()}/${totalCount.toLocaleString()} (${percent}%) - ${elapsed}s - ${rate}/sec`
            );
         }
      } catch (err) {
         console.error(`❌ Error in batch ${batchNumber}:`, err.message);
         // Continue with next batch
      }
   }

   const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
   console.log(`\n✅ Seeding completed!`);
   console.log(`   Total users created: ${totalUsersCreated.toLocaleString()}`);
   console.log(`   Total favorites created: ${totalFavoritesCreated.toLocaleString()}`);
   console.log(`   Total time: ${totalTime} seconds`);
   console.log(`   Average rate: ${(totalUsersCreated / totalTime).toFixed(0)} users/sec`);

   return { usersCreated: totalUsersCreated, favoritesCreated: totalFavoritesCreated };
}

// ===== Main Entry Point =====
async function main() {
   console.log("🌱 User Seed Script Started\n");
   console.log("=".repeat(50));

   const { count } = parseArgs();
   console.log(`   Target: ${count.toLocaleString()} users`);
   console.log(`   Password: ${TEST_PASSWORD} (for k6 login)\n`);

   try {
      await seedUsers(count);

      console.log("\n" + "=".repeat(50));
      console.log("🎉 All done!");
      console.log(`\n📝 k6 Login Info:`);
      console.log(`   - Password: ${TEST_PASSWORD}`);
      console.log(`   - Email: Query from database`);
   } catch (err) {
      console.error("\n❌ Fatal error:", err);
      process.exit(1);
   } finally {
      await prisma.$disconnect();
   }
}

// Run the script
main();
