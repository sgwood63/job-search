import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, TrackerRow, PhaseDRow, ClosedRow, TrackerData } from '../api'

function statusClass(status: string): string {
  const s = status.toLowerCase()
  if (s.includes('hard stop') || s.includes('comp hard stop')) return 'bg-red-100 text-red-700'
  if (s.includes('applied')) return 'bg-green-100 text-green-700'
  if (s.includes('pending review')) return 'bg-yellow-100 text-yellow-700'
  if (s.includes('rejected') || s.includes('not pursuing') || s.includes('no fit'))
    return 'bg-gray-100 text-gray-500'
  if (s.includes('resume ready')) return 'bg-blue-100 text-blue-700'
  if (s.includes('screening') || s.includes('jobot')) return 'bg-purple-100 text-purple-700'
  if (s.includes('awaiting')) return 'bg-teal-100 text-teal-700'
  return 'bg-gray-100 text-gray-600'
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

function Section({ title, count, children, defaultOpen = true }: {
  title: string
  count: number
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 mb-2 text-left w-full"
      >
        <span className="text-xs text-gray-400">{open ? '▾' : '▸'}</span>
        <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{count}</span>
      </button>
      {open && children}
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
                  {row.status.length > 60 ? row.status.slice(0, 60) + '…' : row.status}
                </span>
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
            <th className="px-3 py-2 text-left font-medium">Outcome</th>
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
              <td className="px-3 py-2">
                <span className={`px-1.5 py-0.5 rounded text-xs ${statusClass(row.outcome)}`}>
                  {row.outcome}
                </span>
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

  useEffect(() => {
    api.tracker().then(setData).catch(e => setError(String(e)))
  }, [])

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
      <Section title="Active Applications" count={data.active.length}>
        <ActiveTable rows={data.active} />
      </Section>
      <Section title="Phase D Samples" count={data.phase_d.length} defaultOpen={false}>
        <PhaseDTable rows={data.phase_d} />
      </Section>
      <Section title="Closed / Rejected" count={data.closed.length} defaultOpen={false}>
        <ClosedTable rows={data.closed} />
      </Section>
    </div>
  )
}
