"""
Safe Database Scale-Up Script
==============================
วัตถุประสงค์: เพิ่มข้อมูล Order และ ProductOnOrder สำหรับ experiment ขนาดใหญ่
โดยไม่ใช้ external API (Stripe) - ใช้ mock payment data เท่านั้น

Usage (run from server/ directory):
  python research_experiment/scripts/seed_scale_up.py

Note:
- Script นี้จะ ADD orders จนกว่าจะถึง TARGET (50,000)
- ถ้าต้องการ RESET ก่อน seed ใหม่ ให้ใช้ reset_and_seed.py แทน

Safety:
- ไม่ใช้ Node.js backend services
- ไม่เรียก Stripe API
- ใช้ psycopg2 direct SQL insert เท่านั้น
- Payment fields ใช้ mock data: 'mock_stripe_tx_...'

Dependencies:
  pip install psycopg2-binary python-dotenv
"""

import os
import sys
import random
import string
from datetime import datetime, timedelta, timezone
from pathlib import Path

script_dir = Path(__file__).resolve().parent
server_dir = script_dir.parent.parent
sys.path.insert(0, str(server_dir))

try:
    import psycopg2
    from psycopg2.extras import execute_batch
except ImportError:
    print("❌ psycopg2 not installed. Run: pip install psycopg2-binary")
    sys.exit(1)

try:
    from dotenv import load_dotenv
    load_dotenv(server_dir / '.env')
except ImportError:
    pass


# Configuration
TARGET_ORDERS = 50000
BATCH_SIZE = 1000
ITEMS_PER_ORDER_MIN = 1
ITEMS_PER_ORDER_MAX = 5


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


def generate_mock_payment_id():
    """สร้าง mock payment ID (ไม่เรียก Stripe)"""
    random_str = ''.join(random.choices(string.ascii_lowercase + string.digits, k=16))
    return f"mock_stripe_tx_{random_str}"


def generate_random_timestamp(days_back=90):
    """สร้าง random timestamp ภายใน X วันที่ผ่านมา"""
    now = datetime.now(timezone.utc)
    random_days = random.uniform(0, days_back)
    random_seconds = random.uniform(0, 86400)
    return now - timedelta(days=random_days, seconds=random_seconds)


def fetch_cached_ids(conn, limit=1000):
    """ดึง User IDs และ Product IDs มาเก็บ cache"""
    with conn.cursor() as cur:
        cur.execute(f'SELECT id FROM "User" LIMIT {limit}')
        user_ids = [row[0] for row in cur.fetchall()]
        
        cur.execute(f'SELECT id FROM "Product" LIMIT {limit}')
        product_ids = [row[0] for row in cur.fetchall()]
    
    if not user_ids or not product_ids:
        print("❌ No users or products in database")
        sys.exit(1)
    
    return user_ids, product_ids


def get_current_count(conn, table):
    """นับจำนวน rows ในตาราง"""
    with conn.cursor() as cur:
        cur.execute(f'SELECT count(*) FROM "{table}"')
        return cur.fetchone()[0]


def insert_orders_batch(conn, user_ids, product_ids, needed, batch_size=BATCH_SIZE):
    """Insert orders และ order items แบบ batch"""
    
    # Mock data options
    statuses = ['succeeded', 'succeeded', 'succeeded', 'pending']
    order_statuses = ['Completed', 'Completed', 'Completed', 'Processing', 'Pending']
    
    total_orders = 0
    total_items = 0
    
    print(f"\n🚀 Inserting {needed:,} orders in batches of {batch_size:,}...")
    
    with conn.cursor() as cur:
        for batch_start in range(0, needed, batch_size):
            batch_end = min(batch_start + batch_size, needed)
            batch_count = batch_end - batch_start
            
            # Prepare order data
            order_data = []
            for _ in range(batch_count):
                user_id = random.choice(user_ids)
                cart_total = round(random.uniform(100, 50000), 2)
                created_at = generate_random_timestamp()
                
                order_data.append((
                    user_id,                          # orderedById
                    cart_total,                       # cartTotal
                    generate_mock_payment_id(),       # paymentId (MOCK - no Stripe!)
                    cart_total,                       # amount
                    random.choice(statuses),          # status
                    'thb',                            # currency
                    random.choice(order_statuses),    # orderStatus
                    created_at,                       # createdAt
                    created_at,                       # updatedAt
                    0                                 # refundAmount
                ))
            
            # Bulk insert orders
            execute_batch(cur, """
                INSERT INTO "Order" (
                    "orderedById", "cartTotal", "paymentId", "amount",
                    "status", "currency", "orderStatus", "createdAt", "updatedAt", "refundAmount"
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, order_data, page_size=batch_size)
            
            # Get the IDs of newly inserted orders
            cur.execute(f'SELECT id FROM "Order" ORDER BY id DESC LIMIT {batch_count}')
            new_order_ids = [row[0] for row in cur.fetchall()]
            
            # Prepare order items data
            item_data = []
            for order_id in new_order_ids:
                num_items = random.randint(ITEMS_PER_ORDER_MIN, ITEMS_PER_ORDER_MAX)
                selected_products = random.sample(product_ids, min(num_items, len(product_ids)))
                
                for product_id in selected_products:
                    count = random.randint(1, 5)
                    price = round(random.uniform(50, 5000), 2)
                    discount = round(random.uniform(0, price * 0.3), 2)
                    
                    item_data.append((order_id, product_id, count, price, discount))
            
            # Bulk insert order items
            execute_batch(cur, """
                INSERT INTO "ProductOnOrder" (
                    "orderId", "productId", "count", "price", "discount"
                ) VALUES (%s, %s, %s, %s, %s)
            """, item_data, page_size=batch_size * 5)
            
            total_orders += batch_count
            total_items += len(item_data)
            
            # Commit batch
            conn.commit()
            
            # Progress
            pct = (batch_end / needed) * 100
            print(f"   [{pct:5.1f}%] {total_orders:,}/{needed:,} orders, {total_items:,} items")
    
    return total_orders, total_items


def run_analyze(conn):
    """รัน ANALYZE เพื่ออัพเดต statistics"""
    print("\n📊 Running ANALYZE...")
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute('ANALYZE "Order";')
        cur.execute('ANALYZE "ProductOnOrder";')
    print("   ✅ ANALYZE complete")


def main():
    print("=" * 60)
    print("🔒 SAFE DATABASE SCALE-UP (No External APIs)")
    print("=" * 60)
    print(f"Target: {TARGET_ORDERS:,} orders")
    print("Safety: Using MOCK payment data only")
    print()
    
    conn = get_db_connection()
    print("✅ Connected to database")
    
    # Audit existing data
    current_orders = get_current_count(conn, 'Order')
    current_items = get_current_count(conn, 'ProductOnOrder')
    
    print(f"\n📋 Current State:")
    print(f"   Orders: {current_orders:,}")
    print(f"   ProductOnOrder: {current_items:,}")
    
    if current_orders >= TARGET_ORDERS:
        print(f"\n✅ Target reached ({current_orders:,} >= {TARGET_ORDERS:,}). No action needed.")
        conn.close()
        return
    
    needed = TARGET_ORDERS - current_orders
    print(f"\n📈 Need to insert: {needed:,} more orders")
    
    # Fetch cached IDs
    user_ids, product_ids = fetch_cached_ids(conn)
    print(f"   Cached {len(user_ids)} users and {len(product_ids)} products")
    
    # Insert data
    orders_added, items_added = insert_orders_batch(conn, user_ids, product_ids, needed)
    
    # Run ANALYZE
    run_analyze(conn)
    
    # Final counts
    final_orders = get_current_count(conn, 'Order')
    final_items = get_current_count(conn, 'ProductOnOrder')
    
    print("\n" + "=" * 60)
    print("✅ SCALE-UP COMPLETE!")
    print("=" * 60)
    print(f"   Orders Added:     {orders_added:,}")
    print(f"   Items Added:      {items_added:,}")
    print(f"   Total Orders:     {final_orders:,}")
    print(f"   Total Items:      {final_items:,}")
    print("\n🎯 Database ready for large-scale Phase 2 benchmarking!")
    
    conn.close()


if __name__ == '__main__':
    main()
