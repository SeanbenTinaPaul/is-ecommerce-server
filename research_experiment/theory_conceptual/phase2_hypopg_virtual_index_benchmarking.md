# Phase 2: HypoPG Virtual Index Benchmarking

## 1. แนวคิด (Concept)

Phase 2 เป็นขั้นตอนการ **ทดสอบประสิทธิภาพของ index candidates** จาก Phase 1 โดยใช้ **virtual indexes** แทนการสร้าง index จริงบน production database

ปัญหาของการทดสอบ index แบบดั้งเดิม:
- **สร้าง index จริง** → ใช้เวลานาน, ใช้ storage, ต้อง drop ถ้าไม่ดี
- **กระทบ production** → write operations ช้าลงระหว่างสร้าง index
- **ยากต่อการเปรียบเทียบ** → ต้องสร้าง-ลบ-วัดผล ทีละตัว

HypoPG แก้ปัญหาเหล่านี้โดยการสร้าง **hypothetical indexes** ที่อยู่ใน memory เท่านั้น ไม่กระทบ disk หรือ production workload

---

## 2. ทฤษฎีพื้นฐาน

### 2.1 PostgreSQL Query Planner

PostgreSQL ใช้ **Cost-Based Query Optimizer** ในการเลือก execution plan ที่มี cost ต่ำที่สุด โดย cost ประกอบด้วย:

| Cost Component | คำอธิบาย | Default Value |
|----------------|----------|---------------|
| `seq_page_cost` | ค่าใช้จ่ายในการอ่าน 1 page แบบ sequential | 1.0 |
| `random_page_cost` | ค่าใช้จ่ายในการอ่าน 1 page แบบ random | 4.0 |
| `cpu_tuple_cost` | ค่าใช้จ่ายในการประมวลผล 1 row | 0.01 |
| `cpu_index_tuple_cost` | ค่าใช้จ่ายในการประมวลผล 1 index entry | 0.005 |
| `cpu_operator_cost` | ค่าใช้จ่ายในการเปรียบเทียบ 1 operator | 0.0025 |

**Total Cost** = Startup Cost + Run Cost

```
EXPLAIN SELECT * FROM "Product" WHERE "price" >= 100 AND "price" <= 500;
```

ผลลัพธ์:
```
Seq Scan on Product  (cost=0.00..1852.87 rows=1234 width=...)
  Filter: (price >= 100 AND price <= 500)
```

- `0.00` = startup cost
- `1852.87` = total cost (ยิ่งน้อยยิ่งดี)

### 2.2 EXPLAIN Statement

`EXPLAIN` เป็นเครื่องมือของ PostgreSQL ที่แสดง **query execution plan** โดยไม่ต้อง execute query จริง:

- `EXPLAIN` → แสดง estimated plan (ใช้ statistics)
- `EXPLAIN ANALYZE` → execute จริงแล้วแสดง actual time
- `EXPLAIN (FORMAT JSON)` → output เป็น JSON

ในการทดลองนี้ใช้ `EXPLAIN` (ไม่ใช่ `EXPLAIN ANALYZE`) เพื่อ:
1. ไม่กระทบ database state
2. รองรับ virtual indexes ของ HypoPG
3. วัดค่า estimated cost ซึ่งเป็น metric ที่ consistent

### 2.3 HypoPG Extension

**HypoPG** (Hypothetical Indexes for PostgreSQL) เป็น extension ที่สร้างโดย Julien Rouhaud ให้สามารถสร้าง index สมมติ (hypothetical) เพื่อให้ query planner พิจารณาในการ EXPLAIN ได้ โดย:

- **ไม่ใช้ disk space** → index อยู่ใน shared memory เท่านั้น
- **ไม่กระทบ performance** → ไม่มี I/O overhead
- **ไม่มี maintenance cost** → ไม่มี write amplification
- **เฉพาะ session** → visible เฉพาะ connection ที่สร้าง

```sql
-- สร้าง virtual index
SELECT * FROM hypopg_create_index('CREATE INDEX ON "Product" ("price")');

-- ดู virtual indexes ที่มี
SELECT * FROM hypopg_list_indexes();

-- EXPLAIN จะใช้ virtual index ในการ estimate
EXPLAIN SELECT * FROM "Product" WHERE "price" >= 100;

-- ลบ virtual indexes ทั้งหมด
SELECT hypopg_reset();
```

**ที่มา:** Rouhaud, J. (2019). *HypoPG: Hypothetical Indexes for PostgreSQL*. https://hypopg.readthedocs.io/

### 2.4 Cost Improvement Percentage

สูตรคำนวณ improvement:

```
Improvement % = ((Baseline Cost - New Cost) / Baseline Cost) × 100
```

- **Baseline Cost** = cost เมื่อไม่มี index (Sequential Scan)
- **New Cost** = cost เมื่อมี virtual index (Index Scan)
- **ค่ายิ่งสูง = index ยิ่งมีประโยชน์**

---

## 3. กระบวนการทดลอง (Methodology)

### 3.1 ขั้นตอนการ Benchmark

```
สำหรับแต่ละ candidate:
  1. Reset session         → hypopg_reset()
  2. วัด Baseline          → EXPLAIN test_query (ไม่มี index)
  3. สร้าง Virtual Index   → hypopg_create_index(index_def)
  4. ตรวจสอบ Index Usage   → hypopg_list_indexes() ว่ามี size > 0
  5. วัด New Cost          → EXPLAIN test_query (มี virtual index)
  6. คำนวณ Improvement     → ((baseline - new) / baseline) × 100
  7. บันทึกผล             → JSON output
```

### 3.2 Metrics ที่เก็บ

| Metric | คำอธิบาย | ใช้ตัดสินใจอย่างไร |
|--------|----------|-------------------|
| `baseline_cost` | Total cost แบบไม่มี index | เป็นจุดอ้างอิง |
| `new_cost` | Total cost เมื่อมี virtual index | ยิ่งต่ำยิ่งดี |
| `improvement_pct` | % ที่ cost ลดลง | เกณฑ์หลักในการเลือก |
| `estimated_size_bytes` | ขนาด index โดยประมาณ | พิจารณา storage constraint |
| `is_used` | Planner เลือกใช้ index หรือไม่ | กรอง index ที่ไม่มีประโยชน์ |

### 3.3 การกรองผลลัพธ์ (Filtering)

หลังจาก benchmark เสร็จ จะกรองผลลัพธ์ตามเกณฑ์:

1. **Customer-Centric Only** → ตัด Admin endpoints ออก (freq_score < 8)
2. **is_used = true** → เฉพาะ index ที่ planner เลือกใช้จริง
3. **improvement_pct > 0** → เฉพาะ index ที่ช่วยลด cost ได้จริง

---

## 4. ผลลัพธ์ของ Phase 2

### 4.1 ภาพรวม

| Metric | ก่อนกรอง | หลังกรอง |
|--------|----------|---------|
| **Total Candidates** | 47 | 47 (เก็บไว้ทั้งหมดเพื่อวิเคราะห์) |
| **is_used = true** | 27 | 27 |
| **improvement_pct > 0** | 22 | 22 |
| **Significant (> 5%)** | 16 | 16 |
| **Database Scale** | 50,000 Orders | ~145,000 ProductOnOrder items |

### 4.2 กลุ่มผลลัพธ์ที่โดดเด่น

| กลุ่ม | ลักษณะ | Improvement % | ตัวอย่าง |
|-------|--------|---------------|----------|
| **FK Indexes** | Foreign Key columns ที่ไม่มี index | 39-99% | FK06 (99.7%), FK01 (97.8%) |
| **Composite Indexes** | Multi-column สำหรับ filter+sort | 58-95% | U12 (95.2%), P16 (58.2%) |
| **Search Indexes** | Filter columns สำหรับ search | 32-96% | P19 (96.2%), P18 (32.9%) |
| **PK Redundant** | Index ซ้ำกับ Primary Key | 0-3% | P01, P12 (PK มี index อยู่แล้ว) |

### 4.3 ข้อค้นพบสำคัญ

1. **FK Indexes มี impact สูงสุด** → ProductOnOrder.orderId ลด cost จาก 3027 เหลือ 8 (99.73%)
2. **B-Tree ไม่ work สำหรับ text search** → P17_SearchFiltersTitle (0% improvement) เพราะ `ILIKE '%...%'` ไม่ใช้ B-Tree
3. **Small tables ไม่ benefit จาก index** → Cart, Brand มี cost ต่ำมากอยู่แล้ว (< 5 cost units)
4. **PK columns ไม่ต้องสร้าง index เพิ่ม** → Primary Key มี unique index อัตโนมัติ ทำให้ improvement ≈ 3% เท่านั้น

---

## 5. ข้อจำกัดของ Phase 2

1. **Estimated cost ≠ Actual time** → Cost เป็นตัวเลขสมมติของ planner อาจไม่สะท้อน wall-clock time จริง
2. **ไม่วัด write overhead** → Virtual index ไม่มี write cost จึงไม่ทราบผลกระทบต่อ INSERT/UPDATE/DELETE → แก้ไขใน Phase 3
3. **Session-only** → ผลลัพธ์ขึ้นอยู่กับ statistics ณ ขณะ run, ถ้า data distribution เปลี่ยน ผลอาจเปลี่ยน
4. **ไม่รองรับ GIN index** → HypoPG รองรับเฉพาะ B-Tree (ใน free version) จึงไม่สามารถทดสอบ GIN trigram index ได้

---

## 6. เอกสารอ้างอิง

1. Rouhaud, J. (2019). *HypoPG: Hypothetical Indexes for PostgreSQL*. https://hypopg.readthedocs.io/
2. PostgreSQL Documentation. (2024). *Chapter 14: Performance Tips - Using EXPLAIN*. https://www.postgresql.org/docs/current/using-explain.html
3. PostgreSQL Documentation. (2024). *Chapter 70: How the Planner Uses Statistics*. https://www.postgresql.org/docs/current/planner-stats.html
4. Winand, M. (2012). *SQL Performance Explained*. https://use-the-index-luke.com/
