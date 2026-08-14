/**
 * AdminSettings — the Platform Control Center (/admin/settings).
 *
 * Redesign of the old single-scroll settings form into a console-style
 * hub: category rail + detail panel + live vitals, all driven by the
 * pure-data registry in settingsRegistry.js. Persisted values live in the
 * single settings/global doc (same doc the old page wrote), so every
 * existing consumer — PlatformSettingsContext, MaintenanceBanner,
 * AndroidUpdateBanner, studio feature flags — keeps working unchanged.
 *
 * Structure:
 *   header      — title, global search, health pill, config actions
 *   stat strip  — live platform vitals (useControlCenterData)
 *   rail        — grouped categories with search-match badges
 *   panel       — the selected category's sections (fields) + deep links
 *   overview    — insights (deterministic, from real numbers) + audit feed
 *   save bar    — sticky when there are unsaved changes (Ctrl/Cmd+S saves)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { doc, getDoc, increment, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { useAuth } from '../../../contexts/AuthContext'
import Button from '../../../shared/components/Button'
import Icon from '../../../shared/components/Icon'
import Skeleton from '../../../shared/components/Skeleton'
import ConfirmDialog from '../../../shared/components/ConfirmDialog'
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BeakerIcon,
  Bell,
  BookOpen,
  Bot,
  CheckCircleIcon,
  ComputerDesktop,
  CreditCard,
  Download,
  FolderOpen,
  Globe,
  Info,
  LayoutDashboard,
  Plus,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Undo2,
  Upload,
  Users,
  X,
} from '../../../shared/components/icons'
import { SETTINGS_GROUPS } from '../lib/settingsRegistry.js'
import {
  buildDefaults,
  denormalizeForSave,
  deriveInsights,
  diffKeys,
  exportConfig,
  filterCategories,
  getPath,
  normalizeSettings,
  setPath,
  validateImport,
} from '../lib/settingsCore.js'
import ControlCenterField from '../components/ControlCenterField'
import useControlCenterData from '../lib/useControlCenterData'

// Registry stays JSX-free, so icon names resolve here.
const CATEGORY_ICONS = {
  dashboard: LayoutDashboard,
  settings: Settings,
  userPlus: Plus,
  users: Users,
  bot: Bot,
  book: BookOpen,
  folder: FolderOpen,
  card: CreditCard,
  bell: Bell,
  globe: Globe,
  device: ComputerDesktop,
  shield: ShieldCheck,
  beaker: BeakerIcon,
}

const INSIGHT_TONES = {
  good: { icon: CheckCircleIcon, chip: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-800' },
  info: { icon: Info, chip: 'bg-blue-50 border-blue-200', text: 'text-blue-800' },
  warn: { icon: AlertTriangle, chip: 'bg-amber-50 border-amber-200', text: 'text-amber-800' },
  alert: { icon: AlertCircle, chip: 'bg-red-50 border-red-200', text: 'text-red-800' },
}

function fmtNum(v) {
  return v == null ? '—' : Number(v).toLocaleString('en-GB')
}
function fmtUsd(v) {
  return v == null ? '—' : `$${Number(v).toFixed(2)}`
}
function fmtWhen(ts) {
  if (!ts) return '—'
  try {
    const d = typeof ts?.toDate === 'function' ? ts.toDate() : new Date(ts)
    if (Number.isNaN(d.getTime?.())) return '—'
    return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return '—'
  }
}

export default function AdminSettings() {
  const { currentUser, userProfile } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: vitals, loading: vitalsLoading } = useControlCenterData()

  const [baseline, setBaseline] = useState(null)
  const [form, setForm] = useState(null)
  const [meta, setMeta] = useState({ updatedAt: null, updatedByEmail: '', configVersion: 0 })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null) // { tone: 'good'|'alert', text }
  const [search, setSearch] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const historyRef = useRef([])
  const [historyLen, setHistoryLen] = useState(0)
  const importInputRef = useRef(null)

  const section = searchParams.get('section') || 'overview'

  // ── load ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const snap = await getDoc(doc(db, 'settings', 'global'))
        if (cancelled) return
        const raw = snap.exists() ? snap.data() : {}
        const normalized = normalizeSettings(raw)
        setBaseline(normalized)
        setForm(normalized)
        setMeta({
          updatedAt: raw.updatedAt || null,
          updatedByEmail: raw.updatedByEmail || '',
          configVersion: Number(raw.configVersion) || 0,
        })
      } catch (e) {
        console.error('settings load:', e)
        if (!cancelled) setNotice({ tone: 'alert', text: `Could not load settings: ${e.message || e}` })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const changedKeys = useMemo(
    () => (baseline && form ? diffKeys(baseline, form) : []),
    [baseline, form],
  )
  const dirty = changedKeys.length > 0

  // ── edits ────────────────────────────────────────────────────────────
  const setField = useCallback((key, value) => {
    setForm((f) => {
      historyRef.current = [...historyRef.current.slice(-49), f]
      setHistoryLen(historyRef.current.length)
      return setPath(f, key, value)
    })
    setNotice(null)
  }, [])

  const undo = useCallback(() => {
    const prev = historyRef.current.pop()
    setHistoryLen(historyRef.current.length)
    if (prev) setForm(prev)
  }, [])

  const discard = useCallback(() => {
    historyRef.current = []
    setHistoryLen(0)
    setForm(baseline)
    setNotice(null)
  }, [baseline])

  // ── save ─────────────────────────────────────────────────────────────
  const save = useCallback(async () => {
    if (!form) return
    setSaving(true)
    setNotice(null)
    try {
      await setDoc(doc(db, 'settings', 'global'), {
        ...denormalizeForSave(form),
        updatedAt: serverTimestamp(),
        updatedBy: currentUser?.uid || null,
        updatedByEmail: currentUser?.email || '',
        configVersion: increment(1),
      }, { merge: true })
      historyRef.current = []
      setHistoryLen(0)
      setBaseline(form)
      setMeta((m) => ({
        updatedAt: new Date(),
        updatedByEmail: currentUser?.email || '',
        configVersion: (m.configVersion || 0) + 1,
      }))
      setNotice({ tone: 'good', text: 'Settings saved — changes apply immediately to every connected client.' })
    } catch (err) {
      setNotice({ tone: 'alert', text: `Could not save: ${err.message || err}` })
    } finally {
      setSaving(false)
    }
  }, [form, currentUser])

  // Ctrl/Cmd+S saves, matching every editor surface admins already use.
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        if (dirty && !saving) save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dirty, saving, save])

  // Warn before the tab closes with unsaved changes.
  useEffect(() => {
    if (!dirty) return undefined
    function onBeforeUnload(e) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  // ── import / export / reset ──────────────────────────────────────────
  function handleExport() {
    const payload = exportConfig(form, {
      exportedAt: new Date().toISOString(),
      exportedBy: currentUser?.email || null,
    })
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'zedexams-platform-config.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleImportFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result))
        const { values, applied, errors } = validateImport(parsed, form)
        if (applied.length) {
          historyRef.current = [...historyRef.current.slice(-49), form]
          setHistoryLen(historyRef.current.length)
          setForm(values)
        }
        setNotice({
          tone: errors.length && !applied.length ? 'alert' : 'good',
          text: [
            applied.length ? `Imported ${applied.length} setting${applied.length === 1 ? '' : 's'} — review and Save to apply.` : '',
            errors.length ? `Skipped: ${errors.join('; ')}` : '',
          ].filter(Boolean).join(' '),
        })
      } catch {
        setNotice({ tone: 'alert', text: 'Import failed: not valid JSON.' })
      }
    }
    reader.readAsText(file)
  }

  function resetToDefaults() {
    historyRef.current = [...historyRef.current.slice(-49), form]
    setHistoryLen(historyRef.current.length)
    setForm(buildDefaults())
    setConfirmReset(false)
    setNotice({ tone: 'good', text: 'Defaults staged — nothing is applied until you Save.' })
  }

  // ── search + selection ───────────────────────────────────────────────
  const filtered = useMemo(() => filterCategories(search), [search])
  const searching = search.trim().length > 0

  const active = useMemo(
    () => filtered.find((f) => f.category.id === section) || filtered[0] || null,
    [filtered, section],
  )

  // While searching, keep the selection on a category that has matches.
  useEffect(() => {
    if (searching && filtered.length && !filtered.some((f) => f.category.id === section)) {
      setSearchParams({ section: filtered[0].category.id }, { replace: true })
    }
  }, [searching, filtered, section, setSearchParams])

  const selectCategory = useCallback((id) => {
    setSearchParams(id === 'overview' ? {} : { section: id }, { replace: true })
  }, [setSearchParams])

  const insights = useMemo(
    () => (form ? deriveInsights(form, vitals) : []),
    [form, vitals],
  )

  if (loading || !form) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
        </div>
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    )
  }

  const health = vitals.health
  const healthPill = health == null
    ? { dot: '#9ca3af', label: 'No health signal yet', title: 'Marshal posts a company-health check every hour.' }
    : health.healthy
      ? { dot: '#16a34a', label: 'Healthy', title: health.summary || 'All monitored systems reporting fine.' }
      : { dot: '#dc2626', label: 'Needs attention', title: health.summary || 'Marshal flagged an issue.' }

  return (
    <div className="space-y-5">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-eyebrow">Control Center</p>
            <h1 className="text-display-lg theme-text mt-1">Platform settings</h1>
            <p className="theme-text-muted text-body-sm mt-1.5 max-w-2xl">
              Manage the entire ZedExams platform from one place. Changes apply live to every connected client.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-2 rounded-full border theme-border px-3 py-1.5 text-xs font-black theme-card"
              title={healthPill.title}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: healthPill.dot }} />
              {healthPill.label}
            </span>
            <Button as={Link} to="/admin/activity" variant="secondary" size="sm" leadingIcon={<Icon as={ShieldCheck} size="sm" />}>
              View logs
            </Button>
            <Button variant="secondary" size="sm" onClick={handleExport} leadingIcon={<Icon as={Download} size="sm" />}>
              Export
            </Button>
            <Button variant="secondary" size="sm" onClick={() => importInputRef.current?.click()} leadingIcon={<Icon as={Upload} size="sm" />}>
              Import
            </Button>
            <input ref={importInputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleImportFile} />
            <Button variant="ghost" size="sm" onClick={() => setConfirmReset(true)} leadingIcon={<Icon as={RotateCcw} size="sm" />}>
              Reset
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1 sm:max-w-md">
            <Icon as={Search} size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 theme-text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search settings… (registration, AI, maintenance, android)"
              className="theme-input w-full rounded-xl border theme-border py-2 pl-9 pr-9 text-sm"
              aria-label="Search settings"
            />
            {searching && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 theme-text-muted hover:theme-text"
                aria-label="Clear search"
              >
                <Icon as={X} size="sm" />
              </button>
            )}
          </div>
          <p className="text-xs theme-text-muted">
            Last saved {fmtWhen(meta.updatedAt)}
            {meta.updatedByEmail ? ` · by ${meta.updatedByEmail}` : ''}
            {meta.configVersion ? ` · v${meta.configVersion}` : ''}
            {userProfile?.role ? ` · you are ${userProfile.role === 'superAdmin' ? 'a super admin' : 'an admin'}` : ''}
          </p>
        </div>
      </div>

      {notice && (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm font-bold ${notice.tone === 'good' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}
          role="status"
        >
          {notice.text}
        </div>
      )}

      {/* ── Vitals strip ───────────────────────────────────────────── */}
      <StatStrip vitals={vitals} loading={vitalsLoading} androidBuild={form.androidLatestBuild} />

      {/* ── Rail + detail ──────────────────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-[230px_minmax(0,1fr)] xl:grid-cols-[230px_minmax(0,1fr)_320px]">
        <CategoryRail filtered={filtered} activeId={active?.category.id} onSelect={selectCategory} searching={searching} />

        <div className="min-w-0 space-y-5">
          {active ? (
            active.category.special === 'overview' ? (
              <OverviewPanel insights={insights} vitals={vitals} onSelect={selectCategory} />
            ) : (
              <CategoryPanel
                entry={active}
                form={form}
                changedKeys={changedKeys}
                onChange={setField}
              />
            )
          ) : (
            <div className="rounded-2xl border theme-border p-8 text-center text-sm theme-text-muted">
              Nothing matches “{search}”. Try “registration”, “maintenance”, “AI” or “android”.
            </div>
          )}
        </div>

        {/* Insights rail — desktop only, hidden on overview (it renders them inline). */}
        {active?.category.special !== 'overview' && (
          <div className="hidden xl:block space-y-5">
            <InsightsCard insights={insights} onSelect={selectCategory} compact />
            <ActivityCard rows={vitals.audit} compact />
          </div>
        )}
      </div>

      {/* ── Sticky save bar ────────────────────────────────────────── */}
      {dirty && (
        <div className="fixed inset-x-3 bottom-3 z-40 md:left-[17.5rem] md:right-8">
          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 px-4 py-3 shadow-elev-xl backdrop-blur"
            style={{ background: 'rgba(255,255,255,0.96)', borderColor: '#0F1B2D' }}
          >
            <p className="text-sm font-black theme-text">
              {changedKeys.length} unsaved change{changedKeys.length === 1 ? '' : 's'}
              <span className="ml-2 hidden text-xs font-bold theme-text-muted sm:inline">Ctrl+S to save</span>
            </p>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={undo} disabled={!historyLen} leadingIcon={<Icon as={Undo2} size="sm" />}>
                Undo
              </Button>
              <Button variant="secondary" size="sm" onClick={discard}>
                Discard
              </Button>
              <Button variant="primary" size="sm" onClick={save} loading={saving}>
                Save changes
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmReset}
        title="Reset all settings to defaults?"
        message="Every setting in the registry goes back to its default value. Nothing is written until you press Save, so you can still review or discard."
        confirmLabel="Stage defaults"
        onConfirm={resetToDefaults}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  )
}

// ── Vitals strip ─────────────────────────────────────────────────────

function StatStrip({ vitals, loading, androidBuild }) {
  const cards = [
    { label: 'Users', value: fmtNum(vitals.users), icon: Users, tint: '#eff6ff', color: '#2563eb', to: '/admin/users' },
    { label: 'Learners', value: fmtNum(vitals.learners), icon: Users, tint: '#fcf7f3', color: '#c5613f', to: '/admin/learners' },
    { label: 'Teachers', value: fmtNum(vitals.teachers), icon: Users, tint: '#ecfdf5', color: '#059669', to: '/admin/teachers' },
    { label: 'AI spend today', value: fmtUsd(vitals.aiTodayUsd), icon: Sparkles, tint: '#f5f3ff', color: 'var(--zt-text)', to: '/admin/ai-costs' },
    { label: 'AI spend · 30d', value: fmtUsd(vitals.aiMonthUsd), icon: TrendingUp, tint: '#f5f3ff', color: 'var(--zt-text)', to: '/admin/ai-costs' },
    { label: 'Pending payments', value: fmtNum(vitals.pendingPayments), icon: CreditCard, tint: '#fefce8', color: '#ca8a04', to: '/admin/payments' },
    { label: 'Agent queue', value: fmtNum(vitals.agentQueue), icon: Bot, tint: '#eff6ff', color: '#2563eb', to: '/admin/agents' },
    { label: 'Android build', value: androidBuild ? `v${androidBuild}` : '—', icon: ComputerDesktop, tint: '#f0fdf4', color: '#16a34a', to: '/admin/settings?section=android' },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
      {cards.map((c) => (
        <Link
          key={c.label}
          to={c.to}
          className="theme-card group rounded-2xl border theme-border p-3 no-underline transition-all duration-fast hover:-translate-y-0.5 hover:shadow-elev-md"
        >
          <span className="grid h-8 w-8 place-items-center rounded-xl" style={{ background: c.tint, color: c.color }}>
            <Icon as={c.icon} size="sm" />
          </span>
          {loading ? (
            <Skeleton className="mt-2 h-6 w-16" />
          ) : (
            <p className="mt-2 truncate text-lg font-black theme-text">{c.value}</p>
          )}
          <p className="truncate text-[11px] font-bold uppercase tracking-wide theme-text-muted">{c.label}</p>
        </Link>
      ))}
    </div>
  )
}

// ── Category rail ────────────────────────────────────────────────────

function CategoryRail({ filtered, activeId, onSelect, searching }) {
  const byGroup = SETTINGS_GROUPS
    .map((group) => ({ group, entries: filtered.filter((f) => f.category.group === group.id) }))
    .filter((g) => g.entries.length)

  return (
    <>
      {/* Mobile: horizontal chip scroller */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:hidden">
        {filtered.map(({ category, matches }) => (
          <button
            key={category.id}
            type="button"
            onClick={() => onSelect(category.id)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-black transition-colors ${activeId === category.id ? 'admin-game-nav-active theme-border' : 'theme-card theme-border theme-text-muted'}`}
          >
            <Icon as={CATEGORY_ICONS[category.icon] || Settings} size="xs" />
            {category.label}
            {searching && matches > 0 && <span className="rounded-full bg-black/10 px-1.5 text-[10px]">{matches}</span>}
          </button>
        ))}
      </div>

      {/* Desktop rail */}
      <nav className="hidden lg:block">
        <div className="theme-card sticky top-4 rounded-2xl border theme-border p-2">
          {byGroup.map(({ group, entries }) => (
            <div key={group.id} className="mb-1">
              <p className="px-3 pb-1 pt-3 text-[10px] font-black uppercase tracking-[0.14em] theme-text-muted">{group.label}</p>
              {entries.map(({ category, matches }) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => onSelect(category.id)}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-extrabold transition-all duration-fast ${activeId === category.id ? 'admin-game-nav-active' : 'theme-text-muted hover:theme-bg-subtle hover:theme-text'}`}
                >
                  <Icon as={CATEGORY_ICONS[category.icon] || Settings} size="sm" />
                  <span className="flex-1 truncate">{category.label}</span>
                  {searching && matches > 0 && (
                    <span className="rounded-full px-1.5 text-[10px] font-black" style={{ background: '#D97757', color: '#fff' }}>
                      {matches}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      </nav>
    </>
  )
}

// ── Category detail panel ────────────────────────────────────────────

function CategoryPanel({ entry, form, changedKeys, onChange }) {
  const { category, sections, links } = entry
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black theme-text">{category.label}</h2>
        <p className="mt-0.5 text-sm theme-text-muted">{category.blurb}</p>
      </div>

      {sections.map((section) => (
        <section key={section.id} className="theme-card rounded-2xl border theme-border p-5 shadow-elev-sm">
          <h3 className="text-sm font-black uppercase tracking-wider theme-text">{section.title}</h3>
          {section.description && <p className="mt-1 text-xs theme-text-muted">{section.description}</p>}
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {section.fields.map((field) => (
              <div key={field.key} className={field.type === 'textarea' || field.type === 'toggle' || field.type === 'segmented' ? 'md:col-span-2' : ''}>
                <ControlCenterField
                  field={field}
                  value={getPath(form, field.key)}
                  changed={changedKeys.includes(field.key)}
                  onChange={(v) => onChange(field.key, v)}
                />
              </div>
            ))}
          </div>
        </section>
      ))}

      {links.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-black uppercase tracking-wider theme-text-muted">
            {sections.length ? 'Related tools' : 'Tools'}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {links.map((link) => (
              <Link
                key={link.to + link.label}
                to={link.to}
                className="theme-card group flex items-center justify-between gap-3 rounded-2xl border theme-border p-4 no-underline transition-all duration-fast hover:-translate-y-0.5 hover:shadow-elev-md"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-black theme-text">{link.label}</span>
                  {link.description && <span className="mt-0.5 block truncate text-xs theme-text-muted">{link.description}</span>}
                </span>
                <Icon as={ArrowRight} size="sm" className="shrink-0 theme-text-muted transition-transform duration-fast group-hover:translate-x-0.5" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ── Overview: insights + activity ────────────────────────────────────

function OverviewPanel({ insights, vitals, onSelect }) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black theme-text">Dashboard</h2>
        <p className="mt-0.5 text-sm theme-text-muted">
          Live vitals above, alerts and the latest admin activity below. Every number is read straight from Firestore.
        </p>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <InsightsCard insights={insights} onSelect={onSelect} />
        <ActivityCard rows={vitals.audit} />
      </div>
    </div>
  )
}

function InsightsCard({ insights, onSelect, compact = false }) {
  return (
    <section className="theme-card rounded-2xl border theme-border p-4 shadow-elev-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="inline-flex items-center gap-2 text-sm font-black theme-text">
          <Icon as={Sparkles} size="sm" className="theme-accent-text" />
          Insights & alerts
        </h3>
      </div>
      <div className="space-y-2">
        {insights.slice(0, compact ? 4 : 8).map((ins) => {
          const tone = INSIGHT_TONES[ins.tone] || INSIGHT_TONES.info
          return (
            <div key={ins.id} className={`flex items-start gap-2.5 rounded-xl border p-3 ${tone.chip}`}>
              <Icon as={tone.icon} size="sm" className={`mt-0.5 shrink-0 ${tone.text}`} />
              <div className="min-w-0 flex-1">
                <p className={`text-xs font-bold ${tone.text}`}>{ins.text}</p>
                {ins.action && (
                  ins.action.to ? (
                    <Link to={ins.action.to} className={`mt-1 inline-flex items-center gap-1 text-xs font-black underline ${tone.text}`}>
                      {ins.action.label}
                      <Icon as={ArrowRight} size="xs" />
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelect(ins.action.category)}
                      className={`mt-1 inline-flex items-center gap-1 text-xs font-black underline ${tone.text}`}
                    >
                      {ins.action.label}
                      <Icon as={ArrowRight} size="xs" />
                    </button>
                  )
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function ActivityCard({ rows = [], compact = false }) {
  return (
    <section className="theme-card rounded-2xl border theme-border p-4 shadow-elev-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="inline-flex items-center gap-2 text-sm font-black theme-text">
          <Icon as={ShieldCheck} size="sm" className="theme-accent-text" />
          Recent activity
        </h3>
        <Link to="/admin/activity" className="text-xs font-black theme-accent-text underline">View all</Link>
      </div>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-xs theme-text-muted">
          No audit entries yet — sensitive admin actions land here.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.slice(0, compact ? 5 : 8).map((r) => (
            <li key={r.id} className="flex items-start gap-2.5 rounded-xl border theme-border p-2.5">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: '#D97757' }} />
              <div className="min-w-0">
                <p className="truncate text-xs font-bold theme-text">
                  {r.actorEmail || r.actorUid || 'System'}
                  <span className="font-normal theme-text-muted"> — {r.action || 'action'}</span>
                </p>
                <p className="text-[11px] theme-text-muted">{fmtWhen(r.createdAt)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
