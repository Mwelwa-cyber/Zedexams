/**
 * Re-export only. The helper lives in the shared text package.
 *
 * @see functions/shared/text/textJunk.js
 *
 * It moved there when the past-paper quiz gained SERVER-SIDE marking: the
 * answer key has to resolve a rich-text `correctAnswer` against a rich option,
 * which needs plain-text projection, and the browser and the Cloud Function
 * marking the same exam must project identically or they disagree about which
 * option was right. `functions/` already carried two hand-maintained copies of
 * this extractor "kept in sync" by comment (functions/agents/runners/vex.js,
 * optionDedupeKey.js) — a third would have been the one that drifted.
 *
 * DO NOT ADD A RULE HERE. Anything defined in this file is behaviour the
 * server does not share, which is the situation the shared package ends.
 */
export { stripImportJunkChars } from '../../functions/shared/text/textJunk.js'
