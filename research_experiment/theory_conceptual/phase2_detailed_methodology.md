# Phase 2: ขั้นตอนดำเนินการทดลอง HypoPG Benchmarking (รายละเอียด)

## สารบัญ

1. [สภาพแวดล้อมและเครื่องมือ](#1-สภาพแวดล้อมและเครื่องมือ)
2. [ข้อมูลนำเข้า (Input)](#2-ข้อมูลนำเข้า-input)
3. [ขั้นตอนดำเนินการทดลอง](#3-ขั้นตอนดำเนินการทดลอง)
4. [กระบวนการกรองผลลัพธ์](#4-กระบวนการกรองผลลัพธ์)
5. [ข้อมูลส่งออก (Output)](#5-ข้อมูลส่งออก-output)
6. [ที่มาของค่าแต่ละ field ในผลลัพธ์](#6-ที่มาของค่าแต่ละ-field-ในผลลัพธ์)
7. [ตัวอย่างการ Benchmark 1 Candidate แบบ Step-by-Step](#7-ตัวอย่างการ-benchmark-1-candidate-แบบ-step-by-step)

---

## 1. สภาพแวดล้อมและเครื่องมือ

### 1.1 Database Server

| Item | Detail |
|------|--------|
| **DBMS** | PostgreSQL 17 |
| **Hosting** | Neon Tech (Free Tier, Serverless) |
| **Region** | ap-southeast-1 (Singapore) |
| **Storage Limit** | 500 MB |
| **Connection** | SSL, Connection Pooling via `?sslmode=require` |

### 1.2 Extension: HypoPG

| Item | Detail |
|------|--------|
| **Name** | HypoPG (Hypothetical Indexes for PostgreSQL) |
| **Author** | Julien Rouhaud |
| **Version** | ≥ 1.3.1 |
| **ติดตั้ง** | Pre-installed บน Neon Tech |
| **Documentation** | https://hypopg.readthedocs.io/ |

HypoPG เป็น PostgreSQL extension ที่อนุญาตให้สร้าง **virtual (hypothetical) indexes** ซึ่ง:
- อยู่ใน shared memory เท่านั้น (**ไม่เขียนลง disk**)
- **ไม่กระทบ** query performance ของ production workload
- Query planner สามารถ **พิจารณา** virtual index ใน `EXPLAIN` ได้
- **Visible เฉพาะ session** ที่สร้าง (ผู้ใช้คนอื่นไม่เห็น)

การติดตั้งบน database:
```sql
CREATE EXTENSION IF NOT EXISTS hypopg;
```

### 1.3 Script และ Libraries

| Component | Detail |
|-----------|--------|
| **Script** | `phase2_runner.py` (Python 3.13) |
| **DB Driver** | `psycopg2-binary` 2.9.x — PostgreSQL adapter สำหรับ Python |
| **ENV Loader** | `python-dotenv` — โหลด `DATABASE_URL` จากไฟล์ `.env` |
| **Cursor Type** | `psycopg2.extras.RealDictCursor` — return ผลลัพธ์เป็น dict แทน tuple |
| **Output Format** | JSON (`json` module จาก Python standard library) |

ติดตั้ง dependencies:
```bash
pip install psycopg2-binary python-dotenv
```

### 1.4 ขนาดข้อมูลขณะทดลอง

| Table | Row Count | Estimated Size |
|-------|-----------|---------------|
| **User** | ~10,018 | ~15 MB |
| **Product** | ~10,054 | ~20 MB |
| **Order** | **50,000** | ~25 MB |
| **ProductOnOrder** | **~145,000** | ~35 MB |
| **Image** | ~10,054 | ~5 MB |
| **Discount** | ~varies | ~1 MB |
| **Favorite** | ~40,000 | ~10 MB |
| **Rating** | ~varies | ~1 MB |
| **Cart** | ~10,018 | <1 MB |

> **หมายเหตุ:** ข้อมูลถูก scale up ถึง 50,000 orders ก่อนรัน Phase 2 เพื่อให้ HypoPG มี statistics เพียงพอในการประเมิน

---

## 2. ข้อมูลนำเข้า (Input)

### 2.1 candidates.json

Phase 2 อ่าน index candidates จากไฟล์ `configs/candidates.json` ซึ่งถูกสร้างจาก Phase 1 (Rule-Based Extraction) ทั้งหมด **47 candidates**

โครงสร้างของแต่ละ candidate:
```json
{
  "id": "FK06_ProductOnOrderOrderId",
  "table": "ProductOnOrder",
  "index_def": "CREATE INDEX ON \"ProductOnOrder\" (\"orderId\")",
  "freq_score": 12,
  "rule_applied": "Rule 4 (Join/FK)",
  "source_function": "Various (include products on order)",
  "test_query": "SELECT * FROM \"ProductOnOrder\" WHERE \"orderId\" = 1"
}
```

| Field | คำอธิบาย | ที่มา |
|-------|----------|-------|
| `id` | รหัสเฉพาะของ candidate (ตั้งตาม convention) | Phase 1 |
| `table` | ตารางที่จะสร้าง index | วิเคราะห์จาก index_def |
| `index_def` | คำสั่ง `CREATE INDEX` ที่จะทดสอบ | Phase 1 Rule Extraction |
| `freq_score` | คะแนนความถี่ (0-20) | CBMG + API Frequency Analysis |
| `rule_applied` | กฎที่ใช้ในการระบุ candidate | Phase 1 |
| `source_function` | ชื่อ function ใน source code | วิเคราะห์จาก service files |
| `test_query` | SQL query สำหรับทดสอบ cost | แปลงจาก Prisma ORM query |

### 2.2 DATABASE_URL

Script อ่าน connection string จากไฟล์ `server/.env`:
```
DATABASE_URL="postgresql://user:pass@host/dbname?sslmode=require"
```

มีการ clean Prisma-specific parameters ออกก่อนใช้งานกับ psycopg2:
```python
def clean_database_url(url):
    """ลบ query parameters ที่ Prisma-specific ออกจาก DATABASE_URL
    เพราะ psycopg2 ไม่รู้จัก params เช่น connection_limit, pool_timeout"""
    prisma_params = {'connection_limit', 'pool_timeout', 
                     'socket_timeout', 'pgbouncer'}
    # ... parse and remove these params
```

---

## 3. ขั้นตอนดำเนินการทดลอง

### 3.1 ภาพรวม Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│  Step 0: Initialize                                         │
│  - Connect to PostgreSQL (psycopg2)                         │
│  - CREATE EXTENSION IF NOT EXISTS hypopg                    │
│  - Load 47 candidates from candidates.json                  │
└──────────────────────────┬──────────────────────────────────┘
                           │
         ┌─────────────────▼─────────────────┐
         │  Loop: สำหรับแต่ละ candidate (×47) │
         └─────────────────┬─────────────────┘
                           │
    ┌──────────────────────▼──────────────────────┐
    │  Step 1: Reset Virtual Indexes               │
    │  SELECT hypopg_reset();                      │
    │  → ลบ virtual indexes ทั้งหมดจาก session     │
    └──────────────────────┬──────────────────────┘
                           │
    ┌──────────────────────▼──────────────────────┐
    │  Step 2: Measure Baseline Cost               │
    │  EXPLAIN (FORMAT JSON) <test_query>;         │
    │  → ดึง Total Cost ก่อนมี index              │
    │  → บันทึกเป็น baseline_cost                 │
    └──────────────────────┬──────────────────────┘
                           │
    ┌──────────────────────▼──────────────────────┐
    │  Step 3: Create Virtual Index                │
    │  SELECT * FROM                               │
    │    hypopg_create_index('CREATE INDEX ...');   │
    │  → ได้ indexrelid + indexname กลับมา         │
    └──────────────────────┬──────────────────────┘
                           │
    ┌──────────────────────▼──────────────────────┐
    │  Step 4: Measure New Cost (with index)       │
    │  EXPLAIN (FORMAT JSON) <test_query>;         │
    │  → ดึง Total Cost หลังมี virtual index      │
    │  → ตรวจสอบว่า Node Type = "Index Scan"?     │
    │  → บันทึกเป็น new_cost, is_used             │
    └──────────────────────┬──────────────────────┘
                           │
    ┌──────────────────────▼──────────────────────┐
    │  Step 5: Get Estimated Index Size            │
    │  SELECT hypopg_relation_size(indexrelid)     │
    │    FROM hypopg()                             │
    │    WHERE indexname = <hypo_index_name>;       │
    │  → บันทึกเป็น estimated_size_bytes          │
    └──────────────────────┬──────────────────────┘
                           │
    ┌──────────────────────▼──────────────────────┐
    │  Step 6: Calculate Improvement               │
    │  improvement_pct =                           │
    │    ((baseline - new) / baseline) × 100       │
    └──────────────────────┬──────────────────────┘
                           │
    ┌──────────────────────▼──────────────────────┐
    │  Step 7: Reset & Continue                    │
    │  SELECT hypopg_reset();                      │
    │  → ลบ virtual index ก่อนทดสอบ candidate ถัดไป│
    └──────────────────────┬──────────────────────┘
                           │
         ┌─────────────────▼─────────────────┐
         │  End Loop → Save to JSON          │
         └───────────────────────────────────┘
```

### 3.2 รายละเอียดแต่ละ Step พร้อม Code

#### Step 0: Initialize Connection

```python
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv('server/.env')
db_url = os.getenv('DATABASE_URL')
conn = psycopg2.connect(clean_database_url(db_url))
```

#### Step 1: Reset (ก่อนทดสอบแต่ละ candidate)

```python
def reset_hypopg(conn):
    """ลบ virtual indexes ทั้งหมด"""
    with conn.cursor() as cur:
        cur.execute("SELECT hypopg_reset()")
```

**เหตุผลที่ต้อง reset ก่อนทุก candidate:**
- ป้องกัน virtual index จาก candidate ก่อนหน้ากระทบ baseline measurement
- ทำให้แต่ละ candidate ถูกทดสอบแบบ isolated

#### Step 2: Measure Baseline Cost

```python
def get_total_cost(conn, query):
    """รัน EXPLAIN (FORMAT JSON) และดึง Total Cost"""
    with conn.cursor() as cur:
        cur.execute(f"EXPLAIN (FORMAT JSON) {query}")
        result = cur.fetchone()
        
        plan = result[0][0]  # JSON array
        plan_obj = plan[0].get('Plan', {})
        total_cost = plan_obj.get('Total Cost', 0)
        node_type = plan_obj.get('Node Type', '')
        
        # ตรวจสอบ Index Scan ใน plan tree (recursive)
        is_index_scan = 'Index' in node_type
        if not is_index_scan:
            is_index_scan, index_name = check_plan_for_index(plan_obj)
        
        return total_cost, node_type, is_index_scan, index_name
```

**ทำไมใช้ `EXPLAIN (FORMAT JSON)` ไม่ใช่ `EXPLAIN ANALYZE`?**
1. `EXPLAIN` ใช้ **statistics estimate** → ไม่ execute query จริง → ไม่เปลี่ยนแปลง data
2. HypoPG ทำงานกับ `EXPLAIN` ได้อย่างถูกต้อง (virtual index ถูก planner พิจารณา)
3. `FORMAT JSON` ให้ structured output ที่ parse ได้ง่ายกว่า text format

**ตัวอย่างผลลัพธ์จาก EXPLAIN:**
```json
[
  {
    "Plan": {
      "Node Type": "Seq Scan",
      "Relation Name": "ProductOnOrder",
      "Total Cost": 3027.45,
      "Plan Rows": 3,
      "Plan Width": 40,
      "Filter": "(\"orderId\" = 1)"
    }
  }
]
```

#### Step 3: Create Virtual Index

```python
def create_virtual_index(conn, index_def):
    """สร้าง virtual index ด้วย HypoPG"""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM hypopg_create_index(%s)", (index_def,))
        result = cur.fetchone()
        # result = {'indexrelid': 16401, 'indexname': '<16401>btree_ProductOnOrder_orderId'}
        indexrelid = result.get('indexrelid', 0)
        index_name = result.get('indexname', '')
        return True, indexrelid, index_name, None
```

**HypoPG Function: `hypopg_create_index(text)`**
- **Input:** คำสั่ง `CREATE INDEX` แบบ standard SQL
- **Output:** `indexrelid` (OID ของ virtual index) และ `indexname` (ชื่อ format: `<OID>btree_<table>_<columns>`)
- **สิ่งที่เกิดขึ้นภายใน:** HypoPG จำลอง index metadata ใน shared memory โดยใช้ table statistics ที่มีอยู่เพื่อประมาณขนาด

#### Step 4: Measure New Cost (with virtual index)

เรียก `get_total_cost()` อีกครั้งด้วย query เดิม แต่ตอนนี้ virtual index ถูกสร้างแล้ว:

```python
new_cost, node_type, is_index_scan, used_index = get_total_cost(conn, test_query)

# ตรวจสอบว่า optimizer เลือกใช้ virtual index หรือไม่
is_used = is_index_scan and (
    hypo_index_name in (used_index or '') or 
    str(indexrelid) in (used_index or '')
)
```

**ตัวอย่างผลลัพธ์ EXPLAIN เมื่อมี virtual index:**
```json
[
  {
    "Plan": {
      "Node Type": "Index Scan",
      "Index Name": "<16401>btree_ProductOnOrder_orderId",
      "Relation Name": "ProductOnOrder",
      "Total Cost": 8.11,
      "Plan Rows": 3,
      "Index Cond": "(\"orderId\" = 1)"
    }
  }
]
```

**`is_used` หมายถึงอะไร?**
- `true` = Query planner **เลือกใช้** virtual index (เปลี่ยนจาก Seq Scan → Index Scan)
- `false` = Query planner **ไม่เลือกใช้** (ยังคงเป็น Seq Scan เพราะ index ไม่ช่วยลด cost)

#### Step 5: Get Estimated Index Size

```python
def get_index_size(conn, index_name):
    """ดึงขนาดโดยประมาณของ virtual index (bytes)"""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT hypopg_relation_size(indexrelid) 
            FROM hypopg() 
            WHERE indexname = %s
        """, (index_name,))
        result = cur.fetchone()
        return result[0] if result else 0
```

**HypoPG Function: `hypopg_relation_size(oid)`**
- คืนค่า **estimated size** ของ virtual index (หน่วย: bytes)
- คำนวณจาก table statistics (จำนวน rows, column width) ไม่ใช่ actual disk usage
- ใช้เพื่อประเมิน storage impact ก่อนสร้าง index จริง

#### Step 6: Calculate Improvement

```python
if baseline_cost > 0:
    improvement = ((baseline_cost - new_cost) / baseline_cost) * 100
    result['improvement_pct'] = round(improvement, 2)
```

**สูตร:**
```
Improvement % = ((Baseline Cost − New Cost) / Baseline Cost) × 100
```

**ตัวอย่าง:**
```
FK06: ((3027.45 − 8.11) / 3027.45) × 100 = 99.73%
```

#### Step 7: Reset and Continue

```python
reset_hypopg(conn)  # ลบ virtual index ก่อนทดสอบ candidate ถัดไป
```

### 3.3 การรันคำสั่ง

```bash
# จาก directory: server/
python research_experiment/scripts/phase2_runner.py
```

ผลลัพธ์ใน terminal:
```
============================================================
🔬 PHASE 2: HypoPG Virtual Index Benchmarking
============================================================

🚀 Starting benchmark of 47 candidates...

[1/47]  Testing P01_GetStock...         ✅ Used (Imp: 3.01%, Size: 224.0KB)
[2/47]  Testing P02_GetProductImages... ✅ Used (Imp: 0.07%, Size: 224.0KB)
...
[47/47] Testing FK07_OrderOrderedById... ✅ Used (Imp: 80.68%, Size: 1128.0KB)

============================================================
📊 RESULTS SUMMARY
============================================================
Total Candidates: 47
Index Used:       27 (57.4%)
Index Not Used:   20 (42.6%)
Top 5:
  FK06_ProductOnOrderOrderId  99.73%
  FK01_ImageProductId         97.84%
  P19_SearchFiltersPrice      96.17%
  ...

✅ Phase 2 Complete!
```

---

## 4. กระบวนการกรองผลลัพธ์

หลัง benchmark เสร็จ จะรัน `filter_results.py` เพื่อกรอง Admin-only candidates ออก:

```bash
python research_experiment/scripts/filter_results.py
```

### 4.1 เกณฑ์การกรอง

| เกณฑ์ | คำอธิบาย | ตัวอย่างที่ถูกกรองออก |
|-------|----------|----------------------|
| **Admin endpoints** | Functions ที่ต้อง `adminVerify` middleware | `changeUserStatus`, `changeOrderStatus` |
| **Admin product ops** | CRUD operations สำหรับ admin | `listProdAdmin`, `createProd`, `bulkDiscount` |
| **Admin brand/category** | Write ops ที่เฉพาะ admin | `createBrand`, `removeCategory` |

### 4.2 การแยก Endpoint กลุ่ม

| Group | Middleware | Functions |
|-------|-----------|-----------|
| **Admin (กรองออก)** | `adminVerify` | changeUserStatus, changeOrderStatus, listProdAdmin, searchProdAdmin, etc. |
| **User (เก็บไว้)** | `userVerify` | createUserCart, saveOrder, getOrder, addProdRating, etc. |
| **Guest (เก็บไว้)** | ไม่มี | listProd, readAprod, searchFilters, register, logIn, etc. |

### 4.3 ผลการกรอง

```
Original Count: 47 candidates
  ❌ Removed: P04_ListProdAdmin       (Admin: searchprodadmin)
  ❌ Removed: P05_ListProdAdminPaginated (Admin: listprodadmin)
  ❌ Removed: P06_SearchProdAdmin      (Admin: searchprodadmin)
  ❌ Removed: P21_BulkDiscountProducts (Admin: bulkdiscount)
  ❌ Removed: P22_BulkDiscountDiscount (Admin: bulkdiscount)
  ❌ Removed: P23_ChangeStatusDiscount (Admin: freq < threshold)
  ❌ Removed: A01_ChangeUserStatus     (Admin: ID contains 'admin')
  ❌ Removed: A02_ChangeOrderStatus    (Admin: ID contains 'admin')
  ❌ Removed: A03_GetOrderAdminPaginated (Admin: ID contains 'admin')
  ❌ Removed: BR01_CreateBrandCheck    (Admin: createbrand)
  ❌ Removed: BR02_UpdateBrand         (Admin: updatebrand)
  ❌ Removed: BR04_RemoveBrand         (Admin: removebrand)
  ❌ Removed: CA01_RemoveCategory      (Admin: removecategory)
  ❌ Removed: CA02_UpdateCategory      (Admin: updatecategory)
Filtered Count: 47 - 14 = 33 candidates (customer-centric only)
```

> **Output:** `results/phase2_results_filtered.json`

---

## 5. ข้อมูลส่งออก (Output)

### 5.1 phase2_benchmark_results.json (ก่อนกรอง)

- **จำนวน records:** 47 (ทุก candidates)
- **เรียงตาม:** `improvement_pct` DESC
- **ใช้เป็น:** raw data สำหรับ analysis

### 5.2 phase2_results_filtered.json (หลังกรอง)

- **จำนวน records:** 33 (เฉพาะ User + Guest)
- **เรียงตาม:** `improvement_pct` DESC
- **ใช้เป็น:** input สำหรับ Phase 3

---

## 6. ที่มาของค่าแต่ละ field ในผลลัพธ์

```json
{
  "id": "FK06_ProductOnOrderOrderId",
  "table": "ProductOnOrder",
  "index_def": "CREATE INDEX ON \"ProductOnOrder\" (\"orderId\")",
  "baseline_cost": 3027.45,
  "new_cost": 8.11,
  "improvement_pct": 99.73,
  "estimated_size_bytes": 3366912,
  "is_used": true,
  "freq_score": 12,
  "error": null
}
```

| Field | ที่มา | คำอธิบาย |
|-------|-------|----------|
| `id` | Phase 1 `candidates.json` | รหัสจาก Rule-Based Extraction |
| `table` | Phase 1 `candidates.json` | ตารางที่ index อยู่ |
| `index_def` | Phase 1 `candidates.json` | คำสั่ง CREATE INDEX |
| `baseline_cost` | **`EXPLAIN (FORMAT JSON)` ก่อนสร้าง virtual index** | Total Cost จาก PostgreSQL Query Planner (ไม่มี index = Sequential Scan) |
| `new_cost` | **`EXPLAIN (FORMAT JSON)` หลังสร้าง virtual index** | Total Cost เมื่อ planner เห็น virtual index (อาจเป็น Index Scan) |
| `improvement_pct` | **คำนวณจากสูตร** | `((baseline - new) / baseline) × 100` |
| `estimated_size_bytes` | **`hypopg_relation_size(indexrelid)`** | ขนาดโดยประมาณจาก HypoPG (คำนวณจาก table statistics) |
| `is_used` | **ตรวจสอบ EXPLAIN plan** | `true` ถ้า Node Type เปลี่ยนเป็น Index Scan และใช้ virtual index name |
| `freq_score` | Phase 1 `candidates.json` | คะแนนความถี่จาก CBMG + API Analysis |
| `error` | Runtime | `null` ถ้าไม่มี error, หรือ error message ถ้ามีปัญหา |

---

## 7. ตัวอย่างการ Benchmark 1 Candidate แบบ Step-by-Step

### Candidate: FK06_ProductOnOrderOrderId

**Input:**
```json
{
  "id": "FK06_ProductOnOrderOrderId",
  "table": "ProductOnOrder",
  "index_def": "CREATE INDEX ON \"ProductOnOrder\" (\"orderId\")",
  "test_query": "SELECT * FROM \"ProductOnOrder\" WHERE \"orderId\" = 1"
}
```

**Step 1 — Reset:**
```sql
SELECT hypopg_reset();
-- ✅ ลบ virtual indexes ทั้งหมด
```

**Step 2 — Baseline (ไม่มี index):**
```sql
EXPLAIN (FORMAT JSON) SELECT * FROM "ProductOnOrder" WHERE "orderId" = 1;
```
ผลลัพธ์:
```json
{
  "Plan": {
    "Node Type": "Seq Scan",         -- ← Sequential Scan (ไม่มี index)
    "Relation Name": "ProductOnOrder",
    "Total Cost": 3027.45,           -- ← Baseline Cost
    "Plan Rows": 3,
    "Filter": "(\"orderId\" = 1)"
  }
}
```
→ `baseline_cost = 3027.45`

**Step 3 — Create Virtual Index:**
```sql
SELECT * FROM hypopg_create_index('CREATE INDEX ON "ProductOnOrder" ("orderId")');
```
ผลลัพธ์:
```
 indexrelid |           indexname
------------+--------------------------------------
      16401 | <16401>btree_ProductOnOrder_orderId
```

**Step 4 — New Cost (มี virtual index):**
```sql
EXPLAIN (FORMAT JSON) SELECT * FROM "ProductOnOrder" WHERE "orderId" = 1;
```
ผลลัพธ์:
```json
{
  "Plan": {
    "Node Type": "Index Scan",       -- ← เปลี่ยนเป็น Index Scan!
    "Index Name": "<16401>btree_ProductOnOrder_orderId",
    "Relation Name": "ProductOnOrder",
    "Total Cost": 8.11,              -- ← New Cost (ลดลงมาก)
    "Plan Rows": 3,
    "Index Cond": "(\"orderId\" = 1)"
  }
}
```
→ `new_cost = 8.11`, `is_used = true`

**Step 5 — Index Size:**
```sql
SELECT hypopg_relation_size(indexrelid)
FROM hypopg()
WHERE indexname = '<16401>btree_ProductOnOrder_orderId';
```
→ `estimated_size_bytes = 3,366,912` (≈ 3.2 MB)

**Step 6 — Calculate:**
```
improvement_pct = ((3027.45 - 8.11) / 3027.45) × 100 = 99.73%
```

**Final Output:**
```json
{
  "id": "FK06_ProductOnOrderOrderId",
  "table": "ProductOnOrder",
  "index_def": "CREATE INDEX ON \"ProductOnOrder\" (\"orderId\")",
  "baseline_cost": 3027.45,
  "new_cost": 8.11,
  "improvement_pct": 99.73,
  "estimated_size_bytes": 3366912,
  "is_used": true,
  "freq_score": 12,
  "error": null
}
```

---

## เอกสารอ้างอิง

1. Rouhaud, J. (2019). *HypoPG: Hypothetical Indexes for PostgreSQL*. https://hypopg.readthedocs.io/
2. PostgreSQL Documentation. (2024). *Chapter 14: Performance Tips — Using EXPLAIN*. https://www.postgresql.org/docs/current/using-explain.html
3. PostgreSQL Documentation. (2024). *Chapter 70: How the Planner Uses Statistics*. https://www.postgresql.org/docs/current/planner-stats.html
4. Winand, M. (2012). *SQL Performance Explained*. https://use-the-index-luke.com/
5. psycopg2 Documentation. (2024). https://www.psycopg.org/docs/
