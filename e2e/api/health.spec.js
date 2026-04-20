// @ts-check
import { test, expect } from '@playwright/test';
import { BACKEND_URL, isBackendUp } from '../fixtures/app.js';

/**
 * Backend API contract: these endpoints must exist and respond sensibly for
 * the SPA to boot successfully.
 */
test.describe('Backend API — regression', () => {
  test.beforeAll(async () => {
    const up = await isBackendUp();
    test.skip(!up, `Backend not reachable at ${BACKEND_URL}. Start it with \`uvicorn main:app\` or docker compose.`);
  });

  test('GET /api/health returns ok', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/health`);
    expect(res.status(), 'health endpoint should return 200').toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'ok' });
    expect(typeof body.version).toBe('string');
  });

  test('GET /api/system/health returns a well-formed payload', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/system/health`);
    expect(res.ok(), `system/health status=${res.status()}`).toBeTruthy();
    const body = await res.json();
    expect(body, 'body should be an object').toEqual(expect.any(Object));
  });

  test.describe.parallel('core list endpoints respond', () => {
    const endpoints = [
      '/api/boards',
      '/api/jobs',
      '/api/profiles',
      '/api/files',
      '/api/notifications',
      '/api/test-management/test-cases',
      '/api/test-management/test-sets',
      // NOTE: `/api/test-commands` is intentionally excluded — the backend
      // mounts the router with prefix `/api/test-commands` AND uses route path
      // `/test-commands`, so the effective URL is
      // `/api/test-commands/test-commands`. Add it back here if the routing
      // is normalized.
    ];
    for (const path of endpoints) {
      test(`GET ${path}`, async ({ request }) => {
        const res = await request.get(`${BACKEND_URL}${path}`);
        expect(
          res.ok(),
          `${path} should not error (got ${res.status()})`
        ).toBeTruthy();
        // Most endpoints return arrays or `{ items: [...] }` shaped payloads;
        // we only assert JSON-parses successfully to stay schema-agnostic.
        const body = await res.json().catch(() => null);
        expect(body, `${path} should return JSON`).not.toBeNull();
      });
    }
  });

  test('OpenAPI schema is served', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/openapi.json`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('openapi');
    expect(body).toHaveProperty('paths');
  });
});
