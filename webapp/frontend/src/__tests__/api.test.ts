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

describe('api.updateApplicationFields', () => {
  it('sends PATCH with JSON body to the correct path', async () => {
    vi.stubGlobal('fetch', mockFetch({ id: '1', domain_connection: 'AI tools' }))

    await api.updateApplicationFields('2026-05-01-acme', { domain_connection: 'AI tools' })

    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/api/applications/2026-05-01-acme/fields')
    expect(init.method).toBe('PATCH')
    const body = JSON.parse(init.body)
    expect(body.domain_connection).toBe('AI tools')
  })

  it('encodes folder name in the URL', async () => {
    vi.stubGlobal('fetch', mockFetch({}))

    await api.updateApplicationFields('2026-05-01-acme corp', { domain_tags: ['ai'] })

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain(encodeURIComponent('2026-05-01-acme corp'))
  })
})

describe('api.chunkSearch', () => {
  it('sends POST with query body', async () => {
    const payload = { results: [{ storage_key: 'a/b.md', section_title: 'Summary', section_index: 0, content: 'text', similarity: 0.9 }] }
    vi.stubGlobal('fetch', mockFetch(payload))

    const result = await api.chunkSearch('customer success')

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/api/chunk-search')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body.query).toBe('customer success')
    expect(result.results[0].similarity).toBe(0.9)
  })

  it('passes optional prefix and limit', async () => {
    vi.stubGlobal('fetch', mockFetch({ results: [] }))

    await api.chunkSearch('q', { storage_key_prefix: 'applications/foo/', limit: 3 })

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.storage_key_prefix).toBe('applications/foo/')
    expect(body.limit).toBe(3)
  })
})

describe('api.similarApplications', () => {
  it('sends POST with query', async () => {
    vi.stubGlobal('fetch', mockFetch({ results: [] }))

    await api.similarApplications('enterprise SaaS presales')

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/api/similar-applications')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body.query).toBe('enterprise SaaS presales')
    expect(body.exclude_id).toBeUndefined()
  })

  it('includes exclude_id when provided', async () => {
    vi.stubGlobal('fetch', mockFetch({ results: [] }))

    await api.similarApplications('q', 'uuid-current-app')

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.exclude_id).toBe('uuid-current-app')
  })
})

describe('api.ingestionHistory', () => {
  it('calls GET /api/ingestion-history with no params', async () => {
    vi.stubGlobal('fetch', mockFetch({ records: [] }))

    await api.ingestionHistory()

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/api/ingestion-history')
  })

  it('appends profile_slug and outcome to query string', async () => {
    vi.stubGlobal('fetch', mockFetch({ records: [] }))

    await api.ingestionHistory({ profile_slug: 'presales-se', outcome: 'fit', limit: 25 })

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain('profile_slug=presales-se')
    expect(url).toContain('outcome=fit')
    expect(url).toContain('limit=25')
  })

  it('omits params that are undefined', async () => {
    vi.stubGlobal('fetch', mockFetch({ records: [] }))

    await api.ingestionHistory({ outcome: 'no-fit' })

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain('outcome=no-fit')
    expect(url).not.toContain('profile_slug')
  })
})

describe('api.searchRuns', () => {
  it('calls GET /api/search-runs with no params', async () => {
    vi.stubGlobal('fetch', mockFetch({ records: [] }))

    await api.searchRuns()

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/api/search-runs')
  })

  it('appends profile_slug and since to query string', async () => {
    vi.stubGlobal('fetch', mockFetch({ records: [] }))

    await api.searchRuns({ profile_slug: 'presales-se', since: '2026-01-01', limit: 10 })

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain('profile_slug=presales-se')
    expect(url).toContain('since=2026-01-01')
    expect(url).toContain('limit=10')
  })

  it('omits params that are undefined', async () => {
    vi.stubGlobal('fetch', mockFetch({ records: [] }))

    await api.searchRuns({ since: '2026-05-01' })

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain('since=2026-05-01')
    expect(url).not.toContain('profile_slug')
  })

  it('returns the records array', async () => {
    const record = {
      id: 'run-1', profile_slug: 'presales-se', query: 'SE | AE',
      pages_fetched: 3, total_results: 60, new_after_dedup: 45,
      screened: 44, fit_count: 7, fetch_failed_count: 1,
      summary_key: 'search/2026-05-01-summary.md', run_at: '2026-05-01T12:00:00',
    }
    vi.stubGlobal('fetch', mockFetch({ records: [record] }))

    const result = await api.searchRuns()
    expect(result.records).toHaveLength(1)
    expect(result.records[0].fit_count).toBe(7)
    expect(result.records[0].fetch_failed_count).toBe(1)
  })
})

describe('api.thoughts', () => {
  it('calls GET /api/thoughts with no params → no query string', async () => {
    vi.stubGlobal('fetch', mockFetch({ thoughts: [], total: 0 }))

    await api.thoughts()

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/api/thoughts')
  })

  it('appends provided params to the query string', async () => {
    vi.stubGlobal('fetch', mockFetch({ thoughts: [], total: 0 }))

    await api.thoughts({ limit: 10, offset: 5, sort: 'asc', type: 'email' })

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain('limit=10')
    expect(url).toContain('offset=5')
    expect(url).toContain('sort=asc')
    expect(url).toContain('type=email')
  })

  it('omits undefined params', async () => {
    vi.stubGlobal('fetch', mockFetch({ thoughts: [], total: 0 }))

    await api.thoughts({ sort: 'desc' })

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain('sort=desc')
    expect(url).not.toContain('limit')
    expect(url).not.toContain('offset')
    expect(url).not.toContain('type')
  })
})

describe('api.thoughtStats', () => {
  it('calls GET /api/thoughts/stats', async () => {
    vi.stubGlobal('fetch', mockFetch({ total: 12, by_type: { email: 5, note: 7 } }))

    const result = await api.thoughtStats()

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/api/thoughts/stats')
    expect(result.total).toBe(12)
    expect(result.by_type['email']).toBe(5)
  })
})

describe('api.thought', () => {
  it('calls GET /api/thoughts/{id} with URL-encoded id', async () => {
    const thought = { id: '101', content: '# Test', metadata: {}, created_at: '2026-01-01T00:00:00' }
    vi.stubGlobal('fetch', mockFetch(thought))

    const result = await api.thought('101')

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/api/thoughts/101')
    expect(result.id).toBe('101')
  })

  it('URL-encodes special characters in thought id', async () => {
    vi.stubGlobal('fetch', mockFetch({ id: 'a/b', content: '', metadata: {}, created_at: '' }))

    await api.thought('a/b')

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain(encodeURIComponent('a/b'))
  })
})

describe('api.thoughtConnections', () => {
  it('calls GET /api/thoughts/{id}/connections', async () => {
    vi.stubGlobal('fetch', mockFetch([]))

    await api.thoughtConnections('101')

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/api/thoughts/101/connections')
  })

  it('appends ?limit when limit is provided', async () => {
    vi.stubGlobal('fetch', mockFetch([]))

    await api.thoughtConnections('101', 5)

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/api/thoughts/101/connections?limit=5')
  })
})

describe('api.searchThoughts', () => {
  it('sends POST /api/thoughts/search with query in body', async () => {
    vi.stubGlobal('fetch', mockFetch({ results: [], total: 0 }))

    await api.searchThoughts('hiring manager feedback')

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/api/thoughts/search')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body.query).toBe('hiring manager feedback')
  })

  it('passes limit and mode when provided', async () => {
    vi.stubGlobal('fetch', mockFetch({ results: [] }))

    await api.searchThoughts('q', 10, 'keyword')

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.limit).toBe(10)
    expect(body.mode).toBe('keyword')
  })
})
