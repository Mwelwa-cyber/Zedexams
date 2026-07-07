// My Account — the merged detail view for the "My Account" section. Composes the
// profile, parent/guardian and account-management bodies under one Panel header,
// each an existing, data-wired body so nothing here re-implements save logic.

import { Panel } from '../components/ui'
import { ProfileBody } from './ProfilePanel'
import { ParentBody } from './ParentPanel'
import { AccountBody } from './AccountPanel'

export default function MyAccountPanel({ section, pushToast }) {
  return (
    <Panel section={section}>
      <ProfileBody pushToast={pushToast} />
      <ParentBody />
      <AccountBody pushToast={pushToast} />
    </Panel>
  )
}
