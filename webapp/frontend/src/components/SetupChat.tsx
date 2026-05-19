import { useState, useEffect, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../api'

type Phase = 'A' | 'B' | 'C' | 'D' | 'E'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const PHASE_LABELS: Record<Phase, string> = {
  A: 'Documents',
  B: 'Interview',
  C: 'Profiles',
  D: 'Career Advice',
  E: 'Validation',
}

const PHASE_DOCS: Record<Phase, string> = {
  A: 'You provide source materials: LinkedIn URL or resume PDF, existing cover letters, any job postings you\'re already interested in.',
  B: 'Claude asks about location preferences, must-haves, deal-breakers, compensation floor, travel limits, and what you want from your next role.',
  C: 'Claude builds your experience fact sheet, one profile per target role type, and an achievement library — you review and can edit anything.',
  D: 'Claude scores each profile (experience match, market demand, differentiation), suggests target roles, identifies skill gaps, and tells you which profile is most likely to land interviews fastest.',
  E: 'Claude finds example JDs for each profile, runs them through the screening process, and generates a sample resume to confirm the content is ready.',
}

export default function SetupChat() {
  const [phase, setPhase] = useState<Phase>('A')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [phaseStatus, setPhaseStatus] = useState<Record<string, boolean>>({})
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    api.setupStatus()
      .then(s => setPhaseStatus(s.phases))
      .catch(() => {})
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function switchPhase(p: Phase) {
    if (streaming) {
      abortRef.current?.abort()
      setStreaming(false)
    }
    setPhase(p)
    setMessages([])
    setInput('')
  }

  async function streamSetupChat(msgs: Message[], phaseOverride?: Phase) {
    const activePhase = phaseOverride ?? phase
    setStreaming(true)

    const assistantMsg: Message = { role: 'assistant', content: '' }
    setMessages(prev => [...prev, assistantMsg])

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const res = await fetch('/api/setup-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({
          phase: activePhase,
          messages: msgs.map(m => ({ role: m.role, content: m.content })),
        }),
        signal: ctrl.signal,
      })

      if (!res.ok) {
        const raw = await res.text()
        let errMsg: string
        try { errMsg = JSON.parse(raw).detail ?? raw } catch { errMsg = raw }
        setMessages(prev => {
          const next = [...prev]
          next[next.length - 1] = { role: 'assistant', content: `Error: ${errMsg}` }
          return next
        })
        return
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const payload = line.slice(6)
            if (payload === '[DONE]') continue
            try {
              const text = JSON.parse(payload)
              setMessages(prev => {
                const next = [...prev]
                const last = next[next.length - 1]
                next[next.length - 1] = { ...last, content: last.content + text }
                return next
              })
            } catch {}
          }
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        setMessages(prev => {
          const next = [...prev]
          next[next.length - 1] = { role: 'assistant', content: `Error: ${e}` }
          return next
        })
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }

  const sendMessage = useCallback(async (userText: string) => {
    if (streaming || !userText.trim()) return
    const userMsg: Message = { role: 'user', content: userText }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setInput('')
    await streamSetupChat(nextMessages)
  }, [streaming, messages, phase])

  function startPhase(p: Phase) {
    switchPhase(p)
    const greeting: Message = { role: 'user', content: `/setup ${p}` }
    setTimeout(() => {
      setMessages([greeting])
      streamSetupChat([greeting], p)
    }, 50)
  }

  const phases: Phase[] = ['A', 'B', 'C', 'D', 'E']

  return (
    <div className="flex h-full bg-white">
      {/* Left sidebar — phases */}
      <div className="w-44 flex-shrink-0 border-r bg-gray-50 flex flex-col overflow-hidden">
        <div className="px-3 pt-3 pb-2">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Setup Guide</h2>
        </div>
        <div className="flex-1 overflow-auto py-1">
          {phases.map(p => (
            <button
              key={p}
              onClick={() => startPhase(p)}
              className={`w-full text-left flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                phase === p
                  ? 'bg-blue-600 text-white font-medium'
                  : phaseStatus[p]
                  ? 'text-green-700 hover:bg-green-50'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <span className={`flex-shrink-0 w-5 h-5 rounded text-center leading-5 text-xs font-bold ${
                phase === p ? 'bg-white/20' : phaseStatus[p] ? 'bg-green-100' : 'bg-gray-200'
              }`}>
                {p}
              </span>
              <span className="flex-1 min-w-0 truncate">{PHASE_LABELS[p]}</span>
              {phaseStatus[p] && <span className="text-green-500 flex-shrink-0">✓</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Right area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Phase doc strip */}
        <div className="flex-shrink-0 px-4 py-2.5 border-b bg-blue-50">
          <div className="flex items-start gap-2">
            <span className="text-blue-400 text-xs mt-0.5 flex-shrink-0">ℹ</span>
            <div>
              <span className="text-xs font-semibold text-blue-700">Phase {phase} — {PHASE_LABELS[phase]}: </span>
              <span className="text-xs text-blue-600">{PHASE_DOCS[phase]}</span>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-auto px-4 py-3 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 gap-2">
              <div className="text-3xl">🤖</div>
              <p className="text-sm">Click a phase in the sidebar to start the guided setup.</p>
              <p className="text-xs">Each phase runs a fresh, focused session to keep context short.</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-2xl rounded-lg px-3 py-2 text-sm ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-800'
                }`}
              >
                {msg.role === 'assistant' ? (
                  <div className="prose prose-sm prose-gray max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content || (streaming ? '▋' : '')}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <span>{msg.content}</span>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="flex-shrink-0 px-4 py-3 border-t bg-white">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendMessage(input)
                }
              }}
              placeholder={`Message Claude about Phase ${phase}… (Enter to send, Shift+Enter for newline)`}
              rows={2}
              disabled={streaming}
              className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
            />
            <div className="flex flex-col gap-1">
              <button
                onClick={() => sendMessage(input)}
                disabled={streaming || !input.trim()}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Send
              </button>
              {streaming && (
                <button
                  onClick={() => { abortRef.current?.abort(); setStreaming(false) }}
                  className="px-4 py-2 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300 text-xs"
                >
                  Stop
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
