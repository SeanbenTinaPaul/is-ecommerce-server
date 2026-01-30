/**
 * Flash Sale Management Script
 * สำหรับจัดการ Flash Sale products เพื่อรองรับ k6 load testing
 * 
 * Usage:
 *   node prisma/manage-flashsale.js --set                    # สร้าง flash sale 100 products
 *   node prisma/manage-flashsale.js --set --count=200        # สร้าง 200 products
 *   node prisma/manage-flashsale.js --set --discount=20      # ส่วนลด 20%
 *   node prisma/manage-flashsale.js --set --start="2026-02-01" --end="2026-02-07"
 *   node prisma/manage-flashsale.js --cancel                 # ยกเลิก (isActive=false)
 *   node prisma/manage-flashsale.js --restart                # Reset ด้วย products เดิม
 *   node prisma/manage-flashsale.js --restart --shuffle      # Reset ด้วย products ใหม่
 *   node prisma/manage-flashsale.js --restart --duration=48  # Reset 48 ชั่วโมง
 *   node prisma/manage-flashsale.js --clear                  # ลบ records ทั้งหมด
 */

const prisma = require("../config/prisma");

// ===== Configuration =====
const DEFAULT_COUNT = 100; // 1% of 10,000 products
const DEFAULT_DISCOUNT = 15; // 15% discount
const DEFAULT_DURATION_HOURS = 24; // 24 hours
const MIN_PRODUCT_ID = 55; // productId >= 55 เท่านั้น
const FLASH_SALE_DESCRIPTION = "Flash Sale";
const CREATOR_EMAIL = "flashsale-script@demo.com";

// ===== Helper Functions =====

function parseArgs() {
   const args = process.argv.slice(2);
   const result = {
      mode: null,
      count: DEFAULT_COUNT,
      discount: DEFAULT_DISCOUNT,
      startDate: null,
      endDate: null,
      duration: DEFAULT_DURATION_HOURS,
      shuffle: false
   };

   for (const arg of args) {
      if (arg === "--set") result.mode = "set";
      else if (arg === "--cancel") result.mode = "cancel";
      else if (arg === "--restart") result.mode = "restart";
      else if (arg === "--clear") result.mode = "clear";
      else if (arg === "--shuffle") result.shuffle = true;
      else if (arg.startsWith("--count=")) result.count = parseInt(arg.split("=")[1], 10);
      else if (arg.startsWith("--discount=")) result.discount = parseFloat(arg.split("=")[1]);
      else if (arg.startsWith("--start=")) result.startDate = arg.split("=")[1];
      else if (arg.startsWith("--end=")) result.endDate = arg.split("=")[1];
      else if (arg.startsWith("--duration=")) result.duration = parseInt(arg.split("=")[1], 10);
   }

   if (!result.mode) {
      console.error("❌ กรุณาระบุ mode: --set, --cancel, --restart, หรือ --clear");
      process.exit(1);
   }

   return result;
}

function randomSampleFromArray(arr, n) {
   const shuffled = [...arr].sort(() => 0.5 - Math.random());
   return shuffled.slice(0, Math.min(n, arr.length));
}

function getDateRange(startDate, endDate, durationHours) {
   const now = new Date();
   const start = startDate ? new Date(startDate) : now;
   const end = endDate ? new Date(endDate) : new Date(start.getTime() + durationHours * 60 * 60 * 1000);
   return { start, end };
}

// ===== Mode Functions =====

/**
 * SET: สร้าง flash sale ใหม่ (ลบเก่า → สร้างใหม่)
 */
async function modeSet(options) {
   console.log("📦 Mode: SET - สร้าง Flash Sale ใหม่\n");

   // ดึง products ที่สามารถใส่ flash sale ได้
   const eligibleProducts = await prisma.product.findMany({
      where: { id: { gte: MIN_PRODUCT_ID } },
      select: { id: true }
   });
   console.log(`   Eligible products (id >= ${MIN_PRODUCT_ID}): ${eligibleProducts.length.toLocaleString()}`);

   if (eligibleProducts.length === 0) {
      console.error("❌ ไม่มี products ที่สามารถใส่ flash sale ได้");
      return;
   }

   // สุ่มเลือก products
   const productIds = randomSampleFromArray(eligibleProducts.map(p => p.id), options.count);
   console.log(`   Selected: ${productIds.length.toLocaleString()} products`);

   // กำหนดวันที่
   const { start, end } = getDateRange(options.startDate, options.endDate, options.duration);
   console.log(`   Start: ${start.toISOString()}`);
   console.log(`   End: ${end.toISOString()}`);
   console.log(`   Discount: ${options.discount}%\n`);

   // ลบ flash sale เก่าทั้งหมด
   const deleted = await prisma.discount.deleteMany({
      where: { description: FLASH_SALE_DESCRIPTION }
   });
   console.log(`   🗑️ Deleted ${deleted.count} old flash sale records`);

   // สร้าง flash sale ใหม่
   await prisma.discount.createMany({
      data: productIds.map(id => ({
         productId: id,
         amount: options.discount,
         startDate: start,
         endDate: end,
         description: FLASH_SALE_DESCRIPTION,
         isActive: true,
         createdBy: CREATOR_EMAIL
      }))
   });

   console.log(`   ✅ Created ${productIds.length} flash sale records`);
}

/**
 * CANCEL: ยกเลิก flash sale ทั้งหมด (set isActive = false)
 */
async function modeCancel() {
   console.log("🚫 Mode: CANCEL - ยกเลิก Flash Sale\n");

   const result = await prisma.discount.updateMany({
      where: { description: FLASH_SALE_DESCRIPTION },
      data: { isActive: false }
   });

   console.log(`   ✅ Deactivated ${result.count} flash sale records`);
}

/**
 * RESTART: Reset flash sale (สำหรับ k6 testing)
 */
async function modeRestart(options) {
   console.log("🔄 Mode: RESTART - Reset Flash Sale\n");

   // กำหนดวันที่ใหม่
   const { start, end } = getDateRange(null, null, options.duration);
   console.log(`   New Start: ${start.toISOString()}`);
   console.log(`   New End: ${end.toISOString()}`);
   console.log(`   Duration: ${options.duration} hours\n`);

   if (options.shuffle) {
      // สุ่ม products ใหม่
      console.log("   🔀 Shuffle mode: สุ่ม products ใหม่\n");

      // ดึง products ที่สามารถใช้ได้
      const eligibleProducts = await prisma.product.findMany({
         where: { id: { gte: MIN_PRODUCT_ID } },
         select: { id: true }
      });

      // นับ flash sale เดิม
      const existingCount = await prisma.discount.count({
         where: { description: FLASH_SALE_DESCRIPTION }
      });
      const count = existingCount > 0 ? existingCount : options.count;

      // สุ่มเลือก products
      const productIds = randomSampleFromArray(eligibleProducts.map(p => p.id), count);

      // ลบเก่า → สร้างใหม่
      await prisma.discount.deleteMany({
         where: { description: FLASH_SALE_DESCRIPTION }
      });

      await prisma.discount.createMany({
         data: productIds.map(id => ({
            productId: id,
            amount: options.discount,
            startDate: start,
            endDate: end,
            description: FLASH_SALE_DESCRIPTION,
            isActive: true,
            createdBy: CREATOR_EMAIL
         }))
      });

      console.log(`   ✅ Created ${productIds.length} new flash sale records`);
   } else {
      // ใช้ products เดิม (เร็ว + consistent)
      const result = await prisma.discount.updateMany({
         where: { description: FLASH_SALE_DESCRIPTION },
         data: {
            startDate: start,
            endDate: end,
            isActive: true
         }
      });

      console.log(`   ✅ Restarted ${result.count} flash sale records`);
   }
}

/**
 * CLEAR: ลบ flash sale records ทั้งหมด
 */
async function modeClear() {
   console.log("🗑️ Mode: CLEAR - ลบ Flash Sale ทั้งหมด\n");

   const result = await prisma.discount.deleteMany({
      where: { description: FLASH_SALE_DESCRIPTION }
   });

   console.log(`   ✅ Deleted ${result.count} flash sale records`);
}

// ===== Main Entry Point =====

async function main() {
   console.log("⚡ Flash Sale Management Script\n");
   console.log("=".repeat(50));

   const options = parseArgs();

   try {
      switch (options.mode) {
         case "set":
            await modeSet(options);
            break;
         case "cancel":
            await modeCancel();
            break;
         case "restart":
            await modeRestart(options);
            break;
         case "clear":
            await modeClear();
            break;
      }

      // Summary
      console.log("\n" + "=".repeat(50));
      const activeCount = await prisma.discount.count({
         where: { description: FLASH_SALE_DESCRIPTION, isActive: true }
      });
      const totalCount = await prisma.discount.count({
         where: { description: FLASH_SALE_DESCRIPTION }
      });
      console.log(`📊 Summary: ${activeCount} active / ${totalCount} total flash sale records`);

   } catch (err) {
      console.error("❌ Error:", err.message);
   } finally {
      await prisma.$disconnect();
   }

   console.log("=".repeat(50));
   console.log("🎉 Done!");
}

main();
