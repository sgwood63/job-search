import { useEffect, useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { api } from '../api'
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus'
import { dispatchStageChange } from './SetupView'

const topLinks = [
  { to: '/', label: 'Tracker', icon: '📋', end: true },
  { to: '/ingestion', label: 'Ingestion Results', icon: '🔍', end: false },
  { to: '/sessions', label: 'Sessions', icon: '💬', end: false },
  { to: '/files', label: 'Applicant Files', icon: '📄', end: false },
]

const setupPhases = [
  { key: 'overview', label: 'Overview', icon: '🗺' },
  { key: 'A', label: 'Documents', icon: '📁' },
  { key: 'B', label: 'Interview', icon: '🎤' },
  { key: 'C', label: 'Profiles', icon: '👤' },
  { key: 'D', label: 'Career Advice', icon: '🎯' },
  { key: 'E', label: 'Validation', icon: '✅' },
  { key: 'help', label: 'Help', icon: '❓' },
]

function SetupStatusSection() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<{ phases: Record<string, boolean> } | null>(null)
  const [version, setVersion] = useState(0)

  useRefreshOnFocus(() => setVersion(v => v + 1))

  useEffect(() => {
    api.setupStatus().then(setStatus).catch(() => setStatus(null))
  }, [version])

  const phases = ['A', 'B', 'C', 'D', 'E']
  const allDone = status ? phases.every(p => status.phases[p]) : false

  return (
    <div className="px-3 py-2.5 border-t border-gray-100">
      <button
        onClick={() => navigate('/setup')}
        className="w-full flex items-center gap-2 px-1 py-1 text-sm text-gray-700 hover:text-blue-700 transition-colors group"
      >
        <span>⚙️</span>
        <span className="font-medium flex-1 text-left">Setup</span>
        {status && (
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${allDone ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
            {allDone ? 'Done' : `${phases.filter(p => status.phases[p]).length}/${phases.length}`}
          </span>
        )}
      </button>
      {status && !allDone && (
        <div className="flex gap-1 flex-wrap mt-1 pl-1">
          {phases.map(ph => (
            <span
              key={ph}
              title={`Phase ${ph}`}
              className={`text-xs px-1 py-0.5 rounded font-medium ${
                status.phases[ph] ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
              }`}
            >
              {ph}{status.phases[ph] ? '✓' : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function SetupSidebar({ phaseStatus }: { phaseStatus: Record<string, boolean> }) {
  const navigate = useNavigate()
  const [activePhase, setActivePhase] = useState('overview')

  function selectPhase(key: string) {
    setActivePhase(key)
    dispatchStageChange(key)
  }

  return (
    <>
      <div className="flex-1 py-2 overflow-auto">
        {setupPhases.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => selectPhase(key)}
            className={`w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
              activePhase === key
                ? 'bg-blue-50 text-blue-700 font-medium border-r-2 border-blue-600'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            }`}
          >
            <span>{icon}</span>
            <span className="flex-1 text-left">{label}</span>
            {['A','B','C','D','E'].includes(key) && phaseStatus[key] && (
              <span className="text-green-500 text-xs">✓</span>
            )}
          </button>
        ))}
      </div>
      <div className="px-3 py-2.5 border-t border-gray-100">
        <button
          onClick={() => navigate('/')}
          className="w-full text-xs text-left text-gray-500 hover:text-gray-800 transition-colors"
        >
          ← Back to App
        </button>
      </div>
    </>
  )
}

export { SetupSidebar }

export default function Sidebar() {
  const location = useLocation()
  const isSetup = location.pathname === '/setup'

  const [phaseStatus, setPhaseStatus] = useState<Record<string, boolean>>({})
  const [version, setVersion] = useState(0)
  useRefreshOnFocus(() => setVersion(v => v + 1))
  useEffect(() => {
    api.setupStatus().then(s => setPhaseStatus(s.phases)).catch(() => {})
  }, [version])

  return (
    <aside className="w-48 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col">
      <div className="px-4 py-4 border-b border-gray-100">
        <h1 className="text-sm font-semibold text-gray-800 leading-tight">
          {isSetup ? 'Setup' : 'Job Search'}
        </h1>
      </div>
      {isSetup ? (
        <SetupSidebar phaseStatus={phaseStatus} />
      ) : (
        <>
          <nav className="flex-1 py-2 overflow-auto">
            {topLinks.map(({ to, label, icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
                    isActive
                      ? 'bg-blue-50 text-blue-700 font-medium border-r-2 border-blue-600'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`
                }
              >
                <span>{icon}</span>
                <span>{label}</span>
              </NavLink>
            ))}
            {/* Profiles — indented child of Applicant Files */}
            <NavLink
              to="/profiles"
              className={({ isActive }) =>
                `flex items-center gap-2 pl-10 pr-4 py-1.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 font-medium border-r-2 border-blue-600'
                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                }`
              }
            >
              <span>👤</span>
              <span>Profiles</span>
            </NavLink>
          </nav>
          <SetupStatusSection />
          <div className="px-3 py-2 border-t border-gray-100">
            <NavLink
              to="/help"
              className={({ isActive }) =>
                `flex items-center gap-2 px-1 py-1 text-sm transition-colors ${
                  isActive ? 'text-blue-700 font-medium' : 'text-gray-600 hover:text-gray-900'
                }`
              }
            >
              <span>❓</span>
              <span>Help</span>
            </NavLink>
          </div>
        </>
      )}
    </aside>
  )
}
