/**
 * Behaviour tests for PastPaperStudio.jsx — the /admin/papers wizard.
 *
 * Scope: the publish write, now that the Quiz step is optional. This is the
 * one place in the feature where getting it wrong is expensive and silent —
 * the fields written here are what every learner surface reads to decide
 * whether to show a "Start Quiz" button.
 *
 * Three things are pinned:
 *   - publishing with the Quiz step skipped writes quizStatus 'pending' and
 *     quizId null (never the id of the empty quiz the Studio was authoring);
 *   - publishing with a real quiz writes quizId + quizStatus 'attached'
 *     together in ONE update, not two;
 *   - a quiz with no questions is never attached, whichever route reached
 *     step 4.
 *
 * Firestore, Storage and the import callable are mocked; the wizard is driven
 * through the `?step=` deep link the admin list uses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

// getAppCheckClientState is what describeUploadError consults to tell an
// attestation refusal from a rules denial (both arrive as
// `storage/unauthorized`). Attested + initialised here, so these tests keep
// exercising the permissions wording.
vi.mock('../../../firebase/config', () => ({
  default: {},
  auth: {},
  db: {},
  storage: {},
  getAppCheckClientState: () => ({
    native: false,
    recaptchaKeyConfigured: true,
    initialized: true,
  }),
}))
vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: () => vi.fn().mockResolvedValue({ data: {} }),
}))

// The linked quiz exists and holds `quizQuestionCount` questions.
let quizQuestionCount = 0
let quizExists = true
vi.mock('firebase/firestore', () => ({
  collection: (...path) => ({ path }),
  doc: (...path) => ({ path, id: 'generated-quiz-id' }),
  getDoc: vi.fn(async () => ({ exists: () => quizExists })),
  getDocs: vi.fn(async () => ({ size: quizQuestionCount, docs: [] })),
  query: (ref) => ref,
  serverTimestamp: () => 'ts',
  setDoc: vi.fn(async () => {}),
}))

const mockUpdatePaper = vi.fn(async () => {})
const mockGetPaper = vi.fn()
const mockUploadAsset = vi.fn()
// The duplicate probe: null means "no other paper holds this key".
const mockFindPaperByKey = vi.fn(async () => null)
vi.mock('../../../utils/pastPapers', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createPaper: vi.fn(async () => 'new-paper'),
    getPaper: (...a) => mockGetPaper(...a),
    updatePaper: (...a) => mockUpdatePaper(...a),
    deletePaper: vi.fn(),
    deletePaperPdf: vi.fn(),
    resolvePaperUrl: vi.fn(async () => ''),
    uploadPaperAsset: (...a) => mockUploadAsset(...a),
    findPaperByKey: (...a) => mockFindPaperByKey(...a),
  }
})

vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ currentUser: { uid: 'admin-1' } }) }))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))

const mockNavigate = vi.fn()
let searchQuery = 'step=publish'
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ paperId: 'paper-1' }),
    useSearchParams: () => [new URLSearchParams(searchQuery), vi.fn()],
  }
})

import { setDoc } from 'firebase/firestore'
import PastPaperStudio from './PastPaperStudio'

function savedPaper(overrides = {}) {
  return {
    id: 'paper-1',
    title: 'Grade 7 Maths 2024',
    grade: '7',
    subject: 'mathematics',
    year: 2024,
    examBoard: 'ECZ',
    status: 'draft',
    // A paper cannot publish without a source (the rules refuse a learner read
    // of one that has none), so every fixture that reaches Publish carries it.
    source: 'ecz',
    isOfficial: true,
    sourceConfidence: 'explicit',
    assets: [{
      path: 'papers/admin-1/paper-1/assets/0-p.pdf',
      filename: 'p.pdf',
      size: 1024,
      contentType: 'application/pdf',
    }],
    ...overrides,
  }
}

function renderStudio() {
  return render(<MemoryRouter><PastPaperStudio /></MemoryRouter>)
}

/** The one updatePaper call that carries `status` — the publish/unpublish write. */
function publishWrite() {
  const calls = mockUpdatePaper.mock.calls.filter(([, fields]) => 'status' in fields)
  expect(calls).toHaveLength(1)
  return calls[0][1]
}

beforeEach(() => {
  vi.clearAllMocks()
  // clearAllMocks only clears CALLS — a queued mockRejectedValueOnce would
  // otherwise leak into the next test and fail it somewhere unrelated.
  mockUploadAsset.mockReset()
  quizQuestionCount = 0
  quizExists = true
  searchQuery = 'step=publish'
  mockFindPaperByKey.mockReset()
  mockFindPaperByKey.mockResolvedValue(null)
})

describe('PastPaperStudio — publishing without a quiz', () => {
  it('publishes a skipped paper as pending, with quizId null', async () => {
    const user = userEvent.setup()
    mockGetPaper.mockResolvedValue(savedPaper())
    renderStudio()

    await user.click(await screen.findByRole('button', { name: /Publish paper/ }))

    const fields = publishWrite()
    expect(fields.status).toBe('published')
    expect(fields.quizStatus).toBe('pending')
    expect(fields.quizId).toBeNull()
  })

  it('parks the authoring quiz instead of attaching it or orphaning it', async () => {
    // The Studio mints a quiz the moment step 3 opens. Publishing pending must
    // remember it (so re-entering resumes that quiz) without ever promoting it
    // to `quizId` — it has no questions in it.
    const user = userEvent.setup()
    mockGetPaper.mockResolvedValue(savedPaper({ pendingQuizId: 'draft-q' }))
    renderStudio()

    await user.click(await screen.findByRole('button', { name: /Publish paper/ }))

    const fields = publishWrite()
    expect(fields.quizId).toBeNull()
    expect(fields.pendingQuizId).toBe('draft-q')
  })

  it('refuses to attach a linked quiz that has no questions', async () => {
    // Reached step 4 with a linked-but-empty quiz (the admin opened the editor
    // and left). An empty quiz behind a live "Start Quiz" button is the exact
    // outcome the pending state exists to prevent.
    const user = userEvent.setup()
    quizQuestionCount = 0
    mockGetPaper.mockResolvedValue(savedPaper({ quizId: 'q-empty', quizStatus: 'attached' }))
    renderStudio()

    await user.click(await screen.findByRole('button', { name: /Save changes|Publish paper/ }))

    const fields = publishWrite()
    expect(fields.quizStatus).toBe('pending')
    expect(fields.quizId).toBeNull()
  })

  it('tells the admin what publishing without a quiz will do, without blocking it', async () => {
    mockGetPaper.mockResolvedValue(savedPaper())
    renderStudio()

    expect(await screen.findByText('No quiz attached yet.')).toBeInTheDocument()
    expect(screen.getByText(/visible to learners now/)).toBeInTheDocument()
    // Informational, not an error: the button stays live.
    expect(screen.getByRole('button', { name: /Publish paper/ })).toBeEnabled()
  })
})

describe('PastPaperStudio — publishing with a quiz', () => {
  it('writes quizId and quizStatus together in one update', async () => {
    const user = userEvent.setup()
    quizQuestionCount = 12
    mockGetPaper.mockResolvedValue(savedPaper({ quizId: 'q-real', quizStatus: 'attached' }))
    renderStudio()

    await user.click(await screen.findByRole('button', { name: /Save changes|Publish paper/ }))

    const fields = publishWrite()
    expect(fields.quizId).toBe('q-real')
    expect(fields.quizStatus).toBe('attached')
    // Clearing the parked draft id is part of the same patch — a second write
    // would leave a window where the paper is readable half-attached.
    expect(fields.pendingQuizId).toBeNull()
    expect(fields.status).toBe('published')
  })

  it('resumes the draft quiz parked by an earlier skip rather than minting a second one', async () => {
    const user = userEvent.setup()
    quizQuestionCount = 5
    // The "Add quiz" flow: paper is live and pending, its authoring quiz is in
    // pendingQuizId, and the admin has since filled it in.
    mockGetPaper.mockResolvedValue(savedPaper({
      status: 'published', quizStatus: 'pending', quizId: null, pendingQuizId: 'draft-q',
    }))
    renderStudio()

    await user.click(await screen.findByRole('button', { name: /Save changes/ }))

    const fields = publishWrite()
    expect(fields.quizId).toBe('draft-q')
    expect(fields.quizStatus).toBe('attached')
  })
})

describe('PastPaperStudio — unpublishing a live paper', () => {
  // The button exists so an admin who spots an error can take the paper off
  // the shelf, fix it, and put it back. Each case asks whether it does exactly
  // that and nothing more — a "hide" that half-applies, or that quietly loses
  // work, is worse than no button at all.
  const livePaper = (overrides = {}) => savedPaper({
    status: 'published', quizId: 'q-real', quizStatus: 'attached', ...overrides,
  })

  async function confirmUnpublish(user) {
    await user.click(screen.getByRole('button', { name: 'Unpublish' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Unpublish' }))
  }

  it('takes the paper back to draft', async () => {
    const user = userEvent.setup()
    quizQuestionCount = 8
    mockGetPaper.mockResolvedValue(livePaper())
    renderStudio()
    await screen.findByRole('button', { name: 'Unpublish' })

    await confirmUnpublish(user)

    expect(publishWrite().status).toBe('draft')
  })

  it('makes the linked quiz private too, so the /quiz link stops serving it', async () => {
    const user = userEvent.setup()
    quizQuestionCount = 8
    mockGetPaper.mockResolvedValue(livePaper())
    renderStudio()
    await screen.findByRole('button', { name: 'Unpublish' })

    await confirmUnpublish(user)

    const quizWrite = vi.mocked(setDoc).mock.calls.at(-1)[1]
    expect(quizWrite.isPublished).toBe(false)
    expect(quizWrite.publicAccess).toBe(false)
  })

  it('leaves the quiz LINK alone, so publishing again restores the paper as it was', async () => {
    const user = userEvent.setup()
    quizQuestionCount = 8
    mockGetPaper.mockResolvedValue(livePaper())
    renderStudio()
    await screen.findByRole('button', { name: 'Unpublish' })

    await confirmUnpublish(user)

    const fields = publishWrite()
    expect('quizId' in fields).toBe(false)
    expect('quizStatus' in fields).toBe(false)
  })

  it('touches no quiz when the paper was published with the Quiz step skipped', async () => {
    const user = userEvent.setup()
    quizQuestionCount = 0
    mockGetPaper.mockResolvedValue(savedPaper({
      status: 'published', quizStatus: 'pending', quizId: null, pendingQuizId: 'draft-q',
    }))
    renderStudio()
    await screen.findByRole('button', { name: 'Unpublish' })

    await confirmUnpublish(user)

    expect(publishWrite().status).toBe('draft')
    expect(setDoc).not.toHaveBeenCalled()
  })

  it('keeps the admin in the Studio and flips the primary button back to Publish', async () => {
    const user = userEvent.setup()
    quizQuestionCount = 8
    mockGetPaper.mockResolvedValue(livePaper())
    renderStudio()
    await screen.findByRole('button', { name: 'Unpublish' })

    await confirmUnpublish(user)

    // Fixing the thing that prompted the unpublish is the point — navigating
    // away to the list would put the wizard between the admin and the fix.
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: /Publish paper/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unpublish' })).not.toBeInTheDocument()
    expect(screen.getByText(/Learners can no longer see this paper/)).toBeInTheDocument()
  })

  it('never offers "Discard draft" on a paper that has been live', async () => {
    // Discard DELETES the paper and its uploaded files. Unpublishing must not
    // move a destructive button into reach of an admin who only meant to hide
    // a paper for ten minutes.
    const user = userEvent.setup()
    quizQuestionCount = 8
    mockGetPaper.mockResolvedValue(livePaper())
    renderStudio()
    await screen.findByRole('button', { name: 'Unpublish' })
    expect(screen.queryByRole('button', { name: 'Discard draft' })).not.toBeInTheDocument()

    await confirmUnpublish(user)

    expect(screen.queryByRole('button', { name: 'Discard draft' })).not.toBeInTheDocument()
  })

  it('offers no Unpublish on a paper that was never published', async () => {
    mockGetPaper.mockResolvedValue(savedPaper())
    renderStudio()
    await screen.findByRole('button', { name: /Publish paper/ })
    expect(screen.queryByRole('button', { name: 'Unpublish' })).not.toBeInTheDocument()
    // …and a draft still gets its Discard action.
    expect(screen.getByRole('button', { name: 'Discard draft' })).toBeInTheDocument()
  })

  it('writes nothing until the confirm dialog is confirmed', async () => {
    const user = userEvent.setup()
    quizQuestionCount = 8
    mockGetPaper.mockResolvedValue(livePaper())
    renderStudio()

    await user.click(await screen.findByRole('button', { name: 'Unpublish' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(mockUpdatePaper).not.toHaveBeenCalled()
    expect(setDoc).not.toHaveBeenCalled()
  })

  it('says the paper is live, and stops saying so once it is not', async () => {
    const user = userEvent.setup()
    quizQuestionCount = 8
    mockGetPaper.mockResolvedValue(livePaper())
    renderStudio()

    expect(await screen.findByText('Live to learners')).toBeInTheDocument()
    await confirmUnpublish(user)
    expect(await screen.findByText('Not published')).toBeInTheDocument()
    expect(screen.queryByText('Live to learners')).not.toBeInTheDocument()
  })
})

describe('PastPaperStudio — upload failures', () => {
  // Storage returns `storage/unauthorized` for every arm of the rule alike —
  // wrong role, unverified email, suspended account, disallowed type — and its
  // message names only the path. That opacity is what made a role gap in
  // storage.rules read as a broken uploader for a whole afternoon.
  const pdf = (name = 'paper.pdf') =>
    new File([new Uint8Array([1, 2, 3])], name, { type: 'application/pdf' })

  function fileInput() {
    return document.querySelector('input[type="file"]')
  }

  async function renderUploadStep() {
    searchQuery = 'step=upload'
    mockGetPaper.mockResolvedValue(savedPaper({ assets: [] }))
    renderStudio()
    await screen.findByText(/Drag & drop files here/)
  }

  it('explains what to check instead of restating the storage path', async () => {
    const user = userEvent.setup()
    mockUploadAsset.mockRejectedValue(Object.assign(
      new Error("Firebase Storage: User does not have permission to access 'papers/u/p/assets/0-paper.pdf'. (storage/unauthorized)"),
      { code: 'storage/unauthorized' },
    ))
    await renderUploadStep()

    await user.upload(fileInput(), pdf())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/admin \(or teacher\) role/)
    expect(alert).toHaveTextContent(/verified email/)
    expect(alert).not.toHaveTextContent('papers/u/p/assets')
    // The token refresh is the remedy that actually fixes the common case —
    // storage.rules reads the role from the ID token's `role` claim and only
    // falls back to a cross-service Firestore lookup when the token has none,
    // so a session predating the role change is refused on a correct account.
    // It must be OFFERED FIRST, not left as a closing afterthought: an admin
    // who reads "check your role" and stops has been sent somewhere there is
    // nothing to find.
    expect(alert).toHaveTextContent(/sign(ing)? out and back in once/i)
    const text = alert.textContent
    expect(text.search(/sign(ing)? out and back in/i))
      .toBeLessThan(text.search(/admin \(or teacher\) role/))
  })

  it('keeps the files that uploaded before the one that failed', async () => {
    // A scanned paper is 30 images. Dropping nine good uploads because the
    // tenth was refused means re-doing the whole batch.
    const user = userEvent.setup()
    mockUploadAsset
      .mockResolvedValueOnce({
        path: 'papers/u/p/assets/0-page-1.jpg',
        filename: 'page-1.jpg',
        size: 10,
        contentType: 'image/jpeg',
      })
      .mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'storage/unauthorized' }))
    await renderUploadStep()

    await user.upload(fileInput(), [pdf('page-1.jpg'), pdf('page-2.jpg')])

    expect(await screen.findByText('page-1.jpg')).toBeInTheDocument()
    const assetWrites = mockUpdatePaper.mock.calls.filter(([, f]) => 'assets' in f)
    expect(assetWrites.at(-1)[1].assets).toHaveLength(1)
  })

  it('passes a non-permission failure through in the words the SDK used', async () => {
    const user = userEvent.setup()
    mockUploadAsset.mockRejectedValue(new Error('Network request failed'))
    await renderUploadStep()

    await user.upload(fileInput(), pdf())

    expect(await screen.findByRole('alert')).toHaveTextContent('Network request failed')
  })
})

describe('PastPaperStudio — the Add quiz deep link', () => {
  it('opens on the Quiz step with Upload and Details already saved', async () => {
    searchQuery = 'step=quiz'
    mockGetPaper.mockResolvedValue(savedPaper({ status: 'published', quizStatus: 'pending' }))
    renderStudio()

    expect(await screen.findByText('Quiz authoring')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Skip for now/ })).toBeInTheDocument()
  })

  it('ignores an unrecognised step and opens at the beginning', async () => {
    searchQuery = 'step=banana'
    mockGetPaper.mockResolvedValue(savedPaper())
    renderStudio()

    expect(await screen.findByText(/Drag & drop files here/)).toBeInTheDocument()
  })
})

describe('PastPaperStudio — a paper cannot publish without a source', () => {
  it('refuses to publish a paper with no source, and writes nothing', async () => {
    // Acceptance criterion 1. This is not a nicety: firestore.rules refuses a
    // learner read of a published paper with no established source, so
    // publishing one would produce a paper that is "live" and unopenable.
    const user = userEvent.setup()
    mockGetPaper.mockResolvedValue(savedPaper({ source: null, sourceConfidence: 'unknown' }))
    renderStudio()

    await user.click(await screen.findByRole('button', { name: /Publish paper/ }))

    expect(await screen.findByText(/Choose a source/i)).toBeInTheDocument()
    expect(mockUpdatePaper.mock.calls.filter(([, f]) => 'status' in f)).toHaveLength(0)
  })

  it('refuses to publish onto a paperKey another paper already holds', async () => {
    // Acceptance criterion 4 — re-uploading an identical paper is blocked.
    const user = userEvent.setup()
    mockFindPaperByKey.mockResolvedValue({ id: 'other-paper', title: 'Grade 7 Mathematics — ECZ · 2024' })
    mockGetPaper.mockResolvedValue(savedPaper())
    renderStudio()

    await user.click(await screen.findByRole('button', { name: /Publish paper/ }))

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument()
    expect(mockUpdatePaper.mock.calls.filter(([, f]) => 'status' in f)).toHaveLength(0)
  })
})
