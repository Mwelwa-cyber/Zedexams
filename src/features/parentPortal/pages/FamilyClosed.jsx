/**
 * FamilyClosed — what anyone landing on /family/* sees now that the parent app
 * is retired.
 *
 * It renders a page rather than redirecting, and that is deliberate: a
 * signed-in parent account is sent to `/family` by `getRoleLandingPath`, and
 * `/` is resolved BY ROLE (RootRedirect), so a `<Navigate to="/">` here would
 * bounce `/family` → `/` → `/family` forever. A static page ends the chain.
 *
 * It is also never a dead end: a guardian who still holds an unpaid link in
 * their email can use it (it needs no account), and a signed-in visitor can
 * sign out.
 */
import { Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import Button from '../../../shared/components/Button'

export default function FamilyClosed() {
  const { currentUser, logout } = useAuth()

  return (
    <div className="min-h-screen theme-bg flex items-center justify-center p-6">
      <div className="theme-card border theme-border rounded-3xl shadow-xl w-full max-w-md p-8 text-center">
        <h1 className="text-display-md theme-text mb-2">The parent area has closed</h1>
        <p className="theme-text-muted text-body-sm mb-2">
          Parents no longer need an account. Your child can send you their results on
          WhatsApp, and if they ask you to pay for a plan you can do it from the link they
          send you, using your own mobile-money number.
        </p>
        <p className="theme-text-muted text-body-sm mb-6">
          If you have a question about your child&rsquo;s account, write to us and we will help.
        </p>

        <Link
          to="/"
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-700"
        >
          Go to ZedExams
        </Link>

        {currentUser && (
          <Button variant="ghost" size="md" fullWidth className="mt-3" onClick={() => logout()}>
            Sign out
          </Button>
        )}
      </div>
    </div>
  )
}
