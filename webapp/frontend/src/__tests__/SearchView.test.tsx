import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import SearchView from '../components/SearchView'
import type { IngestionRecord, SearchRun } from '../api'

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const INGESTION_RECORDS: IngestionRecord[] = [
  {
    id: 'rec-1',
    company_name: 'Acme Corp',
    role_title: 'Solutions Engineer',
    profile_slug: 'presales-se',
    outcome: 'fit',
    no_fit_reason: null,
    is_repost: false,
    first_seen_at: null,
    created_at: '2026-05-01T10:00:00',
  },
  {
    id: 'rec-2',
    company_name: 'OldCo',
    role_title: 'Sales Engineer',
    profile_slug: 'presales-se',
    outcome: 'no-fit',
    no_fit_reason: 'Requires on-site relocation',
    is_repost: false,
    first_seen_at: null,
    created_at: '2026-04-28T09:00:00',
  },
  {
    id: 'rec-3',
    company_name: 'DupeCo',
    role_title: 'SE',
    profile_slug: null,
    outcome: 'duplicate',
    no_fit_reason: null,
    is_repost: true,
    first_seen_at: '2026-01-01T00:00:00',
    created_at: '2026-04-27T08:00:00',
  },
]

const SEARCH_RUNS: SearchRun[] = [
  {
    id: 'run-1',
    profile_slug: 'presales-se',
    query: 'Solutions Engineer | Account Executive',
    pages_fetched: 3,
    total_results: 60,
    new_after_dedup: 45,
    screened: 44,
    fit_count: 7,
    fetch_failed_count: 1,
    summary_key: 'search/2026-05-01-120000-presales-se-summary.md',
    run_at: '2026-05-01T12:00:00',
  },
]

// ---------------------------------------------------------------------------
// MSW server
// ---------------------------------------------------------------------------

const server = setupServer(
  http.get('/api/search', () => HttpResponse.json([])),
  http.get('/api/ingestion-history', () => HttpResponse.json({ records: INGESTION_RECORDS })),
  http.get('/api/search-runs', () => HttpResponse.json({ records: [] })),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function renderSearch() {
  return render(<MemoryRouter><SearchView /></MemoryRouter>)
}

// ---------------------------------------------------------------------------
// Panel header / collapse
// ---------------------------------------------------------------------------

describe('SearchView — Search History panel', () => {
  it('renders the collapsible panel header as "Search History"', async () => {
    renderSearch()
    expect(screen.getByText(/search history/i)).toBeInTheDocument()
  })

  it('renders the Positions and Runs tabs', async () => {
    renderSearch()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /positions/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /runs/i })).toBeInTheDocument()
    })
  })

  it('has profile filter select in the tab bar', () => {
    renderSearch()
    expect(screen.getByRole('option', { name: 'All profiles' })).toBeInTheDocument()
  })

  it('collapses the panel when the header is clicked', async () => {
    renderSearch()
    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument()
    })

    const toggle = screen.getByRole('button', { name: /search history/i })
    fireEvent.click(toggle)

    expect(screen.queryByText('Acme Corp')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Positions tab (default)
// ---------------------------------------------------------------------------

describe('SearchView — Positions tab', () => {
  it('shows table column headers once data loads', async () => {
    renderSearch()
    await waitFor(() => {
      expect(screen.getByText('Company')).toBeInTheDocument()
    })
    expect(screen.getByText('Outcome')).toBeInTheDocument()
    expect(screen.getByText('Reason')).toBeInTheDocument()
  })

  it('renders company names from ingestion records', async () => {
    renderSearch()
    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument()
    })
    expect(screen.getByText('OldCo')).toBeInTheDocument()
    expect(screen.getByText('DupeCo')).toBeInTheDocument()
  })

  it('shows outcome badges', async () => {
    renderSearch()
    await waitFor(() => {
      expect(screen.getAllByText('Fit').length).toBeGreaterThanOrEqual(1)
    })
    expect(screen.getAllByText('No Fit').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Duplicate').length).toBeGreaterThanOrEqual(1)
  })

  it('shows repost indicator for repost records', async () => {
    renderSearch()
    await waitFor(() => {
      expect(screen.getByText('DupeCo')).toBeInTheDocument()
    })
    expect(screen.getAllByText('↩').length).toBeGreaterThan(0)
  })

  it('shows no-fit reason text', async () => {
    renderSearch()
    await waitFor(() => {
      expect(screen.getByText(/requires on-site relocation/i)).toBeInTheDocument()
    })
  })

  it('shows record count in filter bar', async () => {
    renderSearch()
    await waitFor(() => {
      expect(screen.getByText('3 records')).toBeInTheDocument()
    })
  })

  it('shows empty state when there are no records', async () => {
    server.use(
      http.get('/api/ingestion-history', () => HttpResponse.json({ records: [] })),
    )
    renderSearch()
    await waitFor(() => {
      expect(screen.getByText(/no ingestion history yet/i)).toBeInTheDocument()
    })
  })

  it('has outcome dropdown with all outcome options', () => {
    renderSearch()
    expect(screen.getByRole('option', { name: 'Fit' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'No Fit' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Duplicate' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Fetch Failed' })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Run History tab
// ---------------------------------------------------------------------------

describe('SearchView — Runs tab', () => {
  it('switches to Run History table after clicking Runs tab', async () => {
    server.use(
      http.get('/api/search-runs', () => HttpResponse.json({ records: SEARCH_RUNS })),
    )
    renderSearch()

    const runsTab = await screen.findByRole('button', { name: /runs/i })
    await userEvent.click(runsTab)

    await waitFor(() => {
      expect(screen.getByText('Screened')).toBeInTheDocument()
      expect(screen.getByText('Failed')).toBeInTheDocument()
    })
  })

  it('shows empty state when no runs exist', async () => {
    renderSearch()

    const runsTab = await screen.findByRole('button', { name: /runs/i })
    await userEvent.click(runsTab)

    await waitFor(() => {
      expect(screen.getByText(/no search runs yet/i)).toBeInTheDocument()
    })
  })

  it('renders run stats when search runs exist', async () => {
    server.use(
      http.get('/api/search-runs', () => HttpResponse.json({ records: SEARCH_RUNS })),
    )
    renderSearch()

    const runsTab = await screen.findByRole('button', { name: /runs/i })
    await userEvent.click(runsTab)

    await waitFor(() => {
      expect(screen.getAllByText('presales-se').length).toBeGreaterThan(0)
    })
    expect(screen.getAllByText('7').length).toBeGreaterThan(0)
  })

  it('shows Pages, Total, Screened column headers', async () => {
    server.use(
      http.get('/api/search-runs', () => HttpResponse.json({ records: SEARCH_RUNS })),
    )
    renderSearch()

    const runsTab = await screen.findByRole('button', { name: /runs/i })
    await userEvent.click(runsTab)

    await waitFor(() => {
      expect(screen.getByText('Pages')).toBeInTheDocument()
      expect(screen.getByText('Total')).toBeInTheDocument()
      expect(screen.getByText('Screened')).toBeInTheDocument()
    })
  })
})
