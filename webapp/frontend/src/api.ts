const BASE = '/api'

export type FileNode = {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  children?: FileNode[]
}

export type TrackerRow = {
  id: string
  date: string
  company: string
  role: string
  profile: string
  status: string
  status_detail: string
  follow_up_date: string
  priority: string
  folder: string | null
  domain_connection?: string
  domain_tags?: string[]
}

export type TrackerData = {
  rows: TrackerRow[]
}

export type Profile = {
  name: string
  path: string
  files: FileNode[]
}

export type ProfilesData = {
  profiles: Profile[]
  reference_files: FileNode[]
}

export type RootFile = {
  name: string
  path: string
  size: number
}

export type Application = {
  name: string
  path: string
  files: FileNode[]
  domain_connection?: string
  domain_tags?: string[]
  jd_requirements?: { required: string[]; preferred: string[] }
}

export type ChunkSearchResult = {
  storage_key: string
  section_title: string | null
  section_index: number
  content: string
  similarity: number
}

export type SimilarApplicationResult = {
  id: string
  company_name: string
  role_title: string
  domain_connection: string | null
  domain_tags: string[] | null
  status: string
  similarity: number
}

export type IngestionRecord = {
  id: string
  company_name: string
  role_title: string
  profile_slug: string | null
  outcome: 'fit' | 'no-fit' | 'duplicate' | 'fetch-failed'
  no_fit_reason: string | null
  is_repost: boolean
  first_seen_at: string | null
  created_at: string
}

export type SearchRun = {
  id: string
  profile_slug: string | null
  query: string | null
  pages_fetched: number
  total_results: number
  new_after_dedup: number
  screened: number
  fit_count: number
  fetch_failed_count: number
  summary_key: string | null
  run_at: string
}

export type Thought = {
  id: string
  content: string
  metadata: Record<string, unknown>
  created_at: string
  similarity?: number
}

export type ThoughtStats = {
  total: number
  by_type: Record<string, number>
}

function ok(r: Response) {
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return r
}

function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { cache: 'no-store', ...init }).then(ok)
}

export const api = {
  tracker: (): Promise<TrackerData> =>
    apiFetch(`${BASE}/tracker`).then(r => r.json()),

  rootFiles: (): Promise<RootFile[]> =>
    apiFetch(`${BASE}/root-files`).then(r => r.json()),

  profiles: (): Promise<ProfilesData> =>
    apiFetch(`${BASE}/profiles`).then(r => r.json()),

  applications: (): Promise<Array<{ name: string; path: string }>> =>
    apiFetch(`${BASE}/applications`).then(r => r.json()),

  application: (folder: string): Promise<Application> =>
    apiFetch(`${BASE}/applications/${encodeURIComponent(folder)}`).then(r => r.json()),

  baseDocuments: (): Promise<FileNode[]> =>
    apiFetch(`${BASE}/base-documents`).then(r => r.json()),

  fileUrl: (path: string) => `${BASE}/file?path=${encodeURIComponent(path)}`,

  downloadUrl: (path: string) => `${BASE}/download?path=${encodeURIComponent(path)}`,

  getFile: (path: string): Promise<string> =>
    apiFetch(`${BASE}/file?path=${encodeURIComponent(path)}`).then(r => r.text()),

  putFile: (path: string, content: string): Promise<void> =>
    apiFetch(`${BASE}/file?path=${encodeURIComponent(path)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }).then(() => undefined),

  upload: (
    dir: string,
    file: File,
    options?: { applicationFolder?: string },
  ): Promise<{ ok: boolean; path: string; name: string; thought_id?: string; thought_category?: string }> => {
    const form = new FormData()
    form.append('file', file)
    const qs = new URLSearchParams({ dir })
    if (options?.applicationFolder) qs.set('application_folder', options.applicationFolder)
    return apiFetch(`${BASE}/upload?${qs}`, {
      method: 'POST',
      body: form,
    }).then(r => r.json())
  },

  updateApplicationFields: (
    folder: string,
    fields: Partial<{ domain_connection: string; domain_tags: string[]; jd_requirements: { required: string[]; preferred: string[] } }>,
  ): Promise<unknown> =>
    apiFetch(`${BASE}/applications/${encodeURIComponent(folder)}/fields`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    }).then(r => r.json()),

  chunkSearch: (query: string, options?: { storage_key_prefix?: string; limit?: number }): Promise<{ results: ChunkSearchResult[] }> =>
    apiFetch(`${BASE}/chunk-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, ...options }),
    }).then(r => r.json()),

  similarApplications: (query: string, excludeId?: string, limit?: number): Promise<{ results: SimilarApplicationResult[] }> =>
    apiFetch(`${BASE}/similar-applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, exclude_id: excludeId, limit }),
    }).then(r => r.json()),

  ingestionHistory: (params?: { profile_slug?: string; outcome?: string; limit?: number; direct_only?: boolean }): Promise<{ records: IngestionRecord[] }> => {
    const qs = new URLSearchParams()
    if (params?.profile_slug) qs.set('profile_slug', params.profile_slug)
    if (params?.outcome) qs.set('outcome', params.outcome)
    if (params?.limit != null) qs.set('limit', String(params.limit))
    if (params?.direct_only) qs.set('direct_only', 'true')
    const q = qs.toString()
    return apiFetch(`${BASE}/ingestion-history${q ? '?' + q : ''}`).then(r => r.json())
  },

  searchRuns: (params?: { profile_slug?: string; since?: string; limit?: number }): Promise<{ records: SearchRun[] }> => {
    const qs = new URLSearchParams()
    if (params?.profile_slug) qs.set('profile_slug', params.profile_slug)
    if (params?.since) qs.set('since', params.since)
    if (params?.limit != null) qs.set('limit', String(params.limit))
    const q = qs.toString()
    return apiFetch(`${BASE}/search-runs${q ? '?' + q : ''}`).then(r => r.json())
  },

  thoughts: (params?: { limit?: number; offset?: number; sort?: string; type?: string }): Promise<{ thoughts: Thought[] }> => {
    const qs = new URLSearchParams()
    if (params?.limit != null) qs.set('limit', String(params.limit))
    if (params?.offset != null) qs.set('offset', String(params.offset))
    if (params?.sort) qs.set('sort', params.sort)
    if (params?.type) qs.set('type', params.type)
    const q = qs.toString()
    return apiFetch(`${BASE}/thoughts${q ? '?' + q : ''}`).then(r => r.json())
  },

  thoughtStats: (): Promise<ThoughtStats> =>
    apiFetch(`${BASE}/thoughts/stats`).then(r => r.json()),

  thought: (id: string): Promise<Thought> =>
    apiFetch(`${BASE}/thoughts/${encodeURIComponent(id)}`).then(r => r.json()),

  thoughtConnections: (id: string, limit?: number): Promise<Thought[]> => {
    const qs = limit != null ? `?limit=${limit}` : ''
    return apiFetch(`${BASE}/thoughts/${encodeURIComponent(id)}/connections${qs}`).then(r => r.json())
  },

  searchThoughts: (query: string, limit?: number, mode?: string): Promise<{ results: Thought[] }> =>
    apiFetch(`${BASE}/thoughts/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit, mode }),
    }).then(r => r.json()),

  docs: (): Promise<Array<{ name: string; size: number }>> =>
    apiFetch(`${BASE}/docs`).then(r => r.json()),

  docFileUrl: (name: string) => `${BASE}/docs/file?name=${encodeURIComponent(name)}`,

  docFile: (name: string): Promise<string> =>
    apiFetch(`${BASE}/docs/file?name=${encodeURIComponent(name)}`).then(r => r.text()),

  setupStatus: (): Promise<{ phases: Record<string, boolean>; raw: string }> =>
    apiFetch(`${BASE}/setup-status`).then(r => r.json()),

  terminalWsUrl: () => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = location.hostname === 'localhost' ? 'localhost:8000' : location.host
    return `${proto}//${host}/ws/terminal`
  },
}
