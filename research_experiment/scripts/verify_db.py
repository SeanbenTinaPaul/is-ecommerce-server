"""
Database Verification Script
=============================
ตรวจสอบสถานะ database (row counts และ output files) ก่อนเริ่ม experiment

Usage (run from server/ directory):
  python research_experiment/scripts/verify_db.py

Output:
- Table row counts: User, Product, Order, ProductOnOrder
- Phase 2 output file status: phase2_results_filtered.json

Dependencies:
  pip install psycopg2-binary python-dotenv
"""

import os
import sys
import json
from pathlib import Path

script_dir = Path(__file__).resolve().parent
server_dir = script_dir.parent.parent
sys.path.insert(0, str(server_dir))

try:
    import psycopg2
except ImportError:
    print("❌ psycopg2 not installed")
    sys.exit(1)

try:
    from dotenv import load_dotenv
    load_dotenv(server_dir / '.env')
except ImportError:
    pass


def clean_database_url(url):
    from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
    parsed = urlparse(url)
    prisma_params = {'connection_limit', 'pool_timeout', 'socket_timeout', 'pgbouncer'}
    query_params = parse_qs(parsed.query)
    cleaned = {k: v for k, v in query_params.items() if k not in prisma_params}
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path, parsed.params, urlencode(cleaned, doseq=True), parsed.fragment))


def main():
    print("=" * 50)
    print("🔍 DATABASE VERIFICATION")
    print("=" * 50)
    
    # Connect
    db_url = os.getenv('DATABASE_URL')
    if not db_url:
        print("❌ DATABASE_URL not found")
        return
    
    conn = psycopg2.connect(clean_database_url(db_url))
    cur = conn.cursor()
    
    # Table counts
    tables = ['User', 'Product', 'Order', 'ProductOnOrder']
    thresholds = {'Order': 5000, 'ProductOnOrder': 5000}
    
    print("\n📊 Table Row Counts:")
    all_pass = True
    for table in tables:
        cur.execute(f'SELECT count(*) FROM "{table}"')
        count = cur.fetchone()[0]
        threshold = thresholds.get(table)
        
        if threshold:
            status = "✅" if count >= threshold else "❌"
            if count < threshold:
                all_pass = False
            print(f"   {status} {table}: {count:,} (required >= {threshold:,})")
        else:
            print(f"   ✅ {table}: {count:,}")
    
    conn.close()
    
    # Check JSON file
    print("\n📁 Phase 2 Output File:")
    json_path = script_dir.parent / 'results' / 'phase2_results_filtered.json'
    
    if json_path.exists():
        with open(json_path, 'r') as f:
            data = json.load(f)
        if len(data) > 0:
            print(f"   ✅ {json_path.name}: EXISTS ({len(data)} candidates)")
        else:
            print(f"   ❌ {json_path.name}: EMPTY")
            all_pass = False
    else:
        print(f"   ❌ {json_path.name}: NOT FOUND")
        all_pass = False
    
    # Summary
    print("\n" + "=" * 50)
    if all_pass:
        print("✅ VERIFICATION PASSED - Ready for Phase 3")
    else:
        print("❌ VERIFICATION FAILED - Please check issues above")
    print("=" * 50)


if __name__ == '__main__':
    main()
