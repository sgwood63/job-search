import { useRef, useState } from 'react'
import { api } from '../api'

type Props = {
  dir: string
  onUploaded: (path: string) => void
  label?: string
}

export default function UploadButton({ dir, onUploaded, label = 'Upload file' }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    setError(null)
    try {
      for (const file of Array.from(files)) {
        const result = await api.upload(dir, file)
        onUploaded(result.path)
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={e => handleFiles(e.target.files)}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm border border-dashed border-gray-300 rounded text-gray-500 hover:border-blue-400 hover:text-blue-600 disabled:opacity-50 transition-colors"
      >
        <span>↑</span>
        <span>{uploading ? 'Uploading…' : label}</span>
      </button>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  )
}
