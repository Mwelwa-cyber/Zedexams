import { useMemo } from 'react'
import { buildStaticMapUrl } from '../../utils/staticMap'
import { hydrateMapLocation } from '../../utils/quizSections'

const MAP_TYPES = [
  { value: 'roadmap', label: 'Road' },
  { value: 'satellite', label: 'Satellite' },
  { value: 'terrain', label: 'Terrain' },
  { value: 'hybrid', label: 'Hybrid' },
]

const MARKER_COLORS = ['red', 'blue', 'green', 'orange', 'purple', 'yellow', 'black']

const INPUT_CLASS =
  'theme-input w-full rounded-lg border px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]'

function emptyMap() {
  // Default centred on Lusaka, Zambia at country-level zoom — Zambian exam
  // prep is the primary use case so this saves authors a step.
  return { lat: -13.1339, lng: 27.8493, zoom: 6, mapType: 'roadmap', markers: [] }
}

function emptyMarker() {
  return { label: '', lat: '', lng: '', color: 'red' }
}

function joinClasses(...parts) {
  return parts.filter(Boolean).join(' ')
}

export default function MapLocationField({ value, onChange, theme }) {
  const enabled = Boolean(value)
  const previewUrl = useMemo(() => {
    const hydrated = hydrateMapLocation(value)
    if (!hydrated) return ''
    try {
      return buildStaticMapUrl({
        lat: hydrated.lat,
        lng: hydrated.lng,
        zoom: hydrated.zoom,
        size: [600, 320],
        mapType: hydrated.mapType,
        markers: hydrated.markers,
      })
    } catch {
      return ''
    }
  }, [value])

  function update(patch) {
    onChange({ ...(value ?? emptyMap()), ...patch })
  }

  function updateMarker(index, patch) {
    const current = value ?? emptyMap()
    const markers = [...(current.markers ?? [])]
    markers[index] = { ...markers[index], ...patch }
    onChange({ ...current, markers })
  }

  function addMarker() {
    const current = value ?? emptyMap()
    const markers = [...(current.markers ?? []), emptyMarker()]
    onChange({ ...current, markers })
  }

  function removeMarker(index) {
    const current = value ?? emptyMap()
    const markers = (current.markers ?? []).filter((_, i) => i !== index)
    onChange({ ...current, markers })
  }

  if (!enabled) {
    return (
      <button
        type="button"
        onClick={() => onChange(emptyMap())}
        className={joinClasses(
          'group w-full min-h-0 rounded-xl border-2 border-dashed p-5 text-center transition-all bg-transparent shadow-none',
          theme?.uploadBorder,
        )}
      >
        <div className="mb-1.5 inline-block text-3xl transition-transform group-hover:scale-110">🗺️</div>
        <p className="theme-text text-sm font-bold">Add Map (Google Static Maps)</p>
        <p className="theme-text-muted mt-0.5 text-xs">
          Embed a map with labelled markers (X, P, …) for "answer using the map below" questions.
        </p>
      </button>
    )
  }

  const markers = value.markers ?? []

  return (
    <div className="theme-card theme-border space-y-3 rounded-2xl border-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="theme-text text-xs font-black uppercase tracking-wide">Map</p>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="min-h-0 rounded-lg bg-red-500 px-2.5 py-1 text-xs font-bold text-white shadow hover:bg-red-600"
        >
          Remove map
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="block">
          <span className="theme-text-muted text-[11px] font-bold">Centre lat</span>
          <input
            type="number"
            step="0.0001"
            value={value.lat ?? ''}
            onChange={event => update({ lat: event.target.value === '' ? '' : Number(event.target.value) })}
            placeholder="-13.1339"
            className={INPUT_CLASS}
          />
        </label>
        <label className="block">
          <span className="theme-text-muted text-[11px] font-bold">Centre lng</span>
          <input
            type="number"
            step="0.0001"
            value={value.lng ?? ''}
            onChange={event => update({ lng: event.target.value === '' ? '' : Number(event.target.value) })}
            placeholder="27.8493"
            className={INPUT_CLASS}
          />
        </label>
        <label className="block">
          <span className="theme-text-muted text-[11px] font-bold">Zoom (1–21)</span>
          <input
            type="number"
            min="1"
            max="21"
            value={value.zoom ?? 6}
            onChange={event => update({ zoom: Math.max(1, Math.min(21, Number(event.target.value) || 6)) })}
            className={INPUT_CLASS}
          />
        </label>
        <label className="block">
          <span className="theme-text-muted text-[11px] font-bold">Map type</span>
          <select
            value={value.mapType ?? 'roadmap'}
            onChange={event => update({ mapType: event.target.value })}
            className={INPUT_CLASS}
          >
            {MAP_TYPES.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      <p className="theme-text-muted text-[11px]">
        Tip: open Google Maps, right-click a location, and click the lat/lng to copy.
      </p>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="theme-text text-xs font-black uppercase tracking-wide">Markers</p>
          <button
            type="button"
            onClick={addMarker}
            className="theme-card theme-border theme-text hover:theme-card-hover min-h-0 rounded-lg border px-3 py-1 text-xs font-bold"
          >
            + Add marker
          </button>
        </div>

        {markers.length === 0 ? (
          <p className="theme-text-muted text-xs">
            No markers yet. Add labelled markers (X, P, A, B…) so sub-questions can reference them.
          </p>
        ) : (
          markers.map((marker, index) => (
            <div key={index} className="theme-bg-subtle grid grid-cols-2 gap-2 rounded-xl border theme-border p-2 sm:grid-cols-5">
              <label className="block">
                <span className="theme-text-muted text-[10px] font-bold">Label</span>
                <input
                  value={marker.label ?? ''}
                  onChange={event => updateMarker(index, { label: event.target.value.slice(0, 1).toUpperCase() })}
                  placeholder="X"
                  maxLength={1}
                  className={INPUT_CLASS}
                />
              </label>
              <label className="block">
                <span className="theme-text-muted text-[10px] font-bold">Lat</span>
                <input
                  type="number"
                  step="0.0001"
                  value={marker.lat ?? ''}
                  onChange={event => updateMarker(index, { lat: event.target.value === '' ? '' : Number(event.target.value) })}
                  className={INPUT_CLASS}
                />
              </label>
              <label className="block">
                <span className="theme-text-muted text-[10px] font-bold">Lng</span>
                <input
                  type="number"
                  step="0.0001"
                  value={marker.lng ?? ''}
                  onChange={event => updateMarker(index, { lng: event.target.value === '' ? '' : Number(event.target.value) })}
                  className={INPUT_CLASS}
                />
              </label>
              <label className="block">
                <span className="theme-text-muted text-[10px] font-bold">Colour</span>
                <select
                  value={marker.color ?? 'red'}
                  onChange={event => updateMarker(index, { color: event.target.value })}
                  className={INPUT_CLASS}
                >
                  {MARKER_COLORS.map(color => (
                    <option key={color} value={color}>{color}</option>
                  ))}
                </select>
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => removeMarker(index)}
                  className="min-h-0 w-full rounded-lg bg-red-500 px-2 py-1.5 text-xs font-bold text-white hover:bg-red-600"
                >
                  Remove
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {previewUrl ? (
        <div className="theme-bg-subtle overflow-hidden rounded-xl border theme-border">
          <img src={previewUrl} alt="Map preview" className="h-auto w-full object-contain" loading="lazy" />
        </div>
      ) : (
        <p className="rounded-lg border border-dashed theme-border p-3 text-center text-xs theme-text-muted">
          Enter centre coordinates to see a preview.
        </p>
      )}
    </div>
  )
}
