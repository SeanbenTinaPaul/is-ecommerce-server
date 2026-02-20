"""
Apply Schema SQL Script
========================
วัตถุประสงค์: Helper script สำหรับ apply SQL schema files ไปยัง database
ช่วยให้การสลับระหว่าง Baseline, Static, Dynamic ง่ายขึ้น

Usage (run from server/ directory):
  python research_experiment/scripts/apply_schema.py baseline  # Drop all indexes
  python research_experiment/scripts/apply_schema.py static    # Create static indexes
  python research_experiment/scripts/apply_schema.py dynamic   # Create dynamic indexes (GIN + trgm)
  python research_experiment/scripts/apply_schema.py list      # List all indexes
  python research_experiment/scripts/apply_schema.py --file custom.sql  # Run custom SQL file

Note:
- สำหรับ experiment flow แนะนำให้รัน baseline ก่อนเสมอ
- ใช้ psycopg2 execute SQL จาก file โดยตรง

Dependencies:
  pip install psycopg2-binary python-dotenv
"""

import os
import sys
import argparse
from pathlib import Path

script_dir = Path(__file__).resolve().parent
server_dir = script_dir.parent.parent
schemas_dir = script_dir.parent / 'schemas'
sys.path.insert(0, str(server_dir))

try:
    import psycopg2
except ImportError:
    print("❌ psycopg2 not installed. Run: pip install psycopg2-binary")
    sys.exit(1)

try:
    from dotenv import load_dotenv
    load_dotenv(server_dir / '.env')
except ImportError:
    pass


# Schema file mapping
SCHEMA_FILES = {
    'baseline': '00_baseline_drop_all.sql',
    'static': '01_static_indexes.sql',
    'dynamic': '02_dynamic_gin_trgm.sql',
    'list': '03_list_all_indexes.sql',
}


def clean_database_url(url):
    """ลบ Prisma-specific params ออกจาก DATABASE_URL"""
    from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
    parsed = urlparse(url)
    prisma_params = {'connection_limit', 'pool_timeout', 'socket_timeout', 'pgbouncer'}
    query_params = parse_qs(parsed.query)
    cleaned = {k: v for k, v in query_params.items() if k not in prisma_params}
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path, parsed.params, urlencode(cleaned, doseq=True), parsed.fragment))


def get_db_connection():
    """สร้าง connection ไปยัง PostgreSQL"""
    db_url = os.getenv('DATABASE_URL')
    if not db_url:
        print("❌ DATABASE_URL not found")
        sys.exit(1)
    return psycopg2.connect(clean_database_url(db_url))


def execute_sql_file(conn, sql_path):
    """Execute SQL file on database"""
    print(f"\n📄 Executing: {sql_path.name}")
    print("-" * 50)
    
    with open(sql_path, 'r', encoding='utf-8') as f:
        sql_content = f.read()
    
    # Split by semicolons for individual statements
    # But handle DO $$ blocks specially
    conn.autocommit = True
    
    try:
        with conn.cursor() as cur:
            # Execute entire file as one block
            cur.execute(sql_content)
            
            # Try to fetch results (for SELECT statements)
            try:
                results = cur.fetchall()
                if results:
                    # Get column names
                    colnames = [desc[0] for desc in cur.description]
                    
                    # Print header
                    print("\n" + " | ".join(colnames))
                    print("-" * (len(colnames) * 20))
                    
                    # Print rows (limit to 50)
                    for i, row in enumerate(results[:50]):
                        print(" | ".join(str(val)[:30] for val in row))
                    
                    if len(results) > 50:
                        print(f"... and {len(results) - 50} more rows")
                    
                    print(f"\n✅ Total rows: {len(results)}")
            except psycopg2.ProgrammingError:
                # No results to fetch (not a SELECT)
                pass
            
            print("\n✅ SQL executed successfully!")
            
    except psycopg2.Error as e:
        print(f"\n❌ SQL Error: {e}")
        return False
    
    return True


def main():
    parser = argparse.ArgumentParser(description='Apply Schema SQL to Database')
    parser.add_argument('schema', nargs='?', choices=['baseline', 'static', 'dynamic', 'list'],
                       help='Schema to apply (baseline, static, dynamic, list)')
    parser.add_argument('--file', '-f', help='Custom SQL file path')
    args = parser.parse_args()
    
    # Validate arguments
    if not args.schema and not args.file:
        print("❌ Please specify a schema or --file")
        print("\nAvailable schemas:")
        for name, filename in SCHEMA_FILES.items():
            print(f"  {name:10} → {filename}")
        sys.exit(1)
    
    # Determine SQL file path
    if args.file:
        sql_path = Path(args.file)
        if not sql_path.is_absolute():
            sql_path = schemas_dir / args.file
    else:
        sql_path = schemas_dir / SCHEMA_FILES[args.schema]
    
    if not sql_path.exists():
        print(f"❌ SQL file not found: {sql_path}")
        sys.exit(1)
    
    print("=" * 50)
    print("🔧 APPLY SCHEMA SQL")
    print("=" * 50)
    print(f"Schema: {args.schema or 'custom'}")
    print(f"File:   {sql_path}")
    
    # Connect and execute
    conn = get_db_connection()
    print("✅ Connected to database")
    
    success = execute_sql_file(conn, sql_path)
    
    conn.close()
    
    if success:
        print("\n" + "=" * 50)
        print(f"✅ Schema '{args.schema or 'custom'}' applied successfully!")
        print("=" * 50)
    else:
        sys.exit(1)


if __name__ == '__main__':
    main()
