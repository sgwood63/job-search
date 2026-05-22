import { useState } from 'react'
import { useSessionContext, SessionMeta } from '../context/SessionContext'
import { ChatMessages, ChatInput } from './ChatPanel'

function statusBadge(status: SessionMeta['status']) {
  const base = 'text-xs px-1.5 py-0.5 rounded-full font-medium'
  if (status === 'executing') return `${base} bg-blue-100 text-blue-700`
  if (status === 'waiting') return `${base} bg-amber-100 text-amber-700`
  return `${base} bg-gray-100 text-gray-500`
}

function relativeTime(ts: number) {
  const diff = Date.now() / 1000 - ts
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function SessionsView() {
  const {
    sessions,
    activeSessionId,
    activeStatus,
    messages,
    streamingContent,
    sessionReady,
    setActiveSession,
    sendInput,
    createSession,
    closeSession,
  } = useSessionContext()

  const [debugData, setDebugData] = useState<Record<string, unknown> | null>(null)
  const [debugLoading, setDebugLoading] = useState(false)
  const [debugOpen, setDebugOpen] = useState(false)

  const executing = activeStatus === 'executing'
  const isClosed = activeStatus === 'closed'

  const active = sessions.find(s => s.id === activeSessionId)

  async function handleSend(text: string) {
    if (!activeSessionId) {
      await createSession(text.slice(0, 40))
    }
    sendInput(text)
  }

  async function handleDebug() {
    if (debugOpen) {
      setDebugOpen(false)
      return
    }
    if (!activeSessionId) return
    setDebugLoading(true)
    try {
      const res = await fetch(`/api/sessions/${activeSessionId}/debug`, { cache: 'no-store' })
      const data = await res.json()
      setDebugData(data)
      setDebugOpen(true)
    } catch {
      setDebugData({ error: 'Failed to fetch debug info' })
      setDebugOpen(true)
    } finally {
      setDebugLoading(false)
    }
  }

  return (
    <div className="flex h-full">
      {/* Session list */}
      <aside className="w-56 flex-shrink-0 border-r bg-white flex flex-col overflow-hidden">
        <div className="px-3 pt-3 pb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Sessions</h2>
          <button
            onClick={() => createSession()}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
            title="New session"
          >
            + New
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {sessions.length === 0 ? (
            <div className="px-3 py-4 text-xs text-gray-400 text-center">
              No sessions yet. Start a chat to create one.
            </div>
          ) : (
            <ul>
              {sessions.map(s => (
                <li key={s.id}>
                  <button
                    onClick={() => setActiveSession(s.id)}
                    className={`w-full text-left px-3 py-2.5 border-b border-gray-50 transition-colors ${
                      s.id === activeSessionId
                        ? 'bg-blue-50'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-xs font-medium text-gray-800 truncate flex-1">
                        {s.label}
                      </span>
                      <span className={statusBadge(s.status)}>{s.status}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">{relativeTime(s.created_at)}</span>
                      {s.mode === 'plan' && (
                        <span className="text-xs text-purple-500">plan</span>
                      )}
                    </div>
                    <code className="text-[10px] text-gray-300 font-mono">{s.id}</code>
                    {s.preview && (
                      <p className="text-xs text-gray-400 truncate mt-0.5">{s.preview.trim().slice(-60)}</p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Session detail */}
      <div className="flex-1 flex flex-col min-w-0 bg-white">
        {!activeSessionId ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
            <div className="text-3xl">💬</div>
            <p className="text-sm">Select a session or start a new one</p>
            <button
              onClick={() => createSession()}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
            >
              + New Session
            </button>
          </div>
        ) : (
          <>
            {/* Session header */}
            <div className="flex-shrink-0 flex flex-col border-b bg-gray-50">
              <div className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-gray-800 truncate block">
                    {active?.label ?? activeSessionId}
                  </span>
                  <code className="text-[10px] text-gray-400 font-mono">{activeSessionId}</code>
                </div>
                <span className={active ? statusBadge(active.status) : ''}>
                  {active?.status ?? ''}
                </span>
                {active?.mode === 'plan' && (
                  <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">plan</span>
                )}
                <button
                  onClick={handleDebug}
                  disabled={debugLoading}
                  className={`text-xs px-2 py-0.5 rounded border transition-colors disabled:opacity-50 ${
                    debugOpen
                      ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
                      : 'bg-white border-gray-200 text-gray-500 hover:text-gray-800 hover:border-gray-300'
                  }`}
                  title="Debug session"
                >
                  {debugLoading ? '…' : 'Debug'}
                </button>
                {activeStatus !== 'closed' && (
                  <button
                    onClick={() => closeSession()}
                    className="text-xs text-gray-400 hover:text-red-500 transition-colors px-1"
                    title="Close session"
                  >
                    Close
                  </button>
                )}
              </div>

              {/* Debug panel */}
              {debugOpen && debugData && (
                <div className="px-4 pb-2 border-t border-amber-100 bg-amber-50">
                  <pre className="text-[10px] font-mono text-amber-900 overflow-auto max-h-32 mt-1.5 whitespace-pre-wrap break-all">
                    {JSON.stringify(debugData, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            {/* Messages */}
            <ChatMessages
              messages={messages}
              streamingContent={streamingContent}
              executing={executing}
              sessionReady={sessionReady}
            />

            {/* Input */}
            {!isClosed ? (
              <ChatInput
                onSend={handleSend}
                disabled={!sessionReady}
                placeholder={!sessionReady ? 'Session starting…' : 'Message… (Enter to send)'}
              />
            ) : (
              <div className="flex-shrink-0 px-4 py-3 border-t bg-gray-50 text-xs text-gray-400 text-center">
                Session closed — read-only transcript
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
