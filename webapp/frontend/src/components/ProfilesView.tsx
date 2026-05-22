import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api, Profile, FileNode } from '../api'
import FileTree from './FileTree'
import FileViewer from './FileViewer'
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus'

export default function ProfilesView() {
  const { profile: profileParam } = useParams<{ profile?: string }>()
  const navigate = useNavigate()
  const [profiles, setProfiles] = useState<Profile[] | null>(null)
  const [referenceFiles, setReferenceFiles] = useState<FileNode[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useRefreshOnFocus(() => setVersion(v => v + 1))

  useEffect(() => {
    api.profiles().then(({ profiles, reference_files }) => {
      setProfiles(profiles)
      setReferenceFiles(reference_files)
    })
  }, [version])

  const activeProfile = profiles?.find(p => p.name === profileParam) ?? null

  return (
    <div className="flex h-full">
      <aside className="w-44 flex-shrink-0 border-r bg-white overflow-auto py-2">
        {referenceFiles.length > 0 && (
          <>
            <div className="px-3 pb-1">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Reference</h2>
            </div>
            {referenceFiles.map(f => (
              <button
                key={f.path}
                onClick={() => { navigate('/profiles'); setSelected(f.path) }}
                className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                  selected === f.path && !profileParam
                    ? 'bg-blue-50 text-blue-700 font-medium border-r-2 border-blue-600'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                {f.name}
              </button>
            ))}
            <div className="border-t border-gray-100 my-2" />
          </>
        )}
        <div className="px-3 pb-2">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Profiles</h2>
        </div>
        {!profiles ? (
          <div className="px-3 text-xs text-gray-400">Loading…</div>
        ) : (
          profiles.map(p => (
            <button
              key={p.name}
              onClick={() => { navigate(`/profiles/${p.name}`); setSelected(null) }}
              className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                activeProfile?.name === p.name
                  ? 'bg-blue-50 text-blue-700 font-medium border-r-2 border-blue-600'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              {p.name}
            </button>
          ))
        )}
      </aside>

      {activeProfile && (
        <aside className="w-52 flex-shrink-0 border-r bg-white overflow-auto py-2">
          <div className="px-3 pb-2">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide truncate">
              {activeProfile.name}
            </h2>
          </div>
          <FileTree
            nodes={activeProfile.files}
            selected={selected}
            onSelect={setSelected}
          />
        </aside>
      )}

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
