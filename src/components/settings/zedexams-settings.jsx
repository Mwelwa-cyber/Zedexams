import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTheme, THEMES } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import CharacterAvatar, {
  CHARACTERS,
  INTEREST_GROUPS,
  getCharacter,
} from '../profile/CharacterAvatar';
import SeoHelmet from '../seo/SeoHelmet';
import LanguageToggle from '../ui/LanguageToggle';
import ParentShareManager from '../parent/ParentShareManager';
import {
  loadAccessibilityPrefs,
  saveAccessibilityPrefs,
} from '../../utils/accessibility';

/* ============================================================================
 * ZedExams — Settings module
 * ----------------------------------------------------------------------------
 * Role-aware settings UI for Admin / Teacher / Learner.
 * Every panel is Firestore-wired or localStorage-wired — there is no mock
 * UI in this file. Admin/Teacher tabs are deliberately limited to the
 * surfaces with a real backend; site-wide admin controls and user
 * management live on the /admin/* routes.
 * ========================================================================== */

/* ── Theme tokens ─────────────────────────────────────────────────────────── */
const T = {
  primary:       '#0e7490',
  primaryHover:  '#0c5e75',
  primarySoft:   '#e0f7fa',
  dark:          '#0f172a',
  surface:       '#f1f5f9',
  panel:         '#ffffff',
  border:        '#e2e8f0',
  borderStrong:  '#cbd5e1',
  muted:         '#64748b',
  text:          '#0f172a',
  textSoft:      '#334155',
  danger:        '#dc2626',
  dangerSoft:    '#fee2e2',
  success:       '#16a34a',
  successSoft:   '#dcfce7',
  warning:       '#d97706',
  font:          "'Sora', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
};

/* ── Tabs per role ────────────────────────────────────────────────────────── */
const TABS = {
  // Admin gets the personal-account preferences that map to their own
  // profile. Site-wide admin controls and user management live on /admin/*.
  admin: [
    { id: 'security',      label: 'Password & Security' },
    { id: 'accessibility', label: 'Accessibility' },
    { id: 'appearance',    label: 'Appearance' },
  ],
  teacher: [
    { id: 'accessibility', label: 'Accessibility' },
    { id: 'appearance',    label: 'Appearance' },
  ],
  // Theme/appearance is removed for learners — the dashboard already
  // hosts a global ThemeSelector, so duplicating it here just confuses
  // children. We also split profile + security into distinct sections,
  // add a Learning Preferences tab for grade/sounds/language, an
  // Accessibility tab (reduced motion, font size, high-contrast), and
  // a Parent/Guardian tab that wraps the existing ParentShareManager.
  learner: [
    { id: 'profile',       label: 'Profile' },
    { id: 'security',      label: 'Password & Security' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'learning',      label: 'Learning Preferences' },
    { id: 'accessibility', label: 'Accessibility' },
    { id: 'parent',        label: 'Parent / Guardian' },
  ],
};

/* ── Validation helpers ───────────────────────────────────────────────────── */
const isNonEmpty = (v) => String(v ?? '').trim().length > 0;
const uid        = () => Math.random().toString(36).slice(2, 9);

/* ── Hooks ────────────────────────────────────────────────────────────────── */
function useIsMobile(bp = 768) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < bp : false
  );
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setIsMobile(window.innerWidth < bp);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [bp]);
  return isMobile;
}

/* Inject Sora font + minimal hover/focus styles once. */
const STYLE_TAG_ID = 'zx-settings-runtime-style';
const FONT_TAG_ID  = 'zx-settings-sora-font';

function ensureRuntimeAssets() {
  if (typeof document === 'undefined') return;

  if (!document.getElementById(FONT_TAG_ID)) {
    const link = document.createElement('link');
    link.id   = FONT_TAG_ID;
    link.rel  = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&display=swap';
    document.head.appendChild(link);
  }

  if (!document.getElementById(STYLE_TAG_ID)) {
    const tag = document.createElement('style');
    tag.id = STYLE_TAG_ID;
    tag.textContent = `
      .zx-btn        { transition: filter .15s ease, background .15s ease, border-color .15s ease, box-shadow .15s ease; }
      .zx-btn:hover:not(:disabled)  { filter: brightness(.94); }
      .zx-btn:active:not(:disabled) { filter: brightness(.88); }
      .zx-btn:disabled              { opacity: .55; cursor: not-allowed; }
      .zx-input:focus, .zx-select:focus {
        outline: none;
        border-color: ${T.primary};
        box-shadow: 0 0 0 3px ${T.primarySoft};
      }
      .zx-tab:hover     { background: ${T.surface}; }
      .zx-link:hover    { text-decoration: underline; }
      .zx-fade-in       { animation: zxFadeIn .18s ease-out; }
      @keyframes zxFadeIn {
        from { opacity: 0; transform: translateY(-4px); }
        to   { opacity: 1; transform: translateY(0); }
      }

      .zx-grid-2 {
        display: grid;
        grid-template-columns: 1fr 1fr;
        column-gap: 20px;
      }

      @media (max-width: 640px) {
        .zx-grid-2 { grid-template-columns: 1fr; }
      }
    `;
    document.head.appendChild(tag);
  }
}

/* ── Reusable primitives ──────────────────────────────────────────────────── */

function FieldLabel({ children, required, hint }) {
  return (
    <label style={{
      display: 'block', fontSize: 13, fontWeight: 600,
      color: T.textSoft, marginBottom: 6,
    }}>
      {children}
      {required && <span style={{ color: T.danger, marginLeft: 4 }}>*</span>}
      {hint && (
        <span style={{ color: T.muted, fontWeight: 400, marginLeft: 8 }}>
          {hint}
        </span>
      )}
    </label>
  );
}

function FieldError({ children }) {
  if (!children) return null;
  return (
    <div style={{
      color: T.danger, fontSize: 12, marginTop: 6, fontWeight: 500,
    }}>
      {children}
    </div>
  );
}

function TextField({
  label, value, onChange, type = 'text', required, error, hint,
  placeholder, autoComplete, disabled, id,
}) {
  const inputId = id || `zx-${label?.toLowerCase().replace(/\s+/g, '-') || uid()}`;
  return (
    <div style={{ marginBottom: 16 }}>
      {label && <FieldLabel required={required} hint={hint}>{label}</FieldLabel>}
      <input
        id={inputId}
        className="zx-input"
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: '10px 12px',
          fontFamily: T.font, fontSize: 14, color: T.text,
          background: disabled ? T.surface : T.panel,
          border: `1px solid ${error ? T.danger : T.border}`,
          borderRadius: 8,
        }}
      />
      <FieldError>{error}</FieldError>
    </div>
  );
}

function SelectField({ label, value, onChange, options, error, hint }) {
  return (
    <div style={{ marginBottom: 16 }}>
      {label && <FieldLabel hint={hint}>{label}</FieldLabel>}
      <select
        className="zx-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: '10px 12px',
          fontFamily: T.font, fontSize: 14, color: T.text,
          background: T.panel,
          border: `1px solid ${error ? T.danger : T.border}`,
          borderRadius: 8,
          cursor: 'pointer',
        }}
      >
        {options.map((opt) => {
          const v = typeof opt === 'string' ? opt : opt.value;
          const l = typeof opt === 'string' ? opt : opt.label;
          return <option key={v} value={v}>{l}</option>;
        })}
      </select>
      <FieldError>{error}</FieldError>
    </div>
  );
}

function Toggle({ label, description, checked, onChange, disabled }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      padding: '12px 0',
      gap: 16,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{label}</div>
        {description && (
          <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
            {description}
          </div>
        )}
      </div>
      <button
        type="button"
        className="zx-btn"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        style={{
          flex: '0 0 auto',
          width: 44, height: 24, padding: 0,
          border: 'none', borderRadius: 999,
          background: checked ? T.primary : T.borderStrong,
          position: 'relative', cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <span style={{
          position: 'absolute', top: 2,
          left: checked ? 22 : 2,
          width: 20, height: 20, borderRadius: '50%',
          background: T.panel,
          boxShadow: '0 1px 3px rgba(0,0,0,.25)',
          transition: 'left .15s ease',
        }} />
      </button>
    </div>
  );
}

function Button({
  children, onClick, variant = 'primary', type = 'button',
  disabled, loading, full, icon, danger, style,
}) {
  const palette = {
    primary: { bg: T.primary,    fg: T.panel,  border: T.primary },
    ghost:   { bg: 'transparent', fg: T.text,  border: T.border },
    soft:    { bg: T.surface,    fg: T.text,   border: T.border },
    danger:  { bg: T.danger,     fg: T.panel,  border: T.danger },
  };
  const p = danger ? palette.danger : (palette[variant] || palette.primary);
  return (
    <button
      type={type}
      className="zx-btn"
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        gap: 8,
        padding: '10px 16px',
        fontFamily: T.font, fontSize: 14, fontWeight: 600,
        color: p.fg, background: p.bg,
        border: `1px solid ${p.border}`,
        borderRadius: 8,
        cursor: 'pointer',
        width: full ? '100%' : 'auto',
        ...style,
      }}
    >
      {loading && <Spinner color={p.fg} />}
      {!loading && icon}
      <span>{loading ? 'Saving…' : children}</span>
    </button>
  );
}

function Spinner({ color = T.panel, size = 14 }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block', width: size, height: size,
        border: `2px solid ${color}`,
        borderTopColor: 'transparent',
        borderRadius: '50%',
        animation: 'zxSpin .7s linear infinite',
      }}
    >
      <style>{`@keyframes zxSpin { to { transform: rotate(360deg); } }`}</style>
    </span>
  );
}

function Toast({ kind = 'success', message, onClose }) {
  useEffect(() => {
    if (!message) return undefined;
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [message, onClose]);
  if (!message) return null;
  const palette = kind === 'error'
    ? { bg: T.dangerSoft,  fg: T.danger,  border: T.danger }
    : { bg: T.successSoft, fg: T.success, border: T.success };
  return (
    <div
      role="status"
      className="zx-fade-in"
      style={{
        position: 'fixed', top: 16, right: 16, zIndex: 1000,
        maxWidth: 360,
        padding: '12px 14px',
        background: palette.bg, color: palette.fg,
        border: `1px solid ${palette.border}`,
        borderRadius: 10,
        fontFamily: T.font, fontSize: 14, fontWeight: 600,
        boxShadow: '0 8px 24px rgba(15,23,42,.08)',
        display: 'flex', alignItems: 'flex-start', gap: 10,
      }}
    >
      <span style={{ flex: 1 }}>{message}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        style={{
          border: 'none', background: 'transparent', color: palette.fg,
          fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}

function SectionCard({ title, description, children, footer }) {
  return (
    <section style={{
      background: T.panel,
      border: `1px solid ${T.border}`,
      borderRadius: 12,
      marginBottom: 20,
      overflow: 'hidden',
    }}>
      <header style={{ padding: '18px 20px 6px 20px' }}>
        <h2 style={{
          margin: 0, fontFamily: T.font,
          fontSize: 16, fontWeight: 700, color: T.text,
        }}>
          {title}
        </h2>
        {description && (
          <p style={{
            margin: '4px 0 0 0', fontFamily: T.font,
            fontSize: 13, color: T.muted,
          }}>
            {description}
          </p>
        )}
      </header>
      <div style={{ padding: '12px 20px 20px 20px' }}>{children}</div>
      {footer && (
        <footer style={{
          padding: '12px 20px',
          borderTop: `1px solid ${T.border}`,
          background: T.surface,
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          {footer}
        </footer>
      )}
    </section>
  );
}

/* ── Character avatar picker ──────────────────────────────────────────────── */

function CharacterAvatarPicker({ pushToast }) {
  const { userProfile, updateProfileFields } = useAuth();
  const [filter, setFilter] = useState('all');
  const [savingId, setSavingId] = useState(null);
  const selectedId = userProfile?.avatarCharacter || null;
  const selected = getCharacter(selectedId);

  const visible = filter === 'all'
    ? CHARACTERS
    : CHARACTERS.filter((c) => c.group === filter);

  const groups = [{ id: 'all', label: 'All' }, ...INTEREST_GROUPS];

  const handlePick = async (id) => {
    if (id === selectedId || savingId) return;
    setSavingId(id);
    try {
      await updateProfileFields({ avatarCharacter: id });
      pushToast('success', 'Avatar updated.');
    } catch (err) {
      pushToast('error', 'Could not save avatar. Please try again.');
      console.error('avatar save failed', err);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <SectionCard
      title="Character avatar"
      description="Pick a character to show on your profile and in the nav bar."
    >
      {/* Current selection preview */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 14,
          padding: 12, marginBottom: 16,
          background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10,
        }}
      >
        <div style={{
          width: 56, height: 56, borderRadius: '50%',
          overflow: 'hidden', flexShrink: 0,
          background: T.primarySoft,
          border: `2px solid ${T.primary}`,
        }}>
          {selected
            ? <CharacterAvatar characterId={selected.id} className="w-full h-full" />
            : (
              <div style={{
                width: '100%', height: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: T.primary, fontWeight: 700, fontSize: 18,
              }}>
                ?
              </div>
            )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, color: T.muted, marginBottom: 2 }}>
            Current avatar
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>
            {selected ? selected.name : 'None selected yet'}
          </div>
        </div>
      </div>

      {/* Interest filter chips */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 6,
        marginBottom: 14,
      }}>
        {groups.map((g) => {
          const active = filter === g.id;
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => setFilter(g.id)}
              style={{
                padding: '6px 12px',
                fontFamily: T.font, fontSize: 13, fontWeight: 600,
                color: active ? T.panel : T.textSoft,
                background: active ? T.primary : T.panel,
                border: `1px solid ${active ? T.primary : T.border}`,
                borderRadius: 999, cursor: 'pointer',
              }}
            >
              {g.label}
            </button>
          );
        })}
      </div>

      {/* Character grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
          gap: 10,
        }}
      >
        {visible.map((c) => {
          const isSelected = c.id === selectedId;
          const isSaving = savingId === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => handlePick(c.id)}
              disabled={!!savingId}
              aria-pressed={isSelected}
              aria-label={`Select ${c.name}`}
              style={{
                position: 'relative',
                padding: 0, border: 'none', background: 'transparent',
                cursor: savingId ? 'wait' : 'pointer',
                borderRadius: 10, overflow: 'hidden',
                outline: isSelected ? `3px solid ${T.primary}` : `1px solid ${T.border}`,
                outlineOffset: isSelected ? -3 : -1,
                // Source tile is a square 512×512 cell of a 4×4 sprite.
                aspectRatio: '1 / 1',
                opacity: isSaving ? 0.6 : 1,
                transition: 'transform .12s ease, outline-color .12s ease',
                transform: isSelected ? 'scale(1.02)' : 'scale(1)',
              }}
            >
              <CharacterAvatar
                characterId={c.id}
                variant="tile"
                className="w-full h-full"
              />
              {isSelected && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute', top: 6, right: 6,
                    width: 22, height: 22, borderRadius: '50%',
                    background: T.primary, color: T.panel,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 800,
                    boxShadow: '0 2px 6px rgba(0,0,0,.25)',
                  }}
                >
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>
    </SectionCard>
  );
}

/* ── Appearance panel (theme switcher only) ───────────────────────────────── */

function AppearancePanel() {
  const { theme, setTheme } = useTheme();

  return (
    <SectionCard
      title="Appearance"
      description="Pick a theme. Changes apply instantly across the app."
    >
      <FieldLabel hint="Applies instantly across the app">Theme</FieldLabel>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {THEMES.map((t) => {
          const on = theme === t.id;
          return (
            <button
              key={t.id}
              type="button"
              className="zx-btn"
              onClick={() => setTheme(t.id)}
              aria-pressed={on}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '8px 14px',
                fontFamily: T.font, fontSize: 13, fontWeight: 600,
                background: on ? T.primarySoft : T.panel,
                color: on ? T.primary : T.textSoft,
                border: `1px solid ${on ? T.primary : T.border}`,
                borderRadius: 8, cursor: 'pointer',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 14, height: 14, borderRadius: '50%',
                  background: t.swatch,
                  border: `2px solid ${on ? T.primary : T.border}`,
                }}
              />
              {t.label}
            </button>
          );
        })}
      </div>
    </SectionCard>
  );
}

/* ── Tabs sidebar ─────────────────────────────────────────────────────────── */

function TabSidebar({ tabs, active, onChange, isMobile }) {
  if (isMobile) {
    return (
      <div
        role="tablist"
        style={{
          display: 'flex', gap: 6,
          overflowX: 'auto', WebkitOverflowScrolling: 'touch',
          padding: '8px 4px',
          borderBottom: `1px solid ${T.border}`,
          background: T.panel,
        }}
      >
        {tabs.map((t) => {
          const on = active === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              className="zx-tab zx-btn"
              onClick={() => onChange(t.id)}
              style={{
                flex: '0 0 auto',
                padding: '8px 14px',
                fontFamily: T.font, fontSize: 13, fontWeight: 600,
                whiteSpace: 'nowrap',
                background: on ? T.primarySoft : 'transparent',
                color: on ? T.primary : T.textSoft,
                border: `1px solid ${on ? T.primary : 'transparent'}`,
                borderRadius: 999,
                cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <nav
      role="tablist"
      aria-orientation="vertical"
      style={{
        display: 'flex', flexDirection: 'column', gap: 4,
        padding: 12,
        background: T.panel,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        position: 'sticky', top: 16,
      }}
    >
      {tabs.map((t) => {
        const on = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            className="zx-tab zx-btn"
            onClick={() => onChange(t.id)}
            style={{
              textAlign: 'left',
              padding: '10px 12px',
              fontFamily: T.font, fontSize: 14, fontWeight: 600,
              background: on ? T.primarySoft : 'transparent',
              color: on ? T.primary : T.textSoft,
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}

/* ── Learner panels (Firestore-wired) ─────────────────────────────────────── */

const GRADE_NUMBERS = [4, 5, 6, 7];

const DEFAULT_LEARNER_NOTIFICATION_PREFS = Object.freeze({
  examReminders: true,
  resultsReleased: true,
  dailyStreak: true,
  announcements: true,
});

const DEFAULT_LEARNER_LEARNING_PREFS = Object.freeze({
  soundEffects: true,
  showHints: true,
  autoplayLessons: false,
});

function normalizeNotificationPrefs(input) {
  return {
    examReminders:   input?.examReminders   ?? DEFAULT_LEARNER_NOTIFICATION_PREFS.examReminders,
    resultsReleased: input?.resultsReleased ?? DEFAULT_LEARNER_NOTIFICATION_PREFS.resultsReleased,
    dailyStreak:     input?.dailyStreak     ?? DEFAULT_LEARNER_NOTIFICATION_PREFS.dailyStreak,
    announcements:   input?.announcements   ?? DEFAULT_LEARNER_NOTIFICATION_PREFS.announcements,
  };
}

function normalizeLearningPrefs(input) {
  return {
    soundEffects:    input?.soundEffects    ?? DEFAULT_LEARNER_LEARNING_PREFS.soundEffects,
    showHints:       input?.showHints       ?? DEFAULT_LEARNER_LEARNING_PREFS.showHints,
    autoplayLessons: input?.autoplayLessons ?? DEFAULT_LEARNER_LEARNING_PREFS.autoplayLessons,
  };
}

function LearnerProfilePanel({ pushToast }) {
  const { currentUser, userProfile, updateProfileFields } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [school, setSchool] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!userProfile) return;
    setDisplayName(userProfile.displayName ?? '');
    setSchool(userProfile.school ?? '');
  }, [userProfile]);

  const handleSave = async () => {
    const e = {};
    if (!isNonEmpty(displayName)) e.displayName = 'Name is required.';
    setErrors(e);
    if (Object.keys(e).length > 0) {
      pushToast('error', 'Please fix the highlighted fields.');
      return;
    }
    setSaving(true);
    try {
      await updateProfileFields({
        displayName: displayName.trim(),
        school: school.trim(),
      });
      pushToast('success', 'Profile updated.');
    } catch (err) {
      console.error('LearnerProfilePanel save failed', err);
      pushToast('error', 'Could not save profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <CharacterAvatarPicker pushToast={pushToast} />
      <SectionCard
        title="Your details"
        description="Used across your dashboard, results, and the parent view."
        footer={<Button onClick={handleSave} loading={saving}>Save changes</Button>}
      >
        <div className="zx-grid-2">
          <TextField
            label="Full name"
            required
            value={displayName}
            onChange={setDisplayName}
            error={errors.displayName}
            autoComplete="name"
          />
          <TextField
            label="School"
            value={school}
            onChange={setSchool}
            placeholder="e.g. Lusaka Academy"
            autoComplete="organization"
          />
        </div>
        <div style={{
          padding: '10px 12px',
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          fontSize: 13,
          color: T.muted,
        }}>
          Signed in as <strong style={{ color: T.text }}>{currentUser?.email || '—'}</strong>.
          {' '}
          Email and grade live on your{' '}
          <Link to="/profile" className="zx-link" style={{ color: T.primary, fontWeight: 600 }}>
            Profile page
          </Link>
          .
        </div>
      </SectionCard>
    </>
  );
}

function LearnerSecurityPanel({ pushToast }) {
  const { currentUser, resetPassword } = useAuth();
  const [sending, setSending] = useState(false);

  const handleResetEmail = async () => {
    if (!currentUser?.email) {
      pushToast('error', 'No email on file for this account.');
      return;
    }
    setSending(true);
    try {
      await resetPassword(currentUser.email);
      pushToast('success', `Password reset email sent to ${currentUser.email}.`);
    } catch (err) {
      console.error('LearnerSecurityPanel resetPassword failed', err);
      pushToast('error', 'Could not send reset email. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <SectionCard
      title="Password & security"
      description="Keep your account safe. ZedExams sends password resets through email so a parent or guardian can help if needed."
      footer={<Button onClick={handleResetEmail} loading={sending}>Send password reset email</Button>}
    >
      <div style={{
        padding: 12,
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 10,
        fontSize: 14,
        color: T.textSoft,
        lineHeight: 1.5,
      }}>
        <div style={{ fontWeight: 600, color: T.text, marginBottom: 4 }}>
          How password changes work
        </div>
        We email a secure link to{' '}
        <strong style={{ color: T.text }}>{currentUser?.email || 'your inbox'}</strong>.
        Click the link to pick a new password — it must be at least 8 characters.
      </div>
    </SectionCard>
  );
}

function LearnerNotificationsPanel({ pushToast }) {
  const { userProfile, updateProfileFields } = useAuth();
  const [prefs, setPrefs] = useState(() => normalizeNotificationPrefs(userProfile?.notificationPrefs));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPrefs(normalizeNotificationPrefs(userProfile?.notificationPrefs));
  }, [userProfile?.notificationPrefs]);

  const set = (k, v) => setPrefs((p) => ({ ...p, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProfileFields({ notificationPrefs: prefs });
      pushToast('success', 'Notification preferences saved.');
    } catch (err) {
      console.error('LearnerNotificationsPanel save failed', err);
      pushToast('error', 'Could not save preferences. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      title="Notifications"
      description="Choose which reminders ZedExams sends you."
      footer={<Button onClick={handleSave} loading={saving}>Save changes</Button>}
    >
      <Toggle
        label="Daily exam reminders"
        description="A nudge when today's exam is ready."
        checked={prefs.examReminders}
        onChange={(v) => set('examReminders', v)}
      />
      <Toggle
        label="Results released"
        description="Tell me when my quiz or exam score is in."
        checked={prefs.resultsReleased}
        onChange={(v) => set('resultsReleased', v)}
      />
      <Toggle
        label="Daily streak reminders"
        description="Help me keep my learning streak alive."
        checked={prefs.dailyStreak}
        onChange={(v) => set('dailyStreak', v)}
      />
      <Toggle
        label="Announcements"
        description="School-wide updates and new feature highlights."
        checked={prefs.announcements}
        onChange={(v) => set('announcements', v)}
      />
    </SectionCard>
  );
}

function LearnerLearningPanel({ pushToast }) {
  const { userProfile, updateLearnerGrade, updateProfileFields } = useAuth();
  const initialGrade = (() => {
    const g = Number(userProfile?.grade);
    return GRADE_NUMBERS.includes(g) ? g : GRADE_NUMBERS[0];
  })();
  const [grade, setGrade] = useState(initialGrade);
  const [learning, setLearning] = useState(() => normalizeLearningPrefs(userProfile?.learningPrefs));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const g = Number(userProfile?.grade);
    if (GRADE_NUMBERS.includes(g)) setGrade(g);
    setLearning(normalizeLearningPrefs(userProfile?.learningPrefs));
  }, [userProfile?.grade, userProfile?.learningPrefs]);

  const set = (k, v) => setLearning((p) => ({ ...p, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      if (Number(userProfile?.grade) !== grade) {
        await updateLearnerGrade(grade);
      }
      await updateProfileFields({ learningPrefs: learning });
      pushToast('success', 'Learning preferences saved.');
    } catch (err) {
      console.error('LearnerLearningPanel save failed', err);
      pushToast('error', 'Could not save preferences. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      title="Learning preferences"
      description="Tune ZedExams to match how you like to study."
      footer={<Button onClick={handleSave} loading={saving}>Save changes</Button>}
    >
      <SelectField
        label="My grade"
        hint="Quizzes, lessons, and daily exams are filtered to this grade."
        value={String(grade)}
        onChange={(v) => setGrade(Number(v))}
        options={GRADE_NUMBERS.map((g) => ({ value: String(g), label: `Grade ${g}` }))}
      />
      <div style={{ borderTop: `1px solid ${T.border}`, marginTop: 4 }}>
        <Toggle
          label="Sound effects"
          description="Play short sounds for correct answers and badges."
          checked={learning.soundEffects}
          onChange={(v) => set('soundEffects', v)}
        />
        <Toggle
          label="Show hints during practice"
          description="Reveal a hint button on practice quizzes."
          checked={learning.showHints}
          onChange={(v) => set('showHints', v)}
        />
        <Toggle
          label="Auto-advance lessons"
          description="Move to the next slide automatically when one finishes."
          checked={learning.autoplayLessons}
          onChange={(v) => set('autoplayLessons', v)}
        />
      </div>
      <div style={{
        marginTop: 16,
        padding: 12,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 10,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: T.text, fontSize: 14 }}>App language</div>
          <div style={{ color: T.muted, fontSize: 12, marginTop: 2 }}>
            Switch between English and other supported languages.
          </div>
        </div>
        <LanguageToggle compact />
      </div>
    </SectionCard>
  );
}

function LearnerAccessibilityPanel({ pushToast }) {
  const [prefs, setPrefs] = useState(() => loadAccessibilityPrefs());

  const set = (k, v) => {
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    // Apply immediately on change so the learner sees the effect without
    // a separate save click. saveAccessibilityPrefs also writes to
    // localStorage so the choice survives reloads.
    saveAccessibilityPrefs(next);
    pushToast('success', 'Accessibility setting updated.');
  };

  return (
    <SectionCard
      title="Accessibility"
      description="Make ZedExams easier to read and use. Changes apply right away."
    >
      <Toggle
        label="Reduce motion"
        description="Trim animations and transitions for less visual movement."
        checked={prefs.reducedMotion}
        onChange={(v) => set('reducedMotion', v)}
      />
      <Toggle
        label="High contrast"
        description="Stronger borders and darker text on every theme."
        checked={prefs.highContrast}
        onChange={(v) => set('highContrast', v)}
      />
      <SelectField
        label="Text size"
        hint="Applies to most of the app. Restart any quiz already in progress."
        value={prefs.fontScale}
        onChange={(v) => set('fontScale', v)}
        options={[
          { value: 'small',  label: 'Small' },
          { value: 'medium', label: 'Medium (default)' },
          { value: 'large',  label: 'Large' },
        ]}
      />
    </SectionCard>
  );
}

function LearnerParentPanel() {
  return (
    <SectionCard
      title="Parent / Guardian access"
      description="Share a read-only progress link with a parent or guardian. They will see your scores and badges — never your password."
    >
      {/* ParentShareManager is the same widget that powers the link
          on /profile, so the two surfaces stay in sync without
          touching the underlying Firestore wiring. */}
      <ParentShareManager />
    </SectionCard>
  );
}

/* ── Main component ───────────────────────────────────────────────────────── */

const VALID_ROLES = ['admin', 'teacher', 'learner'];

export default function ZedExamsSettings({ role = 'admin' }) {
  // Inject font + runtime styles once.
  useEffect(() => { ensureRuntimeAssets(); }, []);

  const isMobile = useIsMobile(820);

  const safeRole = VALID_ROLES.includes(role) ? role : 'learner';
  const tabs = TABS[safeRole];
  const [active, setActive] = useState(tabs[0].id);

  // Reset active tab if role changes (and current tab no longer valid).
  useEffect(() => {
    if (!tabs.some((t) => t.id === active)) setActive(tabs[0].id);
  }, [tabs, active]);

  const [toast, setToast] = useState(null);
  const pushToast = useCallback((kind, message) => {
    setToast({ kind, message, key: uid() });
  }, []);

  // Every panel renders against the signed-in user's own account or
  // localStorage, so a single dispatch covers all three roles. The role
  // gate is the per-role TABS list — tabs an account shouldn't see are
  // simply not in its sidebar.
  const renderActive = () => {
    switch (active) {
      case 'profile':       return <LearnerProfilePanel pushToast={pushToast} />;
      case 'security':      return <LearnerSecurityPanel pushToast={pushToast} />;
      case 'notifications': return <LearnerNotificationsPanel pushToast={pushToast} />;
      case 'learning':      return <LearnerLearningPanel pushToast={pushToast} />;
      case 'accessibility': return <LearnerAccessibilityPanel pushToast={pushToast} />;
      case 'parent':        return <LearnerParentPanel />;
      case 'appearance':    return <AppearancePanel />;
      default:              return null;
    }
  };

  return (
    <div
      style={{
        fontFamily: T.font,
        color: T.text,
        background: T.surface,
        minHeight: '100%',
        padding: isMobile ? 12 : 24,
        boxSizing: 'border-box',
      }}
    >
      <SeoHelmet title="Settings" path="/settings" noIndex />
      {/* Header */}
      <header style={{
        display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
        gap: 16, flexWrap: 'wrap',
        marginBottom: 16,
      }}>
        <div>
          <h1 style={{
            margin: 0, fontFamily: T.font,
            fontSize: isMobile ? 22 : 28, fontWeight: 700, color: T.dark,
          }}>
            Settings
          </h1>
          <p style={{
            margin: '4px 0 0 0', color: T.muted, fontSize: 14,
          }}>
            Signed in as <strong style={{ color: T.text, textTransform: 'capitalize' }}>
              {safeRole}
            </strong>. Manage your preferences below.
          </p>
        </div>
        <span style={{
          padding: '4px 10px',
          background: T.primarySoft, color: T.primary,
          fontWeight: 600, fontSize: 12,
          borderRadius: 999, border: `1px solid ${T.primary}`,
        }}>
          {tabs.length} sections
        </span>
      </header>

      {/* Layout grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '240px 1fr',
          gap: isMobile ? 12 : 20,
          alignItems: 'start',
        }}
      >
        <TabSidebar
          tabs={tabs}
          active={active}
          onChange={setActive}
          isMobile={isMobile}
        />
        <main style={{ minWidth: 0 }}>
          {renderActive()}
        </main>
      </div>

      <Toast
        kind={toast?.kind}
        message={toast?.message}
        onClose={() => setToast(null)}
      />
    </div>
  );
}

/* ── Named exports for tests / external composition ───────────────────────── */
export {
  TABS,
  isNonEmpty,
};
