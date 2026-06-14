import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import ApplicationView from '../components/ApplicationView'
import type { Application, TrackerData } from '../api'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_APP: Application = {
  name: '2026-05-01-acme-se',
  path: 'applications/2026-05-01-acme-se',
  files: [],
  domain_connection: '',
  domain_tags: [],
  jd_requirements: { required: [], preferred: [] },
}

const APP_WITH_DOMAIN: Application = {
  ...BASE_APP,
  domain_connection: 'Applicant built AI developer tooling at scale.',
  domain_tags: ['ai-devtools', 'b2b-saas', 'enterprise'],
  jd_requirements: {
    required: ['5+ years Python', 'Enterprise sales cycles'],
    preferred: ['Kubernetes', 'MLOps experience'],
  },
}

const EMPTY_TRACKER: TrackerData = { rows: [] }

// ---------------------------------------------------------------------------
// MSW server
// ---------------------------------------------------------------------------

const server = setupServer(
  http.get('/api/tracker', () => HttpResponse.json(EMPTY_TRACKER)),
  http.get('/api/applications/:folder', () => HttpResponse.json(BASE_APP)),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function renderApp(folder = '2026-05-01-acme-se') {
  return render(
    <MemoryRouter initialEntries={[`/applications/${folder}`]}>
      <Routes>
        <Route path="/applications/:folder" element={<ApplicationView />} />
      </Routes>
    </MemoryRouter>,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ApplicationView — domain metadata panel', () => {
  it('does not render domain panel when all fields are empty', async () => {
    server.use(
      http.get('/api/applications/:folder', () => HttpResponse.json(BASE_APP)),
    )
    renderApp()
    await waitFor(() => {
      // The folder name derived header should appear
      expect(screen.getByText(/acme se/i)).toBeInTheDocument()
    })
    // No domain section headers
    expect(screen.queryByText(/domain:/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/jd requirements/i)).not.toBeInTheDocument()
  })

  it('renders domain_tags as pill badges', async () => {
    server.use(
      http.get('/api/applications/:folder', () => HttpResponse.json(APP_WITH_DOMAIN)),
    )
    renderApp()

    await waitFor(() => {
      expect(screen.getByText('ai-devtools')).toBeInTheDocument()
    })
    expect(screen.getByText('b2b-saas')).toBeInTheDocument()
    expect(screen.getByText('enterprise')).toBeInTheDocument()
  })

  it('renders domain_connection text', async () => {
    server.use(
      http.get('/api/applications/:folder', () => HttpResponse.json(APP_WITH_DOMAIN)),
    )
    renderApp()

    await waitFor(() => {
      expect(screen.getByText('Applicant built AI developer tooling at scale.')).toBeInTheDocument()
    })
    expect(screen.getByText(/domain:/i)).toBeInTheDocument()
  })

  it('renders jd_requirements section when populated', async () => {
    server.use(
      http.get('/api/applications/:folder', () => HttpResponse.json(APP_WITH_DOMAIN)),
    )
    renderApp()

    await waitFor(() => {
      expect(screen.getByText(/jd requirements/i)).toBeInTheDocument()
    })
  })

  it('expands jd_requirements on click and shows required items', async () => {
    server.use(
      http.get('/api/applications/:folder', () => HttpResponse.json(APP_WITH_DOMAIN)),
    )
    renderApp()

    await waitFor(() => {
      expect(screen.getByText(/jd requirements/i)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText(/jd requirements/i))

    await waitFor(() => {
      expect(screen.getByText('5+ years Python')).toBeInTheDocument()
    })
    expect(screen.getByText('Enterprise sales cycles')).toBeInTheDocument()
    expect(screen.getByText('Kubernetes')).toBeInTheDocument()
  })

  it('shows domain_connection in edit mode when clicked', async () => {
    server.use(
      http.get('/api/applications/:folder', () => HttpResponse.json(APP_WITH_DOMAIN)),
    )
    renderApp()

    await waitFor(() => {
      expect(screen.getByText('Applicant built AI developer tooling at scale.')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Applicant built AI developer tooling at scale.'))

    await waitFor(() => {
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })
    expect(screen.getByDisplayValue('Applicant built AI developer tooling at scale.')).toBeInTheDocument()
  })

  it('shows Save and cancel buttons in edit mode', async () => {
    server.use(
      http.get('/api/applications/:folder', () => HttpResponse.json(APP_WITH_DOMAIN)),
    )
    renderApp()

    await waitFor(() => {
      expect(screen.getByText('Applicant built AI developer tooling at scale.')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Applicant built AI developer tooling at scale.'))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /✕/ })).toBeInTheDocument()
  })

  it('exits edit mode without saving on cancel click', async () => {
    server.use(
      http.get('/api/applications/:folder', () => HttpResponse.json(APP_WITH_DOMAIN)),
    )
    renderApp()

    await waitFor(() => {
      expect(screen.getByText('Applicant built AI developer tooling at scale.')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Applicant built AI developer tooling at scale.'))
    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /✕/ }))

    await waitFor(() => {
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })
  })
})
