/**
 * ReaderPreview — /notes/reader-preview
 *
 * The note reader engine rendered against the Conjunctions demo fixture
 * (the prototype's working note), so the new reading experience can be
 * reviewed end-to-end before pipeline-regenerated notes carry it. Same
 * idea as /teacher/dashboard-preview: fixture data only, nothing
 * written, gated like every learner route.
 */
import { useNavigate, useSearchParams } from 'react-router-dom'
import ReaderEngine from '../reader/ReaderEngine'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import { CONJUNCTIONS_NOTE, CONJUNCTIONS_BLOCKS } from '../reader/fixtures/conjunctionsDemo'

export default function ReaderPreview() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  return (
    <>
      <SeoHelmet title="Note reader preview" path="/notes/reader-preview" noIndex />
      <ReaderEngine
        note={CONJUNCTIONS_NOTE}
        blocks={CONJUNCTIONS_BLOCKS}
        initialMode={searchParams.get('mode') === 'revise' ? 'revise' : 'learn'}
        onBack={() => navigate('/notes')}
      />
    </>
  )
}
