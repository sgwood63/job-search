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

const EMPTY_TRACKER: TrackerData = { active: [], phase_d: [], closed: [] }

const POPULATED_TRACKER: TrackerData = {
  active: [
    {
      date: '2026-05-01',
      company: 'Acme Corp',
      role: 'Solutions Engineer',
      profile: 'presales-se',
      source: 'LinkedIn',
      status: 'Applied',
      status_detail: '',
      next_action: 'Follow up',
      priority: '⭐️⭐️⭐️',
      folder: '2026-05-01-acme-corp-se',
    },
  ],
  phase_d: [],
  closed: [
    {
      date: '2026-04-01',
      company: 'OldCo',
      role: 'SDR',
      status: 'Closed',
      status_detail: 'No response',
      notes: '',
      profile: 'sales',
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

  it('renders section headers once data loads', async () => {
    server.use(http.get('/api/tracker', () => HttpResponse.json(EMPTY_TRACKER)))
    renderTracker()

    await waitFor(() => {
      expect(screen.getByText('Active Applications')).toBeInTheDocument()
    })
    expect(screen.getByText('Closed / Rejected')).toBeInTheDocument()
  })

  it('shows active application company and role', async () => {
    server.use(http.get('/api/tracker', () => HttpResponse.json(POPULATED_TRACKER)))
    renderTracker()

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument()
    })
    expect(screen.getByText('Solutions Engineer')).toBeInTheDocument()
  })

  it('shows count badge on section header', async () => {
    server.use(http.get('/api/tracker', () => HttpResponse.json(POPULATED_TRACKER)))
    renderTracker()

    await waitFor(() => {
      // Active Applications section should show count "1"
      expect(screen.getByText('Active Applications')).toBeInTheDocument()
    })
    // Badge renders the count as text
    const badges = screen.getAllByText('1')
    expect(badges.length).toBeGreaterThan(0)
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
