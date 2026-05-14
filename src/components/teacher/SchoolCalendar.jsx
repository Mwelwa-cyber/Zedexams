import { useState, useEffect } from "react";
import {
  MOE_CALENDAR,
  getActiveTerm,
  getTermStatus,
  daysUntil,
  fmtDate,
} from "../../utils/moeCalendar";

// ── Design tokens ─────────────────────────────────────────────────────────────
// Brand-stable accents — look fine on either light or Midnight surfaces.
const GOLD       = "#C9A84C";
const GOLD_LIGHT = "#E8C96A";
const RED        = "#C0392B";
const INK_DARK   = "#0F1B2D"; // text painted on top of a GOLD chip — never flips
const termColors = ["#1A6B5A", "#1A4B8E", "#7B2D8B"];

// Theme-aware surfaces / ink — backed by .moe-calendar CSS vars in index.css
// (defaults to Navy/Gold/Cream; overridden inside body.theme-midnight).
const PAGE_BG      = "var(--moe-page-bg)";
const SURFACE      = "var(--moe-surface)";
const SURFACE_2    = "var(--moe-surface-2)";
const STRONG_BG    = "var(--moe-strong-bg)";
const STRONG_BG_2  = "var(--moe-strong-bg-2)";
const FG           = "var(--moe-fg)";
const FG_MUTED     = "var(--moe-fg-muted)";
const FG_ON_STRONG = "var(--moe-fg-on-strong)";
const BORDER       = "var(--moe-border)";
const DIVIDER      = "var(--moe-divider)";
const SOFT_WARN_BG = "var(--moe-soft-warn-bg)";
const PROGRESS_TR  = "var(--moe-progress-track)";

const termBg = [
  "var(--moe-term-soft-1)",
  "var(--moe-term-soft-2)",
  "var(--moe-term-soft-3)",
];

// ── Local helpers (UI-only, not worth exporting to lib) ───────────────────────

/** Initialise the selected year from the active term, falling back to today's year or 2026. */
function detectCurrentYear() {
  const active = getActiveTerm();
  if (active) return active.year;
  const y = new Date().getFullYear();
  return MOE_CALENDAR[y] ? y : 2026;
}

/** Initialise the selected term index for a given year. */
function detectCurrentTerm(year) {
  const active = getActiveTerm();
  if (active && active.year === year) return active.termIndex;
  // Not currently in a term — pick first upcoming.
  const terms = MOE_CALENDAR[year]?.terms ?? [];
  const upcomingIdx = terms.findIndex((t) => getTermStatus(t) === "upcoming");
  return upcomingIdx !== -1 ? upcomingIdx : 0;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const cfg = {
    active:   { bg: GOLD,                       color: INK_DARK,                 label: "● ACTIVE"    },
    upcoming: { bg: "#E8F4F8",                  color: "#1A4B8E",                label: "◦ UPCOMING"  },
    past:     { bg: "var(--moe-past-bg)",       color: "var(--moe-past-fg)",     label: "✓ COMPLETED" },
  }[status];
  return (
    <span style={{
      background: cfg.bg, color: cfg.color,
      fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
      padding: "3px 8px", borderRadius: 4,
      fontFamily: "monospace",
    }}>
      {cfg.label}
    </span>
  );
}

function CountdownChip({ term, status }) {
  if (status === "past") return null;

  if (status === "upcoming") {
    const d = daysUntil(term.open);
    return (
      <div style={{ marginTop: 8, fontSize: 12, color: FG, fontWeight: 600 }}>
        Opens in <span style={{ color: GOLD, fontWeight: 800 }}>{d}</span> days
      </div>
    );
  }

  const d   = daysUntil(term.close);
  const pct = Math.max(0, Math.min(100, Math.round(((term.workingDays - d) / term.workingDays) * 100)));
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: FG_MUTED, marginBottom: 4 }}>
        <span style={{ fontWeight: 600, color: RED }}>{d} working days left</span>
        <span>{pct}% elapsed</span>
      </div>
      <div style={{ background: PROGRESS_TR, borderRadius: 99, height: 6, overflow: "hidden" }}>
        <div style={{
          width: `${pct}%`, height: "100%",
          background: `linear-gradient(90deg, ${GOLD}, ${GOLD_LIGHT})`,
          borderRadius: 99, transition: "width 0.6s ease",
        }} />
      </div>
    </div>
  );
}

function HolidayList({ holidays }) {
  const upcoming = holidays
    .map((h) => ({ ...h, delta: daysUntil(h.date) }))
    .filter((h) => h.delta >= 0)
    .sort((a, b) => a.delta - b.delta);

  if (upcoming.length === 0) {
    return (
      <p style={{ fontSize: 12, color: FG_MUTED, fontStyle: "italic", margin: 0 }}>
        No upcoming holidays this term.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {upcoming.map((h, i) => (
        <div key={i} style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "6px 10px", borderRadius: 6,
          background: h.delta === 0 ? SOFT_WARN_BG : SURFACE_2,
          border: `1px solid ${h.delta === 0 ? GOLD : BORDER}`,
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: FG }}>{h.name}</span>
          <span style={{ fontSize: 11, color: h.delta === 0 ? GOLD : FG_MUTED, fontWeight: 700 }}>
            {h.delta === 0 ? "TODAY" : h.delta === 1 ? "Tomorrow" : fmtDate(h.date, "day")}
          </span>
        </div>
      ))}
    </div>
  );
}

function TermCard({ term, index, isSelected, onClick }) {
  const status = getTermStatus(term);
  const color  = termColors[index];
  const bg     = termBg[index];

  return (
    <div
      onClick={onClick}
      style={{
        cursor: "pointer",
        borderRadius: 12,
        border: `2px solid ${isSelected ? color : BORDER}`,
        background: isSelected ? bg : SURFACE,
        padding: "16px 18px",
        transition: "all 0.2s ease",
        boxShadow: isSelected ? `0 4px 16px ${color}22` : "0 1px 4px rgba(0,0,0,0.05)",
        transform: isSelected ? "translateY(-2px)" : "none",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 2 }}>
            Term {index + 1}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: FG }}>{term.name}</div>
        </div>
        <StatusBadge status={status} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px", fontSize: 12, marginBottom: 10 }}>
        {[
          ["Opens",        fmtDate(term.open,  "short")],
          ["Closes",       fmtDate(term.close, "short")],
          ["Working Days", term.workingDays],
          ["Holiday",      `${term.holidayLength} days`],
        ].map(([label, value]) => (
          <div key={label}>
            <div style={{ color: FG_MUTED, fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
            <div style={{ color: FG, fontWeight: 700, marginTop: 1 }}>{value}</div>
          </div>
        ))}
      </div>

      <CountdownChip term={term} status={status} />
    </div>
  );
}

function SectionTitle({ children, style }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, color: FG_MUTED,
      textTransform: "uppercase", letterSpacing: "0.1em",
      marginBottom: 8, ...style,
    }}>
      {children}
    </div>
  );
}

function InfoRow({ label, value, highlight }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between",
      padding: "5px 0", borderBottom: `1px solid ${DIVIDER}`,
    }}>
      <span style={{ fontSize: 12, color: FG_MUTED }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: highlight ? GOLD : FG }}>{value}</span>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function SchoolCalendar() {
  const [year,    setYear]    = useState(detectCurrentYear);
  const [termIdx, setTermIdx] = useState(() => detectCurrentTerm(detectCurrentYear()));

  // Re-detect term when year changes.
  useEffect(() => {
    setTermIdx(detectCurrentTerm(year));
  }, [year]);

  const terms            = MOE_CALENDAR[year].terms;
  const selected         = terms[termIdx];
  const status           = getTermStatus(selected);
  const totalWorkingDays = terms.reduce((sum, t) => sum + t.workingDays, 0);

  return (
    <div
      className="moe-calendar"
      style={{
        minHeight: "100vh",
        background: PAGE_BG,
        fontFamily: "'Georgia', serif",
        padding: "24px 16px",
      }}
    >
      {/* ── Header ── */}
      <div style={{
        background: STRONG_BG, borderRadius: 16, padding: "24px 28px",
        marginBottom: 20, position: "relative", overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", top: -20, right: -20,
          width: 120, height: 120,
          background: `radial-gradient(circle, ${GOLD}33, transparent 70%)`,
          borderRadius: "50%",
        }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, color: GOLD, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 4 }}>
              Republic of Zambia · Ministry of Education
            </div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: FG_ON_STRONG, lineHeight: 1.2 }}>
              School Calendar
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: FG_MUTED }}>
              Early Childhood, Primary &amp; Secondary
            </p>
          </div>
          <div style={{ fontSize: 12, color: FG_MUTED, textAlign: "right" }}>
            <div style={{ color: GOLD, fontWeight: 700, fontSize: 14 }}>
              {new Date().toLocaleDateString("en-ZM", { weekday: "short", day: "numeric", month: "long", year: "numeric" })}
            </div>
            <div style={{ marginTop: 2 }}>Today</div>
          </div>
        </div>

        {/* Year selector */}
        <div style={{ display: "flex", gap: 8, marginTop: 20, flexWrap: "wrap" }}>
          {Object.keys(MOE_CALENDAR).map((y) => (
            <button
              key={y}
              onClick={() => setYear(+y)}
              style={{
                padding: "6px 16px", borderRadius: 99, border: "none",
                cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700,
                transition: "all 0.2s",
                background: +y === year ? GOLD : "rgba(255,255,255,0.1)",
                color:      +y === year ? INK_DARK : "rgba(255,255,255,0.7)",
              }}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      {/* ── Term Cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 20 }}>
        {terms.map((term, i) => (
          <TermCard key={term.id} term={term} index={i} isSelected={termIdx === i} onClick={() => setTermIdx(i)} />
        ))}
      </div>

      {/* ── Detail Panel ── */}
      <div style={{
        background: SURFACE, borderRadius: 16,
        border: `1px solid ${BORDER}`,
        boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
        overflow: "hidden",
      }}>
        {/* Panel header */}
        <div style={{
          background: STRONG_BG_2, padding: "16px 20px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <div style={{ fontSize: 10, color: GOLD, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              {year} · Term {termIdx + 1}
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: FG_ON_STRONG, marginTop: 2 }}>
              {selected.name}
            </div>
          </div>
          <StatusBadge status={status} />
        </div>

        <div style={{ padding: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {/* Dates column */}
          <div>
            <SectionTitle>Term Dates</SectionTitle>
            <InfoRow label="Opens"         value={fmtDate(selected.open,  "short")} highlight={status === "upcoming"} />
            <InfoRow label="Closes"        value={fmtDate(selected.close, "short")} highlight={status === "active"}   />
            <InfoRow label="Resident Days" value={selected.residentDays} />
            <InfoRow label="Working Days"  value={selected.workingDays}  />
            <InfoRow label="Holiday"       value={`${selected.holidayLength} days`} />

            <SectionTitle style={{ marginTop: 16 }}>ECE Mid-Term Break</SectionTitle>
            <InfoRow label="Start" value={fmtDate(selected.eceMidStart, "short")} />
            <InfoRow label="End"   value={fmtDate(selected.eceMidEnd,   "short")} />
          </div>

          {/* Holidays column */}
          <div>
            <SectionTitle>
              {status === "past" ? "Public Holidays" : "Upcoming Holidays"}
            </SectionTitle>
            {status === "past" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {selected.holidays.map((h, i) => (
                  <div key={i} style={{
                    display: "flex", justifyContent: "space-between",
                    padding: "6px 10px", borderRadius: 6,
                    background: SURFACE_2, border: `1px solid ${BORDER}`,
                  }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: FG }}>{h.name}</span>
                    <span style={{ fontSize: 11, color: FG_MUTED }}>{fmtDate(h.date, "day")}</span>
                  </div>
                ))}
              </div>
            ) : (
              <HolidayList holidays={selected.holidays} />
            )}
          </div>
        </div>

        {/* Footer summary */}
        <div style={{
          background: SURFACE_2, borderTop: `1px solid ${BORDER}`,
          padding: "12px 20px",
          display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center",
        }}>
          <div>
            <div style={{ fontSize: 10, color: FG_MUTED, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em" }}>Total Resident Days</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: FG }}>267</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: FG_MUTED, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em" }}>Total Working Days</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: FG }}>{totalWorkingDays}</div>
          </div>
          <div style={{ marginLeft: "auto" }}>
            <span style={{ fontSize: 10, color: FG_MUTED }}>Source: </span>
            <span style={{ fontSize: 10, fontWeight: 700, color: FG }}>MoE Zambia Official Calendar 2026–2030</span>
          </div>
        </div>
      </div>
    </div>
  );
}
