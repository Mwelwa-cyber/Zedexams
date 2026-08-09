/**
 * Human-readable renderers for an agentJobs document's `output`.
 *
 * Every agent writes its result under a single key on `job.output`
 * (`output.till`, `output.echo`, `output.compass`, …); a content-line job
 * carries several (`{ aria, cala, reva }`). Before this module the job
 * detail page rendered only Cala nicely and dumped everything else as raw
 * JSON — the "the agents show me raw output" complaint.
 *
 * `AgentOutput` sniffs which keys are present and routes each to a purpose
 * built card. Cala keeps its existing renderer (CbcAlignmentCard); the
 * ops/growth agents get stat tiles + readable lists; anything unrecognised
 * (a brand-new agent, an odd shape) falls back to `ReadableValue`, which
 * turns any nested object/array into headings, lists, and key/value rows
 * instead of JSON.
 *
 * Deliberately free of Firebase / auth imports so it unit-tests with
 * @testing-library without mocking the SDK.
 */

import { CalaOutput } from './CbcAlignmentCard'

/* ────────────────────────────── helpers ────────────────────────────── */

// camelCase / snake_case / kebab-case → "Title Case". Capitalises the first
// letter of every word but leaves the rest untouched so acronyms (ZMW, KB)
// survive.
export function humanizeKey(key) {
  return String(key)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

const TONES = {
  neutral: 'theme-card theme-border',
  good: 'border-emerald-200 bg-emerald-50',
  warn: 'border-amber-200 bg-amber-50',
  bad: 'border-red-200 bg-red-50',
  info: 'border-sky-200 bg-sky-50',
}

const ITEM_TONES = {
  neutral: 'border theme-border bg-white/60',
  good: 'border border-emerald-200 bg-emerald-50',
  warn: 'border border-amber-200 bg-amber-50',
  bad: 'border border-red-200 bg-red-50',
}

function Card({ tone = 'neutral', title, subtitle, badge, children }) {
  return (
    <section className={`rounded-2xl border p-4 space-y-3 ${TONES[tone] || TONES.neutral}`}>
      {(title || subtitle || badge) && (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <p className="text-sm font-black theme-text">{title}</p>}
            {subtitle && <p className="text-xs theme-text-muted mt-0.5">{subtitle}</p>}
          </div>
          {badge}
        </div>
      )}
      {children}
    </section>
  )
}

function Stat({ label, value, accent }) {
  return (
    <div className="rounded-xl border theme-border bg-white/60 px-3 py-2 text-center">
      <p className="text-[10px] font-black uppercase tracking-wider theme-text-muted">{label}</p>
      <p className={`mt-0.5 text-lg font-black ${accent || 'theme-text'}`}>{value}</p>
    </div>
  )
}

function Pill({ tone = 'neutral', children }) {
  const cls = {
    neutral: 'bg-gray-100 text-gray-600',
    good: 'bg-emerald-100 text-emerald-700',
    warn: 'bg-amber-100 text-amber-800',
    bad: 'bg-red-100 text-red-700',
    info: 'bg-sky-100 text-sky-700',
  }[tone]
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-black whitespace-nowrap ${cls}`}>
      {children}
    </span>
  )
}

function OkPill({ ok }) {
  return <Pill tone={ok ? 'good' : 'bad'}>{ok ? 'OK' : 'Issue'}</Pill>
}

// An object of { label: count } → a row of count chips.
function CountChips({ data }) {
  const entries = Object.entries(data || {}).filter(([, v]) => v != null)
  if (entries.length === 0) {
    return <span className="text-xs theme-text-muted italic">none</span>
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([k, v]) => (
        <span
          key={k}
          className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-bold theme-text"
        >
          <span className="theme-text-muted">{humanizeKey(k)}</span>
          <span className="font-black">{v}</span>
        </span>
      ))}
    </div>
  )
}

function Section({ title, count, children }) {
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-black uppercase tracking-wide theme-text-muted">
        {title}
        {typeof count === 'number' ? ` (${count})` : ''}
      </h4>
      {children}
    </div>
  )
}

// Titled list. Each item is rendered by `render(item)`, defaulting to the
// generic readable object renderer so it never has to be hand-written.
function ItemList({ items, tone = 'neutral', render }) {
  const list = Array.isArray(items) ? items : []
  if (list.length === 0) return null
  return (
    <ul className="space-y-1.5">
      {list.map((it, i) => (
        <li
          key={(it && (it.id || it.paymentId || it.uid || it.generationId)) || i}
          className={`rounded-lg px-3 py-2 text-xs ${ITEM_TONES[tone] || ITEM_TONES.neutral}`}
        >
          {render ? render(it) : <ReadableValue value={it} />}
        </li>
      ))}
    </ul>
  )
}

// Standard "Errors (n)" block — error items vary in shape between agents
// ({stage,message}, {paymentId,stage,message}, …) so render them generically.
function ErrorList({ errors }) {
  const list = Array.isArray(errors) ? errors : []
  if (list.length === 0) return null
  return (
    <Section title="Errors" count={list.length}>
      <ItemList
        items={list}
        tone="bad"
        render={(e) => (
          <div>
            <p className="text-red-800">{e.message || 'Unknown error'}</p>
            {(e.stage || e.paymentId || e.id || e.collection) && (
              <p className="mt-0.5 text-[10px] theme-text-muted">
                {[e.collection, e.id || e.paymentId, e.stage].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
        )}
      />
    </Section>
  )
}

/* ─────────────────── generic readable value renderer ─────────────────── */

function BoolBadge({ value }) {
  return value
    ? <span className="font-black text-emerald-700">Yes</span>
    : <span className="font-black text-red-600">No</span>
}

// Turns any JSON value into readable DOM. Recursion is depth-guarded so a
// pathologically nested draft can't blow the stack; past the guard it falls
// back to a compact <pre>.
export function ReadableValue({ value, depth = 0 }) {
  if (value === null || value === undefined || value === '') {
    return <span className="theme-text-muted italic">—</span>
  }
  if (typeof value === 'boolean') return <BoolBadge value={value} />
  if (typeof value === 'number' || typeof value === 'string') {
    return <span className="theme-text whitespace-pre-wrap break-words">{String(value)}</span>
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="theme-text-muted italic">none</span>
    const allPrimitive = value.every(
      (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v),
    )
    if (allPrimitive) {
      return (
        <ul className="list-inside list-disc space-y-0.5">
          {value.map((v, i) => (
            <li key={i} className="theme-text text-sm"><ReadableValue value={v} depth={depth + 1} /></li>
          ))}
        </ul>
      )
    }
    return (
      <ol className="space-y-2">
        {value.map((v, i) => (
          <li key={i} className="rounded-lg border theme-border bg-white/50 p-2.5">
            <ReadableValue value={v} depth={depth + 1} />
          </li>
        ))}
      </ol>
    )
  }
  if (typeof value === 'object') {
    if (depth > 5) {
      return (
        <pre className="theme-border overflow-x-auto rounded-lg border bg-white/50 p-2 text-[11px]">
          {JSON.stringify(value, null, 2)}
        </pre>
      )
    }
    return <ReadableObject obj={value} depth={depth} />
  }
  return <span className="theme-text">{String(value)}</span>
}

export function ReadableObject({ obj, depth = 0 }) {
  const entries = Object.entries(obj || {}).filter(([, v]) => v !== undefined)
  if (entries.length === 0) return <span className="theme-text-muted italic">—</span>
  return (
    <dl className="space-y-1.5">
      {entries.map(([k, v]) => (
        <div key={k} className="grid grid-cols-1 gap-x-3 gap-y-0.5 sm:grid-cols-[minmax(0,9rem)_1fr]">
          <dt className="pt-0.5 text-[11px] font-black uppercase tracking-wide theme-text-muted">
            {humanizeKey(k)}
          </dt>
          <dd className="min-w-0 text-sm"><ReadableValue value={v} depth={depth + 1} /></dd>
        </div>
      ))}
    </dl>
  )
}

// Labelled, readable panel — used for the job input/brief.
export function ReadablePanel({ label, value }) {
  if (value === undefined || value === null) return null
  return (
    <Card title={label}>
      <ReadableValue value={value} />
    </Card>
  )
}

/* ──────────────────────────── per-agent cards ───────────────────────── */

// Aria — the generated draft (matches a teacherTools schema). The draft is
// the reviewed artifact, so render it readably; the rest is provenance.
function AriaCard({ value }) {
  if (!value || typeof value !== 'object') return null
  const { draft, generationId, modelUsed } = value
  const title = draft && typeof draft === 'object' ? (draft.title || draft.name) : null
  const meta = [modelUsed, generationId && `gen ${String(generationId).slice(0, 8)}`]
    .filter(Boolean)
    .join(' · ')
  return (
    <Card title={`Generated draft${title ? ` — ${title}` : ''}`} subtitle={meta || undefined}>
      {draft
        ? <ReadableValue value={draft} />
        : <p className="text-xs theme-text-muted italic">No draft on this job.</p>}
    </Card>
  )
}

// Reva — content review verdict + suggested edits.
function RevaCard({ value }) {
  if (!value || typeof value !== 'object') return null
  const { verdict, severity, summary, edits = [] } = value
  const tone = verdict === 'approve' ? 'good' : verdict === 'reject' ? 'bad' : 'warn'
  const verdictLabel = { approve: 'Approve', revise: 'Revise', reject: 'Reject' }[verdict] || verdict || '—'
  const editList = Array.isArray(edits) ? edits : []
  return (
    <Card
      tone={tone}
      title={`Content review — ${verdictLabel}`}
      badge={severity ? <Pill tone={tone}>{humanizeKey(severity)} severity</Pill> : null}
    >
      {summary && <p className="text-sm theme-text">{summary}</p>}
      {editList.length > 0 && (
        <Section title="Suggested edits" count={editList.length}>
          <ItemList
            items={editList}
            tone="warn"
            render={(e) => (
              <div className="space-y-0.5">
                {e.where && <p className="text-[11px] font-black text-amber-900">{e.where}</p>}
                {e.suggestion && <p className="theme-text">{e.suggestion}</p>}
                {e.reason && <p className="theme-text-muted italic">{e.reason}</p>}
              </div>
            )}
          />
        </Section>
      )}
    </Card>
  )
}

// Vigil — hourly site health check.
function VigilCard({ value }) {
  if (!value || typeof value !== 'object') return null
  const { ok, hasCritical, counts = {}, checks = {}, failures = [] } = value
  const tone = ok ? 'good' : hasCritical ? 'bad' : 'warn'
  const failList = Array.isArray(failures) ? failures : []
  const surfaces = [
    ['Pages', checks.pages],
    ['Firebase', checks.firebase],
    ['Images', checks.images],
    ['Quizzes', checks.quizzes],
  ].filter(([, c]) => c && typeof c === 'object')
  return (
    <Card
      tone={tone}
      title={`Site health check — ${ok ? 'all clear' : `${counts.total || failList.length} issue${(counts.total || failList.length) === 1 ? '' : 's'}`}`}
      subtitle={value.ranAt ? `Ran ${value.ranAt}` : undefined}
    >
      {surfaces.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {surfaces.map(([label, c]) => (
            <span key={label} className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-bold theme-text">
              {label}
              <OkPill ok={c.ok} />
            </span>
          ))}
        </div>
      )}
      {failList.length > 0 && (
        <Section title="Failures" count={failList.length}>
          <ItemList
            items={failList}
            tone="bad"
            render={(f) => (
              <div>
                <div className="flex items-center gap-2">
                  <Pill tone={f.severity === 'critical' ? 'bad' : 'warn'}>{f.severity || 'issue'}</Pill>
                  <span className="text-[10px] font-black uppercase tracking-wide theme-text-muted">{f.check}</span>
                </div>
                <p className="mt-1 theme-text">{f.message}</p>
                {f.id && <p className="mt-0.5 text-[10px] theme-text-muted break-all">{f.id}</p>}
              </div>
            )}
          />
        </Section>
      )}
    </Card>
  )
}

// Till — payment reconciliation sweep.
function TillCard({ value }) {
  if (!value || typeof value !== 'object') return null
  const {
    checked = 0, recovered = [], failedClosed = [], stillPending = 0,
    skippedTooNew = 0, errors = [], skipped,
  } = value
  const rec = Array.isArray(recovered) ? recovered : []
  const failed = Array.isArray(failedClosed) ? failedClosed : []
  const clean = rec.length === 0 && (Array.isArray(errors) ? errors.length : 0) === 0
  return (
    <Card
      tone={rec.length > 0 ? 'good' : 'neutral'}
      title="Payment reconciliation — Lenco"
      subtitle={clean ? 'No stuck Lenco payments needed recovery.' : `${rec.length} buyer${rec.length === 1 ? '' : 's'} recovered.`}
    >
      {skipped && (
        <p className="rounded-lg bg-white/60 px-3 py-2 text-xs theme-text-muted">
          Skipped: <span className="font-black theme-text">{humanizeKey(String(skipped))}</span>
        </p>
      )}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        <Stat label="Checked" value={checked} />
        <Stat label="Recovered" value={rec.length} accent={rec.length > 0 ? 'text-emerald-700' : undefined} />
        <Stat label="Still pending" value={stillPending} />
        <Stat label="Failed closed" value={failed.length} accent={failed.length > 0 ? 'text-red-700' : undefined} />
        <Stat label="Too new" value={skippedTooNew} accent="theme-text-muted" />
      </div>
      {rec.length > 0 && (
        <Section title="Recovered" count={rec.length}>
          <ItemList
            items={rec}
            tone="good"
            render={(p) => (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="theme-text">
                  {p.planId ? <span className="font-black">{humanizeKey(String(p.planId))}</span> : 'Payment'}
                  {p.userId && <span className="theme-text-muted"> · {p.userId}</span>}
                </span>
                {p.amountZMW != null && <span className="font-black text-emerald-700">K{p.amountZMW}</span>}
              </div>
            )}
          />
        </Section>
      )}
      <ErrorList errors={errors} />
      {/* Till's sweep covers Lenco only (Play verification failures never
          create a payment doc), so a green card here must not read as "all
          payment channels are healthy" — that misread hid a broken Play
          config while Google was auto-refunding real buyers. */}
      <p className="text-[11px] theme-text-muted">
        Covers Lenco (mobile money + cards) only. Google Play purchases are
        verified separately — Vigil&apos;s hourly site-health check flags Play
        billing problems.
      </p>
    </Card>
  )
}

// Echo — support triage sweep.
function EchoCard({ value }) {
  if (!value || typeof value !== 'object') return null
  const {
    processed = 0, surfacedContact = 0, byKind = {},
    byPriority = {}, highPriority = [], errors = [],
  } = value
  const high = Array.isArray(highPriority) ? highPriority : []
  return (
    <Card
      tone={high.length > 0 ? 'warn' : 'neutral'}
      title="Support triage"
      subtitle={processed === 0 ? 'No new messages to triage.' : `${processed} message${processed === 1 ? '' : 's'} classified and drafted a reply.`}
    >
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        <Stat label="Processed" value={processed} />
        <Stat label="Contact form" value={surfacedContact} />
        <Stat label="High priority" value={byPriority.high || 0} accent={(byPriority.high || 0) > 0 ? 'text-amber-700' : undefined} />
        <Stat label="Normal" value={byPriority.normal || 0} accent="theme-text-muted" />
      </div>
      {Object.keys(byKind).length > 0 && (
        <Section title="By kind">
          <CountChips data={byKind} />
        </Section>
      )}
      {high.length > 0 && (
        <Section title="High priority" count={high.length}>
          <ItemList
            items={high}
            tone="warn"
            render={(h) => (
              <div>
                <div className="flex items-center gap-2">
                  <Pill tone="warn">{h.kind}</Pill>
                  {h.who && <span className="text-[11px] font-black theme-text">{h.who}</span>}
                </div>
                {h.snippet && <p className="mt-1 theme-text-muted">{h.snippet}</p>}
              </div>
            )}
          />
        </Section>
      )}
      <ErrorList errors={errors} />
    </Card>
  )
}

// Compass — weekly "what to build next" backlog.
function CompassCard({ value }) {
  if (!value || typeof value !== 'object') return null
  const {
    sampled = 0, totalAttempts = 0, distinctAreas = 0,
    struggleCount = 0, backlog = [], errors = [],
  } = value
  const list = Array.isArray(backlog) ? backlog : []
  return (
    <Card
      tone="info"
      title="Product signal — what to build next"
      subtitle={list.length === 0 ? 'No areas met the demand threshold this week.' : `${list.length} ranked area${list.length === 1 ? '' : 's'} to expand.`}
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Attempts" value={totalAttempts} />
        <Stat label="Sampled" value={sampled} />
        <Stat label="Areas" value={distinctAreas} />
        <Stat label="Struggling" value={struggleCount} accent={struggleCount > 0 ? 'text-amber-700' : undefined} />
      </div>
      {list.length > 0 && (
        <Section title="Backlog" count={list.length}>
          <ol className="space-y-1.5">
            {list.map((b, i) => (
              <li key={`${b.grade}-${b.subject}-${i}`} className={`rounded-lg px-3 py-2 text-xs ${b.struggle ? ITEM_TONES.warn : ITEM_TONES.neutral}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-black theme-text">
                    {i + 1}. Grade {b.grade || '?'} {b.subject}
                  </span>
                  {b.struggle && <Pill tone="warn">struggling</Pill>}
                </div>
                <p className="mt-0.5 text-[11px] theme-text-muted">
                  {b.attempts} attempts · {b.learners} learners · avg {b.avgPercentage}%
                </p>
                {b.recommendation && <p className="mt-1 theme-text">{b.recommendation}</p>}
              </li>
            ))}
          </ol>
        </Section>
      )}
      <ErrorList errors={errors} />
    </Card>
  )
}

// Anchor — weekly at-risk learner scan.
function AnchorCard({ value }) {
  if (!value || typeof value !== 'object') return null
  const { scanned = 0, atRisk = 0, buckets = {}, sample = [], errors = [] } = value
  const list = Array.isArray(sample) ? sample : []
  return (
    <Card
      tone={atRisk > 0 ? 'warn' : 'neutral'}
      title="Retention scan"
      subtitle={atRisk === 0 ? 'No lapsed-but-recoverable learners found.' : `${atRisk} learner${atRisk === 1 ? '' : 's'} went quiet but are worth winning back.`}
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Scanned" value={scanned} />
        <Stat label="At risk" value={atRisk} accent={atRisk > 0 ? 'text-amber-700' : undefined} />
        <Stat label="Sampled" value={list.length} />
      </div>
      {Object.keys(buckets).length > 0 && (
        <Section title="Days inactive">
          <CountChips data={buckets} />
        </Section>
      )}
      {list.length > 0 && (
        <Section title="Win-back sample" count={list.length}>
          <ItemList
            items={list}
            tone="warn"
            render={(l) => (
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] theme-text-muted truncate">{l.uid || '—'}</span>
                  <Pill tone="warn">{l.daysInactive}d quiet</Pill>
                </div>
                <p className="mt-1 theme-text">
                  {l.examsCompleted} exams · best {l.bestPercentage}% · streak {l.longestStreak}
                </p>
                {l.nudge && <p className="mt-0.5 theme-text-muted italic">{l.nudge}</p>}
              </div>
            )}
          />
        </Section>
      )}
      <ErrorList errors={errors} />
    </Card>
  )
}

// Quill — nightly QA smoke over Firestore.
function QuillCard({ value }) {
  if (!value || typeof value !== 'object') return null
  const {
    ok, statusCounts = {}, stuck = [], failures = [],
    recentGenerations, kb = {}, regressions = [],
  } = value
  const regList = Array.isArray(regressions) ? regressions : []
  const stuckList = Array.isArray(stuck) ? stuck : []
  const failList = Array.isArray(failures) ? failures : []
  return (
    <Card
      tone={ok ? 'good' : 'warn'}
      title={`Nightly QA smoke — ${ok ? 'clean' : `${regList.length} regression${regList.length === 1 ? '' : 's'}`}`}
      subtitle={value.ranAt ? `Ran ${value.ranAt}` : undefined}
    >
      {regList.length > 0 && (
        <Section title="Regressions" count={regList.length}>
          <ul className="space-y-1">
            {regList.map((r, i) => (
              <li key={i} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{r}</li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Job status snapshot">
        <CountChips data={statusCounts} />
      </Section>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Stuck >2h" value={stuckList.length} accent={stuckList.length > 0 ? 'text-amber-700' : undefined} />
        <Stat label="Failures 24h" value={failList.length} accent={failList.length > 0 ? 'text-red-700' : undefined} />
        <Stat label="New content 24h" value={recentGenerations ?? '—'} />
        <Stat label="KB topics" value={kb.topicsLatest ?? '—'} accent={kb.ok ? 'text-emerald-700' : 'text-red-700'} />
      </div>
      {failList.length > 0 && (
        <Section title="Recent failures" count={failList.length}>
          <ItemList
            items={failList}
            tone="bad"
            render={(f) => (
              <div>
                <p className="font-black text-red-800">{f.agentId || 'agent'}</p>
                {f.error && <p className="mt-0.5 theme-text-muted break-words">{f.error}</p>}
              </div>
            )}
          />
        </Section>
      )}
    </Card>
  )
}

// Gate — auto-publish gate sweep.
function GateCard({ value }) {
  if (!value || typeof value !== 'object') return null
  const { enabled, evaluated = 0, autoApproved = [], held = [], errors = [] } = value
  const approved = Array.isArray(autoApproved) ? autoApproved : []
  const heldList = Array.isArray(held) ? held : []
  return (
    <Card
      tone={approved.length > 0 ? 'good' : 'neutral'}
      title="Auto-publish gate"
      subtitle={enabled ? `Evaluated ${evaluated} draft${evaluated === 1 ? '' : 's'}.` : 'Auto-publish is off — nothing evaluated.'}
      badge={<Pill tone={enabled ? 'good' : 'neutral'}>{enabled ? 'enabled' : 'disabled'}</Pill>}
    >
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Evaluated" value={evaluated} />
        <Stat label="Auto-approved" value={approved.length} accent={approved.length > 0 ? 'text-emerald-700' : undefined} />
        <Stat label="Held" value={heldList.length} accent={heldList.length > 0 ? 'text-amber-700' : undefined} />
      </div>
      {approved.length > 0 && (
        <Section title="Auto-approved" count={approved.length}>
          <ItemList items={approved} tone="good" render={(a) => (
            <div>
              <span className="font-black theme-text">{a.tool ? humanizeKey(a.tool) : 'draft'}</span>
              {a.reason && <span className="theme-text-muted"> — {a.reason}</span>}
            </div>
          )} />
        </Section>
      )}
      {heldList.length > 0 && (
        <Section title="Held back" count={heldList.length}>
          <ItemList items={heldList} tone="warn" render={(h) => (
            <div>
              <span className="font-black theme-text">{h.tool ? humanizeKey(h.tool) : 'draft'}</span>
              {h.reason && <span className="theme-text-muted"> — {h.reason}</span>}
            </div>
          )} />
        </Section>
      )}
      <ErrorList errors={errors} />
    </Card>
  )
}

// Marshal — fleet watchdog (watches the other watchdogs).
function MarshalCard({ value }) {
  if (!value || typeof value !== 'object') return null
  const {
    healthy, summary, watchedCount = 0, lateAgents = [], neverRan = [],
    pausedAgents = [], stuckCount = 0, recentFailureCount = 0, errors = [],
  } = value
  return (
    <Card
      tone={healthy ? 'good' : 'warn'}
      title={`Fleet watchdog — ${healthy ? 'healthy' : 'attention needed'}`}
      subtitle={summary || undefined}
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="Watched" value={watchedCount} />
        <Stat label="Late" value={(lateAgents || []).length} accent={(lateAgents || []).length > 0 ? 'text-amber-700' : undefined} />
        <Stat label="Never ran" value={(neverRan || []).length} accent={(neverRan || []).length > 0 ? 'text-amber-700' : undefined} />
        <Stat label="Stuck jobs" value={stuckCount} accent={stuckCount > 0 ? 'text-red-700' : undefined} />
        <Stat label="Failures 24h" value={recentFailureCount} accent={recentFailureCount > 0 ? 'text-red-700' : undefined} />
      </div>
      {(pausedAgents || []).length > 0 && (
        <Section title="Paused agents">
          <CountChips data={Object.fromEntries((pausedAgents || []).map((a) => [a, '⏸'])) } />
        </Section>
      )}
      <ErrorList errors={errors} />
    </Card>
  )
}

/* ──────────────────────────── dispatcher ────────────────────────────── */

const RENDERERS = {
  aria: AriaCard,
  cala: ({ value }) => <CalaOutput alignment={value} />,
  reva: RevaCard,
  vigil: VigilCard,
  till: TillCard,
  echo: EchoCard,
  compass: CompassCard,
  anchor: AnchorCard,
  quill: QuillCard,
  gate: GateCard,
  marshal: MarshalCard,
}

// Read order: the draft first, then alignment + review, then ops/growth.
const ORDER = ['aria', 'cala', 'reva', 'vigil', 'till', 'echo', 'compass', 'anchor', 'quill', 'gate', 'marshal']

export default function AgentOutput({ output }) {
  if (!output || typeof output !== 'object') return null

  const known = ORDER.filter((k) => RENDERERS[k] && output[k] != null)
  // Any key we don't have a bespoke card for still gets a readable panel
  // rather than vanishing — covers a brand-new agent on day one.
  const unknown = Object.keys(output).filter((k) => !RENDERERS[k] && output[k] != null)

  if (known.length === 0 && unknown.length === 0) {
    return (
      <Card>
        <p className="text-sm theme-text-muted italic">This job hasn&apos;t produced any output yet.</p>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {known.map((k) => {
        const R = RENDERERS[k]
        return <R key={k} value={output[k]} />
      })}
      {unknown.map((k) => (
        <Card key={k} title={humanizeKey(k)} subtitle={`${humanizeKey(k)} result`}>
          <ReadableValue value={output[k]} />
        </Card>
      ))}
    </div>
  )
}

export { AgentOutput }
