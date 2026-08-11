/**
 * /teacher/register-preview — the Class List and Class Register redesign,
 * rendered for review before any of it is deployed.
 *
 * Unguarded and mock-data-only, following the precedent of
 * /teacher/dashboard-preview. It renders the REAL components — the same
 * ClassListTable, MarkAttendanceView, ImportReviewScreen and grid the product
 * uses — driven by previewFixtures instead of Firestore, so what a reviewer
 * sees is the shipping code and not a mock-up of it. Nothing here reads or
 * writes any Firebase collection.
 *
 * Each screen names the viewport it is meant to be judged at, because half
 * the point of this redesign is that a phone gets its own layout rather than
 * the desktop one squeezed down, and that is not visible in a screenshot with
 * no width attached to it.
 */

import { useMemo, useState } from 'react'
import SeoHelmet from '../../../components/seo/SeoHelmet'
import { resolveAttendancePolicy } from '../../../utils/attendanceConstants'
import { buildClassListView } from '../../../utils/classListCore'
import ClassListTable from '../components/ClassListTable'
import ClassListMobileList from '../components/ClassListMobileList'
import ImportReviewScreen from '../components/ImportReviewScreen'
import {
  MarkAttendanceView,
  AttendanceGridView,
  AttendanceSummaryPanel,
  AttendanceInsightsPanel,
  RegisterValidationPanel,
  RegisterPaperPreview,
} from '../../register'
import {
  PREVIEW_LEARNERS, PREVIEW_REGISTER, PREVIEW_EXTRACTED_ROWS,
  PREVIEW_EXISTING_FOR_REVIEW, buildPreviewRegisterHook,
} from './previewFixtures'

const POLICY = resolveAttendancePolicy()

const SCREENS = [
  { id: 'class-list-desktop', label: '1 · Class List — desktop', width: 1366 },
  { id: 'class-list-mobile', label: '2 · Class List — mobile', width: 390 },
  { id: 'mark-desktop', label: '3 · Mark Attendance — desktop', width: 1366 },
  { id: 'mark-mobile-list', label: '4 · Mark Attendance — mobile, list mode', width: 390 },
  { id: 'mark-mobile-one', label: '5 · Mark Attendance — mobile, one by one', width: 390 },
  { id: 'grid-desktop', label: '6 · Register Grid — desktop', width: 1366 },
  { id: 'grid-landscape', label: '7 · Register Grid — phone landscape', width: 844 },
  { id: 'term-summary', label: '8 · Term Summary + insights + validation', width: 1366 },
  { id: 'capture', label: '9 · Multi-page capture', width: 390 },
  { id: 'review', label: '10 · Capture review + duplicates', width: 1366 },
  { id: 'paper', label: '11 · Official register paper', width: 1366 },
]

/**
 * A frame that pins its contents to a real device width, so a desktop
 * screenshot of a phone screen is honest about what it is.
 */
function Viewport({ width, label, children }) {
  return (
    <figure className="m-0">
      <figcaption className="theme-text-muted text-xs font-black uppercase tracking-wider mb-2">
        {label} · {width}px
      </figcaption>
      <div
        className="border theme-border rounded-radius-md overflow-hidden theme-bg mx-auto"
        style={{ width, maxWidth: '100%' }}
      >
        <div className="p-3">{children}</div>
      </div>
    </figure>
  )
}

function ClassListPreview({ mobile }) {
  const [selectedIds, setSelectedIds] = useState(() => new Set(['learner-3']))
  const [sort, setSort] = useState('list_order')
  const view = useMemo(
    () => buildClassListView(PREVIEW_LEARNERS, { sort, page: 1, pageSize: mobile ? 12 : 25 }),
    [sort, mobile],
  )
  const toggle = (id) => setSelectedIds((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const header = (
    <header className="mb-3">
      <h2 className="theme-text font-display font-black text-xl">Grade 4A</h2>
      <p className="theme-text-muted text-sm">
        2026 Academic Year · <span className="theme-text font-bold">{view.counts.active}</span> active learners
      </p>
      <p className="theme-text-muted text-sm">Class teacher: Mahenga Mwelwa</p>
      <p className="text-emerald-800 text-xs font-black mt-1">
        Synced with Class Register · Last synced: Today, 14:26
      </p>
      <p className="text-amber-800 text-xs font-bold mt-1">
        {view.counts.duplicates} possible duplicate{view.counts.duplicates === 1 ? '' : 's'} ·
        {' '}{view.counts.needsReview} needing review ·
        {' '}{view.counts.missingInfo} missing information
      </p>
    </header>
  )

  if (mobile) {
    return (
      <div>
        {header}
        <ClassListMobileList
          rows={view.rows}
          rangeStart={view.rangeStart}
          selecting
          selectedIds={selectedIds}
          onToggleSelect={toggle}
          onOpenMenu={() => {}}
        />
      </div>
    )
  }
  return (
    <div>
      {header}
      <ClassListTable
        rows={view.rows}
        rangeStart={view.rangeStart}
        duplicateIds={view.duplicateIds}
        selectedIds={selectedIds}
        onToggleSelect={toggle}
        onToggleAll={() => {}}
        allSelected={false}
        onEdit={() => {}}
        onOpenMenu={() => {}}
        sort={sort}
        onSort={setSort}
      />
    </div>
  )
}

export default function ClassListRegisterPreview() {
  const [only, setOnly] = useState('all')
  const hook = useMemo(() => buildPreviewRegisterHook(), [])
  const show = (id) => only === 'all' || only === id

  return (
    <div className="theme-bg min-h-screen p-4 sm:p-6 space-y-8">
      <SeoHelmet title="Class List & Register preview" path="/teacher/register-preview" noIndex />

      <header className="max-w-3xl">
        <p className="rounded-radius-sm border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 text-xs font-black">
          PREVIEW · mock data only · nothing here reads or writes Firestore
        </p>
        <h1 className="theme-text font-display font-black text-2xl mt-3">
          Class List &amp; Class Register
        </h1>
        <p className="theme-text-muted text-sm mt-1">
          Grade 4A at Jemareen Academy — 86 learners, Term 2 of 2026. These are the shipping
          components driven by fixture data, including the awkward cases: two learners with
          the same name, one who joined in June, one who transferred out in July, a record
          with no admission number and a day that is only part-marked.
        </p>
        <label className="inline-flex items-center gap-2 mt-3 text-xs font-black theme-text-muted">
          Show
          <select value={only} onChange={(e) => setOnly(e.target.value)}
            className="rounded-radius-sm border theme-border theme-card theme-text px-2 py-2 text-sm min-h-[44px]">
            <option value="all">Every screen</option>
            {SCREENS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
      </header>

      {show('class-list-desktop') && (
        <Viewport width={1366} label="1 · Class List — desktop">
          <ClassListPreview />
        </Viewport>
      )}

      {show('class-list-mobile') && (
        <Viewport width={390} label="2 · Class List — mobile">
          <ClassListPreview mobile />
        </Viewport>
      )}

      {show('mark-desktop') && (
        <Viewport width={1366} label="3 · Mark Attendance — desktop">
          <MarkAttendanceView registerHook={hook} canMark={{ allowed: true, reason: 'ok' }} />
        </Viewport>
      )}

      {show('mark-mobile-list') && (
        <Viewport width={390} label="4 · Mark Attendance — mobile, list mode">
          <MarkAttendanceView registerHook={hook} canMark={{ allowed: true, reason: 'ok' }} />
        </Viewport>
      )}

      {show('mark-mobile-one') && (
        <Viewport width={390} label="5 · Mark Attendance — mobile, one by one">
          {/* Rendered separately from screen 4 so a screenshot can capture the
              other marking mode; the toggle is in the component itself. */}
          <MarkAttendanceView registerHook={hook} canMark={{ allowed: true, reason: 'ok' }} />
        </Viewport>
      )}

      {show('grid-desktop') && (
        <Viewport width={1366} label="6 · Register Grid — desktop">
          <AttendanceGridView registerHook={hook} canEdit policy={POLICY} />
        </Viewport>
      )}

      {show('grid-landscape') && (
        <Viewport width={844} label="7 · Register Grid — phone landscape">
          <AttendanceGridView registerHook={hook} canEdit policy={POLICY} />
        </Viewport>
      )}

      {show('term-summary') && (
        <Viewport width={1366} label="8 · Term Summary + insights + validation">
          <div className="space-y-4">
            <AttendanceSummaryPanel registerHook={hook} policy={POLICY} uid="preview" canEdit={false} />
            <AttendanceInsightsPanel registerHook={hook} policy={POLICY} />
            <RegisterValidationPanel registerHook={hook} stage="in_progress" canFinalise onFinalise={() => {}} />
          </div>
        </Viewport>
      )}

      {show('capture') && (
        <Viewport width={390} label="9 · Multi-page capture">
          <p className="theme-text-muted text-xs mb-2">
            The capture flow opens full-screen over the app; it is linked rather than framed
            here because a full-screen surface inside a 390px box is not the thing being
            reviewed.
          </p>
          <a href="/teacher/register-preview/capture"
            className="theme-accent-fill theme-on-accent rounded-radius-pill px-4 py-2.5 text-sm font-black inline-block">
            Open the capture flow
          </a>
        </Viewport>
      )}

      {show('review') && (
        <Viewport width={1366} label="10 · Capture review + duplicates">
          <p className="theme-text-muted text-xs mb-2">
            Opens full-screen — nine rows off three photographed pages, including a misread
            name (&ldquo;Chanda Mulenqa&rdquo;), a learner already on the list, a row with no
            admission number and one that was crossed out on the page.
          </p>
          <a href="/teacher/register-preview/review"
            className="theme-accent-fill theme-on-accent rounded-radius-pill px-4 py-2.5 text-sm font-black inline-block">
            Open the review screen
          </a>
        </Viewport>
      )}

      {show('paper') && (
        <Viewport width={1366} label="11 · Official register paper">
          <RegisterPaperPreview
            registerHook={hook}
            register={PREVIEW_REGISTER}
            uid="preview"
            teacherName="Mahenga Mwelwa"
            policy={POLICY}
            focusDate={hook.selectedDate}
          />
        </Viewport>
      )}
    </div>
  )
}

/** The review screen on its own route, because it is full-screen by design. */
export function ImportReviewPreview() {
  return (
    <ImportReviewScreen
      proposed={PREVIEW_EXTRACTED_ROWS}
      existing={PREVIEW_EXISTING_FOR_REVIEW}
      className="Grade 4A"
      pageCount={3}
      pages={[]}
      onCancel={() => { window.location.href = '/teacher/register-preview' }}
      onConfirm={() => { window.location.href = '/teacher/register-preview' }}
    />
  )
}
