/**
 * Fix Script: ปรับ quantity ของ products ทั้งหมด
 * สำหรับเตรียม k6 load testing
 * 
 * Usage:
 *   node prisma/fix-product-quantity.js                  # ตั้ง quantity = 999999 (default)
 *   node prisma/fix-product-quantity.js --quantity=1000  # ตั้ง quantity = 1000
 *   node prisma/fix-product-quantity.js --reset          # reset เป็นค่า random (1-500)
 */

const prisma = require("../config/prisma");

// ===== Configuration =====
const DEFAULT_QUANTITY = 999999; // ค่า default สำหรับ k6 testing
const BATCH_SIZE = 1000;
const LOG_INTERVAL = 2000;
const EXCLUDED_PRODUCT_IDS = [46]; // ยกเว้น banner

// ===== Helper Functions =====

function parseArgs() {
   const args = process.argv.slice(2);
   let mode = "set"; // "set" หรือ "reset"
   let quantity = DEFAULT_QUANTITY;

   for (const arg of args) {
      if (arg.startsWith("--quantity=")) {
         quantity = parseInt(arg.split("=")[1], 10);
         if (isNaN(quantity) || quantity < 0) {
            console.error("Invalid quantity value. Using default:", DEFAULT_QUANTITY);
            quantity = DEFAULT_QUANTITY;
         }
      } else if (arg === "--reset") {
         mode = "reset";
      }
   }

   return { mode, quantity };
}

/**
 * สุ่ม quantity สำหรับ reset mode
 */
function randomQuantity() {
   return Math.floor(Math.random() * 500) + 1; // 1-500
}

// ===== Main Function =====

async function fixProductQuantity(mode, quantity) {
   const modeLabel = mode === "set" 
      ? `ตั้ง quantity = ${quantity.toLocaleString()} ทุก product` 
      : `Reset quantity เป็นค่า random (1-500)`;
   console.log(`🔧 Mode: ${modeLabel}\n`);

   try {
      if (mode === "set") {
         // โหมด SET: อัปเดตทุก product พร้อมกัน (เร็วมาก)
         const result = await prisma.product.updateMany({
            where: { id: { notIn: EXCLUDED_PRODUCT_IDS } },
            data: { quantity: quantity }
         });
         console.log(`✅ Updated ${result.count.toLocaleString()} products to quantity = ${quantity.toLocaleString()}`);
      } else {
         // โหมด RESET: ต้องอัปเดตแต่ละ product ด้วยค่า random
         const allProducts = await prisma.product.findMany({
            where: { id: { notIn: EXCLUDED_PRODUCT_IDS } },
            select: { id: true }
         });
         console.log(`   📦 Total products: ${allProducts.length.toLocaleString()}\n`);

         const startTime = Date.now();
         let updated = 0;

         // Process in batches
         for (let i = 0; i < allProducts.length; i += BATCH_SIZE) {
            const batch = allProducts.slice(i, i + BATCH_SIZE);
            
            // สร้าง update promises
            const updatePromises = batch.map((product) =>
               prisma.product.update({
                  where: { id: product.id },
                  data: { quantity: randomQuantity() }
               })
            );

            await Promise.all(updatePromises);
            updated += batch.length;

            // Log progress
            if (updated % LOG_INTERVAL === 0 || updated >= allProducts.length) {
               const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
               const percent = ((updated / allProducts.length) * 100).toFixed(1);
               console.log(`   Updated: ${updated.toLocaleString()}/${allProducts.length.toLocaleString()} (${percent}%) - ${elapsed}s`);
            }
         }

         const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
         console.log(`\n✅ Reset ${updated.toLocaleString()} products with random quantities`);
         console.log(`   Total time: ${totalTime} seconds`);
      }

   } catch (err) {
      console.error("❌ Error:", err.message);
   } finally {
      await prisma.$disconnect();
   }
}

// ===== Main Entry Point =====
async function main() {
   console.log("🌱 Fix Product Quantity Script\n");
   console.log("=".repeat(50));

   const { mode, quantity } = parseArgs();
   await fixProductQuantity(mode, quantity);

   console.log("=".repeat(50));
   console.log("🎉 Done!");
}

main();
