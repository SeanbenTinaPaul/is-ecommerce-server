# Phase 1: Rule-Based Candidate Generation

## 1. แนวคิด (Concept)

Phase 1 เป็นขั้นตอนของการระบุ **Index Candidates** จาก SQL Query Patterns ที่อยู่ใน source code ของ application โดยอ้างอิงจากหลักการพื้นฐานของ Database Indexing ที่ว่า:

> **Index ที่ดีควรถูกสร้างบนคอลัมน์ที่ถูก query บ่อย และมี selectivity สูง**
> — Ramakrishnan & Gehrke, *Database Management Systems*, 3rd Edition.

แทนที่จะใช้วิธี Trial-and-Error ในการเลือก index, Phase 1 ใช้ **Rule-Based Approach** ที่วิเคราะห์ SQL patterns อย่างเป็นระบบ เพื่อสร้าง candidate list ที่ครอบคลุมและมีเหตุผลรองรับ

---

## 2. ทฤษฎีพื้นฐาน

### 2.1 B-Tree Index

B-Tree (Balanced Tree) เป็นโครงสร้างข้อมูลหลักที่ PostgreSQL ใช้เป็น **default index type** มีคุณสมบัติดังนี้:

- **Time Complexity**: O(log n) สำหรับการค้นหา, เพิ่ม, ลบ
- **Balanced**: ทุก leaf node อยู่ระดับเดียวกัน ทำให้ worst case = average case
- **Sorted**: ข้อมูลถูกจัดเรียงตาม key ทำให้รองรับ range query ได้ดี

```
         [30 | 60]               ← Internal Node
        /    |    \
    [10|20] [40|50] [70|80|90]   ← Leaf Nodes (sorted)
```

**เหมาะกับ:**
- Equality lookups: `WHERE id = 5`
- Range scans: `WHERE price >= 100 AND price <= 500`
- Sorting: `ORDER BY createdAt DESC`
- Prefix matching: `WHERE name LIKE 'abc%'`

**ไม่เหมาะกับ:**
- Pattern matching ตรงกลาง: `WHERE title ILIKE '%laptop%'` (ต้องใช้ GIN trigram แทน)

### 2.2 Composite Index (Multi-Column Index)

Composite Index คือ index ที่สร้างจากหลายคอลัมน์ โดยเรียงลำดับตาม **leftmost prefix rule**:

```sql
CREATE INDEX idx_example ON "Order" ("orderedById", "createdAt" DESC);
```

**Leftmost Prefix Rule:**
- ✅ `WHERE orderedById = 1` → ใช้ index ได้
- ✅ `WHERE orderedById = 1 ORDER BY createdAt DESC` → ใช้ index ได้เต็มที่
- ❌ `WHERE createdAt > '2024-01-01'` → ไม่ใช้ index (ข้ามคอลัมน์แรก)

ที่มา: PostgreSQL Official Documentation - *Multicolumn Indexes*, Section 11.3

### 2.3 Foreign Key Index

PostgreSQL **ไม่สร้าง index บน foreign key columns โดยอัตโนมัติ** ซึ่งแตกต่างจาก MySQL/InnoDB ที่สร้างให้อัตโนมัติ หากไม่มี index บน FK columns จะส่งผลกระทบต่อ:

- **JOIN operations**: Sequential scan แทน index scan
- **CASCADE operations**: `ON DELETE CASCADE` ต้อง scan ทั้ง table
- **Referential integrity checks**: ทุกครั้งที่ INSERT/UPDATE ต้อง verify FK

> **"The lack of an index on a foreign key column is one of the most common performance issues in PostgreSQL."**
> — *PostgreSQL Performance Tuning*, Gregory Smith

---

## 3. กฎการระบุ Index Candidates (Extraction Rules)

### Rule 1: Filter Column Indexing
**แนวคิด:** คอลัมน์ที่ปรากฏใน `WHERE` clause เป็น candidates หลักสำหรับ index

```sql
-- Pattern ที่ตรวจจับ:
SELECT * FROM "Product" WHERE "id" = 1;
SELECT * FROM "User" WHERE "email" = 'test@example.com';
SELECT * FROM "Product" WHERE "price" >= 100 AND "price" <= 500;
```

**เหตุผล:** WHERE clause กำหนด selectivity ของ query โดยตรง หากมี index บนคอลัมน์ที่ filter, PostgreSQL สามารถใช้ Index Scan แทน Sequential Scan ซึ่งลด I/O ได้อย่างมาก

### Rule 2: Sort Column Indexing
**แนวคิด:** คอลัมน์ที่ปรากฏใน `ORDER BY` clause สามารถ benefit จาก index ได้ เพราะ index เก็บข้อมูลแบบ sorted อยู่แล้ว

```sql
-- Pattern ที่ตรวจจับ:
SELECT * FROM "Product" ORDER BY "createdAt" DESC LIMIT 20;
SELECT * FROM "Brand" ORDER BY "id" ASC;
```

**เหตุผล:** หากไม่มี index, PostgreSQL ต้องทำ **Sort operation** ใน memory (หรือ disk ถ้าข้อมูลใหญ่) ซึ่งมี cost เป็น O(n log n) แต่ถ้ามี index สามารถอ่านข้อมูลตามลำดับ index ได้เลย (Index-Only Scan)

### Rule 3: Composite Index for Multi-Column Patterns
**แนวคิด:** เมื่อ query ใช้หลายคอลัมน์พร้อมกันใน WHERE + ORDER BY, composite index จะมีประสิทธิภาพมากกว่า single-column index

```sql
-- Pattern ที่ตรวจจับ:
SELECT * FROM "Order" WHERE "orderedById" = 1 ORDER BY "createdAt" DESC;
SELECT * FROM "Product" WHERE "categoryId" = 1 AND "quantity" > 0 ORDER BY "updatedAt" DESC;
```

**เหตุผล:** Composite index สามารถ satisfy ทั้ง filter และ sort conditions ใน scan เดียว ลดจำนวน I/O operations ได้มากกว่าการใช้ 2 single-column indexes แยกกัน เนื่องจาก PostgreSQL มักเลือกใช้ index เดียวต่อ table ต่อ query

### Rule 4: Join/Foreign Key Indexing
**แนวคิด:** คอลัมน์ที่ใช้ใน `JOIN` condition หรือเป็น foreign key ควรมี index เพื่อเร่งการ join

```sql
-- Pattern ที่ตรวจจับ:
SELECT * FROM "Image" WHERE "productId" = 1;
SELECT * FROM "ProductOnOrder" WHERE "orderId" = 1;
SELECT poo.* FROM "ProductOnOrder" poo JOIN "Order" o ON poo."orderId" = o."id";
```

**เหตุผล:** ดังที่กล่าวไว้ในส่วน 2.3, PostgreSQL ไม่สร้าง FK index อัตโนมัติ ทำให้ JOIN operations ต้อง sequential scan ทุกครั้ง ส่งผลกระทบรุนแรงเมื่อ table มีขนาดใหญ่

---

## 4. Frequency Scoring

นอกจาก rule-based extraction แล้ว, แต่ละ candidate ได้รับ **Frequency Score** (0-20) เพื่อระบุความถี่ในการเรียกใช้ โดยพิจารณาจาก:

| Score Range | ความหมาย | ตัวอย่าง |
|-------------|----------|----------|
| 16-20 | **สูงมาก** - ถูกเรียกทุก page load | `createUserCart`, `listFlashSaleProducts` |
| 11-15 | **สูง** - เรียกบ่อยในการใช้งานปกติ | `searchFilters`, `getOrder`, `readAprod` |
| 6-10 | **ปานกลาง** - เรียกตาม user action | `saveAddress`, `addProdRating`, `register` |
| 1-5 | **ต่ำ** - Admin operations | `listProdAdmin`, `createBrand`, `removeCategory` |

**ที่มาของ Score:** คำนวณจากการวิเคราะห์ Customer Behavior Model Graph (CBMG) ร่วมกับ API frequency analysis ของ frontend routes

---

## 5. ผลลัพธ์ของ Phase 1

จากการวิเคราะห์ source code ใน `server/service/` ทั้ง 6 service files:

| Output | Value |
|--------|-------|
| **Total Candidates** | 47 index candidates |
| **Tables Covered** | 10 tables |
| **Rule 1 (Filter)** | 28 candidates |
| **Rule 2 (Sort)** | 3 candidates |
| **Rule 3 (Composite)** | 9 candidates |
| **Rule 4 (Join/FK)** | 7 candidates |

### Candidates จำแนกตามตาราง

| Table | จำนวน Candidates | ตัวอย่าง |
|-------|-------------------|----------|
| Product | 15 | GetStock, SearchFilters, DisplayProdBy |
| Order | 7 | GetOrder, GetOrderPaginated, SaveOrder |
| User | 5 | CreateUserCart, SaveAddress, Login |
| Cart | 5 | FindCart, GetUserCart, ClearCart |
| Discount | 4 | UpdateDiscount, FlashSaleDiscounts |
| Favorite | 3 | FavoriteExist, FavoriteLimitCheck |
| Brand | 4 | CreateBrand, ListBrand |
| ProductOnOrder | 2 | ProductOnOrderOrderId |
| ProductOnCart | 3 | Upsert, DeleteNotIn |
| Rating | 2 | RatingProductId |
| Category | 2 | RemoveCategory, UpdateCategory |

---

## 6. ข้อจำกัดของ Phase 1

1. **ไม่สามารถวัด cost reduction ได้จริง** - Rule-based เป็นเพียงการคาดการณ์ว่า index น่าจะช่วย แต่ไม่ทราบว่าช่วยได้มากน้อยเพียงใด → แก้ไขใน Phase 2
2. **ไม่พิจารณา write overhead** - Index ทุกตัวมี maintenance cost เมื่อ INSERT/UPDATE/DELETE → แก้ไขใน Phase 3
3. **อาจมี redundant candidates** - index บาง column ซ้ำซ้อนกัน → กรองออกใน Phase 2 (is_used = false)

---

## 7. เอกสารอ้างอิง

1. Ramakrishnan, R., & Gehrke, J. (2003). *Database Management Systems* (3rd ed.). McGraw-Hill.
2. PostgreSQL Documentation. (2024). *Chapter 11: Indexes*. https://www.postgresql.org/docs/current/indexes.html
3. Smith, G. (2010). *PostgreSQL 9.0 High Performance*. Packt Publishing.
4. Schönig, H.-J. (2023). *Mastering PostgreSQL 16* (6th ed.). Packt Publishing.
