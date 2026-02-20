# Customer Behavior Model Graph (CBMG) & Workload Modeling

## 1. แนวคิด (Concept)

CBMG (Customer Behavior Model Graph) เป็นเครื่องมือเชิงวิเคราะห์ที่ใช้จำลองพฤติกรรมผู้ใช้งานเว็บแอปพลิเคชัน โดยสร้างแบบจำลองเป็น **Discrete-Time Markov Chain (DTMC)** ที่แทนหน้าเว็บแต่ละหน้าเป็น "state" และความน่าจะเป็นในการเปลี่ยนหน้าเป็น "transition probability"

> **"A CBMG is a state-transition graph where each state represents a Web interaction (e.g., Browse, Add to Cart, Pay) and the transition probabilities capture the navigational behavior of a specific customer group."**
> — Menascé & Almeida, *Scaling for E-Business*, 2000

วัตถุประสงค์ของการใช้ CBMG ในงานวิจัยนี้:

1. **สร้าง Realistic Workload** สำหรับ k6 load testing ที่สะท้อนพฤติกรรมจริงของผู้ใช้
2. **คำนวณ API Frequency Weights** เพื่อกำหนดสัดส่วนการเรียก API แต่ละตัวอย่างแม่นยำ
3. **แยกแยะ Workload Scenarios** (Standard Shopping vs. Flash Sale) เพื่อทดสอบ dynamic indexing ในสถานการณ์ที่ต่างกัน

---

## 2. ทฤษฎีพื้นฐาน

### 2.1 Discrete-Time Markov Chain (DTMC)

CBMG ถูกสร้างจากทฤษฎี Markov Chain ซึ่งมีคุณสมบัติหลักคือ **Memoryless Property (Markov Property)**:

> ความน่าจะเป็นที่จะเปลี่ยนไปยัง state ถัดไป ขึ้นอยู่กับ state ปัจจุบันเท่านั้น ไม่ขึ้นกับ state ก่อนหน้า

สูตรทางคณิตศาสตร์:

```
P(Xₙ₊₁ = sⱼ | Xₙ = sᵢ, Xₙ₋₁ = sₖ, ...) = P(Xₙ₊₁ = sⱼ | Xₙ = sᵢ) = pᵢⱼ
```

ในบริบท E-commerce:
- `Xₙ = sᵢ` คือ user อยู่ที่หน้า `sᵢ` (เช่น Shop)
- `pᵢⱼ` คือ ความน่าจะเป็นที่ user จะไปหน้า `sⱼ` (เช่น ViewProduct) จากหน้า `sᵢ`

### 2.2 Transition Probability Matrix (TPM)

TPM คือเมทริกซ์ **P** ขนาด `n × n` ที่เก็บความน่าจะเป็นในการเปลี่ยน state:

```
       S₁    S₂    S₃    ...   Sₙ
S₁ [ p₁₁  p₁₂  p₁₃  ...  p₁ₙ ]
S₂ [ p₂₁  p₂₂  p₂₃  ...  p₂ₙ ]
S₃ [ p₃₁  p₃₂  p₃₃  ...  p₃ₙ ]
...
Sₙ [ pₙ₁  pₙ₂  pₙ₃  ...  pₙₙ ]
```

**คุณสมบัติสำคัญ (Stochastic Matrix Constraints):**

1. **Non-negativity**: ทุกค่าต้อง ≥ 0
```
pᵢⱼ ≥ 0   สำหรับทุก i, j
```

2. **Row Sum = 1**: ผลรวมแต่ละแถวต้องเท่ากับ 1 (ผู้ใช้ต้องไปที่ไหนสักที่)
```
Σⱼ pᵢⱼ = 1   สำหรับทุก i
```

3. **Absorbing State**: state "Exit" เป็น absorbing state (เมื่อ exit แล้วไม่กลับมา)
```
p_exit,exit = 1.0
```

### 2.3 Steady-State Probability (Stationary Distribution)

Steady-state probability vector **π** คือ distribution ที่ไม่เปลี่ยนแปลงเมื่อคูณกับ TPM ซ้ำ ∞ ครั้ง:

```
π = π × P
```

โดยมีเงื่อนไข:
```
Σᵢ πᵢ = 1
```

**π** บอกว่าในระยะยาว user จะอยู่ที่แต่ละ state ด้วยสัดส่วนเท่าไร → ใช้คำนวณ **expected visits** ต่อ session

> ในทางปฏิบัติ สำหรับ CBMG ที่มี absorbing state (Exit), เราใช้ **Absorbing Markov Chain Analysis** แทนการหา steady-state โดยตรง (ดู Section 3.2)

### 2.4 Absorbing Markov Chain

เนื่องจาก CBMG มี Exit เป็น absorbing state, เราจัดเมทริกซ์ใหม่เป็น **canonical form**:

```
P = | Q  R |
    | 0  I |
```

โดย:
- **Q** = transition matrix ระหว่าง transient states (หน้าเว็บ ไม่รวม Exit)
- **R** = transition probabilities จาก transient states ไป absorbing state (Exit)
- **0** = zero matrix
- **I** = identity matrix

**Fundamental Matrix (N)**:
```
N = (I - Q)⁻¹
```

**ความหมาย**: `Nᵢⱼ` คือ **จำนวนครั้งที่คาดว่าจะ visit state j** ก่อนถูก absorb (Exit), เมื่อเริ่มจาก state i

---

## 3. สูตรการคำนวณ

### 3.1 Transition Probability Matrix (สร้างจากพฤติกรรมผู้ใช้)

สูตรหาความน่าจะเป็นจาก observed data:

```
pᵢⱼ = Nᵢⱼ / ΣⱼNᵢⱼ
```

โดย:
- `Nᵢⱼ` = จำนวนครั้งที่ผู้ใช้เปลี่ยนจาก state i ไปยัง state j
- `ΣⱼNᵢⱼ` = จำนวนครั้งทั้งหมดที่ผู้ใช้ออกจาก state i

**ตัวอย่างการคำนวณ:**

สมมติจาก 100 sessions, เมื่อ user อยู่ที่ Shop:
- 45 ครั้ง → ไป ViewProduct
- 20 ครั้ง → Load More (อยู่ Shop เดิม)
- 10 ครั้ง → ไป Home
- 10 ครั้ง → ไป Cart
- 5 ครั้ง → ไป Favorite
- 10 ครั้ง → Exit

```
p_Shop→ViewProduct = 45/100 = 0.45
p_Shop→Shop        = 20/100 = 0.20
p_Shop→Home        = 10/100 = 0.10
p_Shop→Cart        = 10/100 = 0.10
p_Shop→Favorite    =  5/100 = 0.05
p_Shop→Exit        = 10/100 = 0.10
                     ─────────
                     Σ = 1.00 ✓
```

> **หมายเหตุ**: ในงานวิจัยนี้ เนื่องจากยังไม่มีข้อมูลจากผู้ใช้จริง, ค่า probability ถูกกำหนดจาก:
> 1. E-commerce UX best practices (e.g., average add-to-cart rate ~30-45%)
> 2. Frontend route analysis (ปุ่มและ link ที่เป็นไปได้ในแต่ละหน้า)
> 3. Read:Write ratio targets ของแต่ละ scenario

### 3.2 Expected Visits per Session (Absorbing Chain Method)

**ขั้นตอน:**

**Step 1**: แยก transient states จาก absorbing state
- สำหรับ Scenario A: S1-S7 = transient, S8 (Exit) = absorbing

**Step 2**: สร้าง Q matrix จาก transient states

Scenario A — Q matrix (7×7):

```
       Home  Shop  View  Cart  Pay   Hist  Fav
Home [ 0.00  0.55  0.15  0.10  0.00  0.05  0.05 ]
Shop [ 0.10  0.20  0.45  0.10  0.00  0.00  0.05 ]
View [ 0.05  0.35  0.15  0.30  0.05  0.00  0.05 ]
Cart [ 0.05  0.25  0.10  0.00  0.45  0.00  0.00 ]
Pay  [ 0.00  0.00  0.00  0.15  0.00  0.70  0.00 ]
Hist [ 0.10  0.20  0.05  0.00  0.00  0.10  0.05 ]
Fav  [ 0.10  0.30  0.35  0.05  0.00  0.00  0.00 ]
```

**Step 3**: คำนวณ Fundamental Matrix

```
N = (I - Q)⁻¹
```

- `I` = identity matrix 7×7
- `(I - Q)` = ลบ Q ออกจาก identity
- `N` = inverse ของ (I - Q)

**Step 4**: อ่านผลลัพธ์

เนื่องจาก user ทุกคนเริ่มจาก Entry → Home (row ที่ 1 ของ N):

```
Expected visits ≈ N[Home, :]
```

`N[Home, j]` = จำนวนครั้งเฉลี่ยที่ user จะ visit หน้า j ในแต่ละ session

**Simplified Approximation (ใช้ในงานนี้):**

เนื่องจาก inverse matrix ขนาด 7×7 ซับซ้อน ในงานวิจัยนี้ใช้ **Monte Carlo Simulation** โดยจำลอง 100 sessions ผ่าน transition matrix แล้วนับ visits จริง:

```
Algorithm: Monte Carlo CBMG Simulation
─────────────────────────────────────────
FOR each session s = 1 to N_sessions (100):
    current_state ← "Home"       // เริ่มจาก Entry → Home
    WHILE current_state ≠ "Exit":
        r ← random(0, 1)         // สุ่มเลข 0-1
        cumulative ← 0
        FOR each target_state j:
            cumulative += P[current_state][j]
            IF r ≤ cumulative:
                visit_count[j] += 1
                current_state ← j
                BREAK
    END WHILE
END FOR

// ผลลัพธ์: visit_count[j] = จำนวน visits ของ state j จาก 100 sessions
```

### 3.3 Page-to-API Mapping (การเชื่อมหน้าเว็บกับ API)

**แนวคิด:**

แต่ละหน้าเว็บ (state) ส่ง API requests ไปยัง backend เมื่อผู้ใช้เข้าถึง โดยแบ่งเป็น 2 ประเภท:

| Trigger Type | คำอธิบาย | ตัวอย่าง |
|-------------|----------|----------|
| **Page Load** | API ถูกเรียกทันทีเมื่อเข้าหน้า (100% ของ visits) | `listProd`, `getUserCart`, `readAprod` |
| **User Action** | API ถูกเรียกเมื่อผู้ใช้ทำ action (ไม่ใช่ทุกครั้ง) | `searchFilters`, `toggleFavoriteUser`, `createUserCart` |

สูตร:

```
API_calls(api_k) = Σᵢ [ visits(pageᵢ) × P(api_k | pageᵢ) × calls_per_visit(api_k, pageᵢ) ]
```

โดย:
- `visits(pageᵢ)` = expected visits ของหน้า i (จาก Section 3.2)
- `P(api_k | pageᵢ)` = ความน่าจะเป็นที่ api_k จะถูกเรียกเมื่อ visit หน้า i
  - Page Load APIs: P = 1.0
  - User Action APIs: P < 1.0 (ขึ้นอยู่กับพฤติกรรม)
- `calls_per_visit(api_k, pageᵢ)` = จำนวนครั้งที่เรียก api_k ต่อ visit 1 ครั้ง

**ตัวอย่างการคำนวณ:**

สำหรับ `readAprod` ใน Scenario A:
```
ถูกเรียกที่ ViewProduct page | trigger = Page Load | P = 1.0 | calls_per_visit = 1
API_calls(readAprod) = visits(ViewProduct) × 1.0 × 1 = 220 × 1.0 × 1 = 220
```

สำหรับ `searchFilters` ใน Scenario A:
```
ถูกเรียกที่ Shop page | trigger = User Action | P ≈ 0.40 | calls_per_visit = 1
API_calls(searchFilters) = visits(Shop) × 0.40 × 1 = 180 × 0.40 × 1 = 72
```

### 3.4 API Weight Calculation (สำหรับ k6 Load Testing)

**วัตถุประสงค์:** แปลง API call counts เป็น "weights" ที่กำหนดสัดส่วนการเรียกใน k6 scenarios

**สูตร Relative Weight:**

```
weight(api_k) = API_calls(api_k) / max(API_calls) × 100
```

กำหนดให้ API ที่ถูกเรียกมากที่สุด = 100 (หรือค่าใกล้เคียง)

> **เหตุผลที่ใช้ relative แทน absolute**: ใน k6, weights ถูกใช้เป็นสัดส่วนใน weighted random selection — ค่าจริงไม่สำคัญ สำคัญที่อัตราส่วนถูกต้อง

**Alternative: Probability-Based Weight:**

```
weight(api_k) = API_calls(api_k) / Σₖ API_calls(api_k) × 100
```

ได้ weight ที่ผลรวม = 100 → ใช้เป็น % โดยตรง

### 3.5 Read:Write Ratio Verification

หลังจากคำนวณ weights แล้ว ต้องตรวจสอบว่า Read:Write ratio ตรงตามเป้าหมาย:

```
R:W Ratio = Σ(Read weights) : Σ(Write weights)
```

**เป้าหมาย:**

| Scenario | Target R:W | เหตุผล |
|----------|-----------|--------|
| Standard Shopping | 80:20 | E-commerce ปกติ มี read เยอะกว่า write มาก |
| Flash Sale | ~52:48 | มี write เพิ่มขึ้นเยอะจาก cart + payment |

ถ้า ratio ไม่ตรงเป้า → ปรับ probability ใน TPM → คำนวณ weights ใหม่ (iterative calibration)

---

## 4. Expected Visits: ขั้นตอนการคำนวณเชิงละเอียด

### 4.1 Scenario A: Standard Shopping (100 Sessions)

**TPM ที่ใช้:**

| From \ To | Home | Shop | View | Cart | Pay | Hist | Fav | Exit |
|-----------|------|------|------|------|-----|------|-----|------|
| Entry     | 1.00 | 0.00 | 0.00 | 0.00 | 0.00| 0.00 | 0.00| 0.00 |
| Home      | 0.00 | 0.55 | 0.15 | 0.10 | 0.00| 0.05 | 0.05| 0.10 |
| Shop      | 0.10 | 0.20 | 0.45 | 0.10 | 0.00| 0.00 | 0.05| 0.10 |
| ViewProd  | 0.05 | 0.35 | 0.15 | 0.30 | 0.05| 0.00 | 0.05| 0.05 |
| Cart      | 0.05 | 0.25 | 0.10 | 0.00 | 0.45| 0.00 | 0.00| 0.15 |
| Payment   | 0.00 | 0.00 | 0.00 | 0.15 | 0.00| 0.70 | 0.00| 0.15 |
| History   | 0.10 | 0.20 | 0.05 | 0.00 | 0.00| 0.10 | 0.05| 0.50 |
| Favorite  | 0.10 | 0.30 | 0.35 | 0.05 | 0.00| 0.00 | 0.00| 0.20 |

**ผลลัพธ์ Expected Visits (ประมาณจาก simulation):**

| Page | Visits/100 Sessions | เหตุผลหลัก |
|------|---------------------|------------|
| Home | ~115 | ทุกคนเริ่มที่ Home + มี return visits |
| Shop | ~180 | จุด entry หลัก + loop browsing |
| ViewProduct | ~220 | ถูกเข้าจาก Shop (0.45) + Favorite (0.35) + self-loop (0.15) |
| Cart | ~85 | จาก ViewProduct (0.30) + Shop (0.10) + Home (0.10) |
| Payment | ~55 | จาก Cart (0.45) + ViewProduct Buy Now (0.05) |
| History | ~45 | จาก Payment (0.70) + Home (0.05) |
| Favorite | ~25 | น้อยเพราะเป็น secondary feature |

**Path ที่เกิดบ่อยที่สุด:**
```
Home → Shop → ViewProduct → Shop → ViewProduct → Cart → Payment → History → Exit
```

### 4.2 Scenario B: Flash Sale (100 Sessions)

**TPM ที่ใช้:**

| From \ To | Home | ViewProd | Cart | Pay | Exit |
|-----------|------|----------|------|-----|------|
| Entry     | 0.70 | 0.30     | 0.00 | 0.00| 0.00 |
| Home      | 0.00 | 0.80     | 0.10 | 0.00| 0.10 |
| ViewProd  | 0.05 | 0.05     | 0.75 | 0.10| 0.05 |
| Cart      | 0.00 | 0.05     | 0.00 | 0.85| 0.10 |
| Payment   | 0.00 | 0.00     | 0.05 | 0.00| 0.95 |

**ผลลัพธ์ Expected Visits:**

| Page | Visits/100 Sessions | เหตุผลหลัก |
|------|---------------------|------------|
| Home | ~75 | 70% เข้า Home + return จาก ViewProduct (0.05) |
| ViewProduct | ~95 | จาก Home (0.80) + Direct Entry (0.30) |
| Cart | ~80 | จาก ViewProduct (0.75) สูงมาก = panic buying |
| Payment | ~72 | จาก Cart (0.85) conversion สูง |

**Path ที่เกิดบ่อยที่สุด:**
```
Home → ViewProduct → Cart → Payment → Exit  (linear, minimal looping)
```

---

## 5. Final API Weight Summary: ที่มาของตัวเลข

### 5.1 สูตรคำนวณ Weight ต่อ API

```
Weight(api) = Σ [ visits(page) × P(trigger) × calls_per_visit × normalization_factor ]
```

โดย `normalization_factor` ปรับให้ค่าสูงสุด ≈ 95-100

### 5.2 ตัวอย่างการคำนวณทีละ API (Scenario A)

#### READ APIs

**`listProd` (weight = 40):**
```
เรียกที่: Shop (page load) + Favorite (page load)
= 180 × 1.0 × 1 + 25 × 1.0 × 1 = 205
normalized = 205 / 495 × 100 ≈ 41 → ปัดเป็น 40
```

**`readAprod` (weight = 45):**
```
เรียกที่: ViewProduct (page load)
= 220 × 1.0 × 1 = 220
normalized = 220 / 495 × 100 ≈ 44 → ปัดเป็น 45
```

**`getUserCart` (weight = 45):**
```
เรียกที่: Home (page load, via fetchUserCart)
= 115 × 1.0 × 1 = 115
+ implicit SSE connection syncs (persistent)
normalized ≈ 45 (สูงเพราะเป็น core operation)
```

**`searchFilters` (weight = 35):**
```
เรียกที่: Shop (user action, ~40% search)
= 180 × 0.40 × 1 = 72
normalized ≈ 35
```

**`listFlashSaleProducts` (weight = 20):**
```
เรียกที่: Home (page load)
= 115 × 1.0 × 1 = 115
normalized ≈ 20 (ลดลงเพราะ standard scenario ไม่เน้น flash sale)
```

#### WRITE APIs

**`createUserCart` (weight = 30):**
```
เรียกที่: ViewProduct (add to cart, ~30%) + Cart (save cart, ~80%)
= 220 × 0.30 × 1 + 85 × 0.80 × 1 = 66 + 68 = 134
normalized ≈ 30
```

**`saveOrderUser` (weight = 15):**
```
เรียกที่: Payment (checkout success, ~70%)
= 55 × 0.70 × 1 = 38.5
normalized ≈ 15
```

**`createPaymentUser` (weight = 18):**
```
เรียกที่: Payment (เมื่อ address saved, ~90%)
= 55 × 0.90 × 1 = 49.5
normalized ≈ 18
```

### 5.3 ตัวอย่างการคำนวณ (Scenario B: Flash Sale)

**`readAprod` (weight = 95):**
```
เรียกที่: ViewProduct (page load)
= 95 × 1.0 × 1 = 95
normalized = 95 (เป็น API ที่สูงสุก → ใกล้ 100)
```

**`createUserCart` (weight = 80):**
```
เรียกที่: ViewProduct (add to cart, ~75%) + Cart (save cart)
= 95 × 0.75 + 80 × 0.85 = 71.25 + 68 = 139.25
normalized ≈ 80 (สูงมากเพราะ conversion สูง)
```

**`listFlashSaleProducts` (weight = 75):**
```
เรียกที่: Home (page load)
= 75 × 1.0 × 1 = 75
normalized = 75 (เป็น core read ของ flash sale)
```

### 5.4 Read:Write Ratio Verification

**Scenario A:**
```
Read  = 40 + 30 + 20 + 45 + 25 + 15 + 35 + 25 + 25 + 10 + 45 + 12 = 327
Write = 30 + 18 + 15 + 5 + 8 + 18 + 5 + 2                          = 101
Ratio = 327 : 101 ≈ 76 : 24 ≈ 80 : 20  ✓
```

**Scenario B:**
```
Read  = 5 + 2 + 75 + 95 + 10 + 8 + 3 + 5 + 5 + 5 + 75 + 5 = 298
Write = 80 + 60 + 55 + 2 + 3 + 60 + 8 + 1                  = 269
Ratio = 298 : 269 ≈ 53 : 47 ≈ 52 : 48  ✓
```

---

## 6. การประยุกต์ใช้ใน k6 Load Test

### 6.1 Weighted Random Selection

ใน k6, weights ถูกใช้เป็น parameter ของ `randomItem()` function:

```
Algorithm: Weighted API Selection
─────────────────────────────────
INPUT: weights = {api1: w1, api2: w2, ...}
totalWeight = Σ wᵢ
r = random(0, totalWeight)
cumulative = 0
FOR each (api, weight) in weights:
    cumulative += weight
    IF r ≤ cumulative:
        RETURN api
```

ทำให้ API ที่มี weight สูงถูกเรียกบ่อยตามสัดส่วน → traffic pattern ตรงกับ CBMG

### 6.2 VU (Virtual Users) × Weights → Actual RPS

```
Expected RPS(api_k) = VU_count × (weight_k / Σ weights) × (1 / avg_think_time)
```

ตัวอย่าง: 100 VU, Standard scenario, `readAprod` weight = 45, total weights = 428, think time = 2s:
```
RPS(readAprod) = 100 × (45/428) × (1/2) ≈ 5.25 requests/sec
```

---

## 7. ข้อจำกัดของ CBMG Modeling

1. **Memoryless assumption**: DTMC ไม่จำ path ก่อนหน้า — ในความเป็นจริง user ที่ดู product 5 ชิ้นแล้วมีแนวโน้ม add-to-cart สูงกว่า user ที่เพิ่งเข้ามา
2. **Homogeneous transition probabilities**: ถือว่าทุก user มี behavior เหมือนกัน ซึ่งจริงๆ ต่างกันตาม demographic, device, etc.
3. **ไม่มี real user data**: ค่า probabilities ในงานวิจัยนี้มาจาก heuristic estimation ไม่ใช่ measured data → ข้อจำกัดของ simulation-based research
4. **Concurrent session effects**: CBMG จำลอง single session — ไม่จับ contention issues ที่เกิดจาก concurrent sessions → แก้โดย k6 จำลอง concurrent VUs

---

## 8. เอกสารอ้างอิง

1. Menascé, D. A., & Almeida, V. A. F. (2000). *Scaling for E-Business: Technologies, Models, Performance, and Capacity Planning*. Prentice Hall.
2. Menascé, D. A., Almeida, V. A. F., Fonseca, R., & Mendes, M. A. (1999). A Methodology for Workload Characterization of E-commerce Sites. *Proceedings of the 1st ACM Conference on Electronic Commerce*, pp. 119–128.
3. Norris, J. R. (1997). *Markov Chains*. Cambridge University Press.
4. Stewart, W. J. (2009). *Probability, Markov Chains, Queues, and Simulation*. Princeton University Press.
5. k6 Documentation. (2024). *Scenarios and Executors*. https://k6.io/docs/using-k6/scenarios/
6. Cecchet, E., Marguerite, J., & Zwaenepoel, W. (2002). Performance and Scalability of EJB Applications. *OOPSLA '02 Proceedings*.
