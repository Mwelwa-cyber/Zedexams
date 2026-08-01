import { describe, it, expect, vi, beforeEach } from 'vitest'

// The real plugin never loads in jsdom; these mocks stand in for the Play
// Billing surface fetchPlayProducts talks to.
const isBillingSupported = vi.fn()
const getProducts = vi.fn()
vi.mock('@capgo/native-purchases', () => ({
  NativePurchases: {
    isBillingSupported: (...a) => isBillingSupported(...a),
    getProducts: (...a) => getProducts(...a),
  },
  PURCHASE_TYPE: { SUBS: 'subs' },
}))
vi.mock('../firebase/config', () => ({ default: {} }))
vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: () => vi.fn(),
}))
vi.mock('./analytics', () => ({ capture: vi.fn() }))

import { fetchPlayProducts } from './playBilling'
import { capture } from './analytics'

// Android subs report the PRODUCT id on planIdentifier (inverted from what the
// name suggests) — build fixtures the way the plugin really does, or the test
// would pass against a shape production never sees.
const playProduct = (productId, basePlanId) => ({
  planIdentifier: productId,
  identifier: basePlanId,
  priceString: 'K50.00',
  price: 50,
  title: productId,
})

describe('fetchPlayProducts — catalogue shortfall reporting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isBillingSupported.mockResolvedValue({ isBillingSupported: true })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('reports nothing when Play returns every requested product', async () => {
    getProducts.mockResolvedValue({
      products: [
        playProduct('learner_premium_weekly', 'weekly'),
        playProduct('learner_premium_monthly', 'monthly'),
      ],
    })

    const out = await fetchPlayProducts(['weekly', 'monthly'])

    expect(out).toHaveLength(2)
    expect(capture).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
  })

  it('still returns the products Play DID serve when some are missing', async () => {
    // A partial catalogue must keep selling — reporting the gap must not
    // become a new way to break the upgrade panel.
    getProducts.mockResolvedValue({
      products: [playProduct('teacher_pro_monthly', 'monthly')],
    })

    const out = await fetchPlayProducts(['pro_monthly', 'pro_yearly'])

    expect(out).toHaveLength(1)
    expect(out[0].planId).toBe('pro_monthly')
    expect(out[0].priceString).toBe('K50.00')
  })

  it('fires play_products_missing naming the plans Play did not return', async () => {
    getProducts.mockResolvedValue({
      products: [playProduct('teacher_pro_monthly', 'monthly')],
    })

    await fetchPlayProducts(['pro_monthly', 'pro_yearly', 'max_monthly'])

    expect(capture).toHaveBeenCalledTimes(1)
    const [event, props] = capture.mock.calls[0]
    expect(event).toBe('play_products_missing')
    expect(props.missingPlanIds).toBe('pro_yearly,max_monthly')
    expect(props.missingProductIds).toBe('teacher_pro_yearly,teacher_max_monthly')
    expect(props.missingCount).toBe(2)
    expect(props.requestedCount).toBe(3)
    expect(props.returnedCount).toBe(1)
    expect(props.empty).toBe(false)
  })

  it('logs the shortfall at error level so a device test surfaces it', async () => {
    getProducts.mockResolvedValue({ products: [] })

    await fetchPlayProducts(['pro_monthly'])

    expect(console.error).toHaveBeenCalledTimes(1)
    const line = String(console.error.mock.calls[0][0])
    expect(line).toContain('teacher_pro_monthly')
    expect(line).toContain('Play Console')
  })

  it('distinguishes an empty catalogue from a partial one', async () => {
    getProducts.mockResolvedValue({ products: [] })

    await fetchPlayProducts(['weekly', 'monthly'])

    expect(capture.mock.calls[0][1].empty).toBe(true)
  })

  it('does not report when billing is unavailable — that is a different failure', async () => {
    // Reporting a catalogue shortfall on a device with no Play Store would
    // bury the real signal under noise from every unsupported device.
    isBillingSupported.mockResolvedValue({ isBillingSupported: false })

    await expect(fetchPlayProducts(['monthly'])).rejects.toThrow(/not available/i)
    expect(capture).not.toHaveBeenCalled()
  })

  it('does not report for a request with no Play-mapped plans', async () => {
    // Grade packs and the top-up have no Play products by design; they exit
    // before Play is ever queried, so there is no shortfall to announce.
    await fetchPlayProducts(['grade_pack_7'])

    expect(getProducts).not.toHaveBeenCalled()
    expect(capture).not.toHaveBeenCalled()
  })
})
