import { useState } from 'react'
import MDEditor from '@uiw/react-md-editor'
import { api } from '../api'

type Props = {
  path: string
  initialContent: string
  onClose: () => void
  onSaved: () => void
}

export default function MarkdownEditor({ path, initialContent, onClose, onSaved }: Props) {
  const [content, setContent] = useState(initialContent)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.putFile(path, content)
      onSaved()
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white" data-color-mode="light">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50 flex-shrink-0">
        <span className="text-sm font-mono text-gray-500 truncate max-w-lg">{path}</span>
        <div className="flex items-center gap-2">
          {error && <span className="text-red-500 text-sm">{error}</span>}
          <button
            onClick={onClose}
            className="px-3 py-1 text-sm border rounded hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <MDEditor
          value={content}
          onChange={v => setContent(v ?? '')}
          height="100%"
          preview="live"
          style={{ height: '100%' }}
        />
      </div>
    </div>
  )
}
