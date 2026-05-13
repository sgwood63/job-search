import { useState, useEffect } from 'react'
import { api, FileNode } from '../api'
import FileTree from './FileTree'
import FileViewer from './FileViewer'
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus'

export default function SearchView() {
  const [nodes, setNodes] = useState<FileNode[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useRefreshOnFocus(() => setVersion(v => v + 1))

  useEffect(() => {
    api.search().then(data => {
      setNodes(data)
      setSelected(prev => {
        if (prev) return prev
        const firstFile = data.find(n => n.type === 'file')
        return firstFile?.path ?? null
      })
    })
  }, [version])

  return (
    <div className="flex h-full">
      <aside className="w-56 flex-shrink-0 border-r bg-white overflow-auto">
        <div className="px-3 pt-3 pb-1">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Search Results</h2>
        </div>
        <div className="py-1">
          {!nodes ? (
            <div className="px-3 text-xs text-gray-400">Loading…</div>
          ) : nodes.length === 0 ? (
            <div className="px-3 text-xs text-gray-400">No search results yet.</div>
          ) : (
            <FileTree nodes={nodes} selected={selected} onSelect={setSelected} />
          )}
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
  )
}
