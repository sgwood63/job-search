import { useState, useEffect } from 'react'
import { api, FileNode, IngestionRecord, SearchRun } from '../api'
import FileTree from './FileTree'
import FileViewer from './FileViewer'
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus'

const OUTCOME_LABEL: Record<string, string> = {
  'fit': 'Fit',
  'no-fit': 'No Fit',
  'duplicate': 'Duplicate',
  'fetch-failed': 'Fetch Failed',
}

function outcomeClass(outcome: string): string {
  switch (outcome) {
    case 'fit':          return 'bg-green-100 text-green-700'
    case 'no-fit':       return 'bg-red-100 text-red-600'
    case 'duplicate':    return 'bg-yellow-100 text-yellow-700'
    case 'fetch-failed': return 'bg-gray-100 text-gray-500'
    default:             return 'bg-gray-100 text-gray-600'
  }
}

function formatDate(iso: string): string {
  return iso ? iso.slice(0, 10) : ''
}

function formatDateTime(iso: string): string {
  if (!iso) return ''
  return iso.slice(0, 16).replace('T', ' ')
}

const OUTCOMES = ['fit', 'no-fit', 'duplicate', 'fetch-failed']

function IngestionTab({ profileSlug }: { profileSlug: string }) {
  const [records, setRecords] = useState<IngestionRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [outcomeFilter, setOutcomeFilter] = useState('')

  useEffect(() => {
    setRecords(null)
    setError(null)
    api.ingestionHistory({
      profile_slug: profileSlug || undefined,
      outcome: outcomeFilter || undefined,
      limit: 100,
    })
      .then(d => setRecords(d.records))
      .catch(e => setError(String(e)))
  }, [profileSlug, outcomeFilter])

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-white">
        <select
          value={outcomeFilter}
          onChange={e => setOutcomeFilter(e.target.value)}
          className="text-xs border border-gray-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
        >
          <option value="">All outcomes</option>
          {OUTCOMES.map(o => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
        </select>
        {outcomeFilter && (
          <button onClick={() => setOutcomeFilter('')} className="text-xs text-blue-500 hover:text-blue-700">
            Clear
          </button>
        )}
        <span className="ml-auto text-xs text-gray-400">{records ? `${records.length} records` : ''}</span>
      </div>
      <div className="overflow-auto max-h-64">
        {error ? (
          <div className="px-4 py-3 text-xs text-red-500">{error}</div>
        ) : !records ? (
          <div className="px-4 py-3 text-xs text-gray-400">Loading…</div>
        ) : records.length === 0 ? (
          <div className="px-4 py-3 text-xs text-gray-400">
            No ingestion history yet. Run <code>/ingest</code> or <code>/linkedin-ingest</code> in a session.
          </div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-gray-50 text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium whitespace-nowrap">Date</th>
                <th className="px-3 py-1.5 text-left font-medium">Company</th>
                <th className="px-3 py-1.5 text-left font-medium">Role</th>
                <th className="px-3 py-1.5 text-left font-medium">Profile</th>
                <th className="px-3 py-1.5 text-left font-medium">Outcome</th>
                <th className="px-3 py-1.5 text-left font-medium">Reason</th>
                <th className="px-3 py-1.5 text-center font-medium">Repost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {records.map(r => (
                <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-3 py-1.5 text-gray-400 whitespace-nowrap">{formatDate(r.created_at)}</td>
                  <td className="px-3 py-1.5 font-medium text-gray-800">{r.company_name}</td>
                  <td className="px-3 py-1.5 text-gray-600 max-w-xs truncate">{r.role_title}</td>
                  <td className="px-3 py-1.5 text-gray-500">{r.profile_slug ?? '—'}</td>
                  <td className="px-3 py-1.5">
                    <span className={`px-1.5 py-0.5 rounded ${outcomeClass(r.outcome)}`}>
                      {OUTCOME_LABEL[r.outcome] ?? r.outcome}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-gray-400 max-w-xs truncate">{r.no_fit_reason ?? ''}</td>
                  <td className="px-3 py-1.5 text-center">{r.is_repost ? '↩' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function RunHistoryTab({ profileSlug }: { profileSlug: string }) {
  const [runs, setRuns] = useState<SearchRun[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setRuns(null)
    setError(null)
    api.searchRuns({ profile_slug: profileSlug || undefined, limit: 50 })
      .then(d => setRuns(d.records))
      .catch(e => setError(String(e)))
  }, [profileSlug])

  return (
    <div className="overflow-auto max-h-72">
      {error ? (
        <div className="px-4 py-3 text-xs text-red-500">{error}</div>
      ) : !runs ? (
        <div className="px-4 py-3 text-xs text-gray-400">Loading…</div>
      ) : (
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-gray-50 text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium whitespace-nowrap">Date</th>
              <th className="px-3 py-1.5 text-left font-medium">Profile</th>
              <th className="px-3 py-1.5 text-left font-medium">Query</th>
              <th className="px-3 py-1.5 text-right font-medium">Pages</th>
              <th className="px-3 py-1.5 text-right font-medium">Total</th>
              <th className="px-3 py-1.5 text-right font-medium">Screened</th>
              <th className="px-3 py-1.5 text-right font-medium">Fit</th>
              <th className="px-3 py-1.5 text-right font-medium">Failed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {runs.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-3 text-center text-gray-400">
                  No search runs yet. Run <code>/ingest</code> or <code>/linkedin-ingest</code> in a session.
                </td>
              </tr>
            ) : runs.map(r => (
              <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-3 py-1.5 text-gray-400 whitespace-nowrap">{formatDateTime(r.run_at)}</td>
                <td className="px-3 py-1.5 text-gray-600">{r.profile_slug ?? '—'}</td>
                <td className="px-3 py-1.5 text-gray-500 max-w-xs truncate" title={r.query}>
                  {r.query.length > 60 ? r.query.slice(0, 60) + '…' : r.query}
                </td>
                <td className="px-3 py-1.5 text-right text-gray-600">{r.pages_fetched}</td>
                <td className="px-3 py-1.5 text-right text-gray-600">{r.total_results}</td>
                <td className="px-3 py-1.5 text-right text-gray-600">{r.screened}</td>
                <td className="px-3 py-1.5 text-right font-medium text-green-700">{r.fit_count}</td>
                <td className="px-3 py-1.5 text-right text-gray-400">{r.fetch_failed_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

type TabId = 'ingestion' | 'runs'

function SearchHistoryPanel() {
  const [open, setOpen] = useState(true)
  const [tab, setTab] = useState<TabId>('ingestion')
  const [profileSlug, setProfileSlug] = useState('')

  return (
    <div className="border-b border-gray-200">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2 bg-gray-50 hover:bg-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide"
      >
        <span>Search History</span>
        <span>{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="flex flex-col">
          {/* Tab bar + shared profile filter */}
          <div className="flex items-center gap-0 border-b border-gray-100 bg-white">
            {(['ingestion', 'runs'] as TabId[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                  tab === t
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t === 'ingestion' ? 'Positions' : 'Runs'}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2 px-4 py-1.5">
              <input
                type="text"
                placeholder="Profile slug…"
                value={profileSlug}
                onChange={e => setProfileSlug(e.target.value)}
                className="text-xs border border-gray-200 rounded px-2 py-1 w-32 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              {profileSlug && (
                <button onClick={() => setProfileSlug('')} className="text-xs text-blue-500 hover:text-blue-700">
                  Clear
                </button>
              )}
            </div>
          </div>

          {tab === 'ingestion'
            ? <IngestionTab profileSlug={profileSlug} />
            : <RunHistoryTab profileSlug={profileSlug} />
          }
        </div>
      )}
    </div>
  )
}

export default function SearchView() {
  const [nodes, setNodes] = useState<FileNode[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useRefreshOnFocus(() => setVersion(v => v + 1))

  useEffect(() => {
    api.search().then(data => {
      setNodes(data)
      setSelected(prev => {
        if (prev) return prev
        const firstFile = data.find(n => n.type === 'file')
        return firstFile?.path ?? null
      })
    })
  }, [version])

  return (
    <div className="flex flex-col h-full">
      <SearchHistoryPanel />

      <div className="flex flex-1 overflow-hidden min-h-0">
        <aside className="w-56 flex-shrink-0 border-r bg-white overflow-auto">
          <div className="px-3 pt-3 pb-1">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Search Results</h2>
          </div>
          <div className="py-1">
            {!nodes ? (
              <div className="px-3 text-xs text-gray-400">Loading…</div>
            ) : nodes.length === 0 ? (
              <div className="px-3 text-xs text-gray-400">No search results yet.</div>
            ) : (
              <FileTree nodes={nodes} selected={selected} onSelect={setSelected} />
            )}
          </div>
        </aside>

        <div className="flex-1 overflow-hidden">
          {selected ? (
            <FileViewer path={selected} />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              Select a file to view
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
