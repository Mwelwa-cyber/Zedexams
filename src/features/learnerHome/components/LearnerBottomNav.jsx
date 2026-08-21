/**
 * LearnerBottomNav — the persistent learner navigation, prototype-v3 IA:
 * Home · Papers · Notes · Games. On phones it is the glass bottom bar
 * with the coral active indicator; from 1000px it renders as the fixed
 * left sidebar (see shared/styles/learnerTheme.css), where the brand row shows.
 *
 * Learn and Practice are deliberately absent (locked scope) — their
 * routes stay reachable until step 5 retires them, via Home's cards and
 * the profile sheet. Profile is NOT here — it opens from the avatar.
 *
 * The destinations themselves are NOT declared here: they come from
 * `shared/constants/learnerTabs.js`, which is the one place the learner
 * IA is written down. This file owns how they LOOK in the `.lhx` system
 * and nothing else — including WHO the bar is for, which arrives as
 * `homePath` / `learnerRoutesOpen` from `LearnerShell`. Two of the routes
 * that mount the shell (`/papers`, `/games`) are public, so this bar is
 * drawn for teachers and guardians too; `resolveLearnerTabs` is what stops
 * it offering them a tab the app would then refuse.
 */
import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import LearnerIcon from './LearnerIcon'
import useHideOnScroll from '../../../hooks/useHideOnScroll'
import { resolveLearnerTabs } from '../../../shared/constants/learnerTabs.js'

export default function LearnerBottomNav({ homePath, learnerRoutesOpen }) {
  // LinkedIn-style auto-hide, in step with the topbar: the bar folds down
  // while the learner scrolls into the page and returns on the first
  // scroll up. Desktop's sidebar ignores the hidden class in CSS.
  const hidden = useHideOnScroll()
  // Labels resolve through i18n like the other bar's do. They used to be
  // hardcoded English here, so a Nyanja learner met a translated bar on
  // the legacy-chrome pages and an English one everywhere else.
  const { t } = useTranslation()
  const tabs = resolveLearnerTabs({ homePath, learnerRoutesOpen })
  return (
    <nav className={`lhx-nav ${hidden ? 'lhx-nav-hidden' : ''}`} aria-label="Learner navigation">
      <div className="lhx-nav-brand" aria-hidden="true">
        <img src="/zedexams-logo.webp" alt="" height="30" />
      </div>
      <div className="lhx-nav-inner">
        {tabs.map((tab) => {
          const label = t(tab.labelKey, tab.label)
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              aria-label={label}
              className={({ isActive }) => `lhx-nav-item ${isActive ? 'is-active' : ''}`}
            >
              {/* react-router sets aria-current="page" on the active link */}
              <LearnerIcon name={tab.id} size={23} />
              <span>{label}</span>
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}
