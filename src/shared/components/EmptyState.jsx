/**
 * EmptyState — standardised "nothing here yet" panel.
 *
 * Centered icon + title + description + primary action. Use inside a card
 * or flush in a section. Matches the elevation and border treatment of
 * the rest of the app.
 */
export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  variant = 'default',
  className = '',
}) {
  const tone =
    variant === 'error'
      ? 'bg-danger-subtle'
      : variant === 'success'
        ? 'bg-success-subtle'
        : 'theme-accent-bg'

  return (
    <div
      className={`flex flex-col items-center justify-center text-center px-6 py-12 ${className}`}
    >
      {Icon && (
        <div
          className={`flex h-14 w-14 items-center justify-center rounded-radius-pill ${tone} mb-4`}
        >
          <Icon className="h-7 w-7 theme-accent-text" />
        </div>
      )}
      {title && (
        <h3 className="text-display-md theme-text mb-1">{title}</h3>
      )}
      {description && (
        <p className="theme-text-muted text-body max-w-md">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
