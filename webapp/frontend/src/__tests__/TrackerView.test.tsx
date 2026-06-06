import { describe, it, expect, vi, beforeAll, afterEach, afterAll } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import TrackerView from '../components/TrackerView'
import type { TrackerData } from '../api'

// ---------------------------------------------------------------------------
// MSW server — intercepts fetch calls from the component
// ---------------------------------------------------------------------------

const EMPTY_TRACKER: TrackerData = { rows: [] }

const POPULATED_TRACKER: TrackerData = {
  rows: [
    {
      id: 'abc-1',
      date: '2026-05-01',
      company: 'Acme Corp',
      role: 'Solutions Engineer',
      profile: 'presales-se',
      status: 'applied',
      status_detail: '',
      follow_up_date: '2026-05-15',
      priority: '⭐⭐⭐',
      folder: '2026-05-01-acme-corp-se',
    },
    {
      id: 'abc-2',
      date: '2026-04-01',
      company: 'OldCo',
      role: 'SDR',
      profile: 'sales',
      status: 'closed',
      status_detail: 'No response',
      follow_up_date: '',
      priority: '',
      folder: null,
    },
  ],
}

const server = setupServer(
  http.get('/api/tracker', () => HttpResponse.json(EMPTY_TRACKER)),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function renderTracker() {
  return render(
    <MemoryRouter>
      <TrackerView />
    </MemoryRouter>,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TrackerView', () => {
  it('shows loading state before data arrives', () => {
    renderTracker()
    expect(screen.getByText(/loading tracker/i)).toBeInTheDocument()
  })

  it('renders table column headers once data loads', async () => {
    server.use(http.get('/api/tracker', () => HttpResponse.json(EMPTY_TRACKER)))
    renderTracker()

    await waitFor(() => {
      expect(screen.getByText('Company')).toBeInTheDocument()
    })
    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText('Profile')).toBeInTheDocument()
  })

  it('shows application company and role', async () => {
    server.use(http.get('/api/tracker', () => HttpResponse.json(POPULATED_TRACKER)))
    renderTracker()

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument()
    })
    expect(screen.getByText('Solutions Engineer')).toBeInTheDocument()
  })

  it('shows row count in filter bar', async () => {
    server.use(http.get('/api/tracker', () => HttpResponse.json(POPULATED_TRACKER)))
    renderTracker()

    await waitFor(() => {
      expect(screen.getByText('2 rows')).toBeInTheDocument()
    })
  })

  it('shows error message when fetch fails', async () => {
    server.use(
      http.get('/api/tracker', () => HttpResponse.json({}, { status: 500 })),
    )
    renderTracker()

    await waitFor(() => {
      expect(screen.getByText(/failed to load tracker/i)).toBeInTheDocument()
    })
  })
})
