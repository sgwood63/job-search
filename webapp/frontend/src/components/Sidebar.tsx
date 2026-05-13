import { NavLink } from 'react-router-dom'

const links = [
  { to: '/', label: 'Tracker', icon: '📋' },
  { to: '/files', label: 'Files', icon: '📄' },
  { to: '/profiles', label: 'Profiles', icon: '👤' },
  { to: '/base-docs', label: 'Base Docs', icon: '📁' },
  { to: '/search', label: 'Search Results', icon: '🔍' },
]

export default function Sidebar() {
  return (
    <aside className="w-48 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col">
      <div className="px-4 py-4 border-b border-gray-100">
        <h1 className="text-sm font-semibold text-gray-800 leading-tight">Job Search Browser</h1>
      </div>
      <nav className="flex-1 py-2">
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
    </aside>
  )
}
