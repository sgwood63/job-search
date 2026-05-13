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

export const api = {
  tracker: (): Promise<TrackerData> =>
    fetch(`${BASE}/tracker`).then(ok).then(r => r.json()),

  rootFiles: (): Promise<RootFile[]> =>
    fetch(`${BASE}/root-files`).then(ok).then(r => r.json()),

  profiles: (): Promise<Profile[]> =>
    fetch(`${BASE}/profiles`).then(ok).then(r => r.json()),

  applications: (): Promise<Array<{ name: string; path: string }>> =>
    fetch(`${BASE}/applications`).then(ok).then(r => r.json()),

  application: (folder: string): Promise<Application> =>
    fetch(`${BASE}/applications/${encodeURIComponent(folder)}`).then(ok).then(r => r.json()),

  baseDocuments: (): Promise<FileNode[]> =>
    fetch(`${BASE}/base-documents`).then(ok).then(r => r.json()),

  search: (): Promise<FileNode[]> =>
    fetch(`${BASE}/search`).then(ok).then(r => r.json()),

  fileUrl: (path: string) => `${BASE}/file?path=${encodeURIComponent(path)}`,

  downloadUrl: (path: string) => `${BASE}/download?path=${encodeURIComponent(path)}`,

  getFile: (path: string): Promise<string> =>
    fetch(`${BASE}/file?path=${encodeURIComponent(path)}`).then(ok).then(r => r.text()),

  putFile: (path: string, content: string): Promise<void> =>
    fetch(`${BASE}/file?path=${encodeURIComponent(path)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }).then(ok).then(() => undefined),

  upload: (
    dir: string,
    file: File,
  ): Promise<{ ok: boolean; path: string; name: string }> => {
    const form = new FormData()
    form.append('file', file)
    return fetch(`${BASE}/upload?dir=${encodeURIComponent(dir)}`, {
      method: 'POST',
      body: form,
    })
      .then(ok)
      .then(r => r.json())
  },
}
