# Phase 3: Intelligent Index Selection

## 1. แนวคิด (Concept)

Phase 3 เป็นขั้นตอนสุดท้ายของ pipeline ที่ทำหน้าที่ **เลือกและจัดอันดับ indexes ที่ดีที่สุด** จาก 47 candidates โดยใช้ **Weighted Scoring Algorithm** ที่พิจารณาทั้ง benefit (cost reduction) และ cost (write overhead)

แนวคิดหลัก:
> **Index ที่ดีไม่ใช่ index ที่ช่วย read ได้มากที่สุด แต่คือ index ที่ให้ net benefit สูงสุดเมื่อรวม write overhead เข้าไปด้วย**

Phase นี้ได้รับแรงบันดาลใจจากแนวคิด **Index Advisor** ที่ใช้ใน commercial DBMS เช่น SQL Server Database Engine Tuning Advisor (DTA) และ Oracle SQL Access Advisor

---

## 2. ทฤษฎีพื้นฐาน

### 2.1 Index Write Amplification

ทุก index ที่สร้าง จะเพิ่ม overhead ให้กับ write operations:

```
Write Cost ∝ (1 + จำนวน indexes บน table)
```

เมื่อ INSERT row ใหม่ ระบบต้อง:
1. เขียนข้อมูลลง heap table
2. เขียน entry ลงทุก index ที่มี ← **Write Amplification**

| Operation | ไม่มี Index | มี 1 Index | มี 5 Indexes |
|-----------|------------|-----------|-------------|
| INSERT | 1x write | 2x writes | 6x writes |
| UPDATE (indexed col) | 1x write | 2x writes | Varies |
| DELETE | 1x write | 2x writes | 6x writes |

สำหรับ e-commerce application ที่มี **Flash Sale** scenario, tables อย่าง `Order` และ `ProductOnOrder` จะมี write operations จำนวนมากในช่วงเวลาสั้น ทำให้ต้องระวังไม่สร้าง index มากเกินไป

### 2.2 Lock Contention และ Deadlock Risk

Index ที่มากเกินไปบน write-heavy tables เพิ่มความเสี่ยงของ:

- **Row-level Lock Contention** → หลาย transactions แย่งอัพเดท index entries พร้อมกัน
- **Deadlock** → เมื่อ transactions lock index pages ในลำดับที่ขัดแย้งกัน
- **Buffer Pool Pressure** → index pages แย่ง shared_buffers กับ data pages

> **"Over-indexing is as dangerous as under-indexing. Each additional index on a write-heavy table increases the chance of lock contention under concurrent workloads."**
> — Winand, M. (2012). *SQL Performance Explained*

### 2.3 Scenario-Based Indexing

แนวคิดของ **Dynamic Indexing** คือการสร้าง/ลบ index ตาม workload scenario:

- **Base_Standard**: Indexes ที่ควรมีตลอดเวลา เพราะ benefit สูงและ write overhead ต่ำ
- **Dynamic_FlashSale**: Indexes ที่ควรสร้างเฉพาะช่วง Flash Sale เพราะอยู่บน write-heavy tables

```
Normal Operation:  [Base Indexes ON ] + [Dynamic Indexes OFF]
Flash Sale Period:  [Base Indexes ON ] + [Dynamic Indexes ON ]
After Flash Sale:   [Base Indexes ON ] + [Dynamic Indexes OFF]  ← DROP เพื่อลด write cost
```

แนวคิดนี้คล้ายกับ **Adaptive Indexing** ที่ศึกษาใน:
- Idreos, S., et al. (2007). *Database Cracking*. CIDR.
- Bruno, N., & Chaudhuri, S. (2007). *An Online Approach to Physical Design Tuning*. ICDE.

---

## 3. Scoring Algorithm

### 3.1 Write Penalty

กำหนด penalty ตามความถี่ของ write operations บนแต่ละ table:

| Table | Penalty | เหตุผล |
|-------|---------|--------|
| Cart | 2.5 | ถูก INSERT/UPDATE/DELETE ทุก session |
| ProductOnCart | 2.5 | Upsert ทุกครั้งที่ sync cart |
| Order | 2.5 | สร้างใหม่ทุกครั้งที่ checkout |
| ProductOnOrder | 2.5 | INSERT bulk items ทุก order |
| Payment | 2.5 | INSERT ทุก transaction |
| Product | 1.2 | ส่วนใหญ่ read, แต่มี stock update |
| Others | 1.0 | อื่นๆ (Image, Favorite, Rating, User, etc.) |

**ค่า 2.5 มาจากไหน?**
- ใน Flash Sale scenario, tables เหล่านี้รับ write traffic สูงถึง 5-10x ของปกติ
- Penalty 2.5 สะท้อนว่า write cost สูงกว่า table ปกติ 2.5 เท่า
- ค่านี้ถูก calibrate จาก workload analysis ใน `workload_config.txt` (write_ratio 5-40%)

### 3.2 Scenario Tagging

```python
if table in ['Order', 'Cart', 'ProductOnOrder', 'Discount'] 
   OR 'FlashSale' in candidate_id:
    tag = "Dynamic_FlashSale"
else:
    tag = "Base_Standard"
```

**เหตุผล:**
- `Order`, `Cart`, `ProductOnOrder` เป็น tables ที่ write-heavy ในช่วง Flash Sale
- `Discount` เกี่ยวข้องกับ Flash Sale promotion โดยตรง
- candidates ที่มี "FlashSale" ใน ID ถูก design มาสำหรับ Flash Sale queries

### 3.3 Scoring Formula

```
Final_Score = (Freq_Score × Improvement_Pct) / (Penalty ^ 1.5)
```

**อธิบายแต่ละ component:**

| Component | ความหมาย | Range |
|-----------|----------|-------|
| `Freq_Score` | ความถี่ในการถูกเรียกใช้ | 1-20 |
| `Improvement_Pct` | เปอร์เซ็นต์ cost reduction จาก Phase 2 | 0-100 |
| `Penalty` | ค่าปรับ write overhead | 1.0-2.5 |

**ทำไมใช้ `Penalty ^ 1.5` (Exponential Penalty)?**

ใช้ exponent 1.5 แทน 1.0 เพื่อ **ลงโทษ write-heavy tables อย่างก้าวกระโดด**:

| Penalty | ^1.0 (Linear) | ^1.5 (Exponential) | ผลกระทบ |
|---------|---------------|---------------------|---------|
| 1.0 | 1.0 | 1.0 | ไม่โดนลงโทษ |
| 1.2 | 1.2 | 1.31 | Product: ลดเล็กน้อย |
| 2.5 | 2.5 | 3.95 | Order/Cart: ลดเกือบ 4x |

เหตุผล: write overhead ไม่ได้เพิ่มขึ้นแบบ linear เมื่อมี concurrent writes มากขึ้น เนื่องจาก lock contention จะทำให้ throughput ลดลงแบบ exponential (Amdahl's Law)

### 3.4 ตัวอย่างการคำนวณ

**FK01_ImageProductId (Base_Standard):**
```
Score = (15 × 97.84) / (1.0 ^ 1.5) = 1467.6 / 1.0 = 1467.6
```

**FK06_ProductOnOrderOrderId (Dynamic_FlashSale):**
```
Score = (12 × 99.73) / (2.5 ^ 1.5) = 1196.76 / 3.95 = 302.8
```

> แม้ FK06 มี improvement สูงกว่า (99.7% vs 97.8%), แต่ score ต่ำกว่าเพราะอยู่บน write-heavy table

---

## 4. กระบวนการเลือก (Selection Process)

### 4.1 ขั้นตอน

```
1. Load ข้อมูล 47 candidates จาก Phase 2
2. คำนวณ Write Penalty ตาม table
3. กำหนด Scenario Tag (Base/Dynamic)
4. คำนวณ Final Score
5. Sort descending by Final Score
6. เลือก Top 15 Candidates
7. สร้าง output files (CSV, SQL, Chart)
```

### 4.2 เกณฑ์การเลือก Top 15

- เลือกจำนวน 15 เพื่อให้ครอบคลุม query patterns หลักของระบบ
- ไม่จำกัดจำนวน Dynamic indexes เพราะจะถูกจัดการแยกจาก Base ในการทดลอง
- candidates ที่มี improvement 0% จะไม่ได้รับการเลือกโดยธรรมชาติ (score = 0)

---

## 5. ผลลัพธ์ของ Phase 3

### 5.1 Top 15 Selected Indexes

| Rank | ID | Table | Tag | Imp% | Score |
|------|-----|-------|-----|------|-------|
| 1 | FK01_ImageProductId | Image | Base | 97.8% | 1467.6 |
| 2 | FK03_FavoriteProductId | Favorite | Base | 92.8% | 1299.6 |
| 3 | P19_SearchFiltersPrice | Product | Base | 96.2% | 1024.2 |
| 4 | P16_DisplayProdByUserCategory | Product | Base | 58.2% | 531.3 |
| 5 | FK04_RatingProductId | Rating | Base | 39.3% | 471.4 |
| 6 | P20_SearchFiltersBrand | Product | Base | 40.4% | 430.1 |
| 7 | U12_GetOrderPaginated | Order | Dynamic | 95.2% | 361.4 |
| 8 | P18_SearchFiltersCategory | Product | Base | 32.9% | 350.7 |
| 9 | FK07_OrderOrderedById | Order | Dynamic | 80.7% | 306.2 |
| 10 | U11_GetOrder | Order | Dynamic | 80.5% | 305.4 |
| 11 | U13_AddProdRatingGroupBy | Rating | Base | 30.5% | 305.0 |
| 12 | FK06_ProductOnOrderOrderId | ProductOnOrder | Dynamic | 99.7% | 302.8 |
| 13 | P15_DisplayProdByUser_Orders | Order | Dynamic | 83.3% | 252.9 |
| 14 | P13_ProductOnOrderByProductId | ProductOnOrder | Dynamic | 52.5% | 199.1 |
| 15 | U15_FavoriteLimitCheck | Favorite | Base | 7.4% | 118.9 |

### 5.2 Tag Distribution

| Tag | จำนวน | Tables |
|-----|--------|--------|
| **Base_Standard** | 9 | Image, Favorite, Product, Rating |
| **Dynamic_FlashSale** | 6 | Order, ProductOnOrder |

### 5.3 ข้อค้นพบ

1. **FK indexes ครองอันดับต้น** → ยืนยันว่า PostgreSQL ไม่มี FK index อัตโนมัติเป็นปัญหาจริง
2. **Product table indexes ปลอดภัย** → Penalty 1.2 ไม่ลดคะแนนมากนัก เพราะเป็น read-heavy table
3. **Order/ProductOnOrder ถูกลดระดับอย่างมีนัยสำคัญ** → แม้มี improvement สูง (80-99%) แต่ penalty 2.5^1.5 = 3.95x ทำให้ score ลดลงมาก
4. **Small table indexes (Cart, Brand) ไม่ผ่าน** → improvement 0% จาก Phase 2 ทำให้ score = 0

---

## 6. การนำไปใช้ในการทดลอง

### 6.1 Experiment Groups

| Group | ชื่อ | Indexes |
|-------|-----|---------|
| **A** | Baseline (No Index) | ไม่มี index ใดๆ (ยกเว้น PK/UK) |
| **B** | Static Indexing | Base + Dynamic indexes ทั้ง 15 ตัว ON ตลอดเวลา |
| **C** | Dynamic Indexing | Base (9 ตัว) ON ตลอด, Dynamic (6 ตัว) ON/OFF ตาม scenario |

### 6.2 Hypothesis

- **H1:** Static Indexing จะให้ read performance ดีกว่า Baseline อย่างมีนัยสำคัญ
- **H2:** Dynamic Indexing จะให้ write performance ดีกว่า Static ในช่วง Flash Sale
- **H3:** Dynamic Indexing จะให้ overall throughput (TPS) ดีกว่า Static เมื่อมี mixed workload

---

## 7. เอกสารอ้างอิง

1. Winand, M. (2012). *SQL Performance Explained*. https://use-the-index-luke.com/
2. Bruno, N., & Chaudhuri, S. (2007). *An Online Approach to Physical Design Tuning*. ICDE.
3. Idreos, S., Kersten, M. L., & Manegold, S. (2007). *Database Cracking*. CIDR.
4. Agrawal, S., et al. (2004). *Integrating Vertical and Horizontal Partitioning into Automated Physical Database Design*. SIGMOD.
5. PostgreSQL Documentation. (2024). *Chapter 11: Indexes*. https://www.postgresql.org/docs/current/indexes.html
