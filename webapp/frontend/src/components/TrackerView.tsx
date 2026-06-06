import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, TrackerRow, TrackerData } from '../api'
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus'

const STATUS_ORDER = [
  'pending-review',
  'resume-ready',
  'applied',
  'interview-scheduled',
  'interviewed',
  'exercise',
  'offer',
  'closed',
  'not-interested',
]

const STATUS_LABEL: Record<string, string> = {
  'pending-review': 'Pending Review',
  'resume-ready': 'Resume Ready',
  'applied': 'Applied',
  'interview-scheduled': 'Interview Scheduled',
  'interviewed': 'Interviewed',
  'exercise': 'Exercise/Test',
  'offer': 'Offer',
  'closed': 'Closed',
  'not-interested': 'Not Interested',
}

function statusClass(status: string): string {
  switch (status) {
    case 'pending-review':      return 'bg-yellow-100 text-yellow-700'
    case 'resume-ready':        return 'bg-blue-100 text-blue-700'
    case 'applied':             return 'bg-green-100 text-green-700'
    case 'interview-scheduled': return 'bg-purple-100 text-purple-700'
    case 'interviewed':         return 'bg-indigo-100 text-indigo-700'
    case 'exercise':            return 'bg-orange-100 text-orange-700'
    case 'offer':               return 'bg-emerald-100 text-emerald-700'
    case 'closed':              return 'bg-gray-100 text-gray-500'
    case 'not-interested':      return 'bg-gray-100 text-gray-400'
    default:                    return 'bg-gray-100 text-gray-600'
  }
}

function priorityBadge(priority: string) {
  if (priority.includes('⭐')) return <span className="text-yellow-500 font-bold">{priority}</span>
  if (priority.toLowerCase() === 'high') return <span className="font-semibold text-gray-700">High</span>
  return <span className="text-gray-400">—</span>
}

function statusSortKey(status: string): number {
  const idx = STATUS_ORDER.indexOf(status)
  return idx === -1 ? STATUS_ORDER.length : idx
}

type SortCol = 'date' | 'company' | 'role' | 'profile' | 'status' | 'follow_up_date' | 'priority'

function compareRows(a: TrackerRow, b: TrackerRow, col: SortCol, dir: 'asc' | 'desc'): number {
  let result = 0
  if (col === 'status') {
    result = statusSortKey(a.status) - statusSortKey(b.status)
  } else if (col === 'priority') {
    const pOrder = (p: string) => p.includes('⭐⭐⭐') ? 0 : p.includes('⭐⭐') ? 1 : p.includes('⭐') ? 2 : 3
    result = pOrder(a.priority) - pOrder(b.priority)
  } else {
    const av = (a[col] ?? '').toLowerCase()
    const bv = (b[col] ?? '').toLowerCase()
    result = av < bv ? -1 : av > bv ? 1 : 0
  }
  return dir === 'asc' ? result : -result
}

function SortIcon({ col, sortCol, sortDir }: { col: SortCol; sortCol: SortCol; sortDir: 'asc' | 'desc' }) {
  if (col !== sortCol) return <span className="text-gray-300 ml-0.5">⇅</span>
  return <span className="ml-0.5">{sortDir === 'asc' ? '▴' : '▾'}</span>
}

function StatusMultiSelect({
  statuses, selected, onChange,
}: {
  statuses: string[]
  selected: Set<string>
  onChange: (s: Set<string>) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const label = selected.size === 0 ? 'All' : `${selected.size} selected`

  const toggle = (s: string) => {
    const next = new Set(selected)
    next.has(s) ? next.delete(s) : next.add(s)
    onChange(next)
  }

  return (
    <div className="relative w-full" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full text-left text-xs border rounded px-2 py-1 bg-white flex items-center justify-between gap-1 ${
          selected.size > 0 ? 'border-blue-400 text-blue-600' : 'border-gray-200 text-gray-500'
        }`}
      >
        <span className="truncate">{label}</span>
        <span className="text-gray-400 flex-shrink-0">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="absolute top-full mt-0.5 left-0 z-20 bg-white border border-gray-200 rounded shadow-md py-1 min-w-44">
          {statuses.map(s => (
            <label key={s} className="flex items-center gap-2 px-3 py-1 hover:bg-gray-50 cursor-pointer text-xs text-gray-700">
              <input type="checkbox" checked={selected.has(s)} onChange={() => toggle(s)} className="accent-blue-500" />
              <span className={`px-1.5 py-0.5 rounded ${statusClass(s)}`}>{STATUS_LABEL[s] ?? s}</span>
            </label>
          ))}
          {selected.size > 0 && (
            <div className="border-t border-gray-100 mt-1 pt-1 px-3">
              <button onClick={() => onChange(new Set())} className="text-xs text-blue-500 hover:text-blue-700">Clear</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const PER_PAGE = 50

export default function TrackerView() {
  const navigate = useNavigate()
  const [data, setData] = useState<TrackerData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [companyFilter, setCompanyFilter] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set())
  const [profileFilter, setProfileFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [sortCol, setSortCol] = useState<SortCol>('status')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)

  useRefreshOnFocus(() => setVersion(v => v + 1))

  useEffect(() => {
    api.tracker().then(setData).catch(e => setError(String(e)))
  }, [version])

  useEffect(() => { setPage(1) }, [companyFilter, roleFilter, selectedStatuses, profileFilter, priorityFilter, sortCol, sortDir])

  const { filtered, profiles, isFiltering } = useMemo(() => {
    if (!data) return { filtered: [], profiles: [], isFiltering: false }

    const allProfiles = Array.from(
      new Set(data.rows.map(r => r.profile).filter(Boolean))
    ).sort()

    const isFiltering = !!(companyFilter || roleFilter || selectedStatuses.size > 0 || profileFilter !== 'all' || priorityFilter !== 'all')
    const co = companyFilter.toLowerCase()
    const ro = roleFilter.toLowerCase()

    const filtered = data.rows.filter(r => {
      if (co && !r.company.toLowerCase().includes(co)) return false
      if (ro && !r.role.toLowerCase().includes(ro)) return false
      if (selectedStatuses.size > 0 && !selectedStatuses.has(r.status)) return false
      if (profileFilter !== 'all' && r.profile !== profileFilter) return false
      if (priorityFilter === 'star' && !r.priority.includes('⭐')) return false
      if (priorityFilter === 'high' && r.priority.toLowerCase() !== 'high') return false
      return true
    })

    const sorted = [...filtered].sort((a, b) => compareRows(a, b, sortCol, sortDir))
    return { filtered: sorted, profiles: allProfiles, isFiltering }
  }, [data, companyFilter, roleFilter, selectedStatuses, profileFilter, priorityFilter, sortCol, sortDir])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const pageRows = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  const handleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const clearFilters = () => {
    setCompanyFilter(''); setRoleFilter('')
    setSelectedStatuses(new Set())
    setProfileFilter('all'); setPriorityFilter('all')
  }

  const thSort = 'px-3 py-2 text-left font-medium cursor-pointer select-none hover:bg-gray-100 whitespace-nowrap'
  const thFilter = 'px-2 py-1.5 bg-white border-b border-gray-200'

  if (error) return <div className="p-8 text-red-500 text-sm">Failed to load tracker: {error}</div>
  if (!data) return <div className="p-8 text-gray-400 text-sm">Loading tracker…</div>

  const availableStatuses = STATUS_ORDER.filter(s => data.rows.some(r => r.status === s))

  return (
    <div className="h-full flex flex-col p-6 gap-0">

      {/* Table with sticky two-row header */}
      <div className="flex-1 overflow-auto min-h-0 rounded border border-gray-200">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10">

            {/* Row 1 — sortable column headers */}
            <tr className="bg-gray-50 text-gray-500 uppercase tracking-wide">
              <th className={thSort} onClick={() => handleSort('date')}>
                Date <SortIcon col="date" sortCol={sortCol} sortDir={sortDir} />
              </th>
              <th className={thSort} onClick={() => handleSort('company')}>
                Company <SortIcon col="company" sortCol={sortCol} sortDir={sortDir} />
              </th>
              <th className={thSort} onClick={() => handleSort('role')}>
                Role <SortIcon col="role" sortCol={sortCol} sortDir={sortDir} />
              </th>
              <th className={thSort} onClick={() => handleSort('profile')}>
                Profile <SortIcon col="profile" sortCol={sortCol} sortDir={sortDir} />
              </th>
              <th className={thSort} onClick={() => handleSort('status')}>
                Status <SortIcon col="status" sortCol={sortCol} sortDir={sortDir} />
              </th>
              <th className={thSort} onClick={() => handleSort('follow_up_date')}>
                Follow-up <SortIcon col="follow_up_date" sortCol={sortCol} sortDir={sortDir} />
              </th>
              <th className={thSort} onClick={() => handleSort('priority')}>
                Priority <SortIcon col="priority" sortCol={sortCol} sortDir={sortDir} />
              </th>
            </tr>

            {/* Row 2 — filter inputs aligned to each column */}
            <tr className="bg-white">
              {/* Date — clear button when filtering */}
              <th className={thFilter}>
                {isFiltering ? (
                  <button onClick={clearFilters} className="text-xs text-blue-500 hover:text-blue-700 whitespace-nowrap">
                    ✕ Clear
                  </button>
                ) : (
                  <span className="text-gray-300 text-xs">—</span>
                )}
              </th>
              {/* Company */}
              <th className={thFilter}>
                <div className="relative">
                  <input
                    type="text"
                    value={companyFilter}
                    onChange={e => setCompanyFilter(e.target.value)}
                    placeholder="Filter…"
                    className="w-full pr-5 pl-2 py-1 text-xs border border-gray-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 font-normal normal-case tracking-normal"
                  />
                  {companyFilter && (
                    <button onClick={() => setCompanyFilter('')} className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">✕</button>
                  )}
                </div>
              </th>
              {/* Role */}
              <th className={thFilter}>
                <div className="relative">
                  <input
                    type="text"
                    value={roleFilter}
                    onChange={e => setRoleFilter(e.target.value)}
                    placeholder="Filter…"
                    className="w-full pr-5 pl-2 py-1 text-xs border border-gray-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 font-normal normal-case tracking-normal"
                  />
                  {roleFilter && (
                    <button onClick={() => setRoleFilter('')} className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">✕</button>
                  )}
                </div>
              </th>
              {/* Profile */}
              <th className={thFilter}>
                <select
                  value={profileFilter}
                  onChange={e => setProfileFilter(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 font-normal normal-case tracking-normal"
                >
                  <option value="all">All</option>
                  {profiles.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </th>
              {/* Status */}
              <th className={`${thFilter} min-w-32`}>
                <StatusMultiSelect statuses={availableStatuses} selected={selectedStatuses} onChange={setSelectedStatuses} />
              </th>
              {/* Follow-up — no filter */}
              <th className={thFilter} />
              {/* Priority */}
              <th className={thFilter}>
                <select
                  value={priorityFilter}
                  onChange={e => setPriorityFilter(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 font-normal normal-case tracking-normal"
                >
                  <option value="all">All</option>
                  <option value="star">⭐ only</option>
                  <option value="high">High only</option>
                </select>
              </th>
            </tr>

          </thead>
          <tbody className="divide-y divide-gray-100">
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-gray-400">
                  {isFiltering ? 'No rows match the current filters.' : 'No applications yet.'}
                </td>
              </tr>
            ) : pageRows.map((row, i) => (
              <tr
                key={row.id || i}
                onClick={() => row.folder && navigate(`/applications/${row.folder}`)}
                className={`${row.folder ? 'cursor-pointer hover:bg-blue-50' : ''} transition-colors`}
              >
                <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{row.date}</td>
                <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">
                  {row.company}
                  {!row.folder && <span className="ml-1 text-gray-300" title="No application folder">●</span>}
                </td>
                <td className="px-3 py-2 text-gray-600 max-w-xs">
                  <span className="line-clamp-2">{row.role}</span>
                </td>
                <td className="px-3 py-2">
                  <span className="bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded text-xs">{row.profile}</span>
                </td>
                <td className="px-3 py-2 max-w-xs">
                  <span className={`px-1.5 py-0.5 rounded text-xs ${statusClass(row.status)}`}>
                    {STATUS_LABEL[row.status] ?? row.status}
                  </span>
                  {row.status_detail && (
                    <div className="text-gray-400 text-xs mt-0.5 line-clamp-2">{row.status_detail}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{row.follow_up_date}</td>
                <td className="px-3 py-2">{priorityBadge(row.priority)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination — always visible */}
      <div className="flex-shrink-0 flex items-center justify-between pt-2 mt-1 border-t border-gray-100 text-xs text-gray-500">
        <span>
          {isFiltering
            ? `${filtered.length} of ${data.rows.length} rows`
            : `${data.rows.length} rows`}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage(p => p - 1)}
            disabled={page === 1}
            className="px-3 py-1 border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
          >‹ Prev</button>
          {totalPages <= 9
            ? Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i + 1}
                  onClick={() => setPage(i + 1)}
                  className={`px-2.5 py-1 rounded border ${
                    page === i + 1
                      ? 'border-blue-400 bg-blue-50 text-blue-600 font-semibold'
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >{i + 1}</button>
              ))
            : <span className="px-2 tabular-nums">{page} / {totalPages}</span>
          }
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={page === totalPages}
            className="px-3 py-1 border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
          >Next ›</button>
        </div>
      </div>

    </div>
  )
}
