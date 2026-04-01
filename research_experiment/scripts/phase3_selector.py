"""
Phase 3: Intelligent Index Selection (BCR Model)
==================================================
วัตถุประสงค์: เลือก indexes ที่ดีที่สุดจาก Phase 2 benchmark
โดยใช้ Benefit-Cost Ratio (BCR) model ที่อ้างอิงจาก:
  - Chaudhuri & Narasayya (1997): Cost-Driven Index Selection
  - Li et al. (2024): Automatic Index Tuning Survey
  - Cormen et al. (2009): Greedy Selection (CLRS)

Scoring Formula:
  Read_Benefit(I)   = (Baseline_Cost − New_Cost) × Funnel_Read_Weight
  Write_Overhead(I) = Index_Size_MB × Funnel_Write_Weight(Table)
  BCR(I)            = Read_Benefit(I) / max(ε, Write_Overhead(I))

Selection Criterion:
  Select all indexes where BCR ≥ 1.0 (Read Benefit exceeds Write Overhead)

Deduplication:
  Candidates sharing the same index_def are merged into one physical index:
    - Sum Read_Benefits (one index serves multiple queries)
    - Count Write_Overhead once (one physical index)

Usage (run from server/ directory):
  set PYTHONIOENCODING=utf-8 && python research_experiment/scripts/phase3_selector.py

Dependencies:
  pip install matplotlib pandas

Outputs:
  - results/phase3_final_ranking.csv
  - artifacts/final_indexes.sql
  - artifacts/optimization_chart.png
"""

import json
import csv
import sys
from pathlib import Path

script_dir = Path(__file__).resolve().parent
project_dir = script_dir.parent
configs_dir = project_dir / 'configs'
results_dir = project_dir / 'results'
artifacts_dir = project_dir / 'artifacts'

# Create output directories
results_dir.mkdir(parents=True, exist_ok=True)
artifacts_dir.mkdir(parents=True, exist_ok=True)


# =============================================================================
# Configuration: BCR Model Constants
# =============================================================================

# Selection threshold: BCR >= 1.0 means Read Benefit > Write Overhead
BCR_THRESHOLD = 1.0

# Epsilon to avoid division by zero for read-only tables (Write_Overhead = 0)
EPSILON = 0.001

# Bytes-to-MB conversion factor
BYTES_PER_MB = 1024 * 1024

# =============================================================================
# Funnel Read Weights (from workload-funnel-analysis.md)
# Scenario A: Standard Shopping — TPC-W "WIPS" (80:20)
# Source: Funnel Model (Baymard 2023, Shopify 2023) + TPC-W Calibration
#
# These normalized weights represent how frequently each API is called
# during standard shopping. Higher weight = more frequent = higher read benefit.
# =============================================================================
FUNNEL_READ_WEIGHTS = {
    # Tier 1: Discovery (100% Funnel Rate)
    'displayProdBy':        100,   # Home ×2 calls
    'listProd':              53,   # Shop + Favorite
    'listFlashSaleProducts': 50,   # Home
    'displayProdByUser':     50,   # Home
    'listCategory':          50,   # Shop
    'listBrand':             50,   # Shop
    'getUserCart':            50,   # Home
    # Tier 2: Product Viewing (50% Funnel Rate)
    'readAprod':             25,   # ViewProduct
    'listProdPaginated':     25,   # Shop (on scroll)
    'searchFilters':         15,   # Shop (30% trigger)
    # Tier 3: Add to Cart (7.5% Funnel Rate)
    'getProductsByIds':       4,   # Cart sync
    # Tier 4: Checkout & Payment (2.17% Funnel Rate)
    'getCartUser':            1,   # Payment
    'getOrderUserPaginated':  1,   # History
    'getOrder':               1,   # History (same tier)
    'getOrderPaginated':      1,   # History (same tier)
}

# Default read weight for source_functions not in the map
# (e.g., FK candidates with "Various" source_function)
DEFAULT_READ_WEIGHT = 25  # Mid-tier — conservative assumption

# =============================================================================
# Funnel Write Weights per Table
# (from workload-funnel-analysis.md Scenario B: Flash Sale WIPSo 50:50)
#
# These represent the Write Overhead cost multiplier per table.
# Higher weight = more writes during Flash Sale = higher maintenance cost.
# Source: Flash Sale calibrated weights (TPC-W WIPSo 50:50)
# =============================================================================
FUNNEL_WRITE_WEIGHTS = {
    'Cart':           100,  # createUserCart = 100 (Flash Sale dominant)
    'ProductOnCart':  100,  # Same write path as Cart
    'Order':            9,  # saveOrderUser = 9 (Flash Sale)
    'ProductOnOrder':   9,  # Same checkout flow as Order
    'Payment':          9,  # createPaymentUser = 9 (Flash Sale)
    'User':            10,  # saveAddressUser = 10 (Standard)
    'Favorite':        22,  # toggleFavoriteUser = 22 (Standard)
    'Rating':           1,  # addRatingUser = 1 (rare)
    'Product':          0,  # No customer write API
    'Image':            0,  # Read-only for customers
    'Discount':         0,  # Admin-only writes
    'Brand':            0,  # Admin-only
    'Category':         0,  # Admin-only
}

# Default write weight for tables not in the map
DEFAULT_WRITE_WEIGHT = 1

# =============================================================================
# Scenario Tagging (for Static vs Dynamic experiment)
# =============================================================================
DYNAMIC_TABLES = {'Order', 'Cart', 'ProductOnOrder', 'Discount'}


# =============================================================================
# Helper: Map source_function to Funnel Read Weight
# =============================================================================
def resolve_read_weight(source_function):
    """
    Map source_function (from candidates.json) to Funnel Read Weight.
    source_function like "Various (include images)" → resolve to DEFAULT_READ_WEIGHT
    source_function like "readAprod" → resolve to known weight
    """
    if not source_function:
        return DEFAULT_READ_WEIGHT

    # Clean up source_function — handle "Various (...)" patterns
    clean = source_function.strip()
    if clean.startswith('Various'):
        return DEFAULT_READ_WEIGHT

    # Direct lookup
    if clean in FUNNEL_READ_WEIGHTS:
        return FUNNEL_READ_WEIGHTS[clean]

    # Case-insensitive fallback: try matching lowercase
    lower_map = {k.lower(): v for k, v in FUNNEL_READ_WEIGHTS.items()}
    if clean.lower() in lower_map:
        return lower_map[clean.lower()]

    return DEFAULT_READ_WEIGHT


def resolve_write_weight(table_name):
    """Map table name to Funnel Write Weight."""
    return FUNNEL_WRITE_WEIGHTS.get(table_name, DEFAULT_WRITE_WEIGHT)


def get_scenario_tag(candidate):
    """
    Assign scenario tag: Dynamic_FlashSale or Base_Standard.
    Indexes on write-heavy Flash Sale tables → Dynamic (create/drop per scenario).
    """
    table = candidate.get('table', '')
    cid = candidate.get('id', '')

    if table in DYNAMIC_TABLES or 'FlashSale' in cid or 'flashsale' in cid.lower():
        return 'Dynamic_FlashSale'
    return 'Base_Standard'


# =============================================================================
# Core: BCR Calculation
# =============================================================================
def calculate_read_benefit(baseline_cost, new_cost, read_weight):
    """
    Read_Benefit = (Baseline_Cost − New_Cost) × Funnel_Read_Weight
    Ref: Chaudhuri & Narasayya (1997) — cost reduction is the primary benefit
    """
    cost_saved = max(0, baseline_cost - new_cost)
    return cost_saved * read_weight


def calculate_write_overhead(index_size_bytes, write_weight):
    """
    Write_Overhead = Index_Size_MB × Funnel_Write_Weight(Table)
    Ref: Li et al. (2024) — index maintenance cost reflects physical storage + write amplification
    """
    index_size_mb = index_size_bytes / BYTES_PER_MB
    return index_size_mb * write_weight


def calculate_bcr(read_benefit, write_overhead):
    """
    BCR = Read_Benefit / max(ε, Write_Overhead)
    Ref: Cormen et al. (2009) — Greedy selection by benefit/cost ratio
    """
    return read_benefit / max(EPSILON, write_overhead)


# =============================================================================
# Core: Deduplication by index_def
# =============================================================================
def deduplicate_candidates(scored_candidates):
    """
    Merge candidates with identical index_def into a single physical index.
    - Sum Read Benefits (one index serves multiple queries)
    - Keep Write Overhead as single count (one physical index)
    - Keep the highest freq_score
    - Collect all source query IDs

    Ref: Chaudhuri (1997) — "what-if" analysis groups queries per index configuration
    """
    groups = {}

    for c in scored_candidates:
        key = c['index_def']

        if key not in groups:
            groups[key] = {
                'index_def':        c['index_def'],
                'table':            c['table'],
                'ids':              [c['id']],
                'source_functions': [c.get('source_function', '')],
                'read_benefit':     c['read_benefit'],
                'write_overhead':   c['write_overhead'],
                'index_size_bytes': c['index_size_bytes'],
                'freq_score':       c['freq_score'],
                'baseline_cost':    c['baseline_cost'],
                'new_cost':         c['new_cost'],
                'improvement_pct':  c['improvement_pct'],
                'tag':              c['tag'],
            }
        else:
            group = groups[key]
            group['ids'].append(c['id'])
            group['source_functions'].append(c.get('source_function', ''))
            # Sum read benefit — one index serves multiple queries
            group['read_benefit'] += c['read_benefit']
            # Keep highest freq_score (most frequently used query)
            group['freq_score'] = max(group['freq_score'], c['freq_score'])
            # Keep highest baseline_cost for reporting
            group['baseline_cost'] = max(group['baseline_cost'], c['baseline_cost'])
            # Keep lowest new_cost for reporting
            group['new_cost'] = min(group['new_cost'], c['new_cost'])
            # Recalculate improvement for reporting
            if group['baseline_cost'] > 0:
                group['improvement_pct'] = (
                    (group['baseline_cost'] - group['new_cost'])
                    / group['baseline_cost'] * 100
                )

    # Recalculate BCR for merged groups
    result = []
    for key, g in groups.items():
        bcr = calculate_bcr(g['read_benefit'], g['write_overhead'])
        # Primary ID = first candidate's ID (for naming)
        primary_id = g['ids'][0]
        result.append({
            'id':               primary_id,
            'merged_ids':       g['ids'],
            'source_functions': g['source_functions'],
            'table':            g['table'],
            'index_def':        g['index_def'],
            'read_benefit':     g['read_benefit'],
            'write_overhead':   g['write_overhead'],
            'bcr':              bcr,
            'index_size_bytes': g['index_size_bytes'],
            'freq_score':       g['freq_score'],
            'baseline_cost':    g['baseline_cost'],
            'new_cost':         g['new_cost'],
            'improvement_pct':  g['improvement_pct'],
            'tag':              g['tag'],
            'query_count':      len(g['ids']),
        })

    return result


# =============================================================================
# Output: CSV Report
# =============================================================================
def write_csv(ranked, output_path):
    """Generate CSV report of selected indexes."""
    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow([
            'Rank', 'ID', 'Merged_IDs', 'Table', 'Tag',
            'Baseline_Cost', 'New_Cost', 'Imp_Pct',
            'Read_Benefit', 'Write_Overhead', 'BCR',
            'Index_Size_MB', 'Queries_Served'
        ])

        for i, c in enumerate(ranked, 1):
            writer.writerow([
                i,
                c['id'],
                ' | '.join(c['merged_ids']),
                c['table'],
                c['tag'],
                round(c['baseline_cost'], 2),
                round(c['new_cost'], 2),
                round(c['improvement_pct'], 2),
                round(c['read_benefit'], 2),
                round(c['write_overhead'], 4),
                round(c['bcr'], 2),
                round(c['index_size_bytes'] / BYTES_PER_MB, 2),
                c['query_count'],
            ])

    print(f"  CSV saved: {output_path}")


# =============================================================================
# Output: SQL File
# =============================================================================
def write_sql(ranked, output_path):
    """Generate SQL file with CREATE INDEX statements."""
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write("-- ============================================================\n")
        f.write("-- Phase 3: Final Selected Indexes (BCR Model)\n")
        f.write("-- ============================================================\n")
        f.write("-- Auto-generated by phase3_selector.py\n")
        f.write(f"-- Total Selected: {len(ranked)} indexes (BCR >= {BCR_THRESHOLD})\n")
        f.write("-- Model: BCR = Read_Benefit / Write_Overhead\n")
        f.write("--   Read_Benefit = (Baseline_Cost - New_Cost) x Funnel_Read_Weight\n")
        f.write("--   Write_Overhead = Index_Size_MB x Funnel_Write_Weight(Table)\n")
        f.write("-- Refs: Chaudhuri 1997, Li et al. 2024, Cormen et al. 2009\n")
        f.write("-- ============================================================\n\n")

        for i, c in enumerate(ranked, 1):
            tag = c['tag']
            bcr_val = round(c['bcr'], 1)
            imp = round(c['improvement_pct'], 1)
            table = c['table']
            queries = c['query_count']
            idx_def = c['index_def']

            f.write(f"-- [{tag}] Rank #{i} | BCR: {bcr_val} | Imp: {imp}%"
                    f" | Table: {table} | Queries: {queries}\n")
            if len(c['merged_ids']) > 1:
                f.write(f"-- Serves: {', '.join(c['merged_ids'])}\n")

            # Generate index name from primary ID
            idx_name = f"idx_p3_{c['id'].lower()}"
            named_def = idx_def.replace(
                'CREATE INDEX ON',
                f'CREATE INDEX IF NOT EXISTS "{idx_name}" ON'
            )
            f.write(f"{named_def};\n\n")

        # ANALYZE statements
        tables_used = sorted(set(c['table'] for c in ranked))
        f.write("-- Update Statistics\n")
        for t in tables_used:
            f.write(f'ANALYZE "{t}";\n')

    print(f"  SQL saved: {output_path}")


# =============================================================================
# Output: Visualization
# =============================================================================
def create_chart(ranked, output_path, top_n=10):
    """Create horizontal bar chart of BCR scores for top N indexes."""
    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
    except ImportError:
        print("  matplotlib not installed. Skipping chart.")
        print("  Install: pip install matplotlib")
        return

    top = ranked[:top_n]
    top_reversed = list(reversed(top))  # Rank 1 at top of chart

    labels = [f"{c['id']}\n({c['table']})" for c in top_reversed]
    bcr_values = [c['bcr'] for c in top_reversed]
    colors = ['#E74C3C' if c['tag'] == 'Dynamic_FlashSale' else '#3498DB'
              for c in top_reversed]

    fig, ax = plt.subplots(figsize=(14, 8))

    bars = ax.barh(labels, bcr_values, color=colors,
                   edgecolor='white', linewidth=0.5, height=0.6)

    # Value labels on bars
    for bar, val in zip(bars, bcr_values):
        label_text = f'{val:,.0f}' if val > 100 else f'{val:.1f}'
        ax.text(bar.get_width() + max(bcr_values) * 0.02,
                bar.get_y() + bar.get_height() / 2,
                label_text, va='center', fontsize=9, fontweight='bold')

    # Styling
    ax.set_xlabel('Benefit-Cost Ratio (BCR)', fontsize=12, fontweight='bold')
    ax.set_title(
        f'Phase 3: Top {top_n} Indexes by BCR\n'
        f'BCR = Read_Benefit / Write_Overhead (Threshold >= {BCR_THRESHOLD})',
        fontsize=13, fontweight='bold', pad=15
    )
    ax.set_xlim(0, max(bcr_values) * 1.2)

    # Grid
    ax.xaxis.grid(True, alpha=0.3, linestyle='--')
    ax.set_axisbelow(True)

    # Legend
    from matplotlib.patches import Patch
    legend_elements = [
        Patch(facecolor='#3498DB', label='Base_Standard'),
        Patch(facecolor='#E74C3C', label='Dynamic_FlashSale'),
    ]
    ax.legend(handles=legend_elements, loc='lower right', fontsize=10)

    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches='tight')
    plt.close()

    print(f"  Chart saved: {output_path}")


# =============================================================================
# Output: JSON (full scored results for traceability)
# =============================================================================
def write_json(all_scored, selected, output_path):
    """Save full BCR results as JSON for reproducibility."""
    output = {
        'metadata': {
            'model': 'Benefit-Cost Ratio (BCR)',
            'threshold': BCR_THRESHOLD,
            'funnel_source': 'workload-funnel-analysis.md',
            'read_weight_scenario': 'Standard Shopping (TPC-W WIPS 80:20)',
            'write_weight_scenario': 'Flash Sale (TPC-W WIPSo 50:50)',
            'references': [
                'Chaudhuri & Narasayya (1997) — Cost-Driven Index Selection, VLDB',
                'Li et al. (2024) — Automatic Index Tuning Survey, IEEE TKDE',
                'Cormen et al. (2009) — Greedy Selection, CLRS',
            ],
            'total_candidates': len(all_scored),
            'selected_count': len(selected),
        },
        'selected': [
            {
                'rank': i + 1,
                'id': c['id'],
                'merged_ids': c['merged_ids'],
                'table': c['table'],
                'tag': c['tag'],
                'index_def': c['index_def'],
                'bcr': round(c['bcr'], 4),
                'read_benefit': round(c['read_benefit'], 4),
                'write_overhead': round(c['write_overhead'], 4),
                'baseline_cost': round(c['baseline_cost'], 2),
                'new_cost': round(c['new_cost'], 2),
                'improvement_pct': round(c['improvement_pct'], 2),
                'index_size_mb': round(c['index_size_bytes'] / BYTES_PER_MB, 2),
                'query_count': c['query_count'],
            }
            for i, c in enumerate(selected)
        ],
        'rejected': [
            {
                'id': c['id'],
                'table': c['table'],
                'bcr': round(c['bcr'], 4),
                'read_benefit': round(c['read_benefit'], 4),
                'write_overhead': round(c['write_overhead'], 4),
                'reason': 'BCR < threshold' if c['read_benefit'] > 0 else 'Zero improvement',
            }
            for c in all_scored if c['bcr'] < BCR_THRESHOLD
        ],
    }

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"  JSON saved: {output_path}")


# =============================================================================
# Main
# =============================================================================
def main():
    print("=" * 65)
    print("  PHASE 3: INTELLIGENT INDEX SELECTION (BCR Model)")
    print("=" * 65)

    # ── Step 1: Load Phase 2 results + candidates.json (for source_function) ──
    phase2_path = results_dir / 'phase2_results_filtered.json'
    candidates_path = configs_dir / 'candidates.json'

    if not phase2_path.exists():
        print(f"  ERROR: Input not found: {phase2_path}")
        sys.exit(1)
    if not candidates_path.exists():
        print(f"  ERROR: Candidates not found: {candidates_path}")
        sys.exit(1)

    with open(phase2_path, 'r', encoding='utf-8') as f:
        phase2_results = json.load(f)

    with open(candidates_path, 'r', encoding='utf-8') as f:
        candidates_raw = json.load(f)

    # Build lookup: id → source_function from candidates.json
    source_func_map = {c['id']: c.get('source_function', '') for c in candidates_raw}

    print(f"\n  Loaded {len(phase2_results)} candidates from Phase 2")
    print(f"  Loaded {len(candidates_raw)} entries from candidates.json")

    # ── Step 2: Score each candidate ──
    print(f"\n  Scoring with BCR model...")
    print(f"  Read Weights: Standard Shopping (TPC-W WIPS 80:20)")
    print(f"  Write Weights: Flash Sale (TPC-W WIPSo 50:50)")
    print(f"  Threshold: BCR >= {BCR_THRESHOLD}\n")

    scored = []
    for c in phase2_results:
        cid = c.get('id', '')
        table = c.get('table', '')
        baseline = c.get('baseline_cost', 0)
        new_cost = c.get('new_cost', 0)
        size_bytes = c.get('estimated_size_bytes', 0)

        # Resolve weights from Funnel model
        source_function = source_func_map.get(cid, '')
        read_weight = resolve_read_weight(source_function)
        write_weight = resolve_write_weight(table)

        # Calculate BCR components
        read_benefit = calculate_read_benefit(baseline, new_cost, read_weight)
        write_overhead = calculate_write_overhead(size_bytes, write_weight)
        bcr = calculate_bcr(read_benefit, write_overhead)

        tag = get_scenario_tag(c)

        scored.append({
            'id':               cid,
            'table':            table,
            'index_def':        c.get('index_def', ''),
            'source_function':  source_function,
            'baseline_cost':    baseline,
            'new_cost':         new_cost,
            'improvement_pct':  c.get('improvement_pct', 0),
            'index_size_bytes': size_bytes,
            'freq_score':       c.get('freq_score', 0),
            'read_weight':      read_weight,
            'write_weight':     write_weight,
            'read_benefit':     read_benefit,
            'write_overhead':   write_overhead,
            'bcr':              bcr,
            'tag':              tag,
        })

    # ── Step 3: Deduplicate by index_def ──
    print(f"  Pre-dedup: {len(scored)} candidates")
    deduped = deduplicate_candidates(scored)
    print(f"  Post-dedup: {len(deduped)} physical indexes")

    # Track merged candidates for reporting
    merged_count = sum(1 for d in deduped if d['query_count'] > 1)
    if merged_count > 0:
        print(f"  Merged groups: {merged_count}")
        for d in deduped:
            if d['query_count'] > 1:
                print(f"    {d['id']} <- {d['merged_ids']} (queries: {d['query_count']})")

    # ── Step 4: Sort by BCR descending ──
    deduped.sort(key=lambda x: x['bcr'], reverse=True)

    # ── Step 5: Select by BCR threshold (not Top-N) ──
    selected = [c for c in deduped if c['bcr'] >= BCR_THRESHOLD]

    print(f"\n  Selected: {len(selected)} / {len(deduped)} (BCR >= {BCR_THRESHOLD})")

    # ── Step 6: Print top results ──
    print(f"\n  {'Rank':<5} {'ID':<35} {'Table':<17} {'Tag':<20} {'BCR':<12} {'RdBenefit':<12} {'WrOverhead':<12}")
    print("  " + "-" * 110)

    display_count = min(len(selected), 15)
    for i, c in enumerate(selected[:display_count], 1):
        bcr_str = f"{c['bcr']:,.1f}" if c['bcr'] < 1_000_000 else f"{c['bcr']:,.0f}"
        print(f"  {i:<5} {c['id']:<35} {c['table']:<17} {c['tag']:<20} "
              f"{bcr_str:<12} {c['read_benefit']:>10,.1f} {c['write_overhead']:>10.4f}")

    if len(selected) > display_count:
        print(f"  ... and {len(selected) - display_count} more")

    # ── Step 7: Tag distribution ──
    base_count = sum(1 for c in selected if c['tag'] == 'Base_Standard')
    dynamic_count = sum(1 for c in selected if c['tag'] == 'Dynamic_FlashSale')
    print(f"\n  Tag Distribution:")
    print(f"    Base_Standard:     {base_count}")
    print(f"    Dynamic_FlashSale: {dynamic_count}")

    # ── Step 8: Generate outputs ──
    print(f"\n  Generating outputs...\n")

    csv_path = results_dir / 'phase3_final_ranking.csv'
    write_csv(selected, csv_path)

    sql_path = artifacts_dir / 'final_indexes.sql'
    write_sql(selected, sql_path)

    chart_path = artifacts_dir / 'optimization_chart.png'
    create_chart(selected, chart_path, top_n=min(10, len(selected)))

    json_path = results_dir / 'phase3_bcr_results.json'
    write_json(deduped, selected, json_path)

    # ── Done ──
    print("\n" + "=" * 65)
    print("  PHASE 3 COMPLETE!")
    print("=" * 65)
    print(f"  Model:     BCR = Read_Benefit / Write_Overhead")
    print(f"  Threshold: BCR >= {BCR_THRESHOLD}")
    print(f"  Selected:  {len(selected)} / {len(deduped)} physical indexes")
    print(f"  CSV:       {csv_path}")
    print(f"  SQL:       {sql_path}")
    print(f"  JSON:      {json_path}")
    print(f"  Chart:     {chart_path}")


if __name__ == '__main__':
    main()
