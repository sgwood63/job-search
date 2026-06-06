import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api } from '../api'

// Helper: make a mock fetch that returns a JSON response
function mockFetch(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(typeof data === 'string' ? data : JSON.stringify(data)),
  } as Response)
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('api.tracker', () => {
  it('calls GET /api/tracker and returns parsed JSON', async () => {
    const payload = { rows: [] }
    vi.stubGlobal('fetch', mockFetch(payload))

    const result = await api.tracker()

    expect(fetch).toHaveBeenCalledOnce()
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/api/tracker')
    expect(result).toEqual(payload)
  })

  it('throws when response is not ok', async () => {
    vi.stubGlobal('fetch', mockFetch({}, 500))
    await expect(api.tracker()).rejects.toThrow()
  })
})

describe('api.getFile', () => {
  it('encodes path in query string', async () => {
    vi.stubGlobal('fetch', mockFetch('# Notes'))
    await api.getFile('applications/2026-01-01-co/notes.md')

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain('/api/file?path=')
    expect(url).toContain(encodeURIComponent('applications/2026-01-01-co/notes.md'))
  })
})

describe('api.putFile', () => {
  it('sends PUT with JSON body', async () => {
    vi.stubGlobal('fetch', mockFetch({ ok: true }))
    await api.putFile('applications/folder/notes.md', '# Content')

    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain('/api/file?path=')
    expect(init.method).toBe('PUT')
    expect(init.headers?.['Content-Type']).toBe('application/json')
    const body = JSON.parse(init.body)
    expect(body.content).toBe('# Content')
  })
})

describe('api.fileUrl', () => {
  it('returns encoded URL without fetching', () => {
    const url = api.fileUrl('profiles/presales-se/resume.md')
    expect(url).toBe('/api/file?path=profiles%2Fpresales-se%2Fresume.md')
  })
})

describe('api.setupStatus', () => {
  it('calls GET /api/setup-status', async () => {
    const payload = { phases: { A: true, B: false }, raw: 'Phase A: complete' }
    vi.stubGlobal('fetch', mockFetch(payload))

    const result = await api.setupStatus()

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/api/setup-status')
    expect(result.phases['A']).toBe(true)
  })
})
