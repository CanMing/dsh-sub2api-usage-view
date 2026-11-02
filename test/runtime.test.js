import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, resolveConfig } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import * as plugin from '../lib/index.js';

test('real Cordis schema resolves live config references and defaults', () => {
  const config = resolveConfig(plugin, {});
  assert.equal(config.enabled.get(), true);
  assert.equal(config.baseURL.get(), '');
  assert.equal(config.adminKeyRef.get(), 'SUB2API_ADMIN_KEY');
  assert.equal(config.accountId.get(), '');
  assert.equal(config.refreshSeconds.get(), 60);
  assert.equal(config.usageSource.get(), 'auto');
});

test('real Loader activates host routes, resolves credentials, and cleans up', async t => {
  const ctx = new Context();
  t.after(async () => { await ctx.fiber.dispose(); });
  const routes = new Map();
  let keyReads = 0;
  ctx.provide('webServer', {
    getOrigin: () => 'http://127.0.0.1:9939',
    register(route) { routes.set(route.path, route); return () => routes.delete(route.path); },
  });
  ctx.provide('credentials', { async resolve(ref) { assert.equal(ref, 'SUB2API_ADMIN_KEY'); keyReads++; return { value: 'runtime-fixture-key', source: 'test' }; } });
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://fixture.invalid/api/v1/admin/accounts/7');
    assert.equal(init.headers['x-api-key'], 'runtime-fixture-key');
    return Response.json({ code: 0, data: { id: 7, name: 'fixture', platform: 'openai', type: 'oauth', extra: { codex_5h_used_percent: 35 } } });
  });
  await ctx.plugin(Loader, { baseUrl: new URL('../', import.meta.url).href });
  const loader = ctx.get('loader');
  await loader.create({ id: 'sub2api-usage-view', name: './lib/index.js', config: { baseURL: 'https://fixture.invalid', accountId: '7' } });
  await loader.await();
  const entry = loader.resolve('sub2api-usage-view');
  await entry.fiber.await();
  assert.equal(entry.fiber.state, 2);
  assert.equal(routes.size, 2);
  let code, body;
  const res = { writeHead(status) { code = status; }, end(text) { body = JSON.parse(text); } };
  await routes.get('/api/dsh-sub2api-usage-view/usage').handler({ method: 'GET', url: '/api/dsh-sub2api-usage-view/usage', socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:9939' } }, res);
  assert.equal(code, 200);
  assert.equal(body.windows.fiveHour.remainingPercent, 65);
  assert.equal(body.stale, true);
  assert.equal(body.observedAt, null);
  assert.equal(keyReads, 1);
  assert.ok(!JSON.stringify(body).includes('runtime-fixture-key'));
  await entry.fiber.dispose();
  assert.equal(routes.size, 0);
});
