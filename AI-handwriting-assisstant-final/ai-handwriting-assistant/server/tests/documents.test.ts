import { describe, expect, it, vi } from 'vitest';
import { buildApp, request, sampleDocument } from './helpers';

describe('document CRUD', () => {
  it('creates, reads, updates, renames, duplicates and deletes a document', async () => {
    const { app } = buildApp();
    const agent = request.agent(app);

    const created = await agent.post('/api/documents').send(sampleDocument());
    expect(created.status).toBe(201);
    const id = created.body.document.id as string;
    expect(created.body.document).toMatchObject({ title: 'Biology notes', version: 1, mode: 'exam' });
    expect(created.body.document.createdAt).toBeTruthy();

    const got = await agent.get(`/api/documents/${id}`);
    expect(got.status).toBe(200);
    expect(got.body.document.content.bodyText).toContain('The cell');
    // The user's original answer is stored untouched next to the reviewed text.
    expect(got.body.document.content.rawText).toBe('cell is unit of life');

    const updatedInput = sampleDocument('Biology notes v2', '# Cells\nUpdated body.');
    const put = await agent.put(`/api/documents/${id}`).send(updatedInput);
    expect(put.status).toBe(200);
    expect(put.body.document).toMatchObject({ title: 'Biology notes v2', version: 2 });
    expect(put.body.document.excerpt).toContain('Updated body');

    const renamed = await agent.patch(`/api/documents/${id}`).send({ title: 'Renamed' });
    expect(renamed.body.document.title).toBe('Renamed');
    expect(renamed.body.document.version).toBe(2); // a rename is not a content revision

    const versions = await agent.get(`/api/documents/${id}/versions`);
    expect(versions.body.versions).toEqual([expect.objectContaining({ version: 1, title: 'Biology notes' })]);

    const dup = await agent.post(`/api/documents/${id}/duplicate`);
    expect(dup.status).toBe(201);
    expect(dup.body.document.id).not.toBe(id);
    expect(dup.body.document.title).toBe('Renamed (copy)');

    const list = await agent.get('/api/documents');
    expect(list.body.total).toBe(2);

    expect((await agent.delete(`/api/documents/${id}`)).status).toBe(204);
    expect((await agent.get(`/api/documents/${id}`)).status).toBe(404);
    expect((await agent.delete(`/api/documents/${id}`)).status).toBe(404);
  });

  it('list responses omit the full body and sort most recently updated first', async () => {
    const { app } = buildApp();
    const agent = request.agent(app);
    const a = await agent.post('/api/documents').send(sampleDocument('A'));
    await new Promise((r) => setTimeout(r, 5));
    await agent.post('/api/documents').send(sampleDocument('B'));
    await new Promise((r) => setTimeout(r, 5));
    await agent.patch(`/api/documents/${a.body.document.id}`).send({ title: 'A touched' });
    const list = await agent.get('/api/documents');
    expect(list.body.items.map((d: { title: string }) => d.title)).toEqual(['A touched', 'B']);
    expect(list.body.items[0]).not.toHaveProperty('content');
  });

  it('paginates', async () => {
    const { app } = buildApp();
    const agent = request.agent(app);
    for (let i = 0; i < 5; i++) await agent.post('/api/documents').send(sampleDocument(`Doc ${i}`));
    const page1 = await agent.get('/api/documents?limit=2&offset=0');
    const page3 = await agent.get('/api/documents?limit=2&offset=4');
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.total).toBe(5);
    expect(page3.body.items).toHaveLength(1);
    expect((await agent.get('/api/documents?limit=500')).status).toBe(400);
  });

  it('validates input', async () => {
    const { app } = buildApp();
    const agent = request.agent(app);
    expect((await agent.post('/api/documents').send({ title: '', content: {} })).status).toBe(400);
    expect((await agent.post('/api/documents').send({ title: 'x', content: { bodyText: 'a'.repeat(40_001) } })).status).toBe(400);
    expect((await agent.patch('/api/documents/00000000-0000-4000-8000-000000000000').send({})).status).toBe(400);
  });

  it('treats malformed ids as not found', async () => {
    const { app } = buildApp();
    const res = await request.agent(app).get('/api/documents/not-a-uuid');
    expect(res.status).toBe(404);
  });
});

describe('document ownership isolation', () => {
  it("never lets one user read, modify, duplicate or delete another user's document", async () => {
    const { app } = buildApp();
    const alice = request.agent(app);
    const mallory = request.agent(app);

    const id = (await alice.post('/api/documents').send(sampleDocument('Private'))).body.document.id as string;

    expect((await mallory.get(`/api/documents/${id}`)).status).toBe(404);
    expect((await mallory.put(`/api/documents/${id}`).send(sampleDocument('Hacked'))).status).toBe(404);
    expect((await mallory.patch(`/api/documents/${id}`).send({ title: 'Hacked' })).status).toBe(404);
    expect((await mallory.post(`/api/documents/${id}/duplicate`)).status).toBe(404);
    expect((await mallory.get(`/api/documents/${id}/versions`)).status).toBe(404);
    expect((await mallory.delete(`/api/documents/${id}`)).status).toBe(404);
    expect((await mallory.get('/api/documents')).body.total).toBe(0);

    const still = await alice.get(`/api/documents/${id}`);
    expect(still.body.document.title).toBe('Private');
  });

  it('issues an httpOnly session cookie and ignores forged tokens', async () => {
    const { app } = buildApp();
    const first = await request(app).get('/api/documents');
    const cookie = first.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/hw_sid=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const forged = await request(app).get('/api/documents').set('Cookie', 'hw_sid=../../etc/passwd');
    expect(forged.status).toBe(200);
    expect(forged.headers['set-cookie']?.[0]).toMatch(/hw_sid=/); // rejected and replaced
  });
});

describe('idempotent create (safe retries)', () => {
  it('returns the same document when a create is retried with the same key', async () => {
    const { app } = buildApp();
    const agent = request.agent(app);
    const key = 'retry-key-0001';
    const a = await agent.post('/api/documents').set('Idempotency-Key', key).send(sampleDocument());
    const b = await agent.post('/api/documents').set('Idempotency-Key', key).send(sampleDocument());
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.document.id).toBe(a.body.document.id);
    expect((await agent.get('/api/documents')).body.total).toBe(1);
  });

  it('scopes keys per user', async () => {
    const { app } = buildApp();
    const key = 'shared-key-0001';
    const a = await request.agent(app).post('/api/documents').set('Idempotency-Key', key).send(sampleDocument());
    const b = await request.agent(app).post('/api/documents').set('Idempotency-Key', key).send(sampleDocument());
    expect(a.body.document.id).not.toBe(b.body.document.id);
  });

  it('rejects malformed keys', async () => {
    const { app } = buildApp();
    const res = await request.agent(app).post('/api/documents').set('Idempotency-Key', 'x').send(sampleDocument());
    expect(res.status).toBe(400);
  });
});

describe('preferences', () => {
  it('returns defaults, then persists changes per user', async () => {
    const { app } = buildApp();
    const agent = request.agent(app);
    const defaults = await agent.get('/api/preferences');
    expect(defaults.body.settings.style).toBe('caveat');
    const settings = { ...defaults.body.settings, style: 'kalam', inkColor: '#111111' };
    expect((await agent.put('/api/preferences').send({ settings })).status).toBe(200);
    expect((await agent.get('/api/preferences')).body.settings).toMatchObject({ style: 'kalam', inkColor: '#111111' });
    expect((await request.agent(app).get('/api/preferences')).body.settings.style).toBe('caveat');
    expect((await agent.put('/api/preferences').send({ settings: { ...settings, inkColor: 'red' } })).status).toBe(400);
  });
});

describe('database failures', () => {
  it('reports DB_UNAVAILABLE (503) instead of crashing or leaking internals', async () => {
    const { app, repo } = buildApp();
    vi.spyOn(repo, 'listDocuments').mockRejectedValue(
      Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:3306 user=root'), { code: 'ECONNREFUSED' }),
    );
    const res = await request.agent(app).get('/api/documents');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DB_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toMatch(/10\.0\.0\.5|root/);
  });

  it('returns a generic 500 for unexpected errors without stack traces', async () => {
    const { app, repo } = buildApp();
    vi.spyOn(repo, 'listDocuments').mockRejectedValue(new Error('SELECT * FROM secret_table blew up'));
    const res = await request.agent(app).get('/api/documents');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toMatch(/SELECT|secret_table|\.ts:/);
  });
});
