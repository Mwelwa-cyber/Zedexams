/**
 * One large tappable card in the dashboard's action stack — icon tile, kicker,
 * title, body, CTA pill and a character illustration bleeding off the corner.
 */
import { memo } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from '../../../../shared/components/icons'
import Icon from '../../../../shared/components/Icon'
import DashboardCharacter from './DashboardCharacter'

const DashboardActionCard = memo(function DashboardActionCard({
  to,
  className,
  icon: ActionIcon,
  iconClassName,
  kicker,
  kickerClassName = '',
  title,
  titleClassName = '',
  body,
  bodyClassName = '',
  action,
  actionClassName,
  image,
  imageAlt,
  imageVariant = 'card',
}) {
  return (
    <section>
      <Link
        to={to}
        className={`zx-card group relative block min-h-[128px] overflow-hidden rounded-3xl border-2 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${className}`}
      >
        <div className="relative z-10 flex min-h-[128px] items-center gap-3 p-4 pr-28 sm:gap-4 sm:p-5 sm:pr-36">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-sm ${iconClassName}`}>
            <Icon as={ActionIcon} size="lg" strokeWidth={2.1} />
          </div>
          <div className="min-w-0 flex-1">
            <p className={`text-xs font-black uppercase tracking-widest ${kickerClassName}`}>
              {kicker}
            </p>
            <h3 className={`mt-0.5 text-base font-black leading-tight ${titleClassName}`}>
              {title}
            </h3>
            <p className={`mt-0.5 hidden text-xs font-bold sm:block ${bodyClassName}`}>
              {body}
            </p>
          </div>
          <div className={`hidden shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-black text-white shadow-sm transition-transform group-hover:translate-x-0.5 sm:flex ${actionClassName}`}>
            {action}
            <Icon as={ChevronRight} size="xs" />
          </div>
        </div>
        <DashboardCharacter
          image={image}
          alt={imageAlt}
          variant={imageVariant}
          className="absolute bottom-0 right-1 z-0 sm:right-3"
        />
      </Link>
    </section>
  )
})

export default DashboardActionCard
