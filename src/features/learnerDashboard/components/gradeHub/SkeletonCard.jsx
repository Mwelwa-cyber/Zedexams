/**
 * The placeholder shown in a card slot while dashboard data loads.
 */
import { memo } from 'react'
import Skeleton from '../../../../shared/components/Skeleton'

const SkeletonCard = memo(function SkeletonCard() {
  return <Skeleton height={96} width={'100%'} className="rounded-2xl" />
})

export default SkeletonCard
