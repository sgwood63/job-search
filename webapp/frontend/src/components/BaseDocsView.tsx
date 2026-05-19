import { useState, useEffect, useRef } from 'react'
import { api, FileNode } from '../api'
import FileTree from './FileTree'
import FileViewer from './FileViewer'
import UploadButton from './UploadButton'
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus'

export default function BaseDocsView() {
  const [nodes, setNodes] = useState<FileNode[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const dragCounter = useRef(0)

  useRefreshOnFocus(() => setVersion(v => v + 1))

  useEffect(() => {
    api.baseDocuments().then(setNodes)
  }, [version])

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
        const result = await api.upload('base-documents', file)
        setSelected(result.path)
      }
      setVersion(v => v + 1)
    } finally {
      setUploading(false)
    }
  }

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
  )
}
