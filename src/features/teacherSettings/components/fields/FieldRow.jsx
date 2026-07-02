// Label + control + optional help text. `full` spans both columns of the
// panel's .tset-grid. The control is whatever the caller passes as children
// (input/select/textarea using the shared studio-input class).
export default function FieldRow({ label, help, full = false, htmlFor, children }) {
  return (
    <div className={`tset-field${full ? ' tset-field--full' : ''}`}>
      <label className="studio-label" htmlFor={htmlFor}>{label}</label>
      {children}
      {help && <p className="tset-help">{help}</p>}
    </div>
  )
}
