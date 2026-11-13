import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBaseURL, normalizeWindow, normalizeSnapshot, UsageService } from '../lib/usage.js';
import { allowedRequest, createRoutes } from '../lib/routes.js';

const time = Date.parse('2026-11-02T15:00:00Z');
const account = { id: 7, name: '我的 Codex', platform: 'openai', type: 'oauth', extra: {
  codex_5h_used_percent: 25, codex_7d_used_percent: 63,
  codex_5h_reset_at: '2026-11-02T18:00:00Z', codex_7d_reset_at: '2026-11-05T15:00:00Z',
  codex_usage_updated_at: '2026-11-02T15:00:00Z',
} };
function harness(overrides = {}) {
  let clock = time;
  let config = { enabled: true, baseURL: 'https://example.com', adminKeyRef: 'SUB2API_ADMIN_KEY', accountId: '7', refreshSeconds: 60, usageSource: 'auto' };
  let key = 'test-admin-secret';
  const calls = [];
  const service = new UsageService({ resolveConfig: () => config, resolveKey: async () => key, now: () => clock,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return overrides.fetch ? overrides.fetch(url, init, calls) : Response.json({ code: 0, data: account });
    },
  });
  return { service, calls, advance: ms => { clock += ms; }, setConfig: delta => { config = { ...config, ...delta }; }, setKey: value => { key = value; } };
}

test('base URL keeps deployment prefixes and removes common API suffixes', () => {
  assert.equal(normalizeBaseURL('https://example.com:1443/sub/api/v1/'), 'https://example.com:1443/sub');
  assert.equal(normalizeBaseURL('https://example.com/v1'), 'https://example.com');
  assert.throws(() => normalizeBaseURL('https://user:secret@example.com'));
  assert.throws(() => normalizeBaseURL('https://example.com?api_key=secret'));
  assert.throws(() => normalizeBaseURL('file:///tmp/api'));
});

test('missing and malformed percentages stay unknown; true zero is preserved', () => {
  for (const utilization of [null, undefined, '', '0', NaN, Infinity, false, -1]) assert.equal(normalizeWindow({ utilization }).remainingPercent, null);
  assert.equal(normalizeWindow({ utilization: 0 }).remainingPercent, 100);
  assert.equal(normalizeWindow({ utilization: 123 }).remainingPercent, 0);
  assert.deepEqual(normalizeWindow(null), { remainingPercent: null, resetAt: null });
});

test('relative reset anchors to the observation rather than polling time', () => {
  assert.equal(normalizeWindow({ utilization: 5, remaining_seconds: 3600 }).resetAt, null);
  assert.equal(normalizeWindow({ remaining_seconds: 3600 }, '2026-11-02T15:00:00Z').resetAt, '2026-11-02T16:00:00.000Z');
});

test('out-of-range relative reset preserves a valid percentage', () => {
  assert.deepEqual(normalizeWindow({ utilization: 25, remaining_seconds: 1e308 }, '2026-11-02T15:00:00Z'), { remainingPercent: 75, resetAt: null });
});

test('sample freshness is unknown without an observation timestamp', async () => {
  for (const [platform, extra] of [['openai', { codex_5h_used_percent: 30 }], ['anthropic', { session_window_utilization: 0.3 }]]) {
    const h = harness({ fetch: async () => Response.json({ code: 0, data: { ...account, platform, extra } }) });
    const result = await h.service.usage();
    assert.equal(result.observedAt, null);
    assert.equal(result.stale, true);
    assert.equal(result.windows.fiveHour.remainingPercent, 70);
  }
});

test('Codex canonical and legacy windows use their actual durations', () => {
  const result = normalizeSnapshot(account);
  assert.equal(result.fiveHour.remainingPercent, 75);
  assert.equal(result.sevenDay.remainingPercent, 37);
  const legacy = normalizeSnapshot({ platform: 'openai', extra: {
    codex_primary_used_percent: 80, codex_secondary_used_percent: 10,
    codex_primary_window_minutes: 10080, codex_secondary_window_minutes: 300,
  } });
  assert.equal(legacy.fiveHour.remainingPercent, 90);
  assert.equal(legacy.sevenDay.remainingPercent, 20);
});

test('Claude raw fractions and Unix seconds convert once; estimates are not invented', () => {
  const snapshot = normalizeSnapshot({ platform: 'anthropic', session_window_end: '2026-11-02T18:00:00Z', extra: {
    session_window_utilization: 0.3, passive_usage_7d_utilization: 0.9, passive_usage_7d_reset: time / 1000 + 86400,
  } });
  assert.equal(snapshot.fiveHour.remainingPercent, 70);
  assert.equal(snapshot.sevenDay.remainingPercent, 10);
  assert.equal(snapshot.sevenDay.resetAt, '2026-11-03T15:00:00.000Z');
  assert.equal(normalizeSnapshot({ platform: 'anthropic', session_window_status: 'allowed' }).fiveHour.remainingPercent, null);
});

test('blank service address requires user configuration and never sends a request', async () => {
  const h = harness(); h.setConfig({ baseURL: '' });
  const result = await h.service.usage();
  assert.equal(result.configured, false);
  assert.match(result.error, /服务地址/);
  assert.equal(h.calls.length, 0);
});

test('default polling reads only saved snapshots with secret host-side and no probes', async () => {
  const h = harness();
  const result = await h.service.usage();
  assert.equal(result.configured, true);
  assert.equal(result.source, 'snapshot');
  assert.equal(result.windows.fiveHour.remainingPercent, 75);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, 'https://example.com/api/v1/admin/accounts/7');
  assert.equal(h.calls[0].init.headers['x-api-key'], 'test-admin-secret');
  assert.equal(h.calls[0].init.redirect, 'error');
  assert.ok(!JSON.stringify(result).includes('test-admin-secret'));
  assert.ok(!JSON.stringify(result).includes('extra'));
  h.service.dispose();
});

test('automatic reads use snapshots; manual refresh queries active usage and is cooldown-bounded', async () => {
  const h = harness({ fetch: async url => {
    if (url.includes('/usage?')) return Response.json({ code: 0, data: {
      five_hour: { utilization: 35, resets_at: '2026-11-02T18:00:00Z' },
      seven_day: { utilization: 62, resets_at: '2026-11-05T15:00:00Z' },
    } });
    return Response.json({ code: 0, data: account });
  } });
  await Promise.all([h.service.usage(), h.service.usage(), h.service.usage()]);
  assert.equal(h.calls.length, 1);
  assert.equal((await h.service.usage()).source, 'snapshot');
  assert.equal(h.calls.length, 1);

  const refreshed = await h.service.usage({ refresh: true });
  assert.equal(refreshed.source, 'active');
  assert.equal(refreshed.windows.fiveHour.remainingPercent, 65);
  assert.equal(refreshed.windows.sevenDay.remainingPercent, 38);
  assert.match(h.calls[2].url, /accounts\/7\/usage\?source=active$/);
  assert.doesNotMatch(h.calls[2].url, /force=/);
  assert.equal(refreshed.stale, false);
  assert.ok(refreshed.manualRefreshAvailableAt);
  assert.equal(h.calls.length, 3);

  const throttled = await h.service.usage({ refresh: true });
  assert.equal(h.calls.length, 3);
  assert.equal(throttled.source, 'active');
  assert.ok(throttled.manualRefreshAvailableAt);
  h.advance(10_001);
  await h.service.usage({ refresh: true });
  assert.equal(h.calls.length, 5);

  h.advance(60_001);
  assert.equal((await h.service.usage()).source, 'snapshot');
  assert.equal(h.calls.length, 6);
});

test('a later empty snapshot preserves the most recent active result instead of blanking the meter', async () => {
  let active = false;
  const h = harness({ fetch: async url => {
    if (url.includes('/usage?')) { active = true; return Response.json({ code: 0, data: { five_hour: { utilization: 30, resets_at: '2026-11-02T18:00:00Z' } } }); }
    return Response.json({ code: 0, data: active ? { ...account, extra: {} } : { ...account, extra: {} } });
  } });
  const queried = await h.service.usage({ refresh: true });
  assert.equal(queried.source, 'active');
  assert.equal(queried.windows.fiveHour.remainingPercent, 70);
  h.advance(60_001);
  const scheduled = await h.service.usage();
  assert.equal(scheduled.source, 'active');
  assert.equal(scheduled.windows.fiveHour.remainingPercent, 70);
  assert.equal(scheduled.stale, true);
  assert.match(scheduled.error, /保留上次主动查询/);
});

test('credential and account changes never reuse another identity snapshot', async () => {
  const h = harness({ fetch: async (url, init) => init.headers['x-api-key'] === 'bad' ? new Response('', { status: 401 }) : Response.json({ code: 0, data: account }) });
  await h.service.usage();
  h.setKey('bad');
  const failed = await h.service.usage();
  assert.equal(failed.windows.fiveHour.remainingPercent, null);
  assert.match(failed.error, /管理员密钥/);
  h.setKey('valid'); h.setConfig({ accountId: '8' });
  await h.service.usage();
  assert.match(h.calls.at(-1).url, /accounts\/8$/);
});

test('network failure retains the last sample and marks it stale without echoing upstream secrets', async () => {
  const h = harness({ fetch: async (_url, _init, calls) => {
    if (calls.length > 1) throw new Error('leaked secret from upstream');
    return Response.json({ code: 0, data: account });
  } });
  const previous = await h.service.usage(); h.advance(61_000);
  const failed = await h.service.usage();
  assert.equal(failed.stale, true);
  assert.equal(failed.windows.fiveHour.remainingPercent, 75);
  assert.equal(failed.fetchedAt, previous.fetchedAt);
  assert.ok(!failed.error.includes('secret'));
});

test('expired samples stay expired; disabled/unconfigured plugins make no upstream call', async () => {
  const h = harness(); h.advance(4 * 3600_000);
  const expired = await h.service.usage();
  assert.equal(expired.stale, true);
  assert.equal(expired.windows.fiveHour.remainingPercent, 75);
  h.setConfig({ enabled: false }); await h.service.usage();
  h.setConfig({ enabled: true }); h.setKey(''); await h.service.usage();
  assert.equal(h.calls.length, 1);
});

test('manual refresh selects the supported live source for Claude OAuth and saved data for setup-token', async () => {
  for (const type of ['oauth', 'setup-token']) {
    const claude = { id: 7, name: 'Claude', platform: 'anthropic', type, extra: { passive_usage_sampled_at: '2026-11-02T15:00:00Z' } };
    const h = harness({ fetch: async url => Response.json({ code: 0, data: url.includes('/usage?')
      ? { five_hour: { utilization: 20, resets_at: '2026-11-02T18:00:00Z' }, seven_day: { utilization: 40, resets_at: '2026-11-05T15:00:00Z' } }
      : claude }) });
    const result = await h.service.usage({ refresh: true });
    assert.equal(result.source, type === 'oauth' ? 'active' : 'passive');
    assert.ok(h.calls.some(call => call.url.endsWith(`/usage?source=${result.source}`)));
  }
});

test('active query results without a sample timestamp are shown as query-only, not silently marked old', async () => {
  const noSample = { ...account, extra: {} };
  const h = harness({ fetch: async url => Response.json({ code: 0, data: url.includes('/usage?')
    ? { five_hour: { utilization: 25, resets_at: '2026-11-02T18:00:00Z' } }
    : noSample }) });
  const result = await h.service.usage({ refresh: true });
  assert.equal(result.windows.fiveHour.remainingPercent, 75);
  assert.equal(result.observedAt, null);
  assert.equal(result.sampleTimeUnknown, true);
  assert.equal(result.stale, false);
  assert.equal(result.error, null);
});

test('active is explicitly selected and never uses force; passive Codex is refused', async () => {
  // The stored snapshot timestamp is old; a live response must supply its own.
  const staleAccount = { ...account, extra: { ...account.extra, codex_usage_updated_at: '2026-10-01T00:00:00Z' } };
  const h = harness({ fetch: async url => Response.json({ code: 0, data: url.includes('/usage') ? { five_hour: { utilization: 20 }, updated_at: '2026-11-02T15:00:00Z' } : staleAccount }) });
  h.setConfig({ usageSource: 'active' });
  const active = await h.service.usage();
  assert.equal(active.windows.fiveHour.remainingPercent, 80);
  assert.equal(active.observedAt, '2026-11-02T15:00:00.000Z');
  assert.equal(active.stale, false);
  assert.match(h.calls[1].url, /usage\?source=active$/);
  h.setConfig({ usageSource: 'passive' });
  assert.match((await h.service.usage()).error, /不支持被动/);
});

test('account pagination exposes only subscription display metadata', async () => {
  const h = harness({ fetch: async () => Response.json({ code: 0, data: { items: [account, { id: 9, name: 'API', platform: 'openai', type: 'apikey' }], total: 2, pages: 1 } }) });
  const result = await h.service.accounts();
  assert.deepEqual(result.accounts, [{ id: 7, name: '我的 Codex', platform: 'openai', type: 'oauth' }]);
});

test('routes refuse cross-origin access, remote peers, DNS rebinding and writes', async () => {
  const req = { socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:9939', origin: 'http://127.0.0.1:9939' }, method: 'GET', url: '/api/dsh-sub2api-usage-view/usage' };
  const origin = 'http://127.0.0.1:9939';
  assert.equal(allowedRequest(req, origin), true);
  assert.equal(allowedRequest({ ...req, headers: { ...req.headers, origin: 'https://evil.example' } }, origin), false);
  assert.equal(allowedRequest({ ...req, headers: { host: 'evil.example' } }, origin), false);
  assert.equal(allowedRequest({ ...req, socket: { remoteAddress: '192.168.1.2' } }, origin), false);
  let status, response;
  const res = { setHeader() {}, writeHead(code) { status = code; }, end(body) { response = JSON.parse(body); } };
  const [route] = createRoutes({ usage: async () => ({ ok: true }) }, () => origin);
  await route.handler({ ...req, method: 'POST' }, res);
  assert.equal(status, 405);
  await route.handler(req, res);
  assert.equal(status, 200); assert.equal(response.ok, true);
});
