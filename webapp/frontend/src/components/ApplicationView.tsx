import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api, Application, TrackerRow } from '../api'
import FileTree from './FileTree'
import FileViewer from './FileViewer'
import UploadButton from './UploadButton'
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus'

function parseFolder(folder: string) {
  const m = folder.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/)
  if (!m) return { date: '', label: folder }
  const label = m[2]
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
  return { date: m[1], label }
}

const STATUS_LABEL: Record<string, string> = {
  'pending-review': 'Pending Review', 'resume-ready': 'Resume Ready',
  'applied': 'Applied', 'interview-scheduled': 'Interview Scheduled',
  'interviewed': 'Interviewed', 'exercise': 'Exercise/Test',
  'offer': 'Offer', 'closed': 'Closed', 'not-interested': 'Not Interested',
}

function statusClass(status: string): string {
  switch (status) {
    case 'pending-review':      return 'bg-yellow-100 text-yellow-700'
    case 'resume-ready':        return 'bg-blue-100 text-blue-700'
    case 'applied':             return 'bg-green-100 text-green-700'
    case 'interview-scheduled': return 'bg-purple-100 text-purple-700'
    case 'interviewed':         return 'bg-indigo-100 text-indigo-700'
    case 'exercise':            return 'bg-orange-100 text-orange-700'
    case 'offer':               return 'bg-emerald-100 text-emerald-700'
    case 'closed':              return 'bg-gray-100 text-gray-500'
    case 'not-interested':      return 'bg-gray-100 text-gray-400'
    default:                    return 'bg-gray-100 text-gray-600'
  }
}

function TrackerHeader({ row }: { row: TrackerRow }) {
  return (
    <div className="px-4 pt-2.5 pb-2 border-b bg-white flex-shrink-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-gray-800 truncate">
            {row.company} · {row.role}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {row.status && (
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusClass(row.status)}`}>
              {STATUS_LABEL[row.status] ?? row.status}
            </span>
          )}
          {row.priority && row.priority.includes('⭐') && (
            <span className="text-yellow-500 text-sm">{row.priority}</span>
          )}
          {row.priority && row.priority.toLowerCase() === 'high' && (
            <span className="text-xs font-semibold text-gray-700">High</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 mt-1 flex-wrap">
        {row.profile && (
          <span className="bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded text-xs">{row.profile}</span>
        )}
        {row.date && (
          <span className="text-xs text-gray-400">{row.date}</span>
        )}
        {row.follow_up_date && (
          <span className="text-xs text-gray-500 truncate max-w-xs">→ {row.follow_up_date}</span>
        )}
      </div>
    </div>
  )
}

export default function ApplicationView() {
  const { folder } = useParams<{ folder: string }>()
  const navigate = useNavigate()
  const [app, setApp] = useState<Application | null>(null)
  const [trackerRow, setTrackerRow] = useState<TrackerRow | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [treeVersion, setTreeVersion] = useState(0)
  const [headerVersion, setHeaderVersion] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const dragCounter = useRef(0)

  useRefreshOnFocus(() => {
    setTreeVersion(v => v + 1)
    setHeaderVersion(v => v + 1)
  })

  useEffect(() => {
    setApp(null)
    setSelected(null)
    setTrackerRow(null)
  }, [folder])

  useEffect(() => {
    if (!folder) return
    api.application(folder).then(setApp).catch(e => setError(String(e)))
  }, [folder, treeVersion])

  useEffect(() => {
    if (!folder) return
    api.tracker().then(data => {
      setTrackerRow(data.rows.find(r => r.folder === folder) ?? null)
    }).catch(() => setTrackerRow(null))
  }, [folder, headerVersion])

  if (!folder) return null

  const { date, label } = parseFolder(folder)

  if (error) {
    return (
      <div className="p-8 text-red-500 text-sm">
        Failed to load application: {error}
      </div>
    )
  }

  const uploadDir = `applications/${folder}`

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault()
    dragCounter.current++
    setDragging(true)
  }
  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    dragCounter.current--
    if (dragCounter.current === 0) setDragging(false)
  }
  function handleDragOver(e: React.DragEvent) { e.preventDefault() }
  async function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    dragCounter.current = 0
    setDragging(false)
    const files = Array.from(e.dataTransfer.files)
    if (!files.length) return
    setUploading(true)
    try {
      for (const file of files) {
        const result = await api.upload(uploadDir, file)
        setSelected(result.path)
      }
      setTreeVersion(v => v + 1)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-gray-50 flex-shrink-0">
        <button
          onClick={() => navigate('/')}
          className="text-gray-400 hover:text-gray-700 text-sm flex-shrink-0"
        >
          ← Tracker
        </button>
        {!trackerRow && (
          <>
            <div className="h-4 border-l border-gray-200" />
            {date && <span className="text-xs text-gray-400">{date}</span>}
            <h1 className="text-sm font-semibold text-gray-800">{label}</h1>
          </>
        )}
      </div>
      {trackerRow && <TrackerHeader row={trackerRow} />}

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-56 flex-shrink-0 border-r bg-white flex flex-col overflow-hidden">
          <div className="flex-1 overflow-auto py-2">
            {!app ? (
              <div className="px-4 text-xs text-gray-400">Loading…</div>
            ) : (
              <FileTree
                nodes={app.files}
                selected={selected}
                onSelect={setSelected}
              />
            )}
          </div>
          <div className="p-2 border-t">
            <UploadButton
              dir={uploadDir}
              onUploaded={path => {
                setTreeVersion(v => v + 1)
                setSelected(path)
              }}
            />
          </div>
        </aside>

        <div
          className="flex-1 overflow-hidden relative"
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {selected ? (
            <FileViewer path={selected} />
          ) : (
            <div className={`flex flex-col items-center justify-center h-full gap-3 transition-colors ${dragging ? 'bg-blue-50' : ''}`}>
              <div className={`border-2 border-dashed rounded-xl px-10 py-8 text-center transition-colors ${dragging ? 'border-blue-400 bg-blue-50' : 'border-gray-200'}`}>
                <div className="text-2xl mb-2">📂</div>
                <p className="text-sm text-gray-500">
                  {uploading ? 'Uploading…' : 'Drop files here to upload'}
                </p>
                <p className="text-xs text-gray-400 mt-1">or use the Upload button in the sidebar</p>
              </div>
            </div>
          )}
          {dragging && (
            <div className="absolute inset-0 border-2 border-blue-400 border-dashed rounded pointer-events-none bg-blue-50/30" />
          )}
        </div>
      </div>
    </div>
  )
}
