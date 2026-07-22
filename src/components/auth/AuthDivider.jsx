// Thin "OR" divider between the social sign-in options and the email form.
export default function AuthDivider() {
  return (
    <div className="flex items-center gap-4 my-5" aria-hidden="true">
      <span className="h-px flex-1 bg-[#E5E7EB]" />
      <span className="text-[12px] uppercase tracking-[1.5px] text-[#8B8F9C] font-medium">or</span>
      <span className="h-px flex-1 bg-[#E5E7EB]" />
    </div>
  )
}
