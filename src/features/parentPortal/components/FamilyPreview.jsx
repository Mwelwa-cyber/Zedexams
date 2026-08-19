/**
 * FamilyPreview — what a guardian will be able to see, shown while they
 * cannot see any of it yet.
 *
 * The three family screens are correct and honest when nothing is linked
 * — and they are also almost entirely blank, which on a desktop leaves
 * most of a very tall page empty and reads as an app that has not
 * finished loading rather than one waiting for a family code.
 *
 * So this is the answer to "what am I getting", not a set of fake cards.
 * Every row here names something the app genuinely does today and that a
 * linked guardian will actually find: the progress cards on Home, the
 * Sunday report on Reports, the approval feed, and the per-child
 * permissions in Manage children. Nothing is invented, and in particular
 * nothing claims a figure — no sample "3h 20m this week", no mocked-up
 * chart — because the first thing a parent would do is compare it to
 * their child and find it was never real. See parentAppCore's header for
 * the same ruling on the dashboard's own numbers.
 */

const ITEMS = [
  {
    icon: '📊',
    title: 'How they are getting on',
    text: 'Quizzes done, subjects going well, and the ones to look at — from their own work, never an estimate.',
  },
  {
    icon: '📈',
    title: 'A weekly report',
    text: 'What went well, where to focus and what to try next. Emailed to you every Sunday, too.',
  },
  {
    icon: '✅',
    title: 'Requests to approve',
    text: 'When your child asks to unlock something, it comes to you — with what they have been working on attached.',
  },
  {
    icon: '🛡️',
    title: 'What they can use',
    text: 'Turn the study helper, games or downloads on and off for each child, and see when it last changed.',
  },
]

export default function FamilyPreview() {
  return (
    <>
      <div className="lhx-section-head">
        <h2 className="lhx-section-title">What you will see here</h2>
      </div>
      <div className="lhx-set-group">
        {ITEMS.map((item) => (
          <div className="lhx-set-row" key={item.title}>
            <span className="lhx-set-ic" aria-hidden="true">{item.icon}</span>
            <span className="lhx-set-txt">
              <span className="lhx-set-title" style={{ display: 'block' }}>{item.title}</span>
              <span className="lhx-set-desc" style={{ display: 'block' }}>{item.text}</span>
            </span>
          </div>
        ))}
      </div>
      <p className="pax-note">
        All of it appears the moment you link a child — nothing here is a sample.
      </p>
    </>
  )
}
