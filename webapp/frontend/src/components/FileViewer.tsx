import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../api'
import MarkdownEditor from './MarkdownEditor'

function ext(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? ''
}

function DownloadLink({ path, name }: { path: string; name: string }) {
  return (
    <a
      href={api.downloadUrl(path)}
      download={name}
      className="px-3 py-1.5 text-sm border border-gray-200 rounded hover:bg-gray-50 text-gray-700"
    >
      ↓ Download
    </a>
  )
}

function MarkdownViewer({ path }: { path: string }) {
  const [content, setContent] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    setContent(null)
    setEditing(false)
    api.getFile(path).then(setContent).catch(() => setContent('⚠ Could not load file.'))
  }, [path, version])

  const name = path.split('/').pop() ?? path

  if (editing && content !== null) {
    return (
      <MarkdownEditor
        path={path}
        initialContent={content}
        onClose={() => setEditing(false)}
        onSaved={() => setVersion(v => v + 1)}
      />
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50 flex-shrink-0">
        <span className="text-sm font-mono text-gray-500 truncate">{name}</span>
        <div className="flex gap-2">
          <button
            onClick={() => setEditing(true)}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded hover:bg-gray-50 text-gray-700"
          >
            ✏ Edit
          </button>
          <DownloadLink path={path} name={name} />
        </div>
      </div>
      <div className="flex-1 overflow-auto p-6">
        {content === null ? (
          <div className="text-gray-400 text-sm">Loading…</div>
        ) : (
          <div className="prose prose-sm max-w-none prose-table:text-xs">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}

function TextViewer({ path }: { path: string }) {
  const [content, setContent] = useState<string | null>(null)
  const name = path.split('/').pop() ?? path

  useEffect(() => {
    setContent(null)
    api.getFile(path).then(setContent).catch(() => setContent('⚠ Could not load file.'))
  }, [path])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50 flex-shrink-0">
        <span className="text-sm font-mono text-gray-500 truncate">{name}</span>
        <DownloadLink path={path} name={name} />
      </div>
      <div className="flex-1 overflow-auto p-4">
        {content === null ? (
          <div className="text-gray-400 text-sm">Loading…</div>
        ) : (
          <pre className="text-xs font-mono whitespace-pre-wrap text-gray-700">{content}</pre>
        )}
      </div>
    </div>
  )
}

function JsonViewer({ path }: { path: string }) {
  const [content, setContent] = useState<string | null>(null)
  const name = path.split('/').pop() ?? path

  useEffect(() => {
    setContent(null)
    api
      .getFile(path)
      .then(raw => {
        try {
          setContent(JSON.stringify(JSON.parse(raw), null, 2))
        } catch {
          setContent(raw)
        }
      })
      .catch(() => setContent('⚠ Could not load file.'))
  }, [path])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50 flex-shrink-0">
        <span className="text-sm font-mono text-gray-500 truncate">{name}</span>
        <DownloadLink path={path} name={name} />
      </div>
      <div className="flex-1 overflow-auto p-4">
        {content === null ? (
          <div className="text-gray-400 text-sm">Loading…</div>
        ) : (
          <pre className="text-xs font-mono whitespace-pre-wrap text-gray-700">{content}</pre>
        )}
      </div>
    </div>
  )
}

function ImageViewer({ path }: { path: string }) {
  const name = path.split('/').pop() ?? path
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50 flex-shrink-0">
        <span className="text-sm font-mono text-gray-500 truncate">{name}</span>
        <DownloadLink path={path} name={name} />
      </div>
      <div className="flex-1 overflow-auto flex items-start justify-center p-4">
        <img src={api.fileUrl(path)} alt={name} className="max-w-full" />
      </div>
    </div>
  )
}

function PdfViewer({ path }: { path: string }) {
  const name = path.split('/').pop() ?? path
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50 flex-shrink-0">
        <span className="text-sm font-mono text-gray-500 truncate">{name}</span>
        <DownloadLink path={path} name={name} />
      </div>
      <div className="flex-1">
        <iframe src={api.fileUrl(path)} title={name} className="w-full h-full" />
      </div>
    </div>
  )
}

function UnsupportedViewer({ path }: { path: string }) {
  const name = path.split('/').pop() ?? path
  const e = ext(path)
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50 flex-shrink-0">
        <span className="text-sm font-mono text-gray-500 truncate">{name}</span>
        <DownloadLink path={path} name={name} />
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-gray-400">
          <div className="text-4xl mb-3">📄</div>
          <p className="text-sm">
            {e ? `.${e.toUpperCase()} files cannot be previewed.` : 'This file cannot be previewed.'}
          </p>
          <a
            href={api.downloadUrl(path)}
            download={name}
            className="mt-3 inline-block px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            ↓ Download {name}
          </a>
        </div>
      </div>
    </div>
  )
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'])
const TEXT_EXTS = new Set(['txt', 'csv', 'sh', 'ts', 'tsx', 'js', 'mjs', 'py'])

export default function FileViewer({ path }: { path: string }) {
  const e = ext(path)

  if (e === 'md') return <MarkdownViewer path={path} />
  if (e === 'pdf') return <PdfViewer path={path} />
  if (IMAGE_EXTS.has(e)) return <ImageViewer path={path} />
  if (e === 'json') return <JsonViewer path={path} />
  if (TEXT_EXTS.has(e)) return <TextViewer path={path} />
  return <UnsupportedViewer path={path} />
}
