const BASE = '/api'

export type FileNode = {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  children?: FileNode[]
}

export type TrackerRow = {
  date: string
  company: string
  role: string
  profile: string
  source: string
  status: string
  next_action: string
  priority: string
  folder: string | null
}

export type PhaseDRow = {
  date: string
  company: string
  role: string
  profile: string
  fit: string
  notes: string
  folder: string | null
}

export type ClosedRow = {
  date: string
  company: string
  role: string
  outcome: string
  notes: string
  profile: string
  folder: string | null
}

export type TrackerData = {
  active: TrackerRow[]
  phase_d: PhaseDRow[]
  closed: ClosedRow[]
}

export type Profile = {
  name: string
  path: string
  files: FileNode[]
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

  profiles: (): Promise<Profile[]> =>
    apiFetch(`${BASE}/profiles`).then(r => r.json()),

  applications: (): Promise<Array<{ name: string; path: string }>> =>
    apiFetch(`${BASE}/applications`).then(r => r.json()),

  application: (folder: string): Promise<Application> =>
    apiFetch(`${BASE}/applications/${encodeURIComponent(folder)}`).then(r => r.json()),

  baseDocuments: (): Promise<FileNode[]> =>
    apiFetch(`${BASE}/base-documents`).then(r => r.json()),

  search: (): Promise<FileNode[]> =>
    apiFetch(`${BASE}/search`).then(r => r.json()),

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
  ): Promise<{ ok: boolean; path: string; name: string }> => {
    const form = new FormData()
    form.append('file', file)
    return apiFetch(`${BASE}/upload?dir=${encodeURIComponent(dir)}`, {
      method: 'POST',
      body: form,
    }).then(r => r.json())
  },
}
