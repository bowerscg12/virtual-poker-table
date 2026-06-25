import { describe, it, expect } from 'vitest';
import { buildApp } from './app.js';

/**
 * Boot smoke test. Constructing the real Fastify app and calling `ready()` exercises the entire
 * plugin + route registration path — the same code that runs at container startup. This guards
 * against startup-config regressions (invalid Fastify options, plugin misconfig, route conflicts)
 * that unit tests never touch because they don't build the production app. Such a bug previously
 * shipped to Cloud Run as FST_ERR_LOG_INVALID_LOGGER_CONFIG and only surfaced at deploy time.
 */
describe('buildApp (server boot)', () => {
  it('constructs and registers all plugins and routes without throwing', async () => {
    const app = await buildApp();
    await app.ready();
    await app.close();
  });

  it('serves the health probe', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
