/**
 * Fix Script: ปรับ description ของ products ให้มีอย่างน้อย 500 ตัวอักษร
 * 
 * Usage:
 *   node prisma/fix-product-description.js                     # แก้ไข products ที่ id < 75
 *   node prisma/fix-product-description.js --from=1 --to=100   # แก้ไข products id 1-100
 *   node prisma/fix-product-description.js --from=50           # แก้ไข products id >= 50
 *   node prisma/fix-product-description.js --to=200            # แก้ไข products id <= 200
 *   node prisma/fix-product-description.js --min-chars=800     # ตั้ง minimum characters เป็น 800
 */

const { faker } = require("@faker-js/faker");
const prisma = require("../config/prisma");

// ===== Configuration =====
const DEFAULT_MIN_CHARS = 500;
const EXCLUDED_PRODUCT_IDS = [46]; // ยกเว้น banner
const BATCH_SIZE = 100;
const LOG_INTERVAL = 500;

// ===== Helper Functions =====

function parseArgs() {
   const args = process.argv.slice(2);
   let fromId = null;
   let toId = 74; // default: id < 75
   let minChars = DEFAULT_MIN_CHARS;

   for (const arg of args) {
      if (arg.startsWith("--from=")) {
         fromId = parseInt(arg.split("=")[1], 10);
      } else if (arg.startsWith("--to=")) {
         toId = parseInt(arg.split("=")[1], 10);
      } else if (arg.startsWith("--min-chars=")) {
         minChars = parseInt(arg.split("=")[1], 10);
      }
   }

   return { fromId, toId, minChars };
}

/**
 * สร้าง description ที่มีความยาวอย่างน้อย minChars
 */
function extendDescription(currentDesc, minChars) {
   if (currentDesc && currentDesc.length >= minChars) {
      return currentDesc; // ไม่ต้องเพิ่ม
   }

   // ต่อ lorem text จนกว่าจะครบ minChars
   let newDesc = currentDesc || "";
   while (newDesc.length < minChars) {
      newDesc += "\n\n" + faker.lorem.paragraphs(2);
   }
   
   return newDesc;
}

// ===== Main Function =====

async function fixProductDescription(fromId, toId, minChars) {
   const rangeLabel = fromId !== null 
      ? `id ${fromId} - ${toId}` 
      : `id <= ${toId}`;
   console.log(`🔧 Fixing descriptions for products ${rangeLabel}`);
   console.log(`   Minimum characters: ${minChars}\n`);

   try {
      // สร้าง where condition
      const whereCondition = {
         id: { notIn: EXCLUDED_PRODUCT_IDS }
      };

      if (fromId !== null && toId !== null) {
         whereCondition.id = { 
            gte: fromId, 
            lte: toId,
            notIn: EXCLUDED_PRODUCT_IDS 
         };
      } else if (fromId !== null) {
         whereCondition.id = { 
            gte: fromId,
            notIn: EXCLUDED_PRODUCT_IDS 
         };
      } else if (toId !== null) {
         whereCondition.id = { 
            lte: toId,
            notIn: EXCLUDED_PRODUCT_IDS 
         };
      }

      // ดึง products ที่ต้องแก้ไข
      const products = await prisma.product.findMany({
         where: whereCondition,
         select: { id: true, description: true }
      });

      console.log(`   📦 Products to check: ${products.length.toLocaleString()}\n`);

      const startTime = Date.now();
      let updated = 0;
      let skipped = 0;
      let processed = 0;

      // Process in batches
      for (let i = 0; i < products.length; i += BATCH_SIZE) {
         const batch = products.slice(i, i + BATCH_SIZE);
         
         for (const product of batch) {
            const currentLength = product.description?.length || 0;
            
            if (currentLength >= minChars) {
               skipped++;
            } else {
               const newDescription = extendDescription(product.description, minChars);
               await prisma.product.update({
                  where: { id: product.id },
                  data: { description: newDescription }
               });
               updated++;
            }
         }

         processed += batch.length;

         // Log progress
         if (processed % LOG_INTERVAL === 0 || processed >= products.length) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const percent = ((processed / products.length) * 100).toFixed(1);
            console.log(`   Processed: ${processed.toLocaleString()}/${products.length.toLocaleString()} (${percent}%) - ${elapsed}s`);
         }
      }

      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n✅ Completed!`);
      console.log(`   Updated: ${updated.toLocaleString()} products`);
      console.log(`   Skipped (already >= ${minChars} chars): ${skipped.toLocaleString()} products`);
      console.log(`   Total time: ${totalTime} seconds`);

   } catch (err) {
      console.error("❌ Error:", err.message);
   } finally {
      await prisma.$disconnect();
   }
}

// ===== Main Entry Point =====
async function main() {
   console.log("🌱 Fix Product Description Script\n");
   console.log("=".repeat(50));

   const { fromId, toId, minChars } = parseArgs();
   await fixProductDescription(fromId, toId, minChars);

   console.log("=".repeat(50));
   console.log("🎉 Done!");
}

main();
