import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, TrackerRow, PhaseDRow, ClosedRow, TrackerData } from '../api'
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus'

const CANONICAL_STATUSES = [
  'Pending Review',
  'Resume Ready',
  'Applied',
  'Interview scheduled',
  'Interviewed',
  'Exercise/Test requested',
  'Exercise/Test',
  'Offer',
  'Closed',
]

function rowMatchesQuery(row: Record<string, string | null>, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return Object.values(row).some(v => v && v.toLowerCase().includes(q))
}

function matchesPriority(priority: string, filter: string): boolean {
  if (filter === 'all') return true
  if (filter === 'star') return priority.includes('⭐')
  if (filter === 'high') return priority.toLowerCase() === 'high'
  return true
}

function statusClass(status: string): string {
  switch (status) {
    case 'Pending Review': return 'bg-yellow-100 text-yellow-700'
    case 'Resume Ready':   return 'bg-blue-100 text-blue-700'
    case 'Applied':        return 'bg-green-100 text-green-700'
    case 'Interview scheduled':     return 'bg-purple-100 text-purple-700'
    case 'Interviewed':             return 'bg-indigo-100 text-indigo-700'
    case 'Exercise/Test requested': return 'bg-orange-100 text-orange-700'
    case 'Exercise/Test':           return 'bg-amber-100 text-amber-700'
    case 'Offer':          return 'bg-emerald-100 text-emerald-700'
    case 'Closed':         return 'bg-gray-100 text-gray-500'
    default:               return 'bg-gray-100 text-gray-600'
  }
}

function priorityBadge(priority: string) {
  if (priority.includes('⭐')) {
    return <span className="text-yellow-500 font-bold">{priority}</span>
  }
  if (priority.toLowerCase() === 'high') {
    return <span className="font-semibold text-gray-700">High</span>
  }
  return <span className="text-gray-400">—</span>
}

function Section({ title, count, total, children, defaultOpen = true, forceOpen = false }: {
  title: string
  count: number
  total: number
  children: React.ReactNode
  defaultOpen?: boolean
  forceOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const isOpen = forceOpen || open
  const isFiltered = count !== total
  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 mb-2 text-left w-full"
      >
        <span className="text-xs text-gray-400">{isOpen ? '▾' : '▸'}</span>
        <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
        {isFiltered ? (
          <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">{count} / {total}</span>
        ) : (
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{count}</span>
        )}
      </button>
      {isOpen && children}
    </div>
  )
}

function ActiveTable({ rows }: { rows: TrackerRow[] }) {
  const navigate = useNavigate()
  return (
    <div className="overflow-x-auto rounded border border-gray-200">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 text-gray-500 uppercase tracking-wide">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Date</th>
            <th className="px-3 py-2 text-left font-medium">Company</th>
            <th className="px-3 py-2 text-left font-medium">Role</th>
            <th className="px-3 py-2 text-left font-medium">Profile</th>
            <th className="px-3 py-2 text-left font-medium">Status</th>
            <th className="px-3 py-2 text-left font-medium">Next Action</th>
            <th className="px-3 py-2 text-left font-medium">Priority</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, i) => (
            <tr
              key={i}
              onClick={() => row.folder && navigate(`/applications/${row.folder}`)}
              className={`${row.folder ? 'cursor-pointer hover:bg-blue-50' : ''} transition-colors`}
            >
              <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{row.date}</td>
              <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">
                {row.company}
                {!row.folder && (
                  <span className="ml-1 text-gray-300" title="No application folder">●</span>
                )}
              </td>
              <td className="px-3 py-2 text-gray-600 max-w-xs">
                <span className="line-clamp-2">{row.role}</span>
              </td>
              <td className="px-3 py-2">
                <span className="bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded text-xs">
                  {row.profile}
                </span>
              </td>
              <td className="px-3 py-2 max-w-xs">
                <span className={`px-1.5 py-0.5 rounded text-xs ${statusClass(row.status)}`}>
                  {row.status}
                </span>
                {row.status_detail && (
                  <div className="text-gray-400 text-xs mt-0.5 line-clamp-2">
                    {row.status_detail}
                  </div>
                )}
              </td>
              <td className="px-3 py-2 text-gray-500 max-w-xs">
                <span className="line-clamp-2">{row.next_action}</span>
              </td>
              <td className="px-3 py-2">{priorityBadge(row.priority)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PhaseDTable({ rows }: { rows: PhaseDRow[] }) {
  const navigate = useNavigate()
  return (
    <div className="overflow-x-auto rounded border border-gray-200">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 text-gray-500 uppercase tracking-wide">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Date</th>
            <th className="px-3 py-2 text-left font-medium">Company</th>
            <th className="px-3 py-2 text-left font-medium">Role</th>
            <th className="px-3 py-2 text-left font-medium">Profile</th>
            <th className="px-3 py-2 text-left font-medium">Fit</th>
            <th className="px-3 py-2 text-left font-medium">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, i) => (
            <tr
              key={i}
              onClick={() => row.folder && navigate(`/applications/${row.folder}`)}
              className={`${row.folder ? 'cursor-pointer hover:bg-blue-50' : ''} transition-colors`}
            >
              <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{row.date}</td>
              <td className="px-3 py-2 font-medium text-gray-800">{row.company}</td>
              <td className="px-3 py-2 text-gray-600">{row.role}</td>
              <td className="px-3 py-2">
                <span className="bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded text-xs">
                  {row.profile}
                </span>
              </td>
              <td className="px-3 py-2 text-gray-700">{row.fit}</td>
              <td className="px-3 py-2 text-gray-500">{row.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ClosedTable({ rows }: { rows: ClosedRow[] }) {
  const navigate = useNavigate()
  return (
    <div className="overflow-x-auto rounded border border-gray-200">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 text-gray-500 uppercase tracking-wide">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Date</th>
            <th className="px-3 py-2 text-left font-medium">Company</th>
            <th className="px-3 py-2 text-left font-medium">Role</th>
            <th className="px-3 py-2 text-left font-medium">Status</th>
            <th className="px-3 py-2 text-left font-medium">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, i) => (
            <tr
              key={i}
              onClick={() => row.folder && navigate(`/applications/${row.folder}`)}
              className={`${row.folder ? 'cursor-pointer hover:bg-blue-50' : ''} transition-colors`}
            >
              <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{row.date}</td>
              <td className="px-3 py-2 font-medium text-gray-700">{row.company}</td>
              <td className="px-3 py-2 text-gray-500">{row.role}</td>
              <td className="px-3 py-2 max-w-xs">
                <span className={`px-1.5 py-0.5 rounded text-xs ${statusClass(row.status)}`}>
                  {row.status}
                </span>
                {row.status_detail && (
                  <div className="text-gray-400 text-xs mt-0.5 line-clamp-2">
                    {row.status_detail}
                  </div>
                )}
              </td>
              <td className="px-3 py-2 text-gray-400 max-w-xs">
                <span className="line-clamp-2">{row.notes}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function TrackerView() {
  const [data, setData] = useState<TrackerData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [profileFilter, setProfileFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')

  useRefreshOnFocus(() => setVersion(v => v + 1))

  useEffect(() => {
    api.tracker().then(setData).catch(e => setError(String(e)))
  }, [version])

  const { filteredActive, filteredPhaseD, filteredClosed, profiles, isFiltering } = useMemo(() => {
    if (!data) return { filteredActive: [], filteredPhaseD: [], filteredClosed: [], profiles: [], isFiltering: false }

    const allProfiles = Array.from(new Set([
      ...data.active.map(r => r.profile),
      ...data.phase_d.map(r => r.profile),
      ...data.closed.map(r => r.profile),
    ].filter(Boolean))).sort()

    const isFiltering = !!(query || statusFilter !== 'all' || profileFilter !== 'all' || priorityFilter !== 'all')

    const filterActive = (rows: TrackerRow[]) => rows.filter(r => {
      if (!rowMatchesQuery(r as unknown as Record<string, string | null>, query)) return false
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (profileFilter !== 'all' && r.profile !== profileFilter) return false
      if (!matchesPriority(r.priority, priorityFilter)) return false
      return true
    })

    const filterPhaseD = (rows: PhaseDRow[]) => rows.filter(r => {
      if (statusFilter !== 'all') return false
      if (!rowMatchesQuery(r as unknown as Record<string, string | null>, query)) return false
      if (profileFilter !== 'all' && r.profile !== profileFilter) return false
      return true
    })

    const filterClosed = (rows: ClosedRow[]) => rows.filter(r => {
      if (!rowMatchesQuery(r as unknown as Record<string, string | null>, query)) return false
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (profileFilter !== 'all' && r.profile !== profileFilter) return false
      return true
    })

    return {
      filteredActive: filterActive(data.active),
      filteredPhaseD: filterPhaseD(data.phase_d),
      filteredClosed: filterClosed(data.closed),
      profiles: allProfiles,
      isFiltering,
    }
  }, [data, query, statusFilter, profileFilter, priorityFilter])

  if (error) {
    return (
      <div className="p-8 text-red-500 text-sm">
        Failed to load tracker: {error}
      </div>
    )
  }

  if (!data) {
    return <div className="p-8 text-gray-400 text-sm">Loading tracker…</div>
  }

  return (
    <div className="h-full overflow-auto p-6">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="relative flex-1 min-w-48">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">🔍</span>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search all columns…"
            className="w-full pl-7 pr-3 py-1.5 text-xs border border-gray-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
            >✕</button>
          )}
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="text-xs border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
        >
          <option value="all">Status: All</option>
          {CANONICAL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={profileFilter}
          onChange={e => setProfileFilter(e.target.value)}
          className="text-xs border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
        >
          <option value="all">Profile: All</option>
          {profiles.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select
          value={priorityFilter}
          onChange={e => setPriorityFilter(e.target.value)}
          className="text-xs border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
        >
          <option value="all">Priority: All</option>
          <option value="star">⭐ only</option>
          <option value="high">High only</option>
        </select>
        {isFiltering && (
          <button
            onClick={() => { setQuery(''); setStatusFilter('all'); setProfileFilter('all'); setPriorityFilter('all') }}
            className="text-xs text-blue-600 hover:text-blue-800 underline"
          >Clear filters</button>
        )}
      </div>

      <Section title="Active Applications" count={filteredActive.length} total={data.active.length} forceOpen={isFiltering}>
        <ActiveTable rows={filteredActive} />
      </Section>
      <Section title="Phase D Samples" count={filteredPhaseD.length} total={data.phase_d.length} defaultOpen={false} forceOpen={isFiltering}>
        <PhaseDTable rows={filteredPhaseD} />
      </Section>
      <Section title="Closed / Rejected" count={filteredClosed.length} total={data.closed.length} defaultOpen={false} forceOpen={isFiltering}>
        <ClosedTable rows={filteredClosed} />
      </Section>
    </div>
  )
}
