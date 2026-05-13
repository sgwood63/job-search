import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api, Profile } from '../api'
import FileTree from './FileTree'
import FileViewer from './FileViewer'

export default function ProfilesView() {
  const { profile: profileParam } = useParams<{ profile?: string }>()
  const navigate = useNavigate()
  const [profiles, setProfiles] = useState<Profile[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    api.profiles().then(setProfiles)
  }, [])

  const activeProfile = profiles?.find(p => p.name === profileParam) ?? profiles?.[0] ?? null

  useEffect(() => {
    setSelected(null)
  }, [activeProfile?.name])

  return (
    <div className="flex h-full">
      <aside className="w-44 flex-shrink-0 border-r bg-white overflow-auto py-2">
        <div className="px-3 pb-2">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Profiles</h2>
        </div>
        {!profiles ? (
          <div className="px-3 text-xs text-gray-400">Loading…</div>
        ) : (
          profiles.map(p => (
            <button
              key={p.name}
              onClick={() => navigate(`/profiles/${p.name}`)}
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
