/**
 * Delete Script: ลบ Favorites records ทั้งหมด
 * สำหรับประหยัด storage - favorites ไม่จำเป็นสำหรับงานวิจัย Indexing
 * 
 * Usage:
 *   node prisma/delete-favorites.js
 */

const prisma = require("../config/prisma");

async function deleteFavorites() {
   console.log("🗑️ Delete All Favorites Records\n");
   console.log("=".repeat(50));

   try {
      // แสดงจำนวนก่อนลบ
      const count = await prisma.favorite.count();
      console.log(`   📊 Current favorites count: ${count.toLocaleString()}\n`);

      if (count === 0) {
         console.log("✅ No favorites to delete!");
         return;
      }

      // ลบทั้งหมด
      const result = await prisma.favorite.deleteMany({});
      console.log(`   ✅ Deleted ${result.count.toLocaleString()} favorites records`);

      // ตรวจสอบ storage ที่ประหยัดได้ (estimate)
      const estimatedSizeMB = (count * 50 / 1024 / 1024).toFixed(2); // ~50 bytes per record
      console.log(`   💾 Estimated storage freed: ~${estimatedSizeMB} MB`);

   } catch (err) {
      console.error("❌ Error:", err.message);
   } finally {
      await prisma.$disconnect();
   }

   console.log("=".repeat(50));
   console.log("🎉 Done!");
}

deleteFavorites();
