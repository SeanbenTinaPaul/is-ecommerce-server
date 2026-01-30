/**
 * Fix Script: เพิ่ม img_url และ public_id ให้กับ Brand ที่ยังไม่มีรูป
 * 
 * Usage:
 *   node prisma/fix-brand-images.js
 */

const prisma = require("../config/prisma");

async function fixBrandImages() {
   console.log("🔧 Fixing brand images...\n");

   try {
      // ดึง brands ที่ยังไม่มี img_url
      const brandsWithoutImage = await prisma.brand.findMany({
         where: {
            OR: [
               { img_url: null },
               { img_url: "" }
            ]
         },
         select: { id: true, title: true }
      });

      console.log(`   Found ${brandsWithoutImage.length} brands without images\n`);

      if (brandsWithoutImage.length === 0) {
         console.log("✅ All brands already have images!");
         return;
      }

      let updated = 0;

      for (const brand of brandsWithoutImage) {
         // สร้าง placeholder image URL สำหรับ brand โดยใช้ id
         const imgUrl = `https://picsum.photos/seed/brand${brand.id}/200/200`;
         const publicId = `seed_brands/brand_${brand.id}`;

         await prisma.brand.update({
            where: { id: brand.id },
            data: {
               img_url: imgUrl,
               public_id: publicId
            }
         });

         console.log(`   ✓ Updated brand #${brand.id}: ${brand.title}`);
         updated++;
      }

      console.log(`\n✅ Updated ${updated} brands with picsum images!`);

   } catch (err) {
      console.error("❌ Error:", err.message);
   } finally {
      await prisma.$disconnect();
   }
}

fixBrandImages();
