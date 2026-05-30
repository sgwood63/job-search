import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'

export interface SessionMeta {
  id: string
  label: string
  created_at: number
  status: 'executing' | 'waiting' | 'closed'
  mode: 'execute' | 'plan'
  preview?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  ts: number
}

interface SessionContextValue {
  sessions: SessionMeta[]
  activeSessionId: string | null
  activeStatus: SessionMeta['status'] | null
  messages: ChatMessage[]
  streamingContent: string
  sessionReady: boolean
  mode: 'execute' | 'plan'
  setMode: (m: 'execute' | 'plan') => void
  setActiveSession: (id: string | null) => void
  createSession: (label?: string) => Promise<string>
  sendInput: (text: string) => void
  closeSession: (id?: string) => Promise<void>
  refreshSessions: () => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function useSessionContext() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSessionContext must be used within SessionProvider')
  return ctx
}

const WS_BASE = typeof window !== 'undefined'
  ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
  : 'ws://localhost:8000'

let _msgCounter = 0
function nextId(prefix: string) {
  return `${prefix}-${++_msgCounter}`
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(null)
  const [activeStatus, setActiveStatus] = useState<SessionMeta['status'] | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streamingContent, setStreamingContent] = useState<string>('')
  const [sessionReady, setSessionReady] = useState(false)
  const [mode, setMode] = useState<'execute' | 'plan'>('execute')

  const wsRef = useRef<WebSocket | null>(null)
  const activeIdRef = useRef<string | null>(null)
  const pendingRef = useRef<string[]>([])

  const refreshSessions = useCallback(() => {
    fetch('/api/sessions', { cache: 'no-store' })
      .then(r => r.json())
      .then((data: SessionMeta[]) => {
        setSessions(data)
        if (activeIdRef.current) {
          const found = data.find(s => s.id === activeIdRef.current)
          if (found) setActiveStatus(found.status)
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    refreshSessions()
    const interval = setInterval(refreshSessions, 5000)
    return () => clearInterval(interval)
  }, [refreshSessions])

  const connectToSession = useCallback(async (id: string) => {
    if (wsRef.current) {
      wsRef.current.onclose = null
      wsRef.current.close()
      wsRef.current = null
    }
    setStreamingContent('')
    setActiveStatus(null)
    setSessionReady(false)

    // Load history immediately via REST to avoid blank-flash on session switch
    try {
      const res = await fetch(`/api/sessions/${id}`, { cache: 'no-store' })
      const data = await res.json()
      if (activeIdRef.current === id && Array.isArray(data.messages)) {
        setMessages(data.messages.map((m: Omit<ChatMessage, 'id'>, i: number) => ({
          ...m,
          id: `${id}-rest-${i}`,
        })))
      }
    } catch {}

    const ws = new WebSocket(`${WS_BASE}/ws/session/${id}`)
    wsRef.current = ws

    ws.onopen = () => {
      // Drain messages queued during disconnect; splice atomically empties the array
      const pending = pendingRef.current.splice(0)
      for (const data of pending) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'replay') {
          // History already loaded via REST — skip WebSocket replay to avoid overwrite
        } else if (msg.type === 'error') {
          setMessages(prev => [...prev, {
            id: nextId(id),
            role: 'assistant',
            content: `⚠️ ${msg.content}`,
            ts: Date.now() / 1000,
          }])
        } else if (msg.type === 'session_error') {
          setMessages(prev => [...prev, {
            id: nextId(id),
            role: 'assistant',
            content: `🔴 ${msg.content}`,
            ts: Date.now() / 1000,
          }])
          setActiveStatus('closed')
          setSessions(prev => prev.map(s =>
            s.id === id ? { ...s, status: 'closed' } : s
          ))
        } else if (msg.type === 'user_message') {
          setMessages(prev => [...prev, {
            id: nextId(id),
            role: 'user',
            content: msg.content,
            ts: msg.ts,
          }])
        } else if (msg.type === 'assistant_chunk') {
          setStreamingContent(prev => prev + msg.content)
        } else if (msg.type === 'assistant_message') {
          setStreamingContent('')
          setMessages(prev => [...prev, {
            id: nextId(id),
            role: 'assistant',
            content: msg.content,
            ts: msg.ts,
          }])
        } else if (msg.type === 'system' && msg.content === 'ready') {
          setSessionReady(true)
        } else if (msg.type === 'status') {
          setActiveStatus(msg.status)
          setSessions(prev => prev.map(s =>
            s.id === id ? { ...s, status: msg.status } : s
          ))
        }
      } catch {}
    }

    ws.onclose = () => {
      if (activeIdRef.current === id) {
        setTimeout(() => {
          if (activeIdRef.current === id) connectToSession(id)
        }, 2000)
      }
    }

    ws.onerror = () => {}
  }, [])

  const setActiveSession = useCallback((id: string | null) => {
    activeIdRef.current = id
    setActiveSessionIdState(id)
    if (id) {
      pendingRef.current = []  // discard any pending from the previous session
      connectToSession(id)
    } else {
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
        wsRef.current = null
      }
      setMessages([])
      setStreamingContent('')
      setActiveStatus(null)
      setSessionReady(false)
    }
  }, [connectToSession])

  const createSession = useCallback(async (label?: string): Promise<string> => {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: label || '', mode }),
    })
    const data = await res.json()
    refreshSessions()
    setActiveSession(data.id)
    return data.id
  }, [mode, refreshSessions, setActiveSession])

  const sendInput = useCallback((text: string) => {
    const data = text + '\n'
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', data }))
    } else {
      pendingRef.current.push(data)
    }
  }, [])

  const closeSession = useCallback(async (id?: string) => {
    const target = id ?? activeSessionId
    if (!target) return
    await fetch(`/api/sessions/${target}/close`, { method: 'POST' })
    if (target === activeSessionId) {
      setActiveStatus('closed')
    }
    refreshSessions()
  }, [activeSessionId, refreshSessions])

  return (
    <SessionContext.Provider value={{
      sessions,
      activeSessionId,
      activeStatus,
      messages,
      streamingContent,
      sessionReady,
      mode,
      setMode,
      setActiveSession,
      createSession,
      sendInput,
      closeSession,
      refreshSessions,
    }}>
      {children}
    </SessionContext.Provider>
  )
}
