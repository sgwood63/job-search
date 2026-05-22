import { useState, useEffect, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api, FileNode } from '../api'
import FileTree from './FileTree'
import FileViewer from './FileViewer'
import UploadButton from './UploadButton'
import HelpView from './HelpView'
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus'
import { useSessionContext } from '../context/SessionContext'
import { ChatMessages, ChatInput } from './ChatPanel'

type Stage = 'overview' | 'A' | 'B' | 'C' | 'D' | 'E' | 'help'

const STAGE_LABELS: Record<Stage, string> = {
  overview: 'Overview',
  A: 'Documents',
  B: 'Interview',
  C: 'Profiles',
  D: 'Career Advice',
  E: 'Validation',
  help: 'Help',
}

const STAGE_PROMPTS: Record<string, string> = {
  B: '/setup B',
  C: '/setup C',
  D: '/setup D',
  E: '/setup E',
}

// ── Overview ──────────────────────────────────────────────────────────────────

function OverviewPane({ phaseStatus }: { phaseStatus: Record<string, boolean> }) {
  const [content, setContent] = useState<string | null>(null)

  useEffect(() => {
    api.docFile('applicant-setup.md').then(setContent).catch(() => setContent(null))
  }, [])

  const phases = ['A', 'B', 'C', 'D', 'E']

  return (
    <div className="flex h-full">
      <div className="w-48 flex-shrink-0 border-r bg-gray-50 p-4">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Phase Status</h3>
        {phases.map(p => (
          <div key={p} className="flex items-center gap-2 py-1">
            <span className={`w-5 h-5 rounded text-center leading-5 text-xs font-bold ${
              phaseStatus[p] ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
            }`}>{p}</span>
            <span className={`text-xs ${phaseStatus[p] ? 'text-green-700' : 'text-gray-500'}`}>
              {phaseStatus[p] ? '✓ Complete' : 'Pending'}
            </span>
          </div>
        ))}
        {phaseStatus['F'] && (
          <div className="flex items-center gap-2 py-1">
            <span className="w-5 h-5 rounded text-center leading-5 text-xs font-bold bg-blue-50 text-blue-600">F</span>
            <span className="text-xs text-blue-600">✓ Active</span>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-auto">
        {content ? (
          <div className="max-w-3xl mx-auto px-8 py-6 prose prose-sm prose-gray">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">Loading setup guide…</div>
        )}
      </div>
    </div>
  )
}

// ── Documents (Phase A) ───────────────────────────────────────────────────────

function DocumentsPane({ onFinish }: { onFinish: () => void }) {
  const [nodes, setNodes] = useState<FileNode[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const dragCounter = useRef(0)

  useRefreshOnFocus(() => setVersion(v => v + 1))
  useEffect(() => { api.baseDocuments().then(setNodes) }, [version])

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault(); dragCounter.current++; setDragging(true)
  }
  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault(); dragCounter.current--
    if (dragCounter.current === 0) setDragging(false)
  }
  function handleDragOver(e: React.DragEvent) { e.preventDefault() }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault(); dragCounter.current = 0; setDragging(false)
    const files = Array.from(e.dataTransfer.files)
    if (!files.length) return
    setUploading(true)
    try {
      for (const f of files) {
        const form = new FormData(); form.append('file', f)
        await fetch('/api/upload?dir=base-documents', { method: 'POST', body: form })
      }
    } finally { setUploading(false); setVersion(v => v + 1) }
  }

  return (
    <div
      className={`flex h-full ${dragging ? 'ring-2 ring-blue-400 ring-inset' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <aside className="w-56 flex-shrink-0 border-r bg-white flex flex-col">
        <div className="px-3 pt-3 pb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Base Documents</h2>
          <UploadButton
            dir="base-documents"
            onUploaded={() => setVersion(v => v + 1)}
          />
        </div>
        <div className="flex-1 overflow-auto">
          {nodes == null ? (
            <div className="px-3 text-xs text-gray-400">Loading…</div>
          ) : (
            <FileTree
              nodes={nodes}
              selected={selected}
              onSelect={setSelected}
            />
          )}
        </div>
        <div className="px-3 py-2 border-t">
          <button
            onClick={onFinish}
            className="w-full py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 font-medium"
          >
            Finish Step →
          </button>
        </div>
      </aside>
      <div className="flex-1 overflow-hidden flex flex-col">
        {uploading && (
          <div className="px-4 py-2 bg-blue-50 text-blue-700 text-xs border-b">Uploading…</div>
        )}
        {dragging && (
          <div className="absolute inset-0 bg-blue-50/80 flex items-center justify-center z-10">
            <span className="text-blue-600 font-medium">Drop files to upload</span>
          </div>
        )}
        <div className="flex-1 overflow-auto">
          {selected ? (
            <FileViewer path={selected} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
              <div className="text-2xl">📁</div>
              <p className="text-sm">Select a document or drop files to upload</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Chat-based stages (B, C, D, E) ────────────────────────────────────────────

const STAGE_SESSION_LABELS: Record<string, string> = {
  B: 'setup-interview',
  C: 'setup-profiles',
  D: 'setup-career-advice',
  E: 'setup-validation',
}

function ChatStagePane({
  stage,
  onFinish,
}: {
  stage: 'B' | 'C' | 'D' | 'E'
  onFinish: () => void
}) {
  const {
    sessions,
    activeSessionId,
    activeStatus,
    messages,
    streamingContent,
    sessionReady,
    createSession,
    setActiveSession,
    sendInput,
  } = useSessionContext()

  const label = STAGE_SESSION_LABELS[stage]
  const executing = activeStatus === 'executing'

  useEffect(() => {
    // If there's already a non-closed session for this stage, attach to it
    const existing = sessions.find(s => s.label === label && s.status !== 'closed')
    if (existing) {
      if (existing.id !== activeSessionId) setActiveSession(existing.id)
      return
    }
    // Otherwise start a new session with the setup prompt
    let cancelled = false
    createSession(label).then(id => {
      if (!cancelled) {
        setTimeout(() => sendInput(STAGE_PROMPTS[stage]), 500)
      }
    })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])

  const handleSend = useCallback((text: string) => {
    sendInput(text)
  }, [sendInput])

  return (
    <div className="flex h-full flex-col">
      {/* Status bar */}
      <div className={`flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b ${
        executing ? 'bg-blue-50' : 'bg-gray-50'
      }`}>
        {executing && (
          <span className="inline-flex gap-0.5">
            {[0,1,2].map(i => (
              <span
                key={i}
                className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce"
                style={{ animationDelay: `${i*0.15}s` }}
              />
            ))}
          </span>
        )}
        <span className={`text-xs font-medium ${executing ? 'text-blue-700' : 'text-gray-500'}`}>
          {executing ? 'Claude is working…' : activeStatus === 'waiting' ? 'Waiting for input' : 'Ready'}
        </span>
        <div className="flex-1" />
        <button
          onClick={onFinish}
          className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
        >
          Finish Step →
        </button>
      </div>

      <ChatMessages messages={messages} streamingContent={streamingContent} executing={executing} sessionReady={sessionReady} />
      <ChatInput onSend={handleSend} disabled={activeStatus === 'closed'} />
    </div>
  )
}

// ── Main SetupView ─────────────────────────────────────────────────────────────

export default function SetupView() {
  const [stage, setStage] = useState<Stage>('overview')
  const [phaseStatus, setPhaseStatus] = useState<Record<string, boolean>>({})
  const [version, setVersion] = useState(0)

  useRefreshOnFocus(() => setVersion(v => v + 1))
  useEffect(() => {
    api.setupStatus().then(s => setPhaseStatus(s.phases)).catch(() => {})
  }, [version])

  // The sidebar passes the selected stage via a custom event or we use a shared ref.
  // For simplicity, we expose a global setter that Sidebar can call.
  useEffect(() => {
    function handler(e: CustomEvent) {
      setStage(e.detail as Stage)
    }
    window.addEventListener('setup-stage-change', handler as EventListener)
    return () => window.removeEventListener('setup-stage-change', handler as EventListener)
  }, [])

  function advanceStage() {
    const order: Stage[] = ['overview', 'A', 'B', 'C', 'D', 'E', 'help']
    const idx = order.indexOf(stage)
    if (idx < order.length - 1) setStage(order[idx + 1])
    setVersion(v => v + 1)
  }

  return (
    <div className="h-full flex flex-col">
      {/* Breadcrumb */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b bg-white">
        <span className="text-xs text-gray-400">Setup</span>
        <span className="text-xs text-gray-300">›</span>
        <span className="text-xs font-medium text-gray-700">{STAGE_LABELS[stage]}</span>
      </div>

      <div className="flex-1 overflow-hidden">
        {stage === 'overview' && <OverviewPane phaseStatus={phaseStatus} />}
        {stage === 'A' && <DocumentsPane onFinish={advanceStage} />}
        {(stage === 'B' || stage === 'C' || stage === 'D' || stage === 'E') && (
          <ChatStagePane stage={stage} onFinish={advanceStage} />
        )}
        {stage === 'help' && <HelpView />}
      </div>
    </div>
  )
}

// Export stage setter for use by Sidebar
export function dispatchStageChange(stage: string) {
  window.dispatchEvent(new CustomEvent('setup-stage-change', { detail: stage }))
}
