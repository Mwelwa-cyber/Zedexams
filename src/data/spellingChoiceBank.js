/**
 * Word Choice — the gap-fill sentences Spelling Ride's third mode plays on.
 *
 * WHY THIS IS A SEPARATE FILE FROM `spellingBank.js`. The bank is 879 rows of
 * `{ word, band, sentence }`, and every one of its sentences is a CLUE: it
 * gives the word's meaning so a learner can spell it. A Word Choice item is
 * the opposite shape — the sentence is the QUESTION and the three lanes hold
 * whole words, so the item needs the confusables as data. The bank's
 * `homophone` band has ninety words and no record anywhere of which word each
 * one is confused WITH, and deriving that from adjacency ("the row above is
 * probably the partner") would be a guess printed to a child as a fact.
 *
 * So the pairing is authored. What is NOT authored twice is the spelling
 * content itself: a Word Choice item is a sentence and a decision between
 * lookalikes, which the bank does not carry and does not want to.
 *
 * THE RULES, all three enforced by `test:spelling-ride`:
 *
 *   THE SENTENCE NEVER PRINTS ITS OWN ANSWER. Same rule `test:spelling-bank`
 *   holds the bank to, and for the same reason: a sentence containing its
 *   answer turns the exercise into copying.
 *
 *   EXACTLY TWO DISTRACTORS, AND THEY ARE PLAUSIBLE. Three lanes, one right.
 *   A distractor is either the real confusable (`there` under `their`) or the
 *   misspelling a Grade 7 actually writes (`alowed`, `peice`). A random third
 *   word makes the lane free and the data worthless.
 *
 *   BRITISH FORMS IN THE ANSWER. ECZ marks British spelling. Distractors are
 *   deliberately wrong and are exempt — that is what they are for.
 *
 * ZAMBIAN CONTEXT ON PURPOSE. Nshima, kwacha, chitenge, the Zambezi, Munda
 * Wanga, mealie-meal, a bus to Kitwe. A child recognising their own world in
 * the sentence is the difference between a drill and a lesson, and it costs
 * nothing to write it that way.
 *
 * THIS IS THE BASELINE, NOT THE WHOLE CATALOGUE. `spellingSentences` in
 * Firestore is folded over this list by `mergeChoiceItems`, so a wrong
 * sentence is an admin edit rather than a release — and a Firestore outage
 * leaves the learner playing these.
 */

/** Every item: `{ id, text, answer, distractors, note }`. The gap is `___`. */
export const SPELLING_CHOICE_BANK = Object.freeze([
  /* ── the classic homophones ─────────────────────────────────────── */
  { id: 'their-books', text: 'The learners left ___ books in the classroom.', answer: 'their', distractors: ['there', "they're"], note: 'their = belonging to them' },
  { id: 'there-match', text: '___ is a football match on Saturday.', answer: 'There', distractors: ['Their', "They're"], note: 'There is / there are' },
  { id: 'theyre-trip', text: '___ going to enjoy the trip to Livingstone.', answer: "They're", distractors: ['Their', 'There'], note: "they're = they are" },
  { id: 'to-market', text: 'We are going ___ the market after school.', answer: 'to', distractors: ['too', 'two'], note: 'to = towards' },
  { id: 'its-tail', text: 'The dog wagged ___ tail.', answer: 'its', distractors: ["it's", "its'"], note: "its = belonging to it" },
  { id: 'youre-late', text: "___ going to be late if you do not hurry.", answer: "You're", distractors: ['Your', 'Yours'], note: "you're = you are" },
  { id: 'your-homework', text: 'Where is ___ homework, Chanda?', answer: 'your', distractors: ["you're", 'yours'], note: 'your = belonging to you' },
  { id: 'whether-rain', text: 'I do not know ___ it will rain today.', answer: 'whether', distractors: ['weather', 'wether'], note: 'whether = if' },
  { id: 'weather-cold', text: 'The ___ turned cold during the night.', answer: 'weather', distractors: ['whether', 'wheather'], note: 'weather = rain and sun' },
  { id: 'here-sit', text: 'Please come ___ and sit down.', answer: 'here', distractors: ['hear', 'heer'], note: 'here = this place' },
  { id: 'hear-back', text: 'I cannot ___ you from the back of the class.', answer: 'hear', distractors: ['here', 'heer'], note: 'hear = with your ears' },
  { id: 'quiet-teacher', text: 'Be ___ while the teacher is speaking.', answer: 'quiet', distractors: ['quite', 'quit'], note: 'quiet = no noise' },
  { id: 'piece-nshima', text: 'We shared a ___ of nshima.', answer: 'piece', distractors: ['peace', 'peice'], note: 'piece = a part of' },
  { id: 'peace-village', text: 'The village lived in ___ for many years.', answer: 'peace', distractors: ['piece', 'peece'], note: 'peace = no fighting' },
  { id: 'advice-studies', text: 'She gave me good ___ about my studies.', answer: 'advice', distractors: ['advise', 'advize'], note: 'advice = the noun' },
  { id: 'advise-earlier', text: 'I would ___ you to start revising earlier.', answer: 'advise', distractors: ['advice', 'advize'], note: 'advise = the verb' },
  { id: 'principal-school', text: 'The ___ of the school addressed the assembly.', answer: 'principal', distractors: ['principle', 'principel'], note: 'principal = the head' },
  { id: 'principle-honesty', text: 'Honesty is an important ___ to live by.', answer: 'principle', distractors: ['principal', 'principel'], note: 'principle = a rule' },
  { id: 'effect-harvest', text: 'The drought had a serious ___ on the harvest.', answer: 'effect', distractors: ['affect', 'effekt'], note: 'effect = the result' },
  { id: 'affect-crops', text: 'Heavy rain will ___ the crops this season.', answer: 'affect', distractors: ['effect', 'afect'], note: 'affect = to change' },
  { id: 'loose-shoes', text: 'My shoes are too ___ for me.', answer: 'loose', distractors: ['lose', 'loos'], note: 'loose = not tight' },
  { id: 'allowed-corridor', text: 'You are not ___ to run in the corridor.', answer: 'allowed', distractors: ['aloud', 'alowed'], note: 'allowed = permitted' },
  { id: 'aloud-story', text: 'She read the story ___ to the whole class.', answer: 'aloud', distractors: ['allowed', 'alound'], note: 'aloud = out loud' },
  { id: 'peak-mountain', text: 'The ___ of the mountain was covered in mist.', answer: 'peak', distractors: ['peek', 'peake'], note: 'peak = the top' },
  { id: 'peek-paper', text: "Do not ___ at your friend's paper.", answer: 'peek', distractors: ['peak', 'peck'], note: 'peek = a quick look' },
  { id: 'whose-bag', text: '___ bag is this on the desk?', answer: 'Whose', distractors: ["Who's", 'Whos'], note: 'whose = belonging to whom' },
  { id: 'than-brother', text: 'He is taller ___ his brother.', answer: 'than', distractors: ['then', 'thann'], note: 'than = comparing' },
  { id: 'stationery-term', text: 'Buy your ___ before the term begins.', answer: 'stationery', distractors: ['stationary', 'stationry'], note: 'stationery = pens and paper' },
  { id: 'stationary-lorry', text: 'The lorry stood ___ at the roadside.', answer: 'stationary', distractors: ['stationery', 'stationry'], note: 'stationary = not moving' },
  { id: 'accept-gift', text: 'Please ___ this small gift from our class.', answer: 'accept', distractors: ['except', 'acept'], note: 'accept = to take' },
  { id: 'except-one', text: 'Everyone came ___ Mutinta, who was ill.', answer: 'except', distractors: ['accept', 'exept'], note: 'except = apart from' },
  { id: 'practise-songs', text: 'We ___ our songs every Thursday.', answer: 'practise', distractors: ['practice', 'practiss'], note: 'practise = the verb' },
  { id: 'practice-choir', text: 'Choir ___ is on Thursday afternoon.', answer: 'practice', distractors: ['practise', 'practiss'], note: 'practice = the noun' },
  { id: 'brake-bicycle', text: 'The ___ on my bicycle needs tightening.', answer: 'brake', distractors: ['break', 'braik'], note: 'brake = it stops you' },
  { id: 'break-ruler', text: 'Do not ___ the ruler by bending it.', answer: 'break', distractors: ['brake', 'braek'], note: 'break = to snap' },

  /* ── the verbs a Grade 7 gets wrong ──────────────────────────────── */
  { id: 'passed-ball', text: 'He ___ the ball to his teammate.', answer: 'passed', distractors: ['past', 'pased'], note: 'passed = the verb' },
  { id: 'bought-uniforms', text: 'They have ___ their uniforms already.', answer: 'bought', distractors: ['brought', 'buyed'], note: 'bought = paid for' },
  { id: 'brought-lunch', text: 'She ___ her lunch from home this morning.', answer: 'brought', distractors: ['bought', 'brung'], note: 'brought = carried here' },
  { id: 'told-story', text: 'The teacher ___ us a story yesterday.', answer: 'told', distractors: ['tolled', 'telled'], note: 'the past of tell' },
  { id: 'caught-bus', text: 'They ___ the early bus to Kitwe.', answer: 'caught', distractors: ['catched', 'cought'], note: 'the past of catch' },
  { id: 'grew-maize', text: 'The farmer ___ maize last season.', answer: 'grew', distractors: ['growed', 'grewed'], note: 'the past of grow' },
  { id: 'done-homework', text: 'I have already ___ my homework.', answer: 'done', distractors: ['did', 'dun'], note: 'have done, not have did' },
  { id: 'lost-pencil', text: 'Chanda has ___ his pencil again.', answer: 'lost', distractors: ['loosed', 'losted'], note: 'the past of lose' },
  { id: 'risen-fare', text: 'The bus fare has ___ again this term.', answer: 'risen', distractors: ['rised', 'raised'], note: 'has risen by itself' },
  { id: 'rises-sun', text: 'The sun ___ in the east.', answer: 'rises', distractors: ['raises', 'rizes'], note: 'it rises on its own' },
  { id: 'goes-school', text: 'She ___ to school every day.', answer: 'goes', distractors: ['go', 'gose'], note: 'she goes, they go' },
  { id: 'played-netball', text: 'We ___ netball yesterday afternoon.', answer: 'played', distractors: ['play', 'plaied'], note: 'yesterday = past tense' },

  /* ── grammar the exam actually tests ─────────────────────────────── */
  { id: 'were-outside', text: 'The children ___ playing outside.', answer: 'were', distractors: ['was', 'where'], note: 'children were, a child was' },
  { id: 'well-exam', text: 'He did very ___ in the examination.', answer: 'well', distractors: ['good', 'goodly'], note: 'did well, not did good' },
  { id: 'fewer-oranges', text: 'There are ___ oranges than mangoes in the basket.', answer: 'fewer', distractors: ['less', 'fewest'], note: 'fewer for things you count' },
  { id: 'tallest-class', text: 'Nsofwa is the ___ girl in the class.', answer: 'tallest', distractors: ['taller', 'most tall'], note: 'tallest of them all' },

  /* ── Zambian classroom and market words ─────────────────────────── */
  { id: 'kwacha-change', text: 'The trader gave me my change in ___.', answer: 'kwacha', distractors: ['quacha', 'kwatcha'], note: 'our currency' },
  { id: 'chitenge-market', text: 'Mother bought a bright ___ at Soweto Market.', answer: 'chitenge', distractors: ['chitenje', 'chintenge'], note: 'the printed cloth' },
  { id: 'mealie-meal', text: 'We carried a bag of ___ home from the depot.', answer: 'mealie-meal', distractors: ['meelie-meal', 'mealy-meal'], note: 'what nshima is made from' },
  { id: 'zambezi-river', text: 'The ___ River drops over the Victoria Falls.', answer: 'Zambezi', distractors: ['Zambesi', 'Zambeezi'], note: 'our great river' },
  { id: 'council-refuse', text: 'The town ___ collects refuse on Fridays.', answer: 'council', distractors: ['counsel', 'councel'], note: 'council = the local authority' },
  { id: 'heritage-falls', text: 'The falls are a world ___ site.', answer: 'heritage', distractors: ['heritege', 'heretage'], note: 'passed down to us' },
])

/**
 * Fold approved Firestore sentences over the bundled list.
 *
 * A MERGE, NOT A REPLACEMENT — the same rule `mergeIntoPack` follows for
 * words, for the same reason: an admin adding four sentences must not replace
 * fifty-seven with four. A Firestore record whose id matches a bundled one
 * WINS, because somebody edited it and the reason they edited it was that the
 * bundled one was wrong.
 *
 * Pure, so the node test drives it without Firestore.
 */
export function mergeChoiceItems(bundled = [], approved = []) {
  if (!Array.isArray(approved) || !approved.length) return bundled
  const byId = new Map(bundled.map((item) => [String(item.id), item]))
  for (const record of approved) {
    const id = String(record?.id || '').trim()
    const text = String(record?.text || '').trim()
    const answer = String(record?.answer || '').trim()
    const distractors = Array.isArray(record?.distractors)
      ? record.distractors.map((d) => String(d).trim()).filter(Boolean)
      : []
    // A malformed record is DROPPED rather than merged. It reached here past
    // the rule and past the service's own filter, so the honest reading is a
    // record written before a shape changed — and a lane with a blank tile in
    // it is worse than one fewer sentence.
    if (!id || !text || !answer || distractors.length < 2) continue
    byId.set(id, { id, text, answer, distractors: distractors.slice(0, 2), note: String(record?.note || '') })
  }
  return [...byId.values()]
}
