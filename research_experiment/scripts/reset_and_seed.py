"""
Reset and Re-Seed Script for K6 Experiment Replications
=========================================================
วัตถุประสงค์: ล้างข้อมูล Order/ProductOnOrder แล้ว re-seed ใหม่สำหรับแต่ละ replication

ใช้สำหรับ:
- Between-phases cleanup (ตาม db_and_infra_config.txt)
- Each replication ของ k6 workload experiment

Usage (run from server/ directory):
  python research_experiment/scripts/reset_and_seed.py -y           # TRUNCATE all, re-seed 50K orders
  python research_experiment/scripts/reset_and_seed.py -t 30000 -y  # Custom target 30K orders
  python research_experiment/scripts/reset_and_seed.py --no-truncate -y  # Delete legacy only (orderId < 67)

Options:
  -t, --target    Target order count (default: 50000)
  --no-truncate   Only delete legacy records, do not truncate all
  -y, --yes       Skip confirmation prompt

Safety:
- ไม่เรียก Stripe API
- ใช้ mock payment data (mock_k6_*)
- ใช้เฉพาะ userId >= 13 และ productId >= 55 (exclude legacy dev data)

Dependencies:
  pip install psycopg2-binary python-dotenv
"""

import os
import sys
import random
import string
import argparse
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


# =============================================================================
# Configuration
# =============================================================================
TARGET_ORDERS = 50000
TARGET_ITEMS_MULTIPLIER = 3  # avg ~3 items per order = 150,000 items
BATCH_SIZE = 1000

# Exclude legacy dev data
MIN_USER_ID = 13
MIN_PRODUCT_ID = 55

# Poisson-like distribution for cart size (λ = 3)
ITEMS_PER_ORDER_MIN = 1
ITEMS_PER_ORDER_MAX = 5


# =============================================================================
# Database Utilities
# =============================================================================
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


# =============================================================================
# Reset Functions
# =============================================================================
def get_counts(conn):
    """ดึงจำนวน records ปัจจุบัน"""
    with conn.cursor() as cur:
        cur.execute('SELECT count(*) FROM "Order"')
        orders = cur.fetchone()[0]
        cur.execute('SELECT count(*) FROM "ProductOnOrder"')
        items = cur.fetchone()[0]
    return orders, items


def truncate_tables(conn):
    """TRUNCATE Order และ ProductOnOrder tables"""
    print("\n🗑️  Truncating tables...")
    conn.autocommit = True
    with conn.cursor() as cur:
        # ProductOnOrder ก่อน (FK constraint)
        cur.execute('TRUNCATE TABLE "ProductOnOrder" CASCADE;')
        print("   ✅ ProductOnOrder truncated")
        
        cur.execute('TRUNCATE TABLE "Order" CASCADE;')
        print("   ✅ Order truncated")
    conn.autocommit = False


def delete_legacy_only(conn):
    """ลบเฉพาะ legacy records (orderId < 67) ถ้ามี"""
    print("\n🔍 Checking for legacy records (orderId < 67)...")
    with conn.cursor() as cur:
        cur.execute('SELECT count(*) FROM "Order" WHERE id < 67')
        legacy_count = cur.fetchone()[0]
        
        if legacy_count > 0:
            print(f"   Found {legacy_count} legacy orders, deleting...")
            # ProductOnOrder จะถูกลบ CASCADE อัตโนมัติ
            cur.execute('DELETE FROM "Order" WHERE id < 67')
            conn.commit()
            print(f"   ✅ Deleted {legacy_count} legacy orders")
        else:
            print("   ✅ No legacy records found")


# =============================================================================
# Seeding Functions
# =============================================================================
def fetch_experiment_ids(conn):
    """ดึง User IDs >= 13 และ Product IDs >= 55 สำหรับ experiment"""
    with conn.cursor() as cur:
        cur.execute(f'SELECT id FROM "User" WHERE id >= {MIN_USER_ID} LIMIT 1000')
        user_ids = [row[0] for row in cur.fetchall()]
        
        cur.execute(f'SELECT id FROM "Product" WHERE id >= {MIN_PRODUCT_ID} LIMIT 1000')
        product_ids = [row[0] for row in cur.fetchall()]
    
    if not user_ids:
        print(f"❌ No users with id >= {MIN_USER_ID}")
        sys.exit(1)
    if not product_ids:
        print(f"❌ No products with id >= {MIN_PRODUCT_ID}")
        sys.exit(1)
    
    print(f"   Cached {len(user_ids)} users (id >= {MIN_USER_ID})")
    print(f"   Cached {len(product_ids)} products (id >= {MIN_PRODUCT_ID})")
    return user_ids, product_ids


def generate_mock_payment_id():
    """สร้าง mock payment ID"""
    random_str = ''.join(random.choices(string.ascii_lowercase + string.digits, k=16))
    return f"mock_k6_{random_str}"


def generate_random_timestamp(days_back=90):
    """สร้าง random timestamp"""
    now = datetime.now(timezone.utc)
    return now - timedelta(days=random.uniform(0, days_back), seconds=random.uniform(0, 86400))


def seed_orders(conn, user_ids, product_ids, target=TARGET_ORDERS):
    """Seed orders และ items แบบ batch"""
    statuses = ['succeeded', 'succeeded', 'succeeded', 'pending']
    order_statuses = ['Completed', 'Completed', 'Completed', 'Processing', 'Pending']
    
    total_orders = 0
    total_items = 0
    
    print(f"\n🚀 Seeding {target:,} orders in batches of {BATCH_SIZE:,}...")
    
    with conn.cursor() as cur:
        for batch_start in range(0, target, BATCH_SIZE):
            batch_end = min(batch_start + BATCH_SIZE, target)
            batch_count = batch_end - batch_start
            
            # Prepare orders
            order_data = []
            for _ in range(batch_count):
                user_id = random.choice(user_ids)
                cart_total = round(random.uniform(100, 50000), 2)
                created_at = generate_random_timestamp()
                
                order_data.append((
                    user_id,
                    cart_total,
                    generate_mock_payment_id(),
                    cart_total,
                    random.choice(statuses),
                    'thb',
                    random.choice(order_statuses),
                    created_at,
                    created_at,
                    0
                ))
            
            # Insert orders
            execute_batch(cur, """
                INSERT INTO "Order" (
                    "orderedById", "cartTotal", "paymentId", "amount",
                    "status", "currency", "orderStatus", "createdAt", "updatedAt", "refundAmount"
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, order_data, page_size=BATCH_SIZE)
            
            # Get new order IDs
            cur.execute(f'SELECT id FROM "Order" ORDER BY id DESC LIMIT {batch_count}')
            new_order_ids = [row[0] for row in cur.fetchall()]
            
            # Prepare items (Poisson-like: λ=3, range 1-5)
            item_data = []
            for order_id in new_order_ids:
                num_items = random.randint(ITEMS_PER_ORDER_MIN, ITEMS_PER_ORDER_MAX)
                selected_products = random.sample(product_ids, min(num_items, len(product_ids)))
                
                for product_id in selected_products:
                    item_data.append((
                        order_id,
                        product_id,
                        random.randint(1, 5),
                        round(random.uniform(50, 5000), 2),
                        round(random.uniform(0, 1500), 2)
                    ))
            
            # Insert items
            execute_batch(cur, """
                INSERT INTO "ProductOnOrder" (
                    "orderId", "productId", "count", "price", "discount"
                ) VALUES (%s, %s, %s, %s, %s)
            """, item_data, page_size=BATCH_SIZE * 5)
            
            total_orders += batch_count
            total_items += len(item_data)
            
            conn.commit()
            
            pct = (batch_end / target) * 100
            print(f"   [{pct:5.1f}%] {total_orders:,}/{target:,} orders, {total_items:,} items")
    
    return total_orders, total_items


def run_analyze(conn):
    """รัน ANALYZE"""
    print("\n📊 Running ANALYZE...")
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute('ANALYZE "Order";')
        cur.execute('ANALYZE "ProductOnOrder";')
    print("   ✅ ANALYZE complete")


# =============================================================================
# Main
# =============================================================================
def main():
    parser = argparse.ArgumentParser(description='Reset and Re-Seed for K6 Experiment')
    parser.add_argument('--target', '-t', type=int, default=TARGET_ORDERS, help=f'Target order count (default: {TARGET_ORDERS})')
    parser.add_argument('--no-truncate', action='store_true', help='Only delete legacy, do not truncate all')
    parser.add_argument('--yes', '-y', action='store_true', help='Skip confirmation prompt')
    args = parser.parse_args()
    
    print("=" * 60)
    print("🔄 RESET AND RE-SEED FOR K6 EXPERIMENT")
    print("=" * 60)
    print(f"Target Orders: {args.target:,}")
    print(f"Mode: {'Delete legacy only' if args.no_truncate else 'TRUNCATE all'}")
    print(f"Using: userId >= {MIN_USER_ID}, productId >= {MIN_PRODUCT_ID}")
    print()
    
    conn = get_db_connection()
    print("✅ Connected to database")
    
    # Show current state
    current_orders, current_items = get_counts(conn)
    print(f"\n📋 Current State:")
    print(f"   Orders: {current_orders:,}")
    print(f"   ProductOnOrder: {current_items:,}")
    
    # Confirmation
    if not args.yes:
        action = "TRUNCATE all data" if not args.no_truncate else "delete legacy only"
        response = input(f"\n⚠️  This will {action} and re-seed. Continue? (y/n): ").strip().lower()
        if response != 'y':
            print("Aborted.")
            conn.close()
            return
    
    # Reset
    if args.no_truncate:
        delete_legacy_only(conn)
    else:
        truncate_tables(conn)
    
    # Verify reset
    post_reset_orders, post_reset_items = get_counts(conn)
    print(f"\n📋 After Reset:")
    print(f"   Orders: {post_reset_orders:,}")
    print(f"   ProductOnOrder: {post_reset_items:,}")
    
    # Seed
    user_ids, product_ids = fetch_experiment_ids(conn)
    orders_created, items_created = seed_orders(conn, user_ids, product_ids, args.target)
    
    # Analyze
    run_analyze(conn)
    
    # Final state
    final_orders, final_items = get_counts(conn)
    
    print("\n" + "=" * 60)
    print("✅ RESET AND RE-SEED COMPLETE!")
    print("=" * 60)
    print(f"   Orders Created:   {orders_created:,}")
    print(f"   Items Created:    {items_created:,}")
    print(f"   Total Orders:     {final_orders:,}")
    print(f"   Total Items:      {final_items:,}")
    print(f"\n🎯 Database ready for k6 experiment replication!")
    
    conn.close()


if __name__ == '__main__':
    main()
