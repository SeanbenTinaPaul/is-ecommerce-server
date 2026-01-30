/**
 * Fix Script: จัดการ favorites ของ users ที่มีอยู่
 * 
 * Usage:
 *   node prisma/fix-user-favorites.js --add=5        # เพิ่ม 5 favorites ต่อ user
 *   node prisma/fix-user-favorites.js --target=10   # ตั้งเป้าให้แต่ละ user มี 10 favorites พอดี
 */

const prisma = require("../config/prisma");

// ===== Configuration =====
const BATCH_SIZE = 500;
const LOG_INTERVAL = 1000;

// ===== Helper Functions =====

function parseArgs() {
   const args = process.argv.slice(2);
   let mode = null; // "add" หรือ "target"
   let value = 0;

   for (const arg of args) {
      if (arg.startsWith("--add=")) {
         mode = "add";
         value = parseInt(arg.split("=")[1], 10);
      } else if (arg.startsWith("--target=")) {
         mode = "target";
         value = parseInt(arg.split("=")[1], 10);
      }
   }

   if (!mode || isNaN(value) || value <= 0) {
      console.error("❌ Invalid arguments!");
      console.error("   Usage:");
      console.error("     --add=N     เพิ่ม N favorites ต่อ user");
      console.error("     --target=N  ตั้งเป้าให้แต่ละ user มี N favorites พอดี");
      process.exit(1);
   }

   return { mode, value };
}

/**
 * สุ่มเลือก n items จาก array (ไม่ซ้ำกัน)
 */
function randomSampleFromArray(arr, n) {
   const shuffled = [...arr].sort(() => 0.5 - Math.random());
   return shuffled.slice(0, Math.min(n, arr.length));
}

// ===== Main Function =====

async function processFavorites(mode, value) {
   const modeLabel = mode === "add" ? `เพิ่ม ${value} favorites ต่อ user` : `ตั้งเป้า ${value} favorites ต่อ user`;
   console.log(`🔧 Mode: ${modeLabel}\n`);

   try {
      // ดึง product IDs ทั้งหมด
      const allProducts = await prisma.product.findMany({
         select: { id: true }
      });
      const allProductIds = allProducts.map((p) => p.id);
      console.log(`   📦 Total products available: ${allProductIds.length.toLocaleString()}`);

      // ดึง user IDs ทั้งหมด
      const allUsers = await prisma.user.findMany({
         select: { id: true }
      });
      console.log(`   👥 Total users to process: ${allUsers.length.toLocaleString()}\n`);

      const startTime = Date.now();
      let totalFavoritesAdded = 0;
      let totalFavoritesRemoved = 0;
      let usersProcessed = 0;

      // Process in batches
      for (let i = 0; i < allUsers.length; i += BATCH_SIZE) {
         const userBatch = allUsers.slice(i, i + BATCH_SIZE);
         const userIds = userBatch.map((u) => u.id);

         // ดึง favorites ที่มีอยู่แล้วสำหรับ users ใน batch นี้
         const existingFavorites = await prisma.favorite.findMany({
            where: { userId: { in: userIds } },
            select: { id: true, userId: true, productId: true }
         });

         // สร้าง map ของ favorites ที่แต่ละ user มีอยู่แล้ว
         const userFavoritesMap = {};
         for (const fav of existingFavorites) {
            if (!userFavoritesMap[fav.userId]) {
               userFavoritesMap[fav.userId] = [];
            }
            userFavoritesMap[fav.userId].push(fav);
         }

         const newFavoritesData = [];
         const favoriteIdsToDelete = [];

         for (const user of userBatch) {
            const existingFavs = userFavoritesMap[user.id] || [];
            const existingProductIds = new Set(existingFavs.map((f) => f.productId));
            const currentCount = existingFavs.length;

            if (mode === "add") {
               // โหมด ADD: เพิ่ม N favorites ใหม่
               const availableProductIds = allProductIds.filter((pid) => !existingProductIds.has(pid));
               if (availableProductIds.length > 0) {
                  const newProductIds = randomSampleFromArray(availableProductIds, value);
                  for (const productId of newProductIds) {
                     newFavoritesData.push({ userId: user.id, productId });
                  }
               }
            } else if (mode === "target") {
               // โหมด TARGET: ตั้งเป้าให้มี N favorites พอดี
               if (currentCount < value) {
                  // มีน้อยกว่าเป้า → เพิ่มให้ครบ
                  const needToAdd = value - currentCount;
                  const availableProductIds = allProductIds.filter((pid) => !existingProductIds.has(pid));
                  if (availableProductIds.length > 0) {
                     const newProductIds = randomSampleFromArray(availableProductIds, needToAdd);
                     for (const productId of newProductIds) {
                        newFavoritesData.push({ userId: user.id, productId });
                     }
                  }
               } else if (currentCount > value) {
                  // มีมากกว่าเป้า → ลบส่วนเกินออก (ลบแบบ random)
                  const needToRemove = currentCount - value;
                  const favsToRemove = randomSampleFromArray(existingFavs, needToRemove);
                  for (const fav of favsToRemove) {
                     favoriteIdsToDelete.push(fav.id);
                  }
               }
               // ถ้า currentCount === value → ไม่ต้องทำอะไร
            }
         }

         // Insert favorites ใหม่
         if (newFavoritesData.length > 0) {
            const result = await prisma.favorite.createMany({
               data: newFavoritesData,
               skipDuplicates: true
            });
            totalFavoritesAdded += result.count;
         }

         // Delete favorites ที่เกิน (สำหรับ target mode)
         if (favoriteIdsToDelete.length > 0) {
            await prisma.favorite.deleteMany({
               where: { id: { in: favoriteIdsToDelete } }
            });
            totalFavoritesRemoved += favoriteIdsToDelete.length;
         }

         usersProcessed += userBatch.length;

         // Log progress
         if (usersProcessed % LOG_INTERVAL === 0 || usersProcessed >= allUsers.length) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const percent = ((usersProcessed / allUsers.length) * 100).toFixed(1);
            console.log(
               `   Processed: ${usersProcessed.toLocaleString()}/${allUsers.length.toLocaleString()} users (${percent}%) - ${elapsed}s`
            );
         }
      }

      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n✅ Completed!`);
      console.log(`   Favorites added: ${totalFavoritesAdded.toLocaleString()}`);
      if (totalFavoritesRemoved > 0) {
         console.log(`   Favorites removed: ${totalFavoritesRemoved.toLocaleString()}`);
      }
      console.log(`   Total time: ${totalTime} seconds`);

   } catch (err) {
      console.error("❌ Error:", err.message);
   } finally {
      await prisma.$disconnect();
   }
}

// ===== Main Entry Point =====
async function main() {
   console.log("🌱 Fix User Favorites Script\n");
   console.log("=".repeat(50));

   const { mode, value } = parseArgs();
   await processFavorites(mode, value);

   console.log("=".repeat(50));
   console.log("🎉 Done!");
}

main();
