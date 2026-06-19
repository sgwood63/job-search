import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api, IngestionRecord, SearchRun, TrackerRow } from '../api'

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

type SortDir = 'asc' | 'desc'
type IngestionSortCol = 'created_at' | 'company_name' | 'role_title' | 'profile_slug' | 'outcome'
type RunSortCol = 'run_at' | 'profile_slug' | 'source' | 'pages_fetched' | 'total_results' | 'screened' | 'fit_count' | 'fetch_failed_count'

function deriveSource(r: SearchRun): string {
  return r.query === null ? 'LinkedIn' : 'Google Jobs'
}

// ---------------------------------------------------------------------------
// Positions tab
// ---------------------------------------------------------------------------

function IngestionTab({
  profileSlug,
  companyFolderMap,
}: {
  profileSlug: string
  companyFolderMap: Map<string, string>
}) {
  const navigate = useNavigate()
  const [records, setRecords] = useState<IngestionRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [outcomeFilter, setOutcomeFilter] = useState('')
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState<IngestionSortCol>('created_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  useEffect(() => {
    setRecords(null)
    setError(null)
    api.ingestionHistory({
      profile_slug: profileSlug || undefined,
      outcome: outcomeFilter || undefined,
      limit: 500,
    })
      .then(d => setRecords(d.records))
      .catch(e => setError(String(e)))
  }, [profileSlug, outcomeFilter])

  function handleSort(col: IngestionSortCol) {
    if (col === sortCol) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  function sortIndicator(col: IngestionSortCol) {
    if (col !== sortCol) return null
    return <span className="ml-0.5">{sortDir === 'asc' ? '▲' : '▼'}</span>
  }

  const filtered = records
    ? records
        .filter(r => {
          if (!search) return true
          const q = search.toLowerCase()
          return r.company_name.toLowerCase().includes(q) || r.role_title.toLowerCase().includes(q)
        })
        .sort((a, b) => {
          const av = a[sortCol] ?? ''
          const bv = b[sortCol] ?? ''
          const cmp = String(av).localeCompare(String(bv))
          return sortDir === 'asc' ? cmp : -cmp
        })
    : null

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-white flex-wrap">
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
        <input
          type="text"
          placeholder="Search company / role…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="text-xs border border-gray-200 rounded px-2 py-1 w-48 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        {search && (
          <button onClick={() => setSearch('')} className="text-xs text-blue-500 hover:text-blue-700">
            Clear
          </button>
        )}
        <span className="ml-auto text-xs text-gray-400">
          {filtered != null
            ? `${filtered.length}${records && filtered.length !== records.length ? ` / ${records.length}` : ''} records`
            : ''}
        </span>
      </div>
      <div className="overflow-auto max-h-[60vh]">
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
                <th
                  className="px-3 py-1.5 text-left font-medium whitespace-nowrap cursor-pointer hover:text-gray-700 select-none"
                  onClick={() => handleSort('created_at')}
                >
                  Date{sortIndicator('created_at')}
                </th>
                <th
                  className="px-3 py-1.5 text-left font-medium cursor-pointer hover:text-gray-700 select-none"
                  onClick={() => handleSort('company_name')}
                >
                  Company{sortIndicator('company_name')}
                </th>
                <th
                  className="px-3 py-1.5 text-left font-medium cursor-pointer hover:text-gray-700 select-none"
                  onClick={() => handleSort('role_title')}
                >
                  Role{sortIndicator('role_title')}
                </th>
                <th
                  className="px-3 py-1.5 text-left font-medium cursor-pointer hover:text-gray-700 select-none"
                  onClick={() => handleSort('profile_slug')}
                >
                  Profile{sortIndicator('profile_slug')}
                </th>
                <th
                  className="px-3 py-1.5 text-left font-medium cursor-pointer hover:text-gray-700 select-none"
                  onClick={() => handleSort('outcome')}
                >
                  Outcome{sortIndicator('outcome')}
                </th>
                <th className="px-3 py-1.5 text-left font-medium">Reason</th>
                <th className="px-3 py-1.5 text-center font-medium">Repost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(filtered ?? []).map(r => {
                const appFolder = r.outcome === 'fit'
                  ? companyFolderMap.get(r.company_name.toLowerCase())
                  : undefined
                return (
                  <tr
                    key={r.id}
                    className={`hover:bg-gray-50 transition-colors ${appFolder ? 'cursor-pointer hover:bg-blue-50' : ''}`}
                    onClick={appFolder ? () => navigate(`/applications/${encodeURIComponent(appFolder)}`) : undefined}
                    title={appFolder ? `Open application: ${appFolder}` : undefined}
                  >
                    <td className="px-3 py-1.5 text-gray-400 whitespace-nowrap">{formatDate(r.created_at)}</td>
                    <td className={`px-3 py-1.5 font-medium ${appFolder ? 'text-blue-700' : 'text-gray-800'}`}>
                      {r.company_name}
                      {appFolder && <span className="ml-1 text-blue-400 text-[10px]">↗</span>}
                    </td>
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
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Run detail panel
// ---------------------------------------------------------------------------

function RunDetailPanel({ run, onClose }: { run: SearchRun; onClose: () => void }) {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setContent(null)
    setError(null)
    if (!run.summary_key) {
      setContent('No summary file recorded for this run.')
      return
    }
    api.getFile(run.summary_key)
      .then(setContent)
      .catch(e => setError(String(e)))
  }, [run.id])

  return (
    <div className="border-t border-gray-200 bg-white">
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-gray-100 bg-gray-50">
        <span className="text-xs font-medium text-gray-600">
          {formatDateTime(run.run_at)} · {deriveSource(run)} · {run.profile_slug ?? 'no profile'}
        </span>
        <button
          onClick={onClose}
          className="text-xs text-gray-400 hover:text-gray-600 px-1"
        >
          ✕
        </button>
      </div>
      <div className="overflow-auto max-h-[45vh] px-6 py-4 prose prose-sm max-w-none prose-table:text-xs prose-headings:my-2 prose-p:my-1 prose-ul:my-1 prose-li:my-0">
        {error ? (
          <p className="text-red-500 not-prose text-xs">{error}</p>
        ) : content === null ? (
          <p className="text-gray-400 not-prose text-xs">Loading…</p>
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Direct submissions section (positions with no search run)
// ---------------------------------------------------------------------------

function DirectSubmissionsSection({ profileSlug }: { profileSlug: string }) {
  const navigate = useNavigate()
  const [records, setRecords] = useState<IngestionRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(true)

  useEffect(() => {
    setRecords(null)
    setError(null)
    api.ingestionHistory({ profile_slug: profileSlug || undefined, direct_only: true, limit: 200 })
      .then(d => setRecords(d.records))
      .catch(e => setError(String(e)))
  }, [profileSlug])

  const count = records?.length ?? 0

  return (
    <div className="border-t border-gray-200">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2 bg-gray-50 hover:bg-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide"
      >
        <span>Direct Submissions {count > 0 ? `(${count})` : ''}</span>
        <span>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="overflow-auto max-h-[35vh]">
          {error ? (
            <div className="px-4 py-3 text-xs text-red-500">{error}</div>
          ) : !records ? (
            <div className="px-4 py-3 text-xs text-gray-400">Loading…</div>
          ) : records.length === 0 ? (
            <div className="px-4 py-3 text-xs text-gray-400">
              No direct submissions yet. JDs submitted via chat appear here.
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
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {records.map(r => (
                  <tr
                    key={r.id}
                    className={`hover:bg-gray-50 transition-colors ${r.outcome === 'fit' ? 'cursor-pointer hover:bg-blue-50' : ''}`}
                    onClick={r.outcome === 'fit' ? () => navigate(`/applications`) : undefined}
                  >
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
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Runs tab
// ---------------------------------------------------------------------------

function RunHistoryTab({ profileSlug }: { profileSlug: string }) {
  const [runs, setRuns] = useState<SearchRun[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState<RunSortCol>('run_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    setRuns(null)
    setError(null)
    setSelectedId(null)
    api.searchRuns({ profile_slug: profileSlug || undefined, limit: 200 })
      .then(d => setRuns(d.records))
      .catch(e => setError(String(e)))
  }, [profileSlug])

  function handleSort(col: RunSortCol) {
    if (col === sortCol) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir(col === 'run_at' ? 'desc' : 'asc')
    }
  }

  function sortIndicator(col: RunSortCol) {
    if (col !== sortCol) return null
    return <span className="ml-0.5">{sortDir === 'asc' ? '▲' : '▼'}</span>
  }

  const filtered = runs
    ? runs
        .filter(r => {
          if (!search) return true
          const q = search.toLowerCase()
          return (r.profile_slug ?? '').toLowerCase().includes(q) ||
                 deriveSource(r).toLowerCase().includes(q)
        })
        .sort((a, b) => {
          let av: string | number
          let bv: string | number
          if (sortCol === 'source') {
            av = deriveSource(a); bv = deriveSource(b)
          } else if (sortCol === 'pages_fetched' || sortCol === 'total_results' ||
                     sortCol === 'screened' || sortCol === 'fit_count' || sortCol === 'fetch_failed_count') {
            av = a[sortCol] ?? 0; bv = b[sortCol] ?? 0
            const numCmp = (av as number) - (bv as number)
            return sortDir === 'asc' ? numCmp : -numCmp
          } else {
            av = (a[sortCol as keyof SearchRun] ?? '') as string
            bv = (b[sortCol as keyof SearchRun] ?? '') as string
          }
          const cmp = String(av).localeCompare(String(bv))
          return sortDir === 'asc' ? cmp : -cmp
        })
    : null

  const selectedRun = selectedId ? (runs ?? []).find(r => r.id === selectedId) ?? null : null

  function thClass(col: RunSortCol, extra = '') {
    return `px-3 py-1.5 font-medium cursor-pointer hover:text-gray-700 select-none ${extra}`
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-white">
        <input
          type="text"
          placeholder="Filter by profile or source…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="text-xs border border-gray-200 rounded px-2 py-1 w-52 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        {search && (
          <button onClick={() => setSearch('')} className="text-xs text-blue-500 hover:text-blue-700">
            Clear
          </button>
        )}
        <span className="ml-auto text-xs text-gray-400">
          {filtered != null
            ? `${filtered.length}${runs && filtered.length !== runs.length ? ` / ${runs.length}` : ''} runs`
            : ''}
        </span>
      </div>

      <div className="overflow-auto max-h-[60vh]">
        {error ? (
          <div className="px-4 py-3 text-xs text-red-500">{error}</div>
        ) : !runs ? (
          <div className="px-4 py-3 text-xs text-gray-400">Loading…</div>
        ) : runs.length === 0 ? (
          <div className="px-4 py-3 text-xs text-gray-400">
            No search runs yet. Run <code>/ingest</code> or <code>/linkedin-ingest</code> in a session.
          </div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-gray-50 text-gray-500 uppercase tracking-wide">
              <tr>
                <th className={thClass('run_at', 'text-left whitespace-nowrap')} onClick={() => handleSort('run_at')}>
                  Date{sortIndicator('run_at')}
                </th>
                <th className={thClass('profile_slug', 'text-left')} onClick={() => handleSort('profile_slug')}>
                  Profile{sortIndicator('profile_slug')}
                </th>
                <th className={thClass('source', 'text-left')} onClick={() => handleSort('source')}>
                  Source{sortIndicator('source')}
                </th>
                <th className={thClass('pages_fetched', 'text-right')} onClick={() => handleSort('pages_fetched')}>
                  Pages{sortIndicator('pages_fetched')}
                </th>
                <th className={thClass('total_results', 'text-right')} onClick={() => handleSort('total_results')}>
                  Total{sortIndicator('total_results')}
                </th>
                <th className={thClass('screened', 'text-right')} onClick={() => handleSort('screened')}>
                  Screened{sortIndicator('screened')}
                </th>
                <th className={thClass('fit_count', 'text-right')} onClick={() => handleSort('fit_count')}>
                  Fit{sortIndicator('fit_count')}
                </th>
                <th className={thClass('fetch_failed_count', 'text-right')} onClick={() => handleSort('fetch_failed_count')}>
                  Failed{sortIndicator('fetch_failed_count')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(filtered ?? []).map(r => (
                <tr
                  key={r.id}
                  className={`transition-colors cursor-pointer ${
                    r.id === selectedId
                      ? 'bg-blue-50 hover:bg-blue-100'
                      : 'hover:bg-gray-50'
                  }`}
                  onClick={() => setSelectedId(id => id === r.id ? null : r.id)}
                  title="Click to view run summary"
                >
                  <td className="px-3 py-1.5 text-gray-400 whitespace-nowrap">{formatDateTime(r.run_at)}</td>
                  <td className="px-3 py-1.5 text-gray-600">{r.profile_slug ?? '—'}</td>
                  <td className="px-3 py-1.5 text-gray-500">{deriveSource(r)}</td>
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

      {selectedRun && (
        <RunDetailPanel
          run={selectedRun}
          onClose={() => setSelectedId(null)}
        />
      )}

      <DirectSubmissionsSection profileSlug={profileSlug} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Panel + root
// ---------------------------------------------------------------------------

type TabId = 'ingestion' | 'runs'

function SearchHistoryPanel() {
  const [open, setOpen] = useState(true)
  const [tab, setTab] = useState<TabId>('ingestion')
  const [profileSlug, setProfileSlug] = useState('')
  const [profileOptions, setProfileOptions] = useState<string[]>([])
  const [trackerRows, setTrackerRows] = useState<TrackerRow[]>([])

  useEffect(() => {
    api.profiles()
      .then(d => setProfileOptions(d.profiles.map(p => p.name)))
      .catch(() => {})
    api.tracker()
      .then(d => setTrackerRows(d.rows))
      .catch(() => {})
  }, [])

  const companyFolderMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of trackerRows) {
      if (r.folder) m.set(r.company.toLowerCase(), r.folder)
    }
    return m
  }, [trackerRows])

  return (
    <div className="flex flex-col h-full">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2 bg-gray-50 hover:bg-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide flex-shrink-0"
      >
        <span>Search History</span>
        <span>{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="flex flex-col">
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
            <div className="ml-auto flex items-center px-4 py-1.5">
              <select
                value={profileSlug}
                onChange={e => setProfileSlug(e.target.value)}
                className="text-xs border border-gray-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                <option value="">All profiles</option>
                {profileOptions.map(slug => (
                  <option key={slug} value={slug}>{slug}</option>
                ))}
              </select>
            </div>
          </div>

          {tab === 'ingestion'
            ? <IngestionTab profileSlug={profileSlug} companyFolderMap={companyFolderMap} />
            : <RunHistoryTab profileSlug={profileSlug} />
          }
        </div>
      )}
    </div>
  )
}

export default function SearchView() {
  return (
    <div className="flex flex-col h-full">
      <SearchHistoryPanel />
    </div>
  )
}
