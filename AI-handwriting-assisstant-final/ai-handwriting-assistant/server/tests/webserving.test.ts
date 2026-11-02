import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp, request, testConfig } from './helpers';

function fakeWebDist() {
  const dir = mkdtempSync(path.join(tmpdir(), 'hw-web-'));
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>App</title><div id="root"></div>');
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log(1)');
  return dir;
}

describe('serving the built web app from the API (single-service hosting)', () => {
  it('serves index.html, static assets and falls back to the app for deep links', async () => {
    const { app } = buildApp({ config: testConfig({ webDist: fakeWebDist() }) });
    expect((await request(app).get('/')).text).toContain('id="root"');
    expect((await request(app).get('/assets/app.js')).text).toBe('console.log(1)');
    expect((await request(app).get('/some/client/route')).text).toContain('id="root"');
  });

  it('never lets API paths fall through to the app', async () => {
    const { app } = buildApp({ config: testConfig({ webDist: fakeWebDist() }) });
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect((await request(app).get('/api/health')).body.status).toBe('ok');
  });

  it('serves only the API when no web build is configured', async () => {
    const { app } = buildApp({ config: testConfig({ webDist: null }) });
    expect((await request(app).get('/')).status).toBe(404);
  });
});
