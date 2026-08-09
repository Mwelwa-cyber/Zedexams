/**
 * Shared icon vocabularies and marks.
 *
 * The app draws icons from `lucide-react`; this area is for the ZedExams
 * marks that are not in that set, and for a NAMED VOCABULARY that more than
 * one feature draws from.
 *
 * `classListIcons.js` is the first resident and the reason the second half of
 * that sentence exists (Phase 4, Wave 4). It is the Lucide set the Class List
 * and the Class Register are both specified against — its own docblock has
 * always said so — and when the Class List migrated, three files in
 * `teacher/register/attendance/` still imported it. Pulling it into
 * `features/classList/` would have made the register reach through another
 * feature's front door to draw a checkmark, and evaluate that feature's panel
 * to get one. A module two features share belongs below both.
 *
 * A namespace marker, not a barrel — import the file (`shared/icons/
 * classListIcons`), not this index. Re-exporting every vocabulary here would
 * put all of them in the chunk of anything that wanted one arrow.
 */

export {}
