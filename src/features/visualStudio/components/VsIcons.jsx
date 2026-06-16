/* Inline SVG icons for Visual Studio. Self-contained so the feature folder
   has no dependency on the app-wide icon set (eases the future standalone-app
   port). All share one stroke style. */

function S({ children, size = 20 }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const IconSparkles = (p) => <S {...p}><path d="M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 16l-1.8-4.8L6 9.4l4.2-1.8z" /><path d="M19 14l.7 1.8L21.5 16.5l-1.8.7L19 19l-.7-1.8L16.5 16.5l1.8-.7z" /></S>
export const IconTemplate = (p) => <S {...p}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></S>
export const IconBank = (p) => <S {...p}><circle cx="8" cy="8" r="4" /><path d="M3 21l6-6" /><rect x="13" y="13" width="8" height="8" rx="1" /><path d="M14 4h7v6" /></S>
export const IconBlank = (p) => <S {...p}><path d="M12 5v14M5 12h14" /></S>
export const IconSaved = (p) => <S {...p}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></S>
export const IconCursor = (p) => <S {...p}><path d="M4 3l7 17 2.5-7L21 10.5z" /></S>
export const IconTag = (p) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .8-1 1.7" /><path d="M12 16.5h.01" /></S>
export const IconText = (p) => <S {...p}><path d="M5 5h14M12 5v14M8 19h8" /></S>
export const IconArrow = (p) => <S {...p}><path d="M4 12h15M14 6l6 6-6 6" /></S>
export const IconBox = (p) => <S {...p}><rect x="4" y="5" width="16" height="14" rx="2" /></S>
export const IconUndo = (p) => <S {...p}><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-1" /></S>
export const IconRedo = (p) => <S {...p}><path d="M15 14l5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h1" /></S>
export const IconLock = (p) => <S {...p}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></S>
export const IconTrash = (p) => <S {...p}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></S>
export const IconCopy = (p) => <S {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></S>
export const IconDownload = (p) => <S {...p}><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 21h14" /></S>
export const IconSend = (p) => <S {...p}><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" /></S>
export const IconCheck = (p) => <S {...p}><path d="M20 6L9 17l-5-5" /></S>
export const IconSearch = (p) => <S {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></S>
export const IconBack = (p) => <S {...p}><path d="M15 18l-6-6 6-6" /></S>
export const IconImage = (p) => <S {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></S>
export const IconCircle = (p) => <S {...p}><circle cx="12" cy="12" r="9" /></S>
export const IconLine = (p) => <S {...p}><path d="M4 20L20 4" /></S>
export const IconBlankLine = (p) => <S {...p}><path d="M3 17h18" /><path d="M7 7h6" opacity="0.5" /></S>
export const IconAdjust = (p) => <S {...p}><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" fill="currentColor" /><circle cx="15" cy="12" r="2" fill="currentColor" /><circle cx="8" cy="18" r="2" fill="currentColor" /></S>
