import { useState, useEffect } from 'react'
import { api, RootFile } from '../api'
import FileViewer from './FileViewer'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`
  return `${(bytes / 1024 / 1024).toFixed(1)}M`
}

export default function RootFilesView() {
  const [files, setFiles] = useState<RootFile[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    api.rootFiles().then(data => {
      setFiles(data)
      if (data.length > 0) setSelected(data[0].path)
    })
  }, [])

  return (
    <div className="flex h-full">
      <aside className="w-56 flex-shrink-0 border-r bg-white overflow-auto py-2">
        <div className="px-3 pb-2">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Files</h2>
        </div>
        {!files ? (
          <div className="px-3 text-xs text-gray-400">Loading…</div>
        ) : (
          files.map(f => (
            <button
              key={f.path}
              onClick={() => setSelected(f.path)}
              className={`w-full flex items-center justify-between px-3 py-1.5 text-sm text-left transition-colors ${
                selected === f.path
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className="truncate text-xs">{f.name}</span>
              <span className="text-xs text-gray-400 ml-2 flex-shrink-0">{formatSize(f.size)}</span>
            </button>
          ))
        )}
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
  )
}
