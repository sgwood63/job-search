import { useState, useEffect, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../api'

// ── Command reference ─────────────────────────────────────────────────────────

const COMMAND_REFERENCE = [
  { cmd: '/status', usage: '/status', desc: 'Pipeline snapshot with past-due follow-ups' },
  { cmd: '/ingest', usage: '/ingest [profile]', desc: 'Search Google Jobs for a profile; save fit jobs for review' },
  { cmd: '/audit', usage: '/audit [folder]', desc: 'Validate application folder completeness before submitting' },
  { cmd: '/apply', usage: '/apply "Co" "Role" "date" [url]', desc: 'Record submission in tracker + notes.md atomically' },
  { cmd: '/memory', usage: '/memory read|update|add', desc: 'Navigate and sync the memory system' },
]

const PRESET_COMMANDS = [
  { label: '/status', command: '/status' },
  { label: '/memory read', command: '/memory read' },
  { label: '/ingest', command: '/ingest' },
  { label: '/audit', command: '/audit' },
]

// ── Command Launcher ──────────────────────────────────────────────────────────

interface CommandEntry {
  cmd: string
  text: string
}

function CommandLauncher() {
  const [entries, setEntries] = useState<CommandEntry[]>([])
  const [running, setRunning] = useState(false)
  const [customCmd, setCustomCmd] = useState('')
  const [showRef, setShowRef] = useState(false)
  const outputRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [entries])

  const runCommand = useCallback(async (cmd: string) => {
    if (running) return
    setRunning(true)
    const entry: CommandEntry = { cmd, text: '' }
    setEntries(prev => [...prev, entry])
    const idx = entries.length // index of the new entry

    try {
      const res = await fetch('/api/run-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ command: cmd }),
      })
      if (!res.ok) {
        const err = await res.text()
        setEntries(prev => {
          const next = [...prev]
          next[next.length - 1] = { ...next[next.length - 1], text: `Error: ${err}` }
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
              setEntries(prev => {
                const next = [...prev]
                next[next.length - 1] = { ...next[next.length - 1], text: next[next.length - 1].text + text }
                return next
              })
            } catch {}
          }
        }
      }
    } catch (e) {
      setEntries(prev => {
        const next = [...prev]
        next[next.length - 1] = { ...next[next.length - 1], text: `Error: ${e}` }
        return next
      })
    } finally {
      setRunning(false)
    }
  }, [running, entries.length])

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-gray-50 flex-shrink-0 flex-wrap">
        {PRESET_COMMANDS.map(({ label, command }) => (
          <button
            key={command}
            onClick={() => runCommand(command)}
            disabled={running}
            className="text-xs px-2.5 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed font-mono"
          >
            {label}
          </button>
        ))}
        <div className="flex items-center gap-1 ml-2 flex-1 min-w-48">
          <input
            type="text"
            value={customCmd}
            onChange={e => setCustomCmd(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && customCmd.trim()) {
                runCommand(customCmd.trim())
                setCustomCmd('')
              }
            }}
            placeholder="/apply &quot;Co&quot; &quot;Role&quot; &quot;2026-05-16&quot;"
            className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <button
            onClick={() => { if (customCmd.trim()) { runCommand(customCmd.trim()); setCustomCmd('') } }}
            disabled={running || !customCmd.trim()}
            className="text-xs px-2.5 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Run
          </button>
        </div>
        <button
          onClick={() => setShowRef(r => !r)}
          className="text-xs px-2 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50 text-gray-500"
          title="Command reference"
        >
          ?
        </button>
        {entries.length > 0 && (
          <button
            onClick={() => setEntries([])}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Clear
          </button>
        )}
        {running && <span className="text-xs text-blue-500 animate-pulse">Running…</span>}
      </div>

      {/* Command reference (collapsible) */}
      {showRef && (
        <div className="flex-shrink-0 border-b bg-white px-3 py-2">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 uppercase tracking-wide text-left">
                <th className="pb-1 pr-3 font-medium">Command</th>
                <th className="pb-1 pr-3 font-medium">Usage</th>
                <th className="pb-1 font-medium">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {COMMAND_REFERENCE.map(({ cmd, usage, desc }) => (
                <tr key={cmd}>
                  <td className="py-1 pr-3 font-mono text-blue-600 whitespace-nowrap">{cmd}</td>
                  <td className="py-1 pr-3 font-mono text-gray-600 whitespace-nowrap">{usage}</td>
                  <td className="py-1 text-gray-500">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Output */}
      <div ref={outputRef} className="flex-1 overflow-auto">
        {entries.length === 0 ? (
          <div className="px-3 py-3 text-xs text-gray-400 font-mono">
            Run a command to see output here. Click <span className="font-bold">?</span> for command reference.
          </div>
        ) : (
          entries.map((entry, i) => (
            <div key={i} className="border-b border-gray-100 last:border-0">
              <div className="px-3 py-1.5 bg-gray-950 text-yellow-400 font-mono text-xs">
                $ claude --print {entry.cmd}
              </div>
              <div className="px-4 py-3 prose prose-sm max-w-none prose-gray">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {entry.text || (running && i === entries.length - 1 ? '_Running…_' : '')}
                </ReactMarkdown>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ── Terminal (xterm.js + WebSocket PTY) ───────────────────────────────────────

function TerminalPanel() {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<import('xterm').Terminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitRef = useRef<import('xterm-addon-fit').FitAddon | null>(null)

  useEffect(() => {
    let term: import('xterm').Terminal
    let fitAddon: import('xterm-addon-fit').FitAddon

    async function init() {
      if (!containerRef.current) return
      const { Terminal } = await import('xterm')
      const { FitAddon } = await import('xterm-addon-fit')

      term = new Terminal({
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        fontSize: 12,
        theme: {
          background: '#030712',
          foreground: '#d1fae5',
          cursor: '#34d399',
        },
        cursorBlink: true,
      })

      fitAddon = new FitAddon()
      term.loadAddon(fitAddon)
      term.open(containerRef.current)
      fitAddon.fit()

      termRef.current = term
      fitRef.current = fitAddon

      const wsUrl = api.terminalWsUrl()
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        term.writeln('\r\x1b[32mConnected to shell. Type `claude` to start.\x1b[0m')
        const { cols, rows } = term
        ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      }

      ws.onmessage = e => {
        term.write(e.data)
      }

      ws.onerror = () => {
        term.writeln('\r\n\x1b[31mWebSocket error. Is the backend running?\x1b[0m')
      }

      ws.onclose = () => {
        term.writeln('\r\n\x1b[33mSession closed.\x1b[0m')
      }

      term.onData(data => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data)
      })
    }

    init()

    const handleResize = () => fitRef.current?.fit()
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      wsRef.current?.close()
      termRef.current?.dispose()
    }
  }, [])

  return (
    <div className="flex-1 overflow-hidden bg-gray-950 p-1">
      <div ref={containerRef} className="h-full" />
    </div>
  )
}

// ── Bottom Panel Container ────────────────────────────────────────────────────

type Tab = 'commands' | 'terminal'

export default function BottomPanel() {
  const [open, setOpen] = useState(true)
  const [tab, setTab] = useState<Tab>('commands')
  const [height, setHeight] = useState(220)
  const dragging = useRef(false)
  const startY = useRef(0)
  const startH = useRef(0)

  function onMouseDown(e: React.MouseEvent) {
    dragging.current = true
    startY.current = e.clientY
    startH.current = height
    e.preventDefault()
  }

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return
      const delta = startY.current - e.clientY
      setHeight(Math.max(120, Math.min(600, startH.current + delta)))
    }
    function onUp() { dragging.current = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  return (
    <div
      className="flex-shrink-0 border-t border-gray-200 bg-white flex flex-col"
      style={{ height: open ? height : undefined }}
    >
      {/* Panel header */}
      <div
        className="flex items-center gap-1 px-2 py-0 border-b border-gray-100 bg-gray-50 flex-shrink-0 select-none cursor-row-resize"
        onMouseDown={onMouseDown}
      >
        <div className="flex items-center gap-0 flex-1">
          {(['commands', 'terminal'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={e => { e.stopPropagation(); setTab(t); setOpen(true) }}
              className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                tab === t && open
                  ? 'border-blue-500 text-blue-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'commands' ? '⚡ Commands' : '> Terminal'}
            </button>
          ))}
        </div>
        <button
          onClick={() => setOpen(o => !o)}
          className="text-gray-400 hover:text-gray-600 px-2 py-1 text-xs"
          title={open ? 'Collapse' : 'Expand'}
        >
          {open ? '▾' : '▴'}
        </button>
      </div>

      {/* Panel body */}
      {open && (
        <div className="flex-1 overflow-hidden flex flex-col">
          {tab === 'commands' ? <CommandLauncher /> : <TerminalPanel />}
        </div>
      )}
    </div>
  )
}
