import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useSessionContext, ChatMessage } from '../context/SessionContext'

function StatusDot({ status }: { status: 'executing' | 'waiting' | 'closed' | null }) {
  if (status === 'executing') {
    return (
      <span className="inline-flex gap-0.5 items-center">
        {[0, 1, 2].map(i => (
          <span
            key={i}
            className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </span>
    )
  }
  if (status === 'waiting') return <span className="w-2 h-2 bg-amber-400 rounded-full inline-block" />
  if (status === 'closed') return <span className="w-2 h-2 bg-gray-300 rounded-full inline-block" />
  return <span className="w-2 h-2 bg-gray-200 rounded-full inline-block" />
}

function StatusLabel({ status }: { status: 'executing' | 'waiting' | 'closed' | null }) {
  if (status === 'executing') return <span className="text-blue-600 text-xs">Executing</span>
  if (status === 'waiting') return <span className="text-amber-600 text-xs">Waiting</span>
  if (status === 'closed') return <span className="text-gray-400 text-xs">Closed</span>
  return <span className="text-gray-400 text-xs">No session</span>
}

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-3 py-2.5 flex gap-1 items-center">
        {[0, 1, 2].map(i => (
          <span
            key={i}
            className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  )
}

function MessageActions({ content, role, ts }: { content: string; role: 'user' | 'assistant'; ts: number }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  function handleDownload() {
    const ext = role === 'assistant' ? 'md' : 'txt'
    const filename = `message-${Math.floor(ts)}.${ext}`
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 mt-1 justify-end">
      <button
        onClick={handleCopy}
        title="Copy to clipboard"
        className="text-xs px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-500 hover:text-gray-800 hover:border-gray-300 transition-colors"
      >
        {copied ? '✓' : '⧉'}
      </button>
      <button
        onClick={handleDownload}
        title="Download"
        className="text-xs px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-500 hover:text-gray-800 hover:border-gray-300 transition-colors"
      >
        ↓
      </button>
    </div>
  )
}

export function MessageBubble({ msg }: { msg: ChatMessage }) {
  if (msg.role === 'user') {
    return (
      <div className="group flex flex-col items-end">
        <div className="max-w-[85%] bg-blue-600 text-white text-sm rounded-2xl rounded-tr-sm px-3 py-2 whitespace-pre-wrap break-words">
          {msg.content}
        </div>
        <MessageActions content={msg.content} role={msg.role} ts={msg.ts} />
      </div>
    )
  }
  return (
    <div className="group flex flex-col items-start">
      <div className="max-w-[92%] bg-gray-100 text-gray-900 text-sm rounded-2xl rounded-tl-sm px-3 py-2">
        <div className="prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-li:my-0">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
        </div>
      </div>
      <MessageActions content={msg.content} role={msg.role} ts={msg.ts} />
    </div>
  )
}

export function ChatMessages({
  messages,
  streamingContent,
  executing,
  sessionReady,
}: {
  messages: ChatMessage[]
  streamingContent: string
  executing: boolean
  sessionReady: boolean
}) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, executing])

  const hasMessages = messages.length > 0

  return (
    <div className="flex-1 overflow-auto px-4 py-3 flex flex-col gap-3">
      {!sessionReady && !hasMessages && (
        <div className="flex items-center justify-center h-full text-gray-400 text-xs">
          Session starting…
        </div>
      )}
      {sessionReady && !hasMessages && (
        <div className="flex items-center justify-center h-full text-gray-400 text-xs text-center p-4">
          Send a message to start
        </div>
      )}

      {messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}

      {streamingContent && (
        <div className="group flex flex-col items-start">
          <div className="max-w-[92%] bg-gray-100 text-gray-900 text-sm rounded-2xl rounded-tl-sm px-3 py-2">
            <div className="prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-li:my-0">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingContent}</ReactMarkdown>
            </div>
          </div>
        </div>
      )}
      {executing && !streamingContent && <TypingIndicator />}
      <div ref={endRef} />
    </div>
  )
}

export function ChatInput({
  onSend,
  disabled,
  placeholder,
}: {
  onSend: (text: string) => void
  disabled?: boolean
  placeholder?: string
}) {
  const [input, setInput] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text) return
    onSend(text)
    setInput('')
  }, [input, onSend])

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/upload?dir=applications', { method: 'POST', body: form })
    const data = await res.json()
    if (data.ok) {
      setInput(prev => prev + (prev ? '\n' : '') + `[file: ${data.name}]`)
    }
    e.target.value = ''
  }, [])

  return (
    <div className="flex-shrink-0 px-2 py-2 border-t border-gray-100 bg-white">
      <div className="flex gap-1.5 items-end">
        <button
          onClick={() => fileRef.current?.click()}
          title="Attach file"
          className="flex-shrink-0 p-1.5 text-gray-400 hover:text-gray-700 transition-colors"
        >
          📎
        </button>
        <input ref={fileRef} type="file" className="hidden" onChange={handleFile} />
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          placeholder={placeholder ?? 'Message… (Enter to send)'}
          rows={2}
          disabled={disabled}
          className="flex-1 text-sm border border-gray-200 rounded px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={disabled || !input.trim()}
          className="flex-shrink-0 px-3 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </div>
    </div>
  )
}

export default function ChatPanel() {
  const {
    activeSessionId,
    activeStatus,
    messages,
    streamingContent,
    sessionReady,
    mode,
    setMode,
    createSession,
    sendInput,
    closeSession,
    sessions,
    setActiveSession,
  } = useSessionContext()

  const [expanded, setExpanded] = useState(false)
  const [maximized, setMaximized] = useState(false)

  const executing = activeStatus === 'executing'
  const isClosed = activeStatus === 'closed'

  const handleSend = useCallback(async (text: string) => {
    if (!activeSessionId) {
      await createSession(text.slice(0, 40))
    }
    sendInput(text)
  }, [activeSessionId, createSession, sendInput])

  const handleNewSession = useCallback(async () => {
    await createSession()
  }, [createSession])

  const handleClose = useCallback(async () => {
    await closeSession()
  }, [closeSession])

  // Collapse maximized state when minimizing
  function handleMinimize() {
    setExpanded(false)
    setMaximized(false)
  }

  const panelStyle: React.CSSProperties = maximized
    ? { width: '50vw', height: 'calc(100vh - 2rem)', bottom: '1rem', right: '1rem', top: 'auto' }
    : { width: expanded ? 380 : 200 }

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col"
      style={panelStyle}
    >
      {expanded && (
        <div
          className="bg-white border border-gray-200 rounded-lg shadow-xl flex flex-col overflow-hidden"
          style={maximized ? { flex: 1, height: '100%' } : { height: 500 }}
        >
          {/* Header */}
          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-100">
            <StatusDot status={activeStatus} />
            <span className="text-xs font-medium text-gray-700 flex-1 truncate">
              {activeSessionId
                ? sessions.find(s => s.id === activeSessionId)?.label || activeSessionId
                : 'Chat'}
            </span>
            <StatusLabel status={activeStatus} />

            {/* Plan/Execute toggle */}
            <button
              onClick={() => setMode(mode === 'execute' ? 'plan' : 'execute')}
              disabled={executing}
              title={`Switch to ${mode === 'execute' ? 'plan' : 'execute'} mode`}
              className={`text-xs px-1.5 py-0.5 rounded font-medium transition-colors disabled:opacity-50 ${
                mode === 'plan'
                  ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                  : 'bg-green-100 text-green-700 hover:bg-green-200'
              }`}
            >
              {mode === 'plan' ? 'Plan' : 'Exec'}
            </button>

            {activeSessionId && !isClosed && (
              <button
                onClick={handleClose}
                title="Close session"
                className="text-gray-400 hover:text-red-500 text-xs px-1 transition-colors"
              >
                ✕
              </button>
            )}
            <button
              onClick={() => setMaximized(m => !m)}
              title={maximized ? 'Restore' : 'Maximize'}
              className="text-gray-400 hover:text-gray-700 text-xs px-1 transition-colors"
            >
              {maximized ? '⊡' : '⊞'}
            </button>
            <button
              onClick={handleMinimize}
              title="Minimize"
              className="text-gray-400 hover:text-gray-700 text-xs px-1 transition-colors"
            >
              –
            </button>
          </div>

          {/* Session switcher (if multiple sessions) */}
          {sessions.length > 1 && (
            <div className="flex-shrink-0 flex gap-1 px-2 py-1 border-b border-gray-50 overflow-x-auto">
              {sessions.slice(0, 4).map(s => (
                <button
                  key={s.id}
                  onClick={() => setActiveSession(s.id)}
                  className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full transition-colors ${
                    s.id === activeSessionId
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  {s.label.slice(0, 16)}{s.label.length > 16 ? '…' : ''}
                </button>
              ))}
            </div>
          )}

          {/* Messages */}
          <ChatMessages messages={messages} streamingContent={streamingContent} executing={executing} sessionReady={sessionReady || !activeSessionId} />

          {/* Input */}
          <ChatInput
            onSend={handleSend}
            disabled={isClosed || (!!activeSessionId && !sessionReady)}
            placeholder={
              isClosed ? 'Session closed' :
              !activeSessionId ? 'Message… (Enter to send)' :
              !sessionReady ? 'Session starting…' :
              'Message… (Enter to send)'
            }
          />

          {/* Footer: new session */}
          <div className="flex-shrink-0 flex justify-center px-2 py-1 border-t border-gray-50">
            <button
              onClick={handleNewSession}
              className="text-xs text-gray-400 hover:text-blue-600 transition-colors"
            >
              + New Session
            </button>
          </div>
        </div>
      )}

      {/* Collapsed bar */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg shadow-md hover:shadow-lg transition-shadow text-sm text-gray-700"
      >
        <StatusDot status={activeStatus} />
        <span className="font-medium flex-1 text-left">Chat</span>
        {activeStatus === 'executing' && (
          <span className="text-xs text-blue-600">Running…</span>
        )}
        <span className="text-gray-400 text-xs">{expanded ? '▼' : '▲'}</span>
      </button>
    </div>
  )
}
