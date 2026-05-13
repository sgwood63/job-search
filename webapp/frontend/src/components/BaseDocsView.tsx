import { useState, useEffect } from 'react'
import { api, FileNode } from '../api'
import FileTree from './FileTree'
import FileViewer from './FileViewer'
import UploadButton from './UploadButton'

export default function BaseDocsView() {
  const [nodes, setNodes] = useState<FileNode[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    api.baseDocuments().then(setNodes)
  }, [version])

  return (
    <div className="flex h-full">
      <aside className="w-56 flex-shrink-0 border-r bg-white flex flex-col overflow-hidden">
        <div className="px-3 pt-3 pb-1">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Base Documents</h2>
        </div>
        <div className="flex-1 overflow-auto py-1">
          {!nodes ? (
            <div className="px-3 text-xs text-gray-400">Loading…</div>
          ) : (
            <FileTree nodes={nodes} selected={selected} onSelect={setSelected} />
          )}
        </div>
        <div className="p-2 border-t">
          <UploadButton
            dir="base-documents"
            label="Upload to base docs"
            onUploaded={path => {
              setVersion(v => v + 1)
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
  )
}
