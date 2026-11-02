import axe from 'axe-core';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { caps, errorResponse, jsonResponse, mockApi, renderWithProviders } from '../test/utils';
import { Dashboard } from './Dashboard';

afterEach(() => vi.unstubAllGlobals());

const doc = (id: string, title: string) => ({
  id,
  title,
  mode: 'notes' as const,
  excerpt: 'Plants make food using light.',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
});
const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';

describe('Dashboard', () => {
  it('shows a loading state, then an empty state with the primary action', async () => {
    mockApi({ 'GET /api/health': () => jsonResponse(caps()), 'GET /api/documents': () => jsonResponse({ items: [], total: 0, limit: 12, offset: 0 }) });
    renderWithProviders(<Dashboard />);
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
    expect(await screen.findByText('No documents yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create New Notes' })).toBeInTheDocument();
  });

  it('shows an error with retry when the server is unreachable, then recovers', async () => {
    let fail = true;
    mockApi({
      'GET /api/health': () => jsonResponse(caps()),
      'GET /api/documents': () => (fail ? errorResponse(500, 'INTERNAL', 'Something went wrong on our side.') : jsonResponse({ items: [doc(ID1, 'Biology')], total: 1, limit: 12, offset: 0 })),
    });
    renderWithProviders(<Dashboard />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('heading', { name: 'Biology' })).toBeInTheDocument();
  });

  it('lists documents with timestamps and honest storage/AI status', async () => {
    mockApi({
      'GET /api/health': () => jsonResponse(caps({ store: 'memory', ai: 'local-fallback' })),
      'GET /api/documents': () => jsonResponse({ items: [doc(ID1, 'Biology'), doc(ID2, 'History')], total: 2, limit: 12, offset: 0 }),
    });
    renderWithProviders(<Dashboard />);
    expect(await screen.findByRole('heading', { name: 'Biology' })).toBeInTheDocument();
    expect(screen.getAllByText('Created')).toHaveLength(2);
    expect(await screen.findByText(/temporary memory/i)).toBeInTheDocument();
    expect(screen.getByText(/basic local formatter/i)).toBeInTheDocument();
  });

  it('asks for confirmation before deleting, and only then calls the API', async () => {
    let items = [doc(ID1, 'Biology')];
    const { calls } = mockApi({
      'GET /api/health': () => jsonResponse(caps()),
      'GET /api/documents': () => jsonResponse({ items, total: items.length, limit: 12, offset: 0 }),
      [`DELETE /api/documents/${ID1}`]: () => {
        items = [];
        return new Response(null, { status: 204 });
      },
    });
    renderWithProviders(<Dashboard />);
    await userEvent.click(await screen.findByRole('button', { name: /delete biology/i }));

    const dialog = screen.getByRole('dialog', { name: /delete this document/i });
    expect(calls.some((c) => c.key.startsWith('DELETE'))).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(calls.some((c) => c.key === `DELETE /api/documents/${ID1}`)).toBe(true));
    expect(await screen.findByText('No documents yet')).toBeInTheDocument();
  });

  it('can cancel the delete dialog with Escape without deleting', async () => {
    const { calls } = mockApi({
      'GET /api/health': () => jsonResponse(caps()),
      'GET /api/documents': () => jsonResponse({ items: [doc(ID1, 'Biology')], total: 1, limit: 12, offset: 0 }),
    });
    renderWithProviders(<Dashboard />);
    await userEvent.click(await screen.findByRole('button', { name: /delete biology/i }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls.some((c) => c.key.startsWith('DELETE'))).toBe(false);
  });

  it('has no automatically detectable accessibility violations', async () => {
    mockApi({
      'GET /api/health': () => jsonResponse(caps()),
      'GET /api/documents': () => jsonResponse({ items: [doc(ID1, 'Biology')], total: 1, limit: 12, offset: 0 }),
    });
    const { container } = renderWithProviders(<Dashboard />);
    await screen.findByRole('heading', { name: 'Biology' });
    // Colour contrast needs real layout/styles; it is covered by the browser E2E run instead.
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
