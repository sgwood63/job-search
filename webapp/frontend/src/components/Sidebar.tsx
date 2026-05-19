import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus'

const links = [
  { to: '/', label: 'Tracker', icon: '📋' },
  { to: '/files', label: 'Files', icon: '📄' },
  { to: '/profiles', label: 'Profiles', icon: '👤' },
  { to: '/base-docs', label: 'Base Docs', icon: '📁' },
  { to: '/search', label: 'Search Results', icon: '🔍' },
  { to: '/docs', label: 'Docs', icon: '📖' },
  { to: '/setup', label: 'Setup', icon: '🤖' },
]

function SetupStatusBar() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<{ phases: Record<string, boolean> } | null>(null)
  const [version, setVersion] = useState(0)

  useRefreshOnFocus(() => setVersion(v => v + 1))

  useEffect(() => {
    api.setupStatus().then(setStatus).catch(() => setStatus(null))
  }, [version])

  if (!status) return null

  const phases = ['A', 'B', 'C', 'D', 'E']
  const allDone = phases.every(p => status.phases[p])

  return (
    <div className="px-3 py-2.5 border-t border-gray-100 bg-gray-50">
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
        Setup Status
      </div>
      <div className="flex gap-1.5 flex-wrap mb-2">
        {phases.map(ph => (
          <span
            key={ph}
            title={`Phase ${ph}`}
            className={`text-xs px-1.5 py-0.5 rounded font-medium ${
              status.phases[ph]
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-400'
            }`}
          >
            {ph} {status.phases[ph] ? '✓' : '○'}
          </span>
        ))}
        {status.phases['F'] && (
          <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-blue-50 text-blue-600">
            F ✓
          </span>
        )}
      </div>
      {!allDone && (
        <button
          onClick={() => navigate('/setup')}
          className="w-full text-xs text-left text-blue-600 hover:text-blue-800 underline"
        >
          Launch Setup →
        </button>
      )}
    </div>
  )
}

export default function Sidebar() {
  return (
    <aside className="w-48 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col">
      <div className="px-4 py-4 border-b border-gray-100">
        <h1 className="text-sm font-semibold text-gray-800 leading-tight">Job Search Browser</h1>
      </div>
      <nav className="flex-1 py-2 overflow-auto">
        {links.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
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
      </nav>
      <SetupStatusBar />
    </aside>
  )
}
