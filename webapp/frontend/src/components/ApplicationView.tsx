import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api, Application } from '../api'
import FileTree from './FileTree'
import FileViewer from './FileViewer'
import UploadButton from './UploadButton'

function parseFolder(folder: string) {
  const m = folder.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/)
  if (!m) return { date: '', label: folder }
  const label = m[2]
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
  return { date: m[1], label }
}

export default function ApplicationView() {
  const { folder } = useParams<{ folder: string }>()
  const navigate = useNavigate()
  const [app, setApp] = useState<Application | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [treeVersion, setTreeVersion] = useState(0)

  useEffect(() => {
    if (!folder) return
    setApp(null)
    setSelected(null)
    api.application(folder).then(setApp).catch(e => setError(String(e)))
  }, [folder, treeVersion])

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

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-white flex-shrink-0">
        <button
          onClick={() => navigate('/')}
          className="text-gray-400 hover:text-gray-700 text-sm"
        >
          ← Tracker
        </button>
        <div className="h-4 border-l border-gray-200" />
        {date && <span className="text-xs text-gray-400">{date}</span>}
        <h1 className="text-sm font-semibold text-gray-800">{label}</h1>
      </div>

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

        <div className="flex-1 overflow-hidden">
          {selected ? (
            <FileViewer path={selected} />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              Select a file to view
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
