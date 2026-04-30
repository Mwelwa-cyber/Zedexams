import { useState } from 'react'
import { CheckIcon, ShareIcon } from '@heroicons/react/24/solid'

/**
 * One-tap share button for the game-finish screen.
 *
 * Uses the native Web Share API where available (mobile Safari/Chrome,
 * recent Android). Falls back to copy-to-clipboard with a small "Copied!"
 * tooltip on older browsers.
 */
export default function ShareButton({ game, score, accuracy, bestStreak }) {
  const [copied, setCopied] = useState(false)

  const shareText = buildShareText({ game, score, accuracy, bestStreak })
  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/games/play/${game.id}`
    : ''

  async function handleShare() {
    const payload = {
      title: `ZedExams Games — ${game.title}`,
      text: shareText,
      url: shareUrl,
    }
    if (navigator.share) {
      try {
        await navigator.share(payload)
        return
      } catch (err) {
        if (err?.name === 'AbortError') return
        // fall through to clipboard
      }
    }
    const toCopy = `${shareText}\n\n${shareUrl}`
    try {
      await navigator.clipboard.writeText(toCopy)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      alert(toCopy)
    }
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={handleShare}
        className="zx-sticker-btn zx-sticker-btn-secondary rounded-[14px] px-4 py-2.5 text-sm"
      >
        <ShareIcon className="h-4 w-4" />
        <span>Challenge a friend</span>
      </button>
      {copied && (
        <span className="absolute left-1/2 -translate-x-1/2 -top-9 whitespace-nowrap px-2.5 py-1 rounded-lg text-xs font-black bg-slate-900 text-white shadow">
          <span className="inline-flex items-center gap-1">
            <CheckIcon className="h-3.5 w-3.5" />
            Copied to clipboard
          </span>
        </span>
      )}
    </div>
  )
}

function buildShareText({ game, score, accuracy, bestStreak }) {
  const parts = [
    `I scored ${score} on "${game.title}" on ZedExams Games!`,
  ]
  if (typeof accuracy === 'number') parts.push(`${accuracy}% accuracy`)
  if (typeof bestStreak === 'number' && bestStreak > 0) parts.push(`Best streak: ${bestStreak}`)
  parts.push('Can you beat me?')
  return parts.join(' · ')
}
