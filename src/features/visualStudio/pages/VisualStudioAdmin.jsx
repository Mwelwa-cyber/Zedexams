/* Admin — Visual Studio (brief item 13): moderate teacher visuals
   (approve / reject / delete) and read the estimated AI image-cost report.
   Route /admin/visuals, admin-gated. Teacher-submitted SHARED pictures arrive
   in the Picture Bank "Needs tagging" queue (PictureBankAdmin); this page is
   for teacher-owned visualAssets oversight + cost. */

import { useCallback, useEffect, useState } from 'react'
import PageHeader from '../../../components/ui/PageHeader'
import SeoHelmet from '../../../components/seo/SeoHelmet'
import {
  listAllVisualAssets, moderateVisualAsset, deleteVisualAsset,
} from '../services/visualAssetService'
import { fetchImageCostReport } from '../lib/visualCostReport'

const STATUS_PATCH = {
  approve: { status: 'approved', visibility: 'public' },
  reject: { status: 'rejected', visibility: 'private' },
  hide: { status: 'draft', visibility: 'private' },
}

function StatCard({ label, value, sub }) {
  return (
    <div className="theme-card theme-border" style={{ border: '1px solid', borderRadius: 14, padding: 16, minWidth: 150 }}>
      <div style={{ fontSize: 24, fontWeight: 800 }}>{value}</div>
      <div className="theme-text-muted" style={{ fontSize: 12 }}>{label}</div>
      {sub && <div className="theme-text-muted" style={{ fontSize: 11, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

export default function VisualStudioAdmin() {
  const [costs, setCosts] = useState(null)
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [c, a] = await Promise.all([
      fetchImageCostReport({ max: 500 }),
      listAllVisualAssets({ max: 200 }),
    ])
    setCosts(c)
    setAssets(a)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  async function moderate(asset, action) {
    setBusyId(asset.id)
    setMsg('')
    try {
      await moderateVisualAsset(asset.id, action)
      setAssets((prev) => prev.map((x) => (x.id === asset.id ? { ...x, ...STATUS_PATCH[action] } : x)))
      setMsg(`Visual ${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'hidden'}.`)
    } catch (e) {
      setMsg(e?.message || 'Could not update.')
    } finally {
      setBusyId('')
    }
  }

  async function remove(asset) {
    if (typeof window !== 'undefined' && !window.confirm(`Delete "${asset.title}"? This cannot be undone.`)) return
    setBusyId(asset.id)
    setMsg('')
    try {
      await deleteVisualAsset(asset)
      setAssets((prev) => prev.filter((x) => x.id !== asset.id))
      setMsg('Deleted.')
    } catch (e) {
      setMsg(e?.message || 'Could not delete.')
    } finally {
      setBusyId('')
    }
  }

  return (
    <div className="min-h-full" style={{ backgroundColor: '#FAFAF7' }}>
      <SeoHelmet title="Visual Studio admin" noIndex />
      <main className="max-w-6xl mx-auto px-5 py-8">
        <PageHeader
          eyebrow="Admin"
          title="Visual Studio"
          description="Moderate teacher visuals and track estimated AI image costs."
        />

        {msg && <p className="theme-text" style={{ fontSize: 13, margin: '8px 0' }}>{msg}</p>}

        {/* cost report */}
        <section style={{ marginTop: 12 }}>
          <h2 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 10px' }}>AI image costs (estimated)</h2>
          {loading || !costs ? (
            <p className="theme-text-muted" style={{ fontSize: 13 }}>Loading…</p>
          ) : costs.error ? (
            <p style={{ fontSize: 13, color: '#92400e' }}>⚠ {costs.error}</p>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <StatCard label="Images generated" value={costs.total} sub={`last ${costs.sampled} log rows`} />
                <StatCard label="Estimated spend" value={`$${costs.totalCost.toFixed(2)}`} />
                <StatCard label="Teachers" value={costs.byTeacher.length} />
              </div>
              {costs.byGenerator.length > 0 && (
                <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div>
                    <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 6px' }}>By provider</h3>
                    {costs.byGenerator.map((g) => (
                      <div key={g.generator} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '4px 0', borderBottom: '1px solid #eee' }}>
                        <span>{g.generator}</span><span>{g.count} · ${g.cost.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 6px' }}>Top teachers</h3>
                    {costs.byTeacher.slice(0, 8).map((t) => (
                      <div key={t.uid} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '4px 0', borderBottom: '1px solid #eee' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{t.uid}</span>
                        <span>{t.count} · ${t.cost.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        {/* visuals moderation */}
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 10px' }}>
            Teacher visuals {assets.length ? `(${assets.length})` : ''}
          </h2>
          {loading ? (
            <p className="theme-text-muted" style={{ fontSize: 13 }}>Loading…</p>
          ) : assets.length === 0 ? (
            <p className="theme-text-muted" style={{ fontSize: 13 }}>No saved visuals yet.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 14 }}>
              {assets.map((a) => (
                <div key={a.id} className="theme-card theme-border" style={{ border: '1px solid', borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ height: 130, background: '#f7faf6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {a.imageUrl
                      ? <img src={a.thumbnailUrl || a.imageUrl} alt={a.title} crossOrigin="anonymous" loading="lazy" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                      : <span className="theme-text-muted" style={{ fontSize: 12 }}>No image</span>}
                  </div>
                  <div style={{ padding: 10 }}>
                    <b style={{ fontSize: 13, display: 'block', lineHeight: 1.3 }}>{a.title}</b>
                    <span className="theme-text-muted" style={{ fontSize: 11 }}>
                      {[a.subject, a.grade ? `Grade ${a.grade}` : '', a.status].filter(Boolean).join(' · ')}
                    </span>
                    <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {a.safetyStatus === 'flagged' && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 999, background: '#fcf7f3', color: '#92400e' }}>Flagged</span>}
                      {a.visibility === 'public' && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 999, background: '#e6f0ec', color: '#16544a' }}>Public</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, padding: 8, borderTop: '1px solid #eee', flexWrap: 'wrap' }}>
                    <button type="button" disabled={busyId === a.id} onClick={() => moderate(a, 'approve')} style={btn('#16a34a')}>Approve</button>
                    <button type="button" disabled={busyId === a.id} onClick={() => moderate(a, 'reject')} style={btn('#b7791f')}>Reject</button>
                    <button type="button" disabled={busyId === a.id} onClick={() => remove(a)} style={btn('#b42318')}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function btn(color) {
  return {
    flex: 1, minWidth: 64, border: `1px solid ${color}`, color, background: 'var(--zt-card)',
    borderRadius: 8, padding: '6px 8px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
  }
}
