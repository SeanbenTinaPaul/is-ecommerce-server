# -*- coding: utf-8 -*-
"""
CBMG V_j Calculator -- Menasce's Absorbing Markov Chain Method
Formula: V_1 = 1 (entry state), V_j = Sum_k V_k * p_{k,j} for j=2..n
ref: Menasce & Almeida (2000), Scaling for E-Business
"""
import numpy as np

# ──────────────────────────────────────────────
# Scenario A: Standard Shopping
# States: 0=Entry, 1=Home, 2=Shop, 3=ViewProd, 4=Cart, 5=Payment, 6=History, 7=Favorite, 8=Exit
# ──────────────────────────────────────────────
labels_a = ["Entry", "Home", "Shop", "ViewProd", "Cart", "Payment", "History", "Favorite", "Exit"]

P_a = np.array([
    # Entry  Home  Shop  View  Cart  Pay   Hist  Fav   Exit
    [ 0.00,  1.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00],  # Entry
    [ 0.00,  0.00, 0.55, 0.15, 0.10, 0.00, 0.05, 0.05, 0.10],  # Home
    [ 0.00,  0.10, 0.20, 0.45, 0.10, 0.00, 0.00, 0.05, 0.10],  # Shop
    [ 0.00,  0.05, 0.35, 0.15, 0.30, 0.05, 0.00, 0.05, 0.05],  # ViewProd
    [ 0.00,  0.05, 0.25, 0.10, 0.00, 0.45, 0.00, 0.00, 0.15],  # Cart
    [ 0.00,  0.00, 0.00, 0.00, 0.15, 0.00, 0.70, 0.00, 0.15],  # Payment
    [ 0.00,  0.10, 0.20, 0.05, 0.00, 0.00, 0.10, 0.05, 0.50],  # History
    [ 0.00,  0.10, 0.30, 0.35, 0.05, 0.00, 0.00, 0.00, 0.20],  # Favorite
    [ 0.00,  0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 1.00],  # Exit (absorbing)
])

# ──────────────────────────────────────────────
# Scenario B: Flash Sale
# States: 0=Entry, 1=Home, 2=ViewProd, 3=Cart, 4=Payment, 5=Exit
# ──────────────────────────────────────────────
labels_b = ["Entry", "Home", "ViewProd", "Cart", "Payment", "Exit"]

P_b = np.array([
    # Entry  Home  View  Cart  Pay   Exit
    [ 0.00,  0.70, 0.30, 0.00, 0.00, 0.00],  # Entry
    [ 0.00,  0.00, 0.80, 0.10, 0.00, 0.10],  # Home
    [ 0.00,  0.05, 0.05, 0.75, 0.10, 0.05],  # ViewProd
    [ 0.00,  0.00, 0.05, 0.00, 0.85, 0.10],  # Cart
    [ 0.00,  0.00, 0.00, 0.05, 0.00, 0.95],  # Payment
    [ 0.00,  0.00, 0.00, 0.00, 0.00, 1.00],  # Exit (absorbing)
])


def validate_tpm(P, labels):
    """ตรวจสอบว่าแต่ละแถว sum = 1"""
    print("--- Row Sum Validation ---")
    valid = True
    for i, row in enumerate(P):
        s = row.sum()
        ok = "OK" if abs(s - 1.0) < 1e-9 else "NG"
        if abs(s - 1.0) >= 1e-9:
            valid = False
        print(f"  {labels[i]:>12s}: sum = {s:.4f} {ok}")
    return valid


def solve_vj(P, labels):
    """
    แก้ระบบสมการ V_j ตาม Menascé:
      V_0 = 1 (Entry)
      V_j = Σ_k V_k * p_{k,j}  for j = 1..n-1  (ไม่รวม Entry, ไม่รวม Exit)

    จัดรูปเป็น: (I - P_transient^T) * V_transient = p_entry_column
    โดย P_transient คือ sub-matrix ของ transient states (ไม่รวม Entry & Exit)
    """
    n = len(labels)
    entry = 0
    exit_state = n - 1
    transient = list(range(1, exit_state))  # states between Entry and Exit

    # สร้างระบบสมการ: V_j = Σ_k V_k * p_{k,j}
    # สำหรับ transient states j:
    #   V_j = V_entry * p_{entry,j} + Σ_{k in transient} V_k * p_{k,j}
    #   V_j - Σ_{k in transient} V_k * p_{k,j} = 1 * p_{entry,j}
    # เขียนเป็น matrix: (I - Q^T) * V = b
    # โดย Q[i][j] = p_{transient_i, transient_j}, b[j] = p_{entry, transient_j}

    m = len(transient)
    Q = np.zeros((m, m))
    b = np.zeros(m)

    for i_idx, i_state in enumerate(transient):
        for j_idx, j_state in enumerate(transient):
            Q[i_idx][j_idx] = P[i_state][j_state]
        b[i_idx] = P[entry][transient[i_idx]]  # contribution from Entry (V_entry=1)

    # (I - Q^T) * V = b  →  BUT we want column-based:
    # V_j = b_j + Σ_k Q[k][j] * V_k  (sum over rows k, column j)
    # V_j - Σ_k Q[k][j] * V_k = b_j
    # (I - Q^T) V = b  where Q^T[j][k] = Q[k][j]

    A = np.eye(m) - Q.T
    V_transient = np.linalg.solve(A, b)

    # คำนวณ V_exit
    V_exit = P[entry][exit_state]  # from Entry
    for i_idx, i_state in enumerate(transient):
        V_exit += V_transient[i_idx] * P[i_state][exit_state]

    # รวมผลลัพธ์
    V = np.zeros(n)
    V[entry] = 1.0
    for i_idx, i_state in enumerate(transient):
        V[i_state] = V_transient[i_idx]
    V[exit_state] = V_exit

    return V


def print_results(V, labels, sessions=100):
    """แสดงผลลัพธ์ V_j"""
    n = len(labels)
    S = V.sum()

    print(f"\n{'='*60}")
    print(f"  V_j per Session (Menasce Method)")
    print(f"{'='*60}")
    print(f"  {'State':<14s} {'V_j (per session)':>18s} {'per {0} sessions'.format(sessions):>18s}")
    print(f"  {'-'*14} {'-'*18} {'-'*18}")
    for i in range(n):
        print(f"  {labels[i]:<14s} {V[i]:>18.4f} {V[i]*sessions:>18.1f}")
    print(f"  {'-'*14} {'-'*18} {'-'*18}")
    print(f"  {'Session Length S':.<32s} {S:.4f}")
    print(f"  {'V_exit':.<32s} {V[-1]:.4f} (should be 1.0)")

    # Buy-to-Visit ratio
    pay_idx = None
    for i, l in enumerate(labels):
        if l == "Payment":
            pay_idx = i
            break
    if pay_idx is not None:
        print(f"  {'BV (Buy-to-Visit)':.<32s} {V[pay_idx]:.4f}")

    return S


# ──────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────
if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("  SCENARIO A: Standard Shopping")
    print("=" * 60)
    validate_tpm(P_a, labels_a)
    V_a = solve_vj(P_a, labels_a)
    S_a = print_results(V_a, labels_a, sessions=100)

    print("\n\n" + "=" * 60)
    print("  SCENARIO B: Flash Sale Panic")
    print("=" * 60)
    validate_tpm(P_b, labels_b)
    V_b = solve_vj(P_b, labels_b)
    S_b = print_results(V_b, labels_b, sessions=100)

    # สรุป comparison กับค่าเดิม
    print("\n\n" + "=" * 60)
    print("  COMPARISON: Old Estimates vs Computed V_j x 100")
    print("=" * 60)
    old_a = {"Home": 115, "Shop": 180, "ViewProd": 220, "Cart": 85, "Payment": 55, "History": 45, "Favorite": 25}
    print(f"\n  Scenario A:")
    print(f"  {'State':<14s} {'Old Estimate':>14s} {'Computed':>14s} {'Delta':>10s}")
    print(f"  {'-'*14} {'-'*14} {'-'*14} {'-'*10}")
    for i, label in enumerate(labels_a):
        if label in old_a:
            computed = V_a[i] * 100
            old = old_a[label]
            delta = computed - old
            print(f"  {label:<14s} {old:>14.0f} {computed:>14.1f} {delta:>+10.1f}")

    old_b = {"Home": 75, "ViewProd": 95, "Cart": 80, "Payment": 72}
    print(f"\n  Scenario B:")
    print(f"  {'State':<14s} {'Old Estimate':>14s} {'Computed':>14s} {'Delta':>10s}")
    print(f"  {'-'*14} {'-'*14} {'-'*14} {'-'*10}")
    for i, label in enumerate(labels_b):
        if label in old_b:
            computed = V_b[i] * 100
            old = old_b[label]
            delta = computed - old
            print(f"  {label:<14s} {old:>14.0f} {computed:>14.1f} {delta:>+10.1f}")
