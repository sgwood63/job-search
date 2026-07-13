import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api, Thought } from '../api'

function formatDateTime(iso: string): string {
  return iso ? iso.slice(0, 19).replace('T', ' ') : ''
}

export default function ThoughtDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [thought, setThought] = useState<Thought | null>(null)
  const [connections, setConnections] = useState<Thought[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    setThought(null)
    setConnections(null)
    setError(null)

    api.thought(id)
      .then(t => {
        setThought(t)
        return api.thoughtConnections(id, 8)
      })
      .then(conns => {
        const list = (conns as { connections?: Thought[] }).connections ??
          (Array.isArray(conns) ? conns : [])
        setConnections(list)
      })
      .catch(e => setError(String(e)))
  }, [id])

  if (!id) return null

  const meta = thought?.metadata ?? {}
  const isMarkdown = thought?.content?.trimStart().startsWith('#') ?? false

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-100 bg-white flex-shrink-0">
        <button
          onClick={() => navigate('/thoughts')}
          className="text-xs text-gray-500 hover:text-gray-800 transition-colors"
        >
          ← Thoughts
        </button>
        {thought && (
          <span className="text-xs text-gray-400 ml-auto">{formatDateTime(thought.created_at)}</span>
        )}
      </div>

      {error ? (
        <div className="px-4 py-3 text-xs text-red-500">{error}</div>
      ) : thought === null ? (
        <div className="px-4 py-3 text-xs text-gray-400">Loading…</div>
      ) : (
        <div className="flex-1 overflow-auto px-6 py-4 space-y-6">
          <section>
            {isMarkdown ? (
              <div className="prose prose-sm max-w-none prose-headings:my-2 prose-p:my-1 prose-ul:my-1 prose-li:my-0">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{thought.content}</ReactMarkdown>
              </div>
            ) : (
              <pre className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed font-mono bg-gray-50 rounded p-4 overflow-auto">
                {thought.content}
              </pre>
            )}
          </section>

          {Object.keys(meta).length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Metadata</h3>
              <div className="bg-gray-50 rounded border border-gray-200 overflow-hidden">
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-gray-100">
                    {Object.entries(meta).map(([k, v]) => (
                      <tr key={k}>
                        <td className="px-3 py-1.5 text-gray-400 font-medium w-40 align-top whitespace-nowrap">{k}</td>
                        <td className="px-3 py-1.5 text-gray-700 break-all">
                          {typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Connections {connections !== null ? `(${connections.length})` : ''}
            </h3>
            {connections === null ? (
              <p className="text-xs text-gray-400">Loading…</p>
            ) : connections.length === 0 ? (
              <p className="text-xs text-gray-400">No related thoughts found.</p>
            ) : (
              <div className="space-y-2">
                {connections.map(c => (
                  <div
                    key={c.id}
                    onClick={() => navigate(`/thoughts/${encodeURIComponent(c.id)}`)}
                    className="rounded border border-gray-200 px-3 py-2 cursor-pointer hover:border-blue-300 hover:bg-blue-50 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-[10px] text-gray-400">{formatDateTime(c.created_at)}</span>
                      {c.similarity != null && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                          {Math.round(c.similarity * 100)}% match
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-700 line-clamp-2 leading-relaxed">
                      {c.content?.slice(0, 160)}{(c.content?.length ?? 0) > 160 ? '…' : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
