import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, Thought, ThoughtStats } from '../api'

function formatRelativeDate(iso: string): string {
  if (!iso) return ''
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
  return iso.slice(0, 10)
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-white rounded border border-gray-200 px-4 py-3 flex flex-col gap-0.5 min-w-[120px]">
      <div className="text-[10px] text-gray-500 uppercase tracking-wide font-medium">{label}</div>
      <div className="text-2xl font-semibold text-gray-800">{value}</div>
    </div>
  )
}

function ThoughtCard({ thought, onClick }: { thought: Thought; onClick: () => void }) {
  const meta = thought.metadata ?? {}
  const category = String(meta.thought_category ?? '')
  const company = String(meta.company ?? '')
  const profile = String(meta.profile_slug ?? '')
  const preview = thought.content?.slice(0, 200) ?? ''
  const hasMore = (thought.content?.length ?? 0) > 200

  return (
    <div
      onClick={onClick}
      className="border-b border-gray-100 px-4 py-3 cursor-pointer hover:bg-blue-50 transition-colors"
    >
      <div className="flex items-start gap-2 mb-1.5">
        <div className="flex-1 text-xs text-gray-700 leading-relaxed font-mono whitespace-pre-wrap line-clamp-3">
          {preview}{hasMore && '…'}
        </div>
        <span className="text-[10px] text-gray-400 shrink-0">{formatRelativeDate(thought.created_at)}</span>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {category && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">{category}</span>
        )}
        {company && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">{company}</span>
        )}
        {profile && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{profile}</span>
        )}
        {thought.similarity != null && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 ml-auto">
            {Math.round(thought.similarity * 100)}% match
          </span>
        )}
      </div>
    </div>
  )
}

function StatsRow({ stats }: { stats: ThoughtStats }) {
  const topCategories = Object.entries(stats.by_type)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)

  return (
    <div className="flex gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50 flex-shrink-0 overflow-x-auto">
      <StatCard label="Total Thoughts" value={stats.total} />
      {topCategories.map(([cat, count]) => (
        <StatCard key={cat} label={cat} value={count} />
      ))}
    </div>
  )
}

export default function ThoughtsView() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<ThoughtStats | null>(null)
  const [thoughts, setThoughts] = useState<Thought[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [isSearchResults, setIsSearchResults] = useState(false)

  useEffect(() => {
    api.thoughtStats()
      .then(setStats)
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (isSearchResults) return
    setThoughts(null)
    setError(null)
    api.thoughts({ limit: 50 })
      .then(d => setThoughts((d as { thoughts?: Thought[] }).thoughts ?? (d as unknown as Thought[]) ?? []))
      .catch(e => setError(String(e)))
  }, [isSearchResults])

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim()) {
      handleClear()
      return
    }
    setSearching(true)
    setError(null)
    try {
      const d = await api.searchThoughts(query.trim(), 30)
      const results = (d as { results?: Thought[] }).results ?? (d as unknown as Thought[]) ?? []
      setThoughts(results)
      setIsSearchResults(true)
    } catch (e) {
      setError(String(e))
    } finally {
      setSearching(false)
    }
  }

  function handleClear() {
    setQuery('')
    setIsSearchResults(false)
    setThoughts(null)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {stats && <StatsRow stats={stats} />}

      <form
        onSubmit={handleSearch}
        className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-white flex-shrink-0"
      >
        <input
          type="text"
          placeholder="Search thoughts…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="flex-1 text-sm border border-gray-200 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        {(query || isSearchResults) && (
          <button
            type="button"
            onClick={handleClear}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Clear
          </button>
        )}
        <button
          type="submit"
          disabled={searching}
          className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>

      {isSearchResults && (
        <div className="px-4 py-1.5 bg-blue-50 border-b border-blue-100 flex-shrink-0">
          <span className="text-xs text-blue-600">
            {thoughts?.length ?? 0} result{thoughts?.length !== 1 ? 's' : ''} for "{query}"
          </span>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {error ? (
          <div className="px-4 py-3 text-xs text-red-500">{error}</div>
        ) : thoughts === null ? (
          <div className="px-4 py-3 text-xs text-gray-400">Loading…</div>
        ) : thoughts.length === 0 ? (
          <div className="px-4 py-3 text-xs text-gray-400">
            {isSearchResults ? 'No results found.' : 'No thoughts yet.'}
          </div>
        ) : (
          thoughts.map(t => (
            <ThoughtCard
              key={t.id}
              thought={t}
              onClick={() => navigate(`/thoughts/${encodeURIComponent(t.id)}`)}
            />
          ))
        )}
      </div>
    </div>
  )
}
