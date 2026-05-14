import { useState } from "react";
import {
  MOE_CALENDAR,
  getActiveTerm,
  getTermStatus,
  daysUntil,
  fmtDate,
  getCurrentWeekInTerm,
  getTotalWeeksInTerm,
  getUpcomingHolidays,
} from "../../utils/moeCalendar";

// ── Design tokens (ZedExams) ──────────────────────────────────────────────────
const NAVY  = "#0F1B2D";
const DEEP  = "#1A2F4E";
const GOLD  = "#C9A84C";
const CREAM = "#FAF7F2";
const WHITE = "#FFFFFF";
const MUTED = "#8A9BB0";

const TERM_ACCENT = ["#1A6B5A", "#1A4B8E", "#7B2D8B"];
const TERM_SOFT   = ["#EAF5F2", "#EAF0FA", "#F5EAF9"];

// ── Helpers ───────────────────────────────────────────────────────────────────
function today() {
  const d = new Date(); d.setHours(0,0,0,0); return d;
}

function detectYear() {
  const y = today().getFullYear();
  return MOE_CALENDAR[y] ? y : 2026;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TermPill({ term, index, active, onClick }) {
  const status = getTermStatus(term);
  const accent = TERM_ACCENT[index];
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 18px",
        borderRadius: 99,
        border: `2px solid ${active ? accent : "#E5E9EF"}`,
        background: active ? accent : WHITE,
        color: active ? WHITE : MUTED,
        fontSize: 13, fontWeight: 700,
        cursor: "pointer",
        fontFamily: "Georgia, serif",
        transition: "all 0.18s",
        boxShadow: active ? `0 3px 10px ${accent}44` : "none",
        display: "flex", alignItems: "center", gap: 6,
      }}
    >
      <span>Term {index + 1}</span>
      {status === "active" && (
        <span style={{
          width: 7, height: 7, borderRadius: "50%",
          background: active ? WHITE : GOLD,
          display: "inline-block",
          boxShadow: "0 0 0 2px rgba(255,255,255,0.4)",
          animation: "pulse 1.5s infinite",
        }} />
      )}
    </button>
  );
}

function CountdownCard({ term, termIndex }) {
  const status = getTermStatus(term);
  const accent = TERM_ACCENT[termIndex];
  const soft   = TERM_SOFT[termIndex];
  const week   = status === "active" ? getCurrentWeekInTerm() : null;
  const total  = getTotalWeeksInTerm(term);

  if (status === "past") {
    return (
      <div style={{
        background: "#F7F7F7", borderRadius: 14,
        padding: "20px 24px", textAlign: "center",
        border: "1px solid #E5E9EF",
      }}>
        <div style={{ fontSize: 32 }}>✓</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#AAA", marginTop: 4 }}>Term Complete</div>
      </div>
    );
  }

  if (status === "upcoming") {
    const d = daysUntil(term.open);
    return (
      <div style={{
        background: soft, borderRadius: 14,
        padding: "20px 24px", textAlign: "center",
        border: `1px solid ${accent}33`,
      }}>
        <div style={{ fontSize: 11, color: accent, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>
          School Opens In
        </div>
        <div style={{ fontSize: 52, fontWeight: 800, color: accent, lineHeight: 1.1, margin: "6px 0" }}>{d}</div>
        <div style={{ fontSize: 13, color: DEEP, fontWeight: 600 }}>days</div>
        <div style={{ fontSize: 12, color: MUTED, marginTop: 8 }}>{fmtDate(term.open, "full")}</div>
      </div>
    );
  }

  // Active
  const dLeft = daysUntil(term.close);
  const pct = Math.max(0, Math.min(100, Math.round(
    ((term.residentDays - dLeft) / term.residentDays) * 100
  )));

  return (
    <div style={{
      background: soft, borderRadius: 14,
      padding: "20px 24px",
      border: `1px solid ${accent}33`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: accent, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            School Closes
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: NAVY, marginTop: 2 }}>
            {fmtDate(term.close, "short")}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: MUTED, fontWeight: 600 }}>WEEK</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: accent }}>{week}</div>
          <div style={{ fontSize: 11, color: MUTED }}>of {total}</div>
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: MUTED, marginBottom: 5 }}>
          <span style={{ fontWeight: 600 }}>{pct}% through the term</span>
          <span style={{ color: "#C0392B", fontWeight: 700 }}>{dLeft} days left</span>
        </div>
        <div style={{ background: `${accent}22`, borderRadius: 99, height: 8, overflow: "hidden" }}>
          <div style={{
            width: `${pct}%`, height: "100%",
            background: `linear-gradient(90deg, ${accent}, ${accent}AA)`,
            borderRadius: 99,
            transition: "width 0.6s ease",
          }} />
        </div>
      </div>
    </div>
  );
}

function HolidayRow({ holiday }) {
  const d = daysUntil(holiday.date);
  const isToday  = d === 0;
  const isSoon   = d > 0 && d <= 7;
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "10px 14px", borderRadius: 8,
      background: isToday ? "#FFF8E6" : isSoon ? "#FFF3F3" : "#F7F9FC",
      border: `1px solid ${isToday ? GOLD : isSoon ? "#FFC0C0" : "#E5E9EF"}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>
          {isToday ? "🎉" : isSoon ? "⚠️" : "📅"}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>{holiday.name}</span>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: isToday ? GOLD : isSoon ? "#C0392B" : MUTED }}>
          {isToday ? "TODAY!" : isSoon ? `${d} days` : fmtDate(holiday.date, "day")}
        </div>
        {!isToday && (
          <div style={{ fontSize: 10, color: MUTED }}>{fmtDate(holiday.date, "short").split(" ").slice(0,2).join(" ")}</div>
        )}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function LearnerCalendar() {
  const [year, setYear]       = useState(detectYear);
  const [termIdx, setTermIdx] = useState(() => {
    const active = getActiveTerm();
    return active ? active.termIndex : 0;
  });

  const terms    = MOE_CALENDAR[year].terms;
  const term     = terms[termIdx];
  const upcoming = getUpcomingHolidays(30);

  return (
    <div style={{
      minHeight: "100vh",
      background: CREAM,
      fontFamily: "Georgia, serif",
      padding: "20px 16px",
    }}>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      {/* Header */}
      <div style={{
        background: `linear-gradient(135deg, ${NAVY} 0%, ${DEEP} 100%)`,
        borderRadius: 16, padding: "20px 24px", marginBottom: 20,
        position: "relative", overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", bottom: -30, right: -30,
          width: 130, height: 130,
          background: `radial-gradient(circle, ${GOLD}22, transparent 70%)`,
          borderRadius: "50%",
        }} />
        <div style={{ fontSize: 10, color: GOLD, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 4 }}>
          ZedExams · School Calendar
        </div>
        <h2 style={{ margin: 0, color: WHITE, fontSize: 20, fontWeight: 700 }}>
          {year} Academic Year
        </h2>
        <p style={{ margin: "4px 0 16px", color: MUTED, fontSize: 12 }}>
          Ministry of Education, Republic of Zambia
        </p>

        {/* Year picker */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {Object.keys(MOE_CALENDAR).map(y => (
            <button
              key={y}
              onClick={() => { setYear(+y); setTermIdx(0); }}
              style={{
                padding: "4px 14px", borderRadius: 99, border: "none",
                cursor: "pointer", fontSize: 12, fontWeight: 700,
                fontFamily: "Georgia, serif",
                background: +y === year ? GOLD : "rgba(255,255,255,0.1)",
                color: +y === year ? NAVY : "rgba(255,255,255,0.6)",
                transition: "all 0.18s",
              }}
            >{y}</button>
          ))}
        </div>
      </div>

      {/* Term Pills */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        {terms.map((t, i) => (
          <TermPill key={i} term={t} index={i} active={termIdx === i} onClick={() => setTermIdx(i)} />
        ))}
      </div>

      {/* Countdown */}
      <CountdownCard term={term} termIndex={termIdx} />

      {/* Term quick dates */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr",
        gap: 10, margin: "14px 0",
      }}>
        {[
          { label: "Opens",        value: fmtDate(term.open, "short") },
          { label: "Closes",       value: fmtDate(term.close, "short") },
          { label: "Working Days", value: term.workingDays },
          { label: "Holiday",      value: `${term.holidayLength} days` },
        ].map(({ label, value }) => (
          <div key={label} style={{
            background: WHITE, borderRadius: 10, padding: "12px 16px",
            border: "1px solid #E5E9EF",
          }}>
            <div style={{ fontSize: 10, color: MUTED, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: NAVY, marginTop: 3 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Upcoming Holidays */}
      <div style={{ background: WHITE, borderRadius: 14, overflow: "hidden", border: "1px solid #E5E9EF" }}>
        <div style={{
          padding: "14px 18px",
          borderBottom: "1px solid #E5E9EF",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>Upcoming Public Holidays</div>
          <div style={{ fontSize: 11, color: MUTED }}>Next 30 days</div>
        </div>
        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
          {upcoming.length === 0 ? (
            <p style={{ fontSize: 13, color: MUTED, fontStyle: "italic", margin: 0 }}>
              No public holidays in the next 30 days.
            </p>
          ) : (
            upcoming.map((h, i) => <HolidayRow key={i} holiday={h} />)
          )}
        </div>
      </div>

      {/* All holidays this term */}
      <div style={{ marginTop: 14, background: WHITE, borderRadius: 14, overflow: "hidden", border: "1px solid #E5E9EF" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #E5E9EF" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>
            {term.name} — All Public Holidays
          </div>
        </div>
        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
          {term.holidays.map((h, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between",
              padding: "8px 12px", borderRadius: 8,
              background: "#F7F9FC", border: "1px solid #E5E9EF",
            }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>{h.name}</span>
              <span style={{ fontSize: 12, color: MUTED, fontWeight: 600 }}>{fmtDate(h.date, "short")}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <p style={{ textAlign: "center", fontSize: 10, color: MUTED, marginTop: 20 }}>
        Source: MoE Zambia Official School Calendar 2026–2030 · Ng'andu Edition
      </p>
    </div>
  );
}
