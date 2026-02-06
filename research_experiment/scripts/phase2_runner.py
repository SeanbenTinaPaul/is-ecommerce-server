"""
Phase 2: Virtual Index Benchmarking using HypoPG
================================================
วัตถุประสงค์: วัดประสิทธิภาพของ index candidates จาก Phase 1 โดยใช้ virtual index
(ไม่ต้องสร้าง index จริง) เพื่อเปรียบเทียบ cost reduction

Usage (run from server/ directory):
  python research_experiment/scripts/phase2_runner.py

Prerequisites:
- HypoPG extension installed on PostgreSQL (Neon)
- candidates.json exists in configs/
- Tables must have data (run seed_orders.py or reset_and_seed.py first if empty)

Output:
- results/phase2_benchmark_results.json

Dependencies:
  pip install psycopg2-binary python-dotenv
"""

import os
import sys
import json
import re
from pathlib import Path

# เพิ่ม path สำหรับ load .env จาก server folder
script_dir = Path(__file__).resolve().parent
server_dir = script_dir.parent.parent
sys.path.insert(0, str(server_dir))

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:
    print("❌ Error: psycopg2 not installed. Run: pip install psycopg2-binary")
    sys.exit(1)

try:
    from dotenv import load_dotenv
    # โหลด .env จาก server folder
    env_path = server_dir / '.env'
    load_dotenv(env_path)
except ImportError:
    print("⚠️ Warning: python-dotenv not installed. Using system environment variables.")


def clean_database_url(url):
    """
    ลบ query parameters ที่ Prisma-specific ออกจาก DATABASE_URL
    เพราะ psycopg2 ไม่รู้จัก params เช่น connection_limit, pool_timeout
    """
    from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
    
    parsed = urlparse(url)
    prisma_only_params = {'connection_limit', 'pool_timeout', 'socket_timeout', 'pgbouncer'}
    query_params = parse_qs(parsed.query)
    cleaned_params = {k: v for k, v in query_params.items() if k not in prisma_only_params}
    cleaned_query = urlencode(cleaned_params, doseq=True)
    
    return urlunparse((
        parsed.scheme, parsed.netloc, parsed.path,
        parsed.params, cleaned_query, parsed.fragment
    ))


def get_db_connection():
    """สร้าง connection ไปยัง PostgreSQL database"""
    database_url = os.getenv('DATABASE_URL')
    if not database_url:
        print("❌ Error: DATABASE_URL not found in environment")
        sys.exit(1)
    
    # Clean Prisma-specific params
    database_url = clean_database_url(database_url)
    
    try:
        conn = psycopg2.connect(database_url)
        conn.autocommit = True
        return conn
    except psycopg2.Error as e:
        print(f"❌ Database connection failed: {e}")
        sys.exit(1)


def initialize_hypopg(conn):
    """ติดตั้ง hypopg extension (ถ้ายังไม่มี)"""
    try:
        with conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS hypopg;")
        print("✅ HypoPG extension ready")
    except psycopg2.Error as e:
        print(f"❌ Failed to create HypoPG extension: {e}")
        sys.exit(1)


def load_candidates(candidates_path):
    """โหลด index candidates จาก JSON file"""
    try:
        with open(candidates_path, 'r', encoding='utf-8') as f:
            candidates = json.load(f)
        print(f"📦 Loaded {len(candidates)} candidates from {candidates_path}")
        return candidates
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"❌ Failed to load candidates: {e}")
        sys.exit(1)


def get_total_cost(conn, query):
    """
    รัน EXPLAIN (FORMAT JSON) และดึง Total Cost
    Returns: (total_cost, plan_text, is_index_scan, index_name)
    """
    try:
        with conn.cursor() as cur:
            # ใช้ EXPLAIN เพื่อดู query plan (ไม่ execute จริง)
            cur.execute(f"EXPLAIN (FORMAT JSON) {query}")
            result = cur.fetchone()
            
            if result and result[0]:
                plan = result[0][0]  # JSON array wrapped in list
                if isinstance(plan, str):
                    plan = json.loads(plan)
                
                # ดึง Plan object
                plan_obj = plan.get('Plan', plan)
                if isinstance(plan, list) and len(plan) > 0:
                    plan_obj = plan[0].get('Plan', {})
                
                total_cost = plan_obj.get('Total Cost', 0)
                node_type = plan_obj.get('Node Type', '')
                index_name = plan_obj.get('Index Name', '')
                
                # ตรวจสอบว่าใช้ Index Scan หรือไม่
                is_index_scan = 'Index' in node_type
                
                # ถ้า parent ไม่ใช่ index scan ให้ลอง check children
                if not is_index_scan:
                    is_index_scan, index_name = check_plan_for_index(plan_obj)
                
                return total_cost, node_type, is_index_scan, index_name
            
            return 0, '', False, ''
    except psycopg2.Error as e:
        # ถ้า query syntax ผิด ให้ return error indicator
        return -1, str(e), False, ''


def check_plan_for_index(plan_obj):
    """Recursive check หา Index Scan ใน plan tree"""
    if not plan_obj:
        return False, ''
    
    node_type = plan_obj.get('Node Type', '')
    index_name = plan_obj.get('Index Name', '')
    
    if 'Index' in node_type:
        return True, index_name
    
    # Check children plans
    for child_key in ['Plans', 'Subplans']:
        children = plan_obj.get(child_key, [])
        for child in children:
            found, idx_name = check_plan_for_index(child)
            if found:
                return True, idx_name
    
    return False, ''


def create_virtual_index(conn, index_def):
    """
    สร้าง virtual index ด้วย HypoPG
    Returns: (success, indexrelid, index_name, error_message)
    """
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM hypopg_create_index(%s)", (index_def,))
            result = cur.fetchone()
            
            if result:
                indexrelid = result.get('indexrelid', 0)
                index_name = result.get('indexname', '')
                return True, indexrelid, index_name, None
            
            return False, 0, '', 'No result returned'
    except psycopg2.Error as e:
        return False, 0, '', str(e)


def get_index_size(conn, index_name):
    """ดึงขนาดโดยประมาณของ virtual index (bytes)"""
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT hypopg_relation_size(indexrelid) 
                FROM hypopg() 
                WHERE indexname = %s
            """, (index_name,))
            result = cur.fetchone()
            return result[0] if result else 0
    except psycopg2.Error:
        return 0


def reset_hypopg(conn):
    """ลบ virtual indexes ทั้งหมด"""
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT hypopg_reset();")
    except psycopg2.Error:
        pass  # ไม่ critical ถ้า reset ไม่ได้


def benchmark_candidate(conn, candidate, index, total):
    """
    Benchmark single candidate
    Returns: result dict
    """
    candidate_id = candidate.get('id', 'Unknown')
    table = candidate.get('table', 'Unknown')
    index_def = candidate.get('index_def', '')
    test_query = candidate.get('test_query', '')
    freq_score = candidate.get('freq_score', 0)
    
    result = {
        'id': candidate_id,
        'table': table,
        'index_def': index_def,
        'baseline_cost': 0,
        'new_cost': 0,
        'improvement_pct': 0,
        'estimated_size_bytes': 0,
        'is_used': False,
        'freq_score': freq_score,
        'error': None
    }
    
    # ข้ามถ้าไม่มี test_query
    if not test_query:
        result['error'] = 'No test_query provided'
        print(f"[{index}/{total}] Testing {candidate_id}... ⏭️ Skipped (no query)")
        return result
    
    # Step 1: Baseline measurement (ก่อนสร้าง virtual index)
    reset_hypopg(conn)  # ตรวจสอบว่าไม่มี virtual index ค้าง
    baseline_cost, _, _, _ = get_total_cost(conn, test_query)
    
    if baseline_cost < 0:
        result['error'] = 'Invalid test_query syntax'
        print(f"[{index}/{total}] Testing {candidate_id}... ❌ Query Error")
        return result
    
    result['baseline_cost'] = round(baseline_cost, 2)
    
    # Step 2: Create virtual index
    success, indexrelid, hypo_index_name, error = create_virtual_index(conn, index_def)
    
    if not success:
        result['error'] = f'Index creation failed: {error}'
        print(f"[{index}/{total}] Testing {candidate_id}... ❌ Index Error")
        reset_hypopg(conn)
        return result
    
    # Step 3: Measure with virtual index
    new_cost, node_type, is_index_scan, used_index = get_total_cost(conn, test_query)
    result['new_cost'] = round(new_cost, 2) if new_cost >= 0 else 0
    
    # ตรวจสอบว่า optimizer เลือกใช้ virtual index หรือไม่
    # (hypopg ใช้ชื่อ index ที่ขึ้นต้นด้วย "<oid>btree_")
    is_used = is_index_scan and (
        hypo_index_name in (used_index or '') or 
        str(indexrelid) in (used_index or '')
    )
    result['is_used'] = is_used
    
    # Step 4: Get estimated size
    size_bytes = get_index_size(conn, hypo_index_name)
    result['estimated_size_bytes'] = size_bytes
    
    # Step 5: Calculate improvement
    if baseline_cost > 0:
        improvement = ((baseline_cost - new_cost) / baseline_cost) * 100
        result['improvement_pct'] = round(improvement, 2)
    
    # Step 6: Reset for next iteration
    reset_hypopg(conn)
    
    # Console output
    status = "✅ Used" if is_used else "⚠️ Not Used"
    imp_str = f"{result['improvement_pct']}%"
    size_kb = size_bytes / 1024 if size_bytes > 0 else 0
    
    print(f"[{index}/{total}] Testing {candidate_id}... {status} (Imp: {imp_str}, Size: {size_kb:.1f}KB)")
    
    return result


def save_results(results, output_path):
    """บันทึกผลลัพธ์ลง JSON file"""
    # สร้าง directory ถ้ายังไม่มี
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Sort by improvement_pct descending
    sorted_results = sorted(results, key=lambda x: x.get('improvement_pct', 0), reverse=True)
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(sorted_results, f, indent=2, ensure_ascii=False)
    
    print(f"\n📁 Results saved to: {output_path}")


def print_summary(results):
    """แสดงสรุปผลลัพธ์"""
    total = len(results)
    used_count = sum(1 for r in results if r.get('is_used', False))
    error_count = sum(1 for r in results if r.get('error'))
    
    # Top 5 improvements
    sorted_by_imp = sorted(
        [r for r in results if not r.get('error') and r.get('improvement_pct', 0) > 0],
        key=lambda x: x.get('improvement_pct', 0),
        reverse=True
    )[:5]
    
    print("\n" + "=" * 60)
    print("📊 BENCHMARK SUMMARY")
    print("=" * 60)
    print(f"Total Candidates:    {total}")
    print(f"Index Used:          {used_count} ({used_count/total*100:.1f}%)")
    print(f"Errors:              {error_count}")
    
    if sorted_by_imp:
        print("\n🏆 Top 5 Improvements:")
        for i, r in enumerate(sorted_by_imp, 1):
            print(f"   {i}. {r['id']}: {r['improvement_pct']}% (Size: {r['estimated_size_bytes']/1024:.1f}KB)")
    
    # Naive B-Tree warning (text search indexes)
    naive_candidates = [r for r in results if 'title' in r.get('index_def', '').lower() and r.get('improvement_pct', 0) < 10]
    if naive_candidates:
        print("\n⚠️ Naive B-Tree Indexes (Low Impact - as expected):")
        for r in naive_candidates[:3]:
            print(f"   - {r['id']}: {r['improvement_pct']}% (proves B-Tree ineffective for text search)")


def main():
    """Main execution"""
    print("=" * 60)
    print("🔬 PHASE 2: HypoPG Virtual Index Benchmarking")
    print("=" * 60)
    
    # Define paths
    configs_dir = script_dir.parent / 'configs'
    results_dir = script_dir.parent / 'results'
    candidates_path = configs_dir / 'candidates.json'
    output_path = results_dir / 'phase2_benchmark_results.json'
    
    # Setup
    conn = get_db_connection()
    initialize_hypopg(conn)
    candidates = load_candidates(candidates_path)
    
    print(f"\n🚀 Starting benchmark of {len(candidates)} candidates...\n")
    
    # Benchmark each candidate
    results = []
    total = len(candidates)
    
    for i, candidate in enumerate(candidates, 1):
        result = benchmark_candidate(conn, candidate, i, total)
        results.append(result)
    
    # Save and summarize
    save_results(results, output_path)
    print_summary(results)
    
    # Cleanup
    conn.close()
    print("\n✅ Phase 2 Complete!")


if __name__ == '__main__':
    main()
