import { useState, useEffect } from 'react'
import { api } from '../api'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'

const DOC_LABELS: Record<string, string> = {
  'README.md': 'README',
  'QUICK-START.md': 'Quick Start',
  'USER-GUIDE.md': 'User Guide',
  'DEVELOPER-README.md': 'Developer Guide',
  'workflow.md': 'Workflow',
  'applicant-setup.md': 'Setup Guide',
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function makeComponents(onDocLink?: (name: string) => void): Components {
  return {
    a({ href, children }) {
      if (!href) return <span>{children}</span>
      if (/^https?:\/\//.test(href)) {
        return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
      }
      if (href.startsWith('#')) {
        return (
          <a
            href={href}
            onClick={e => {
              e.preventDefault()
              document.getElementById(href.slice(1))?.scrollIntoView({ behavior: 'smooth' })
            }}
          >
            {children}
          </a>
        )
      }
      if (href.endsWith('.md') && onDocLink) {
        const name = href.split('/').pop()!
        return (
          <button
            className="text-blue-600 underline hover:text-blue-800 cursor-pointer"
            onClick={() => onDocLink(name)}
          >
            {children}
          </button>
        )
      }
      return <a href={href}>{children}</a>
    },
    h1({ children }) {
      const id = slugify(String(children))
      return <h1 id={id}>{children}</h1>
    },
    h2({ children }) {
      const id = slugify(String(children))
      return <h2 id={id}>{children}</h2>
    },
    h3({ children }) {
      const id = slugify(String(children))
      return <h3 id={id}>{children}</h3>
    },
    h4({ children }) {
      const id = slugify(String(children))
      return <h4 id={id}>{children}</h4>
    },
  }
}

export default function DocsView() {
  const [docs, setDocs] = useState<Array<{ name: string; size: number }>>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.docs().then(setDocs)
  }, [])

  useEffect(() => {
    if (!selected) return
    setLoading(true)
    setContent(null)
    api.docFile(selected)
      .then(setContent)
      .finally(() => setLoading(false))
  }, [selected])

  const components = makeComponents(name => {
    if (docs.some(d => d.name === name)) setSelected(name)
  })

  return (
    <div className="flex h-full">
      <aside className="w-56 flex-shrink-0 border-r bg-white flex flex-col overflow-hidden">
        <div className="px-3 pt-3 pb-1">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Documentation</h2>
        </div>
        <div className="flex-1 overflow-auto py-1">
          {docs.length === 0 ? (
            <div className="px-3 text-xs text-gray-400">Loading…</div>
          ) : (
            <ul>
              {docs.map(doc => (
                <li key={doc.name}>
                  <button
                    onClick={() => setSelected(doc.name)}
                    className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
                      selected === doc.name
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                  >
                    <span>📄</span>
                    <span>{DOC_LABELS[doc.name] ?? doc.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <div className="flex-1 overflow-auto">
        {!selected && (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            Select a document to read
          </div>
        )}
        {selected && loading && (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            Loading…
          </div>
        )}
        {selected && content && (
          <div className="max-w-3xl mx-auto px-8 py-6 prose prose-sm prose-gray">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
              {content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}
