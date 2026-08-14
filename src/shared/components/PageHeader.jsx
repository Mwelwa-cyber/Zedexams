/**
 * PageHeader — eyebrow + display title + optional helper text + actions.
 *
 * Used by every admin/teacher surface (and result pages) so headers look
 * identical without each page re-implementing the layout. Picks up theme
 * tokens — no hard-coded colors.
 *
 * Example:
 *   <PageHeader
 *     eyebrow="Dashboard"
 *     title="Welcome back"
 *     description="Latest activity across your classroom."
 *     actions={<Button>New quiz</Button>}
 *   />
 */
export default function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className = '',
}) {
  return (
    <div className={`page-header ${className}`}>
      <div className="min-w-0">
        {eyebrow && <p className="text-eyebrow">{eyebrow}</p>}
        <h1 className="text-display-lg theme-text mt-1">{title}</h1>
        {description && (
          <p className="theme-text-muted text-body-sm mt-1.5 max-w-2xl">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
          {actions}
        </div>
      )}
    </div>
  )
}
