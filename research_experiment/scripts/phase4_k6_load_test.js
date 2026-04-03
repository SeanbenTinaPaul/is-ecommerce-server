/**
 * Phase 4: k6 Load Test Script — WeStride E-commerce
 * ===================================================
 * Calibrated workload using Funnel + TPC-W framework
 *
 * Weight sources:
 *   - configs/workload-funnel-analysis.md (STANDARD_WEIGHTS, FLASH_SALE_WEIGHTS)
 *   - configs/workload_config.txt (VU, think_time, Zipf α per phase)
 *
 * Usage:
 *   k6 run phase4_k6_load_test.js --env BASE_URL=http://<GCP_VM_IP>:5000/api
 *   k6 run phase4_k6_load_test.js --env BASE_URL=http://<GCP_VM_IP>:5000/api --summary-export=k6_result.json
 *
 * Required env vars:
 *   BASE_URL  — API base URL (e.g. http://35.x.x.x:5000/api)
 *
 * Pre-requisites:
 *   1. python research_experiment/scripts/phase4_metrics_collector.py reset
 *   2. Confirm Neon compute is Fixed Size (2 CU)
 *   3. Confirm connection string uses '-pooler' endpoint
 */

import http from 'k6/http';
import { sleep, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// ============================================================================
// Section: Custom Metrics
// ============================================================================
const readApiDuration = new Trend('read_api_duration', true);
const writeApiDuration = new Trend('write_api_duration', true);
const readApiErrors = new Rate('read_api_errors');
const writeApiErrors = new Rate('write_api_errors');
const apiCallCounter = new Counter('api_calls_total');

// ============================================================================
// Section: Configuration Constants (from workload_config.txt)
// ============================================================================
const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000/api';

// User pool: userId starts from 13 (per experiment constraint)
const USER_ID_START = 13;
const USER_POOL_SIZE = 200; // Use 200 simulated users
const PASSWORD = '123456';  // Default password from seeding

// Product pool
const TOTAL_PRODUCTS = 20000;
const PRODUCT_ID_START = 55; // productId starts from 55

// Phase durations (seconds) — aligned with workload_config.txt
// Ramp-up = time for infra warm-up (pool, JIT, cache), NOT real traffic arrival modeling
const PHASE_DURATIONS = {
  phase1: { rampUp: 60, sustained: 120 },   // 1min ramp (20 VU / 100 pool = trivial) → 2min measurement
  phase2: { rampUp: 120, sustained: 180 },  // 2min ramp (100 VU / 100 pool = 1:1, gentle) → 3min measurement
  phase3: { rampUp: 120, sustained: 180 },  // 2min ramp (300 VU / 100 pool = 3:1, queue builds ~40s in) → 3min measurement
  phase4: { rampUp: 30, sustained: 300 },   // 30s ramp (flash sale burst — intentionally aggressive) → 5min measurement
};

// Think time ranges per phase (seconds)
const THINK_TIMES = {
  phase1: { min: 5, max: 10 },
  phase2: { min: 3, max: 5 },
  phase3: { min: 1, max: 3 },
  phase4: { min: 0.5, max: 1.5 },
};

// Zipf skew per phase (from workload_config.txt data_distribution)
const ZIPF_SKEW = {
  phase1: { read: 0.6, write: 0.5 },
  phase2: { read: 0.75, write: 0.7 },
  phase3: { read: 0.9, write: 0.85 },
  phase4: { read: 0.95, write: 0.95 },
};

// Cart size (Poisson λ) per phase
const CART_LAMBDA = {
  phase1: { read: 4, write: 2 },
  phase2: { read: 3, write: 2 },
  phase3: { read: 2, write: 2 },
  phase4: { read: 1, write: 3 },
};

// ============================================================================
// Section: Calibrated API Weights (from workload-funnel-analysis.md)
// ============================================================================

// Scenario A: Standard Shopping — TPC-W WIPS (80:20)
// Used for Phases 1-3
const STANDARD_WEIGHTS = {
  // READ APIs
  displayProdBy:        100,
  listProd:              53,
  listFlashSaleProducts: 50,
  displayProdByUser:     50,
  listCategory:          50,
  listBrand:             50,
  getUserCart:            50,
  readAprod:              25,
  listProdPaginated:     25,
  searchFilters:         15,
  getProductsByIds:       4,
  getCartUser:            1,
  getOrderUserPaginated:  1,

  // WRITE APIs (calibrated ×8.77)
  createUserCart:         66,
  toggleFavoriteUser:    22,
  saveAddressUser:       10,
  createPaymentUser:     10,
  saveOrderUser:         10,
  addRatingUser:          1,
  reqCancelPayment:       1,
  reqRefund:              1,
};

// Scenario B: Flash Sale — TPC-W WIPSo (50:50)
// Used for Phase 4
const FLASH_SALE_WEIGHTS = {
  // READ APIs
  readAprod:              37,
  getProductsByIds:       28,
  displayProdBy:         22,
  listFlashSaleProducts: 11,
  displayProdByUser:     11,
  getUserCart:            11,
  getCartUser:            2,
  getOrderUserPaginated:  2,
  listProd:               2,
  listCategory:           2,
  listBrand:              2,
  searchFilters:          1,
  listProdPaginated:      1,

  // WRITE APIs (calibrated ×3.63)
  createUserCart:        100,
  saveAddressUser:        9,
  createPaymentUser:      9,
  saveOrderUser:          9,
  toggleFavoriteUser:     3,
  reqCancelPayment:       3,
  addRatingUser:          1,
  reqRefund:              1,
};

// API type classification for metrics
const WRITE_APIS = new Set([
  'createUserCart', 'toggleFavoriteUser', 'saveAddressUser',
  'createPaymentUser', 'saveOrderUser', 'addRatingUser',
  'reqCancelPayment', 'reqRefund',
]);

// ============================================================================
// Section: k6 Scenario Options
// ============================================================================
export const options = {
  scenarios: {
    // Phase 1: Off-peak (20 VU) — STANDARD_WEIGHTS
    phase1_offpeak: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: `${PHASE_DURATIONS.phase1.rampUp}s`, target: 20 },
        { duration: `${PHASE_DURATIONS.phase1.sustained}s`, target: 20 },
      ],
      env: { PHASE: '1' },
      tags: { phase: 'offpeak' },
    },
    // Phase 2: Normal (100 VU) — STANDARD_WEIGHTS
    phase2_normal: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: `${PHASE_DURATIONS.phase2.rampUp}s`, target: 100 },
        { duration: `${PHASE_DURATIONS.phase2.sustained}s`, target: 100 },
      ],
      startTime: `${PHASE_DURATIONS.phase1.rampUp + PHASE_DURATIONS.phase1.sustained + 10}s`,
      env: { PHASE: '2' },
      tags: { phase: 'normal' },
    },
    // Phase 3: Peak (300 VU) — STANDARD_WEIGHTS
    phase3_peak: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: `${PHASE_DURATIONS.phase3.rampUp}s`, target: 300 },
        { duration: `${PHASE_DURATIONS.phase3.sustained}s`, target: 300 },
      ],
      startTime: `${PHASE_DURATIONS.phase1.rampUp + PHASE_DURATIONS.phase1.sustained + 10 + PHASE_DURATIONS.phase2.rampUp + PHASE_DURATIONS.phase2.sustained + 10}s`,
      env: { PHASE: '3' },
      tags: { phase: 'peak' },
    },
    // Phase 4: Flash Sale (1000 VU) — FLASH_SALE_WEIGHTS
    phase4_flashsale: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: `${PHASE_DURATIONS.phase4.rampUp}s`, target: 1000 },
        { duration: `${PHASE_DURATIONS.phase4.sustained}s`, target: 1000 },
      ],
      startTime: `${PHASE_DURATIONS.phase1.rampUp + PHASE_DURATIONS.phase1.sustained + 10 + PHASE_DURATIONS.phase2.rampUp + PHASE_DURATIONS.phase2.sustained + 10 + PHASE_DURATIONS.phase3.rampUp + PHASE_DURATIONS.phase3.sustained + 10}s`,
      env: { PHASE: '4' },
      tags: { phase: 'flashsale' },
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    read_api_errors: ['rate<0.05'],   // <5% read errors
    write_api_errors: ['rate<0.10'],  // <10% write errors
  },
};

// ============================================================================
// Section: Utility Functions
// ============================================================================

/**
 * Zipfian distribution random number generator
 * Generates numbers biased toward lower values (popular products)
 * @param {number} n - Range [1, n]
 * @param {number} alpha - Skew parameter (higher = more skewed)
 * @returns {number} Random number in [1, n]
 */
function zipfRandom(n, alpha) {
  // Rejection sampling method for Zipfian distribution
  const harmonicN = harmonicNumber(n, alpha);
  const u = Math.random() * harmonicN;

  let cumulative = 0;
  for (let k = 1; k <= n; k++) {
    cumulative += 1.0 / Math.pow(k, alpha);
    if (u <= cumulative) {
      return k;
    }
  }
  return n;
}

// Cache harmonic numbers per (n, alpha) to avoid recalculation
// H(n, α) = Σ_{k=1}^{n} 1/k^α — the Zipf normalization constant
const harmonicCache = {};
function harmonicNumber(n, alpha) {
  const key = `${n}_${alpha}`;
  if (harmonicCache[key]) return harmonicCache[key];

  // Compute first min(n, 1000) terms exactly
  const limit = Math.min(n, 1000);
  let h = 0;
  for (let k = 1; k <= limit; k++) {
    h += 1.0 / Math.pow(k, alpha);
  }

  // Approximate tail using integral: ∫_{M}^{n} x^{-α} dx
  // This is critical for α < 1 where tail terms are significant
  // (e.g., α=0.6 → tail contains ~62% of total probability mass)
  if (n > 1000) {
    if (alpha < 1) {
      // ∫ x^{-α} dx = x^{1-α}/(1-α), for α < 1: (n^{1-α} - M^{1-α})/(1-α)
      h += (Math.pow(n, 1 - alpha) - Math.pow(1000, 1 - alpha)) / (1 - alpha);
    } else if (alpha > 1) {
      // For α > 1: (M^{1-α} - n^{1-α})/(α-1)
      h += (Math.pow(1000, 1 - alpha) - Math.pow(n, 1 - alpha)) / (alpha - 1);
    } else {
      // α === 1: harmonic series tail ≈ ln(n/M)
      h += Math.log(n / 1000);
    }
  }

  harmonicCache[key] = h;
  return h;
}

/**
 * Poisson random variate generator (Knuth's algorithm)
 * @param {number} lambda - Mean value
 * @returns {number} Random number from Poisson distribution, minimum 1
 */
function poissonRandom(lambda) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return Math.max(1, k - 1);
}

/**
 * Weighted random selection from weight map
 * @param {Object} weights - Map of {apiName: weight}
 * @returns {string} Selected API name
 */
function weightedRandom(weights) {
  const entries = Object.entries(weights);
  let totalWeight = 0;
  for (const [, w] of entries) {
    totalWeight += w;
  }

  let r = Math.random() * totalWeight;
  let cumulative = 0;
  for (const [api, w] of entries) {
    cumulative += w;
    if (r <= cumulative) {
      return api;
    }
  }
  return entries[entries.length - 1][0];
}

/**
 * Random think time within phase range
 */
function thinkTime(phase) {
  const config = THINK_TIMES[`phase${phase}`];
  return config.min + Math.random() * (config.max - config.min);
}

/**
 * Get a random product ID using Zipfian distribution
 */
function getRandomProductId(phase, isWrite) {
  const skewConfig = ZIPF_SKEW[`phase${phase}`];
  const alpha = isWrite ? skewConfig.write : skewConfig.read;
  const rank = zipfRandom(TOTAL_PRODUCTS, alpha);
  return PRODUCT_ID_START + rank - 1;
}

/**
 * Generate random cart items for write operations
 */
function generateCartItems(phase) {
  const lambda = CART_LAMBDA[`phase${phase}`].write;
  const count = poissonRandom(lambda);
  const items = [];

  for (let i = 0; i < count; i++) {
    const productId = getRandomProductId(phase, true);
    items.push({
      id: productId,
      countCart: Math.floor(Math.random() * 3) + 1, // 1-3 quantity
      price: Math.floor(Math.random() * 5000) + 100,
      buyPriceNum: Math.floor(Math.random() * 5000) + 100,
      preferDiscount: Math.random() > 0.7 ? Math.floor(Math.random() * 30) : null,
    });
  }
  return items;
}

// ============================================================================
// Section: Auth Token Management
// ============================================================================

// Store tokens per VU
const vuTokens = {};

/**
 * Login and cache JWT token for current VU's assigned user
 */
function ensureAuth(vuId) {
  if (vuTokens[vuId]) return vuTokens[vuId];

  // Map VU to a user ID (circular assignment within pool)
  const userId = USER_ID_START + (vuId % USER_POOL_SIZE);
  const email = `user${userId}@test.com`;

  const loginRes = http.post(
    `${BASE_URL}/login`,
    JSON.stringify({ email, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } }
  );

  if (loginRes.status === 200) {
    try {
      const body = JSON.parse(loginRes.body);
      if (body.token) {
        vuTokens[vuId] = body.token;
        return body.token;
      }
    } catch (e) {
      // Parse error — fall through
    }
  }

  // Fallback: retry once
  const retryRes = http.post(
    `${BASE_URL}/login`,
    JSON.stringify({ email, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login_retry' } }
  );

  if (retryRes.status === 200) {
    try {
      const body = JSON.parse(retryRes.body);
      if (body.token) {
        vuTokens[vuId] = body.token;
        return body.token;
      }
    } catch (e) {
      // Parse error
    }
  }

  return null;
}

/**
 * Build auth headers
 */
function authHeaders(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

// ============================================================================
// Section: API Call Implementations
// ============================================================================

function callApi(apiName, phase, token) {
  const isWrite = WRITE_APIS.has(apiName);
  const headers = token ? authHeaders(token) : { 'Content-Type': 'application/json' };
  let res;

  switch (apiName) {
    // ---- READ APIs ----
    case 'displayProdBy': {
      // POST /display-prod-by — "best seller" or "new arrivals"
      const sortTypes = ['sold', 'createdAt', 'price', 'avgRating'];
      const sortBy = sortTypes[Math.floor(Math.random() * sortTypes.length)];
      res = http.post(`${BASE_URL}/display-prod-by`, JSON.stringify({
        sort: sortBy, order: 'desc', limit: 20,
      }), { headers, tags: { name: 'displayProdBy' } });
      break;
    }
    case 'listProd': {
      const count = [20, 50, 100][Math.floor(Math.random() * 3)];
      res = http.get(`${BASE_URL}/products/${count}?leastStock=0`, {
        headers, tags: { name: 'listProd' },
      });
      break;
    }
    case 'listFlashSaleProducts': {
      res = http.get(`${BASE_URL}/products/flash-sale`, {
        headers, tags: { name: 'listFlashSaleProducts' },
      });
      break;
    }
    case 'displayProdByUser': {
      res = http.get(`${BASE_URL}/display-prod-by-user`, {
        headers: authHeaders(token), tags: { name: 'displayProdByUser' },
      });
      break;
    }
    case 'listCategory': {
      res = http.get(`${BASE_URL}/category`, {
        headers, tags: { name: 'listCategory' },
      });
      break;
    }
    case 'listBrand': {
      res = http.get(`${BASE_URL}/brand`, {
        headers, tags: { name: 'listBrand' },
      });
      break;
    }
    case 'getUserCart': {
      res = http.get(`${BASE_URL}/user/cart`, {
        headers: authHeaders(token), tags: { name: 'getUserCart' },
      });
      break;
    }
    case 'readAprod': {
      const productId = getRandomProductId(phase, false);
      res = http.get(`${BASE_URL}/product/${productId}`, {
        headers, tags: { name: 'readAprod' },
      });
      break;
    }
    case 'listProdPaginated': {
      const page = Math.floor(Math.random() * 10);
      res = http.get(`${BASE_URL}/products-paginated?skip=${page * 20}&take=20`, {
        headers, tags: { name: 'listProdPaginated' },
      });
      break;
    }
    case 'searchFilters': {
      const categories = [1, 2, 3, 4, 5];
      const catId = categories[Math.floor(Math.random() * categories.length)];
      res = http.post(`${BASE_URL}/search-filters`, JSON.stringify({
        query: '', categoryId: [catId], brandId: [], priceRange: [0, 100000],
        sort: 'createdAt', order: 'desc',
      }), { headers, tags: { name: 'searchFilters' } });
      break;
    }
    case 'getProductsByIds': {
      // Cart sync — get product details for items in cart
      const numItems = poissonRandom(CART_LAMBDA[`phase${phase}`].read);
      const ids = [];
      for (let i = 0; i < numItems; i++) {
        ids.push(getRandomProductId(phase, false));
      }
      res = http.post(`${BASE_URL}/products-by-ids`, JSON.stringify({ ids }), {
        headers, tags: { name: 'getProductsByIds' },
      });
      break;
    }
    case 'getCartUser': {
      // Alias for getUserCart on payment page context
      res = http.get(`${BASE_URL}/user/cart`, {
        headers: authHeaders(token), tags: { name: 'getCartUser' },
      });
      break;
    }
    case 'getOrderUserPaginated': {
      res = http.get(`${BASE_URL}/user/order-paginated?skip=0&take=10`, {
        headers: authHeaders(token), tags: { name: 'getOrderUserPaginated' },
      });
      break;
    }

    // ---- WRITE APIs ----
    case 'createUserCart': {
      const cartItems = generateCartItems(phase);
      res = http.post(`${BASE_URL}/user/cart`, JSON.stringify({ carts: cartItems }), {
        headers: authHeaders(token), tags: { name: 'createUserCart' },
      });
      break;
    }
    case 'toggleFavoriteUser': {
      const productId = getRandomProductId(phase, true);
      res = http.post(`${BASE_URL}/user/favorite`, JSON.stringify({ productId }), {
        headers: authHeaders(token), tags: { name: 'toggleFavoriteUser' },
      });
      break;
    }
    case 'saveAddressUser': {
      const addresses = [
        '123 Main St, Bangkok 10110',
        '456 Sukhumvit Rd, Bangkok 10250',
        '789 Silom Rd, Bangkok 10500',
      ];
      const address = addresses[Math.floor(Math.random() * addresses.length)];
      res = http.post(`${BASE_URL}/user/address`, JSON.stringify({ address }), {
        headers: authHeaders(token), tags: { name: 'saveAddressUser' },
      });
      break;
    }
    case 'createPaymentUser': {
      // Simulated payment intent — this may fail if no cart exists
      // In real flow, a Stripe payment intent would be created
      // We simulate the API call to generate DB load
      res = http.post(`${BASE_URL}/user/create-payment-intent`, JSON.stringify({
        amount: Math.floor(Math.random() * 50000) + 500,
        currency: 'thb',
      }), {
        headers: authHeaders(token), tags: { name: 'createPaymentUser' },
      });
      break;
    }
    case 'saveOrderUser': {
      // Simulated order save — requires a cart + payment intent
      // This will often fail (no real Stripe payment) but still generates DB queries
      res = http.post(`${BASE_URL}/user/order`, JSON.stringify({
        paymentIntent: {
          id: `pi_test_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
          amount: Math.floor(Math.random() * 5000000) + 50000, // in satang
          currency: 'thb',
          status: 'succeeded',
        },
      }), {
        headers: authHeaders(token), tags: { name: 'saveOrderUser' },
      });
      break;
    }
    case 'addRatingUser': {
      const productId = getRandomProductId(phase, true);
      res = http.post(`${BASE_URL}/user/rating`, JSON.stringify({
        ratings: [{
          productId,
          orderId: Math.floor(Math.random() * 500000) + 1,
          rating: Math.floor(Math.random() * 5) + 1,
          comment: 'Load test rating',
        }],
      }), {
        headers: authHeaders(token), tags: { name: 'addRatingUser' },
      });
      break;
    }
    case 'reqCancelPayment': {
      res = http.post(`${BASE_URL}/user/cancel-payment-intent`, JSON.stringify({
        paymentIntentId: `pi_test_cancel_${Date.now()}`,
      }), {
        headers: authHeaders(token), tags: { name: 'reqCancelPayment' },
      });
      break;
    }
    case 'reqRefund': {
      res = http.post(`${BASE_URL}/user/refund-payment`, JSON.stringify({
        paymentIntentId: `pi_test_refund_${Date.now()}`,
      }), {
        headers: authHeaders(token), tags: { name: 'reqRefund' },
      });
      break;
    }
    default:
      console.warn(`Unknown API: ${apiName}`);
      return;
  }

  // Record custom metrics
  if (res) {
    const duration = res.timings.duration;
    const isError = res.status >= 400 || res.status === 0;

    if (isWrite) {
      writeApiDuration.add(duration);
      writeApiErrors.add(isError ? 1 : 0);
    } else {
      readApiDuration.add(duration);
      readApiErrors.add(isError ? 1 : 0);
    }
    apiCallCounter.add(1);
  }
}

// ============================================================================
// Section: Main VU Execution
// ============================================================================
export default function () {
  // Determine current phase from scenario env
  const phase = parseInt(__ENV.PHASE || '1');
  const vuId = __VU;

  // Authenticate VU
  const token = ensureAuth(vuId);
  if (!token) {
    console.error(`VU ${vuId}: Failed to authenticate, skipping iteration`);
    sleep(5);
    return;
  }

  // Select weight set based on phase
  const weights = phase === 4 ? FLASH_SALE_WEIGHTS : STANDARD_WEIGHTS;

  // Pick a random API using calibrated weights
  const selectedApi = weightedRandom(weights);

  // Execute the API call
  group(`Phase${phase}_${selectedApi}`, () => {
    callApi(selectedApi, phase, token);
  });

  // Apply think time based on phase
  sleep(thinkTime(phase));
}

// ============================================================================
// Section: Test Lifecycle Hooks
// ============================================================================
export function setup() {
  console.log('=== WeStride E-commerce Load Test ===');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`User pool: ${USER_ID_START} to ${USER_ID_START + USER_POOL_SIZE - 1}`);
  console.log(`Product pool: ${PRODUCT_ID_START} to ${PRODUCT_ID_START + TOTAL_PRODUCTS - 1}`);
  console.log('Phases: 1=Off-peak(20VU) → 2=Normal(100VU) → 3=Peak(300VU) → 4=FlashSale(1000VU)');
  console.log('Weight sets: Phase 1-3=STANDARD(80:20), Phase 4=FLASH_SALE(50:50)');

  // Verify API is reachable
  const healthCheck = http.get(`${BASE_URL}/category`);
  if (healthCheck.status !== 200) {
    console.error(`❌ API health check failed! Status: ${healthCheck.status}`);
    console.error(`Response: ${healthCheck.body}`);
  } else {
    console.log('✅ API health check passed');
  }

  return {};
}

export function teardown(data) {
  console.log('=== Load Test Complete ===');
  console.log('Next steps:');
  console.log('  1. python research_experiment/scripts/phase4_metrics_collector.py collect <experiment_name>');
  console.log('  2. Compare results across Baseline / Static / Dynamic experiments');
}
