"""
Phase 2 Results Filter Script
==============================
วัตถุประสงค์: กรอง index candidates ที่เกี่ยวข้องกับ Admin-only endpoints ออก
เก็บเฉพาะ User และ Guest/Public related candidates สำหรับ customer-centric research

Usage (run from server/ directory):
  python research_experiment/scripts/filter_results.py

Input:
- results/phase2_benchmark_results.json

Output:
- results/phase2_results_filtered.json (customer-centric candidates only)

Route Analysis (from server/routes):
------------------------------------
Admin-Only (adminVerify required):
- admin.js: getAllUsers, changeUserStatus, changeOrderStatus, getOrderAdmin, getOrderAdminPaginated
- products.js: listProdAdminPaginated, searchProdAdmin, createProd, updateProd, removeProd, bulkDiscount
- brand.js: createBrand, updateBrand, removeBrand
- category.js: createCategory, updateCategory, removeCategory

User-Only (userVerify required):
- user.js: createUserCart, getUserCart, clearCart, saveAddress, saveOrder, getOrder, getOrderPaginated, addProdRating, favoriteProduct
- auth.js: currUserProfile
- paymentStripe.js: createPayment, cancelPayment, reqRefund

Guest/Public (no auth):
- products.js: listProd, listProdPaginated, listFlashSaleProducts, readAprod, getProductImages, displayProdBy, searchFilters, getStock
- brand.js: listBrand
- category.js: listCategory
- auth.js: register, logIn
"""

import json
from pathlib import Path

# Script directory
script_dir = Path(__file__).resolve().parent
configs_dir = script_dir.parent / 'configs'
results_dir = script_dir.parent / 'results'

# Input/Output files
INPUT_FILE = results_dir / 'phase2_benchmark_results.json'
OUTPUT_FILE = results_dir / 'phase2_results_filtered.json'

# Admin-only function/endpoint patterns (case-insensitive matching)
ADMIN_ONLY_PATTERNS = [
    # ID patterns containing "Admin"
    'admin',
    
    # Admin service functions
    'getallusers',
    'changeuserstatus',
    'changeorderstatus',
    'getorderadmin',
    
    # Admin product functions
    'listprodadmin',
    'searchprodadmin',
    'createprod',
    'updateprod',
    'removeprod',
    'bulkdiscount',
    
    # Admin brand functions (write operations only)
    'createbrand',
    'updatebrand',
    'removebrand',
    
    # Admin category functions (write operations only)
    'createcategory',
    'updatecategory',
    'removecategory',
]

# Exclude patterns in index_def or test_query
ADMIN_QUERY_PATTERNS = [
    'products-admin',
    '/admin/',
]


def is_admin_only(candidate):
    """
    ตรวจสอบว่า candidate เป็น admin-only หรือไม่
    Returns: (is_admin, reason)
    """
    candidate_id = candidate.get('id', '').lower()
    source_function = candidate.get('source_function', '').lower()
    index_def = candidate.get('index_def', '').lower()
    test_query = candidate.get('test_query', '').lower()
    
    # Check ID patterns
    for pattern in ADMIN_ONLY_PATTERNS:
        if pattern in candidate_id:
            return True, f"ID contains '{pattern}'"
        if pattern in source_function:
            return True, f"source_function contains '{pattern}'"
    
    # Check query patterns
    for pattern in ADMIN_QUERY_PATTERNS:
        if pattern in index_def or pattern in test_query:
            return True, f"Query contains '{pattern}'"
    
    return False, None


def load_results(filepath):
    """โหลด benchmark results จาก JSON file"""
    with open(filepath, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_results(results, filepath):
    """บันทึกผลลัพธ์ลง JSON file"""
    filepath.parent.mkdir(parents=True, exist_ok=True)
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)


def main():
    print("=" * 60)
    print("🔍 PHASE 2 RESULTS FILTER")
    print("=" * 60)
    print(f"Input:  {INPUT_FILE}")
    print(f"Output: {OUTPUT_FILE}")
    print()
    
    # Load results
    candidates = load_results(INPUT_FILE)
    original_count = len(candidates)
    print(f"Original Count: {original_count}")
    
    # Filter candidates
    filtered = []
    removed = []
    
    for candidate in candidates:
        is_admin, reason = is_admin_only(candidate)
        if is_admin:
            removed.append({
                'id': candidate.get('id'),
                'reason': reason
            })
        else:
            filtered.append(candidate)
    
    filtered_count = len(filtered)
    removed_count = len(removed)
    
    # Save filtered results
    save_results(filtered, OUTPUT_FILE)
    
    # Print summary
    print(f"Filtered Count: {filtered_count}")
    print(f"Removed Count:  {removed_count}")
    print()
    
    print("Removed IDs:")
    for item in removed:
        print(f"   ❌ {item['id']} ({item['reason']})")
    
    print()
    print("=" * 60)
    
    # Verification
    filtered_ids = [c.get('id', '') for c in filtered]
    
    verify_removed = ['P05_ListProdAdminPaginated', 'A03_GetOrderAdminPaginated']
    print("✅ Verification:")
    for check_id in verify_removed:
        if check_id not in filtered_ids:
            print(f"   ✅ {check_id} is NOT in filtered results (correct)")
        else:
            print(f"   ❌ {check_id} is STILL in filtered results (ERROR)")
    
    print()
    print(f"📁 Filtered results saved to: {OUTPUT_FILE}")
    print("✅ Filter Complete!")


if __name__ == '__main__':
    main()
