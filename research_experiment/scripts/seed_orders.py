"""
Database Seeding Script: Orders and ProductOnOrder
===================================================
วัตถุประสงค์: เตรียมข้อมูล Order และ ProductOnOrder สำหรับ HypoPG benchmarking
เนื่องจาก HypoPG จะ ignore indexes บน empty tables

Usage (run from server/ directory):
  python research_experiment/scripts/seed_orders.py           # seed 5,000 orders (with prompt)
  python research_experiment/scripts/seed_orders.py --force   # seed 5,000 orders (skip prompt)

Note:
- Script นี้จะ ADD 5,000 orders (ไม่ลบข้อมูลเดิม)
- ใช้สำหรับ HypoPG Phase 2 benchmarking เท่านั้น
- สำหรับ k6 experiment ให้ใช้ reset_and_seed.py แทน

Dependencies:
  pip install psycopg2-binary python-dotenv
"""

import os
import sys
import random
from datetime import datetime, timedelta
from pathlib import Path

# Setup path for loading .env
script_dir = Path(__file__).resolve().parent
server_dir = script_dir.parent.parent
sys.path.insert(0, str(server_dir))

try:
    import psycopg2
    from psycopg2.extras import execute_values
except ImportError:
    print("❌ Error: psycopg2 not installed. Run: pip install psycopg2-binary")
    sys.exit(1)

try:
    from dotenv import load_dotenv
    env_path = server_dir / '.env'
    load_dotenv(env_path)
except ImportError:
    print("⚠️ Warning: python-dotenv not installed. Using system environment variables.")


# Configuration
NUM_ORDERS = 5000
MIN_ITEMS_PER_ORDER = 1
MAX_ITEMS_PER_ORDER = 3
DAYS_BACK = 30


def clean_database_url(url):
    """
    ลบ query parameters ที่ Prisma-specific ออกจาก DATABASE_URL
    เพราะ psycopg2 ไม่รู้จัก params เช่น connection_limit, pool_timeout
    """
    from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
    
    parsed = urlparse(url)
    
    # Query params ที่ psycopg2 รองรับ
    # sslmode, connect_timeout, application_name, etc.
    prisma_only_params = {'connection_limit', 'pool_timeout', 'socket_timeout', 'pgbouncer'}
    
    # Parse และ filter query params
    query_params = parse_qs(parsed.query)
    cleaned_params = {k: v for k, v in query_params.items() if k not in prisma_only_params}
    
    # Rebuild URL
    cleaned_query = urlencode(cleaned_params, doseq=True)
    cleaned_url = urlunparse((
        parsed.scheme, parsed.netloc, parsed.path,
        parsed.params, cleaned_query, parsed.fragment
    ))
    
    return cleaned_url


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
        return conn
    except psycopg2.Error as e:
        print(f"❌ Database connection failed: {e}")
        sys.exit(1)


def fetch_valid_ids(conn):
    """ดึง valid User IDs และ Product IDs จาก database"""
    with conn.cursor() as cur:
        # Fetch User IDs
        cur.execute('SELECT id FROM "User" LIMIT 100')
        user_ids = [row[0] for row in cur.fetchall()]
        
        if not user_ids:
            print("❌ Error: No users found in database. Please seed users first.")
            sys.exit(1)
        
        # Fetch Product IDs
        cur.execute('SELECT id FROM "Product" LIMIT 100')
        product_ids = [row[0] for row in cur.fetchall()]
        
        if not product_ids:
            print("❌ Error: No products found in database. Please seed products first.")
            sys.exit(1)
    
    print(f"📦 Found {len(user_ids)} users and {len(product_ids)} products")
    return user_ids, product_ids


def generate_random_timestamp(days_back=DAYS_BACK):
    """สร้าง random timestamp ภายใน X วันที่ผ่านมา"""
    from datetime import timezone
    now = datetime.now(timezone.utc)
    random_days = random.uniform(0, days_back)
    random_seconds = random.uniform(0, 86400)  # seconds in a day
    return now - timedelta(days=random_days, seconds=random_seconds)


def seed_orders(conn, user_ids, product_ids):
    """สร้าง Orders และ ProductOnOrder records"""
    statuses = ['succeeded', 'succeeded', 'succeeded']  # 3x weight for succeeded
    order_statuses = ['Completed', 'Completed', 'Pending', 'Processing']
    
    orders_created = 0
    items_created = 0
    
    print(f"\n🚀 Starting to seed {NUM_ORDERS} orders...")
    
    try:
        with conn.cursor() as cur:
            for i in range(NUM_ORDERS):
                # Pick random user
                user_id = random.choice(user_ids)
                
                # Generate order data
                status = random.choice(statuses)
                order_status = random.choice(order_statuses)
                created_at = generate_random_timestamp()
                cart_total = round(random.uniform(100, 50000), 2)
                payment_id = f"pi_seed_{i}_{random.randint(1000, 9999)}"
                
                # Insert Order
                cur.execute("""
                    INSERT INTO "Order" (
                        "orderedById", "cartTotal", "paymentId", "amount", 
                        "status", "currency", "orderStatus", "createdAt", "updatedAt"
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                """, (
                    user_id, cart_total, payment_id, cart_total,
                    status, 'thb', order_status, created_at, created_at
                ))
                
                order_id = cur.fetchone()[0]
                orders_created += 1
                
                # Insert 1-3 ProductOnOrder items
                num_items = random.randint(MIN_ITEMS_PER_ORDER, MAX_ITEMS_PER_ORDER)
                selected_products = random.sample(product_ids, min(num_items, len(product_ids)))
                
                for product_id in selected_products:
                    count = random.randint(1, 5)
                    price = round(random.uniform(50, 5000), 2)
                    discount = round(random.uniform(0, price * 0.3), 2)  # 0-30% discount
                    
                    # ProductOnOrder schema: id, productId, orderId, count, price, discount, isRefunded
                    cur.execute("""
                        INSERT INTO "ProductOnOrder" (
                            "orderId", "productId", "count", "price", "discount"
                        )
                        VALUES (%s, %s, %s, %s, %s)
                    """, (
                        order_id, product_id, count, price, discount
                    ))
                    items_created += 1
                
                # Progress indicator
                if (i + 1) % 500 == 0:
                    print(f"   Progress: {i + 1}/{NUM_ORDERS} orders...")
                    conn.commit()  # Commit in batches
            
            # Final commit
            conn.commit()
            
    except psycopg2.Error as e:
        conn.rollback()
        print(f"❌ Error during seeding: {e}")
        sys.exit(1)
    
    return orders_created, items_created


def run_analyze(conn):
    """รัน ANALYZE เพื่ออัพเดต statistics สำหรับ query planner"""
    print("\n📊 Running ANALYZE to update statistics...")
    
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute('ANALYZE "Order";')
            cur.execute('ANALYZE "ProductOnOrder";')
        print("   ✅ ANALYZE complete")
    except psycopg2.Error as e:
        print(f"   ⚠️ ANALYZE warning: {e}")


def verify_data(conn):
    """ตรวจสอบจำนวน records ที่สร้าง"""
    with conn.cursor() as cur:
        cur.execute('SELECT COUNT(*) FROM "Order"')
        order_count = cur.fetchone()[0]
        
        cur.execute('SELECT COUNT(*) FROM "ProductOnOrder"')
        item_count = cur.fetchone()[0]
    
    return order_count, item_count


def main():
    """Main execution"""
    import argparse
    parser = argparse.ArgumentParser(description='Seed Orders for HypoPG benchmarking')
    parser.add_argument('--force', '-f', action='store_true', help='Skip confirmation prompt')
    args = parser.parse_args()
    
    print("=" * 60)
    print("🌱 DATABASE SEEDING: Orders & ProductOnOrder")
    print("=" * 60)
    
    # Connect
    conn = get_db_connection()
    print("✅ Connected to database")
    
    # Fetch valid IDs
    user_ids, product_ids = fetch_valid_ids(conn)
    
    # Check existing data
    existing_orders, existing_items = verify_data(conn)
    if existing_orders > 0:
        print(f"⚠️ Found existing data: {existing_orders} orders, {existing_items} items")
        if not args.force:
            response = input("   Do you want to continue and ADD more? (y/n): ").strip().lower()
            if response != 'y':
                print("   Aborted.")
                conn.close()
                return
        else:
            print("   --force flag detected, continuing...")
    
    # Seed data
    orders_created, items_created = seed_orders(conn, user_ids, product_ids)
    
    # Run ANALYZE (critical for HypoPG)
    run_analyze(conn)
    
    # Verify
    total_orders, total_items = verify_data(conn)
    
    # Summary
    print("\n" + "=" * 60)
    print("✅ SEEDING COMPLETE!")
    print("=" * 60)
    print(f"   New Orders Created:    {orders_created}")
    print(f"   New Items Created:     {items_created}")
    print(f"   Total Orders in DB:    {total_orders}")
    print(f"   Total Items in DB:     {total_items}")
    print("\n🎯 Database is now ready for HypoPG benchmarking!")
    
    conn.close()


if __name__ == '__main__':
    main()
