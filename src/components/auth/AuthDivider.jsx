// Thin "OR" divider between the social sign-in options and the email form.
export default function AuthDivider() {
  return (
    <div className="flex items-center gap-4 my-5" aria-hidden="true">
      <span className="h-px flex-1 bg-[color:var(--border)]" />
      <span className="text-[12px] uppercase tracking-[1.5px] text-[color:var(--text-muted)] font-medium">or</span>
      <span className="h-px flex-1 bg-[color:var(--border)]" />
    </div>
  )
}
