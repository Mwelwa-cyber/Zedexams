import PasskeyListItem from './PasskeyListItem'

export default function PasskeyList({ passkeys, onRename, onRemove, busy }) {
  if (!passkeys.length) {
    return (
      <p className="rounded-xl border border-dashed border-gray-300 px-4 py-5 text-center text-[13px] text-gray-500">
        No passkeys yet. Add one to sign in with your fingerprint, face, PIN,
        or device screen lock.
      </p>
    )
  }
  return (
    <ul className="divide-y divide-gray-100">
      {passkeys.map((p) => (
        <PasskeyListItem
          key={p.id}
          passkey={p}
          busy={busy}
          onRename={() => onRename(p)}
          onRemove={() => onRemove(p)}
        />
      ))}
    </ul>
  )
}
