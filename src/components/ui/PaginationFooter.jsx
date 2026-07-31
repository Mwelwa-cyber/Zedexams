import Button from './Button.jsx'

/**
 * PaginationFooter — the shared "bottom of a paginated list" control
 * (Prompt 16 §9/§36/§37). Renders the correct one of: a Load-More button, a
 * next-page spinner, a next-page error with retry (existing items stay
 * visible), or an end-of-results marker.
 *
 * Accessibility: the status line is an `aria-live="polite"` region so a screen
 * reader announces "Loading more…", "N more loaded", or "No more X" without
 * moving focus (§36). The Load-More button is a real <button> with an
 * accessible label and disables itself while a page is loading.
 *
 * Pair with usePaginatedQuery / useInfiniteFirestoreQuery:
 *   <PaginationFooter
 *     hasNextPage={hasNextPage}
 *     isLoadingNextPage={isLoadingNextPage}
 *     error={error}
 *     onLoadMore={loadNextPage}
 *     loadedCount={items.length}
 *     noun="assessment paper"
 *     sentinelRef={sentinelRef}   // optional — for infinite scroll
 *   />
 */
export default function PaginationFooter({
  hasNextPage,
  isLoadingNextPage,
  error,
  onLoadMore,
  loadedCount = 0,
  noun = 'item',
  nounPlural,
  sentinelRef,
  className = '',
}) {
  const plural = nounPlural || `${noun}s`

  // A next-page failure keeps the loaded list intact and offers a retry that
  // reuses the same cursor (§37). Distinct from an empty/initial error.
  if (error && !isLoadingNextPage) {
    return (
      <div className={`flex flex-col items-center gap-2 py-4 ${className}`}>
        <p role="alert" className="text-sm font-bold" style={{ color: '#b91c1c' }}>
          Couldn't load more {plural}.
        </p>
        <Button variant="secondary" size="sm" onClick={onLoadMore}>
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className={`flex flex-col items-center gap-2 py-4 ${className}`}>
      <div aria-live="polite" className="sr-only">
        {isLoadingNextPage
          ? `Loading more ${plural}…`
          : hasNextPage
            ? ''
            : loadedCount > 0
              ? `No more ${plural}.`
              : ''}
      </div>

      {hasNextPage ? (
        <>
          <Button
            variant="secondary"
            size="sm"
            onClick={onLoadMore}
            loading={isLoadingNextPage}
            disabled={isLoadingNextPage}
            aria-label={`Load more ${plural}`}
          >
            {isLoadingNextPage ? 'Loading more…' : `Load more ${plural}`}
          </Button>
          {/* Sentinel for infinite scroll — inert when no ref is supplied. */}
          {sentinelRef ? <div ref={sentinelRef} aria-hidden="true" style={{ height: 1, width: '100%' }} /> : null}
        </>
      ) : loadedCount > 0 ? (
        <p className="text-xs font-bold" style={{ color: 'var(--zt-text-muted)' }}>
          You've reached the end · {loadedCount} {loadedCount === 1 ? noun : plural}
        </p>
      ) : null}
    </div>
  )
}
