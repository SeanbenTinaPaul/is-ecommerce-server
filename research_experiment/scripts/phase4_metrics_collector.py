"""
Phase 3: Database Metrics Collector
===================================
วัตถุประสงค์: เก็บสถิติการรัน Query จาก pg_stat_statements เพื่อใช้วัดประสิทธิภาพ
ของ Database ภายใต้ Load Test (Baseline vs Static vs Dynamic)

Usage (run from server/ directory):
  # 1. ล้างสถิติเก่าทิ้ง (ก่อนกดรัน k6)
  python research_experiment/scripts/phase3_metrics_collector.py reset
  
  # 2. ดูดข้อมูลสถิติที่เกิดขึิ้น (หลัง k6 วิ่งเสร็จ)
  python research_experiment/scripts/phase3_metrics_collector.py collect <experiment_name>
  # Example: python research_experiment/scripts/phase3_metrics_collector.py collect baseline
"""

import os
import sys
import csv
from datetime import datetime
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
    load_dotenv(server_dir / '.env')
except ImportError:
    pass

def clean_database_url(url):
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
    database_url = os.getenv('DATABASE_URL')
    if not database_url:
        print("❌ Error: DATABASE_URL not found")
        sys.exit(1)
    
    database_url = clean_database_url(database_url)
    try:
        conn = psycopg2.connect(database_url)
        conn.autocommit = True
        return conn
    except psycopg2.Error as e:
        print(f"❌ Database connection failed: {e}")
        sys.exit(1)

def reset_stats(conn):
    """รีเซ็ต pg_stat_statements ให้เป็นศูนย์"""
    print("🧹 Resetting pg_stat_statements...")
    try:
        with conn.cursor() as cur:
            # ใช้ pg_stat_statements_reset() เพื่อล้างเฉพาะ db ปัจจุบัน (ถ้ามีสิทธิ์)
            # หรือถ้ารันบน Neon ที่มีสิทธิ์จำกัด อาจจะล้างได้แค่ระดับ User ปัจจุบัน
            cur.execute("SELECT pg_stat_statements_reset();")
        print("✅ Success! Database statistics have been reset to zero.")
        print("▶️ You can now start your k6 load test.")
    except psycopg2.Error as e:
        print(f"❌ Failed to reset stats. Note: Requires pg_stat_statements extension and privileges. Error: {e}")

def collect_stats(conn, experiment_name):
    """ดึงข้อมูลสถิติและเซฟเป็น CSV"""
    print(f"📊 Collecting metrics for experiment: {experiment_name}")
    
    results_dir = script_dir.parent / 'results'
    results_dir.mkdir(parents=True, exist_ok=True)
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"db_metrics_{experiment_name}_{timestamp}.csv"
    output_path = results_dir / filename
    
    # Query ดึง Top 50 Queries ที่ใช้เวลาประมวลผลรวมเยอะที่สุด
    # กรองเฉพาะ database ปัจจุบัน (ecom_westride)
    sql = """
        SELECT 
            query, 
            calls, 
            round(total_exec_time::numeric, 2) as total_exec_time_ms, 
            round(mean_exec_time::numeric, 2) as mean_exec_time_ms, 
            rows 
        FROM pg_stat_statements 
        WHERE dbid = (SELECT datid FROM pg_stat_database WHERE datname = current_database())
        -- Filter out utility commands that aren't relevant to performance
        AND query NOT ILIKE '%pg_stat_statements%' 
        AND query NOT ILIKE 'BEGIN%'
        AND query NOT ILIKE 'COMMIT%'
        ORDER BY total_exec_time DESC 
        LIMIT 50;
    """
    
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql)
            rows = cur.fetchall()
            
            if not rows:
                print("⚠️ No metrics found. Did you run the load test?")
                return
            
            # Save to CSV
            with open(output_path, 'w', newline='', encoding='utf-8') as csvfile:
                fieldnames = ['query', 'calls', 'total_exec_time_ms', 'mean_exec_time_ms', 'rows']
                writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
                
                writer.writeheader()
                for row in rows:
                    writer.writerow(row)
                    
            print(f"✅ Collected {len(rows)} queries.")
            print(f"💾 Saved to: {output_path}")
            
    except psycopg2.Error as e:
        print(f"❌ Failed to collect stats: {e}")

def main():
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python phase3_metrics_collector.py reset")
        print("  python phase3_metrics_collector.py collect <experiment_name>")
        sys.exit(1)
        
    action = sys.argv[1].lower()
    
    conn = get_db_connection()
    
    # Ensure extension exists
    try:
        with conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS pg_stat_statements;")
    except psycopg2.Error:
        pass # Ignore if no privileges, just try to run the main logic anyway
        
    if action == 'reset':
        reset_stats(conn)
    elif action == 'collect':
        if len(sys.argv) < 3:
            print("❌ Error: Please provide an experiment name (e.g., baseline, static, dynamic)")
            sys.exit(1)
        experiment_name = sys.argv[2]
        collect_stats(conn, experiment_name)
    else:
        print(f"❌ Unknown action: {action}")
        
    conn.close()

if __name__ == '__main__':
    main()
