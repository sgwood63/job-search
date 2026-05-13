import { useState } from 'react'
import type { FileNode } from '../api'

function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase()
  const icons: Record<string, string> = {
    md: '📝',
    pdf: '📕',
    png: '🖼',
    jpg: '🖼',
    jpeg: '🖼',
    gif: '🖼',
    svg: '🖼',
    json: '📊',
    txt: '📃',
    csv: '📊',
    docx: '📄',
    doc: '📄',
    ts: '💻',
    tsx: '💻',
    js: '💻',
    mjs: '💻',
  }
  return icons[ext ?? ''] ?? '📄'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`
  return `${(bytes / 1024 / 1024).toFixed(1)}M`
}

type Props = {
  nodes: FileNode[]
  selected: string | null
  onSelect: (path: string) => void
  indent?: number
}

function TreeNode({
  node,
  selected,
  onSelect,
  indent,
}: {
  node: FileNode
  selected: string | null
  onSelect: (path: string) => void
  indent: number
}) {
  const [open, setOpen] = useState(true)

  if (node.type === 'directory') {
    return (
      <div>
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1 w-full text-left px-2 py-1 text-sm text-gray-600 hover:bg-gray-50"
          style={{ paddingLeft: `${indent * 12 + 8}px` }}
        >
          <span className="text-xs text-gray-400">{open ? '▾' : '▸'}</span>
          <span>📂</span>
          <span className="truncate font-medium">{node.name}</span>
        </button>
        {open && node.children && (
          <div>
            {node.children.map(child => (
              <TreeNode
                key={child.path}
                node={child}
                selected={selected}
                onSelect={onSelect}
                indent={indent + 1}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <button
      onClick={() => onSelect(node.path)}
      className={`flex items-center gap-1 w-full text-left px-2 py-1 text-sm rounded transition-colors ${
        selected === node.path
          ? 'bg-blue-50 text-blue-700'
          : 'text-gray-700 hover:bg-gray-50'
      }`}
      style={{ paddingLeft: `${indent * 12 + 8}px` }}
      title={node.name}
    >
      <span>{fileIcon(node.name)}</span>
      <span className="truncate flex-1 text-xs">{node.name}</span>
      {node.size !== undefined && (
        <span className="text-xs text-gray-400 flex-shrink-0">{formatSize(node.size)}</span>
      )}
    </button>
  )
}

export default function FileTree({ nodes, selected, onSelect, indent = 0 }: Props) {
  return (
    <div>
      {nodes.map(node => (
        <TreeNode
          key={node.path}
          node={node}
          selected={selected}
          onSelect={onSelect}
          indent={indent}
        />
      ))}
    </div>
  )
}
