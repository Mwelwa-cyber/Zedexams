/**
 * Authoritative real-world Zambian facts injected into every Claude-backed
 * teacher/quiz generation (see anthropicClient.buildSystemBlocks).
 *
 * WHY THIS EXISTS
 * ---------------
 * The models' training data still describes Zambia's PRE-2025 currency, where
 * K2 and K5 were banknotes and the largest note was K100. That is now wrong.
 * The Bank of Zambia launched a new "Heritage" family of banknotes and coins
 * (the 2024 Series) on 31 March 2025; from 1 April 2026 it is the ONLY legal
 * tender. Lesson plans, worksheets and quizzes that say "the K2 note" or that a
 * K50 is the biggest note are factually wrong and embarrass teachers in front
 * of inspectors. This block is the single source of truth so the whole site
 * stays current — edit it here, every generator picks it up.
 *
 * Keep this tightly scoped to durable, verifiable facts. It is NOT a place for
 * volatile data such as exchange rates or current prices.
 */

// Bump when the facts below change so older aiGenerations stay traceable.
const ZAMBIAN_FACTS_VERSION = "zambian_facts.v1_2025_heritage_currency";

const ZAMBIAN_CURRENCY_REFERENCE = `<zambian_facts version="${ZAMBIAN_FACTS_VERSION}">
AUTHORITATIVE ZAMBIAN CURRENCY REFERENCE — use these EXACT facts whenever your
content mentions money, currency, shopping, change, prices, banknotes or coins.
Your training data is out of date on Zambian currency; trust this block over it.

The Bank of Zambia introduced a NEW family of currency (the 2024 "Heritage"
Series) on 31 March 2025. Since 1 April 2026 it is the ONLY legal tender — the
older notes and coins have been withdrawn and must not be referenced as current.

CURRENT BANKNOTES (6 denominations): K10, K20, K50, K100, K200, K500.
  - K200 and K500 are NEW notes. K500 is the highest-value banknote.
CURRENT COINS (6 denominations): 5 ngwee, 10 ngwee, 50 ngwee, K1, K2, K5.
  - K2 and K5 are now COINS, NOT banknotes. The smallest coin is 5 ngwee.
SUBUNIT: 1 Kwacha (K) = 100 ngwee (n). ISO currency code: ZMW.

WHAT CHANGED (do NOT present the old facts as current):
  - K2 and K5 used to be banknotes; they are now coins.
  - There was no K200 or K500 before; these are new banknotes.
  - 1 ngwee and 2 ngwee coins are not part of the current series.

RULES FOR USING THIS:
  - When writing money examples, use ONLY the denominations listed above. Never
    treat K2 or K5 as banknotes, never invent a K1000 banknote or a 1 ngwee
    coin, and never invent any denomination not listed above.
  - Prefer realistic small amounts for primary learners (e.g. K5, K10, K20,
    K50, 50 ngwee) and keep prices plausible for present-day Zambia.
  - Write amounts as "K50" or "K3.50"; write sub-unit amounts as "50 ngwee".
  - Only bring up the currency CHANGE itself when the topic is actually about
    money or the new currency; otherwise just use the correct denominations
    naturally without lecturing about the redesign.
</zambian_facts>`;

module.exports = {
  ZAMBIAN_FACTS_VERSION,
  ZAMBIAN_CURRENCY_REFERENCE,
};
