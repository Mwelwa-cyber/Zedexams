/**
 * Hand the operator the credentials CSV.
 *
 * The DOM half of the export; the text half is `lib/demoTrialsCore.js`, which
 * is where the column contract lives and where it is tested.
 *
 * Kept as an anchor click rather than moved onto `src/utils/saveBlob.js` during
 * the migration. `saveBlob` exists to keep filenames on Android, and this panel
 * is admin-only on the web — swapping the download mechanism is a behavioural
 * change, and a migration is a move. It is a reasonable follow-up, not part of
 * this one.
 */

import { toCredentialsCsv, credentialsFilename } from '../lib/demoTrialsCore'

export function downloadCredentialsCsv(rows) {
  const blob = new Blob([toCredentialsCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = credentialsFilename()
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
