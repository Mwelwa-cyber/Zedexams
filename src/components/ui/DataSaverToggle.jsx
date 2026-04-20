/**
 * DataSaverToggle — compact toggle for the header/navbar.
 * When Data Saver is ON, images and heavy animations are disabled.
 */
import { useDataSaver } from '../../contexts/DataSaverContext'

export default function DataSaverToggle({ showLabel = false }) {
  const { dataSaver, toggleDataSaver } = useDataSaver()

  const label = dataSaver
    ? 'Data Saver is on — click to disable'
    : 'Enable Data Saver to reduce mobile data usage'

  return (
    <button
      type="button"
      onClick={toggleDataSaver}
      aria-label={label}
      aria-pressed={dataSaver}
      title={label}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-xs font-bold transition-all min-h-0 ${
        dataSaver
          ? 'bg-green-100 border-green-300 text-green-700 shadow-sm'
          : 'bg-gray-100 border-gray-200 text-gray-500 hover:bg-gray-200'
      }`}
    >
      {/* Battery / signal icon */}
      <span className="text-sm leading-none" aria-hidden="true">
        {dataSaver ? '🔋' : '📶'}
      </span>
      {showLabel && (
        <span>{dataSaver ? 'Saver ON' : 'Data Saver'}</span>
      )}
      {/* Toggle indicator dot */}
      <span
        aria-hidden="true"
        className={`w-2 h-2 rounded-full transition-colors ${
          dataSaver ? 'bg-green-500' : 'bg-gray-400'
        }`}
      />
    </button>
  )
}
