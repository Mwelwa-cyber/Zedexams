// Security & Privacy — the merged detail view. Composes the security body
// (strength, password reset, recovery, 2FA, activity) and the privacy body
// (data sharing, analytics consent, profile visibility, safety) under one
// Panel header. Both are existing, data-wired bodies.

import { Panel } from '../components/ui'
import { SecurityBody } from './SecurityPanel'
import { PrivacyBody } from './PrivacyPanel'

export default function PrivacySecurityPanel({ section, pushToast }) {
  return (
    <Panel section={section}>
      <SecurityBody pushToast={pushToast} />
      <PrivacyBody />
    </Panel>
  )
}
