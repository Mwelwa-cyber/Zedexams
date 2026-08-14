// Floating AI assistant button — a persistent, premium entry point to Zed from
// anywhere on the Settings dashboard. Navigates to the full assistant page.

import { useNavigate } from 'react-router-dom'
import Icon from '../../../shared/components/Icon'
import { Sparkles } from '../../../shared/components/icons'

export default function AiFab() {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      className="lset-fab"
      onClick={() => navigate('/ask-zed')}
      aria-label="Open AI assistant"
    >
      <span className="lset-fab__pulse"><Icon as={Sparkles} size="sm" strokeWidth={2.3} /></span>
      Ask Zed
    </button>
  )
}
