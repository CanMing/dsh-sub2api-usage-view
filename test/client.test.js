import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// Browser/RPC boundaries are fixtures. The form double checks our controller
// protocol; it does not claim to validate the SDK's own persistence engine.
class FormDouble {
  constructor(scope, specs, secrets) {
    this.scope = scope; this.specs = new Map(specs.map((spec) => [spec.field, spec]));
    this.secrets = new Map(secrets.map((spec) => [spec.field, spec])); this.drafts = new Map();
    this.state = { dirty: false, invalid: false, saving: false, failed: false };
  }
  shell() { const snapshot = this.scope.getSnapshot(); return { available: snapshot.status === 'ready', writable: snapshot.writable, ...this.state }; }
  field(field) { return { text: this.drafts.get(field) ?? this.specs.get(field)?.format(this.scope.getSnapshot().value?.[field]) ?? '', invalid: false, overridden: false }; }
  bind(project) { let snapshot = project(); this.project = project; return this.store = { getSnapshot: () => snapshot, set: (value) => { snapshot = value; } }; }
  actions() { return {
    edit: (field, text) => { this.drafts.set(field, text); this.state.dirty = true; this.store.set(this.project()); },
    resetField: (field) => { this.drafts.set(field, this.specs.get(field).format(this.scope.getSnapshot().base?.[field])); this.state.dirty = true; this.store.set(this.project()); },
    discard: () => { this.drafts.clear(); this.state.dirty = false; this.store.set(this.project()); },
  }; }
  async save() {
    this.state.saving = true;
    const patch = {};
    for (const [field, text] of this.drafts) if (this.specs.has(field)) {
      const parsed = this.specs.get(field).parse(text);
      if (!parsed) { this.state.failed = true; this.state.saving = false; return; }
      patch[field] = parsed.kind === 'set' ? parsed.value : this.scope.getSnapshot().base[field];
    }
    if (Object.keys(patch).length && !this.scope.accept(patch)) { this.state.failed = true; this.state.saving = false; return; }
    for (const field of Object.keys(patch)) this.drafts.delete(field);
    for (const [field, spec] of this.secrets) if (this.drafts.has(field)) {
      if (!await spec.write(this.drafts.get(field))) { this.state.failed = true; this.state.saving = false; return; }
      this.drafts.delete(field);
    }
    this.state = { ...this.state, saving: false, failed: false, dirty: false }; this.store.set(this.project());
  }
  dispose() { this.disposed = true; }
}
const textSpec = (field) => ({ field, format: (value) => typeof value === 'string' ? value : '', parse: (text) => text.trim() ? { kind: 'set', value: text.trim() } : { kind: 'clear' } });
const numberSpec = (field) => ({ field, format: (value) => typeof value === 'number' ? String(value) : '', parse(text) { return !text.trim() ? { kind: 'clear' } : Number.isFinite(Number(text)) ? { kind: 'set', value: Number(text) } : undefined; } });
const component = () => null;
const primitives = { Button: component, Tag: component, SettingsForm: component, SettingsSecretField: component, SettingsValueField: component, SettingsFormModel: FormDouble, settingsTextField: textSpec, settingsNumberField: numberSpec };
const plain = (value) => JSON.parse(JSON.stringify(value));
const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function runtime({ fetch: fetcher = async () => ({ ok: true, json: async () => ({}) }) } = {}) {
  let registration; let clock = 100000; let timerId = 0;
  const timers = new Map(); const events = new Map(); const effects = [];
  const document = { visibilityState: 'visible', addEventListener: (name, fn) => events.set(name, fn), removeEventListener: (name) => events.delete(name) };
  const React = { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }), useSyncExternalStore: (_subscribe, snapshot) => snapshot() };
  class ClockDate extends Date { static now() { return clock; } }
  const context = { URL, Date: ClockDate, AbortController, React, document,
    fetch: fetcher, setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay, interval: false }); return timerId; },
    setInterval: (fn, delay) => { timers.set(++timerId, { fn, delay, interval: true }); return timerId; },
    clearTimeout: (id) => timers.delete(id), clearInterval: (id) => timers.delete(id),
    window: { __ModuleLoader__: { load: (value) => { registration = value; } } },
  };
  const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  new vm.Script(bundle, { filename: 'lib/client.js' }).runInNewContext(context);
  const client = registration.factory((name) => { if (name === 'react') return React; if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives; throw new Error(`Unexpected import ${name}`); });
  return { client, registration, timers, events, effects, document, setClock: (value) => { clock = value; },
    fire(delay) { for (const [id, timer] of [...timers]) if (timer.delay === delay) { if (!timer.interval) timers.delete(id); timer.fn(); } },
  };
}
function scopeOf(value = {}) {
  const base = { enabled: true, baseURL: 'https://fixture.invalid', adminKeyRef: 'SUB2API_ADMIN_KEY', accountId: '', refreshSeconds: 60, usageSource: 'auto' };
  let snapshot = { status: 'ready', writable: true, base, value: { ...base, ...value }, user: {}, revision: 1 };
  const listeners = new Set(); const writes = [];
  return { writes, listeners, getSnapshot: () => snapshot, subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    accept(patch) { if (this.reject) return false; writes.push(plain(patch)); snapshot = { ...snapshot, value: { ...snapshot.value, ...patch }, revision: snapshot.revision + 1 }; for (const listener of listeners) listener(); return true; },
  };
}
function settings(env, { configured = true, writable = true, describe, set } = {}) {
  const scope = scopeOf(); const writes = []; const keys = new Map(configured ? [['SUB2API_ADMIN_KEY', 'old-key']] : []);
  const ctx = { remote: { credentials: {
    async describe(refs) { return describe ? describe(refs) : { ok: true, value: Object.fromEntries(refs.map((ref) => [ref, { configured: keys.has(ref), writable }])) }; },
    async set(ref, text) { writes.push({ ref, text, acceptedRef: scope.getSnapshot().value.adminKeyRef }); if (set) return set(ref, text); keys.set(ref, text); return { ok: true }; },
  } } };
  const controller = new env.client.UsageSettingsController(scope, ctx, { invalidate() {} });
  return { controller, scope, writes, keys, ctx };
}
function strings(node) { if (node == null || node === false) return ''; if (typeof node !== 'object') return String(node); return (node.children ?? []).flat(Infinity).map(strings).join(' '); }
function walk(node, predicate) { if (!node || typeof node !== 'object') return []; return [...(predicate(node) ? [node] : []), ...(node.children ?? []).flat(Infinity).flatMap((child) => walk(child, predicate))]; }

const usage = { enabled: true, configured: true, accountId: '12', accountName: '测试账号', windows: { fiveHour: { remainingPercent: 42.5, resetAt: new Date(160000).toISOString() }, sevenDay: { remainingPercent: 0, resetAt: null } }, refreshSeconds: 60 };

test('generated classic factory exports client and registers only official slots', async () => {
  const env = runtime(); assert.equal(env.registration.id, 'dsh-sub2api-usage-view');
  assert.equal(env.client.name, 'sub2api-usage-view'); assert.deepEqual(plain(env.client.inject), ['slots', 'configForms', 'remote', 'remote.credentials']);
  const { scope, ctx } = settings(env); const registrations = []; const injected = []; const watched = []; const disposers = [];
  env.client.apply({ ...ctx, effect: (fn) => disposers.push(fn()), remote: { ...ctx.remote, $on: (event) => { assert.equal(event, 'credentials/reference-updated'); return () => {}; } },
    slots: { inject: (slot, fn) => { injected.push(slot); return fn(); }, register: (spec, view) => { registrations.push({ spec, view }); return () => {}; } },
    configForms: { get: (namespace) => { assert.equal(namespace, 'sub2api-usage-view'); return scope; }, whileServed: (namespaces, fn) => { watched.push(...namespaces); return fn(); } },
  });
  assert.deepEqual(injected, ['conversation.composer.dock', 'plugins.item']); assert.deepEqual(watched, ['sub2api-usage-view']);
  const dock = registrations[0]; assert.equal(dock.view, env.client.UsageDock); assert.equal(dock.spec.name, 'conversation.composer.dock');
  assert.equal(dock.spec.inject().store, dock.spec.inject().store); assert.equal(registrations[1].spec.label(), 'Sub2API 账号用量');
  for (const dispose of disposers.reverse()) dispose(); await settle(); assert.equal(env.timers.size, 0);
});

test('missing/invalid values remain unknown; zero is preserved; expired reset waits', () => {
  const { client } = runtime();
  for (const value of [undefined, null, '100', NaN, Infinity, -1, 101]) assert.equal(client.remainingPercent(value), null);
  assert.equal(client.remainingPercent(0), 0); assert.equal(client.countdown(null, 100000), '重置时间未知');
  assert.equal(client.countdown('bad', 100000), '重置时间未知'); assert.equal(client.countdown(new Date(99999).toISOString(), 100000), '等待刷新');
  assert.equal(client.countdown(new Date(3661000).toISOString(), 0), '01:01:01');
  assert.equal(client.countdown(new Date(90061000).toISOString(), 0), '1天 01:01:01');
  assert.equal(client.windowView({}, 100000).text, '未知'); assert.equal(client.windowView({ remainingPercent: 0 }, 100000).text, '0%');
});

test('session subscriptions deduplicate reads, ticker never fetches and final unmount cleans timers', async () => {
  const pending = deferred(); const calls = [];
  const env = runtime({ fetch: async (url, options) => { calls.push({ url, options }); return pending.promise; } });
  const store = new env.client.UsageStore(); const first = store.subscribe(() => {}); const second = store.subscribe(() => {});
  assert.equal(calls.length, 1); assert.equal(calls[0].options.credentials, 'same-origin'); assert.ok(calls[0].options.signal instanceof AbortSignal);
  env.fire(1000); env.fire(1000); assert.equal(calls.length, 1);
  pending.resolve({ ok: true, json: async () => usage }); await settle();
  assert.equal(store.getSnapshot().data.windows.sevenDay.remainingPercent, 0); assert.equal(env.timers.size, 2);
  first(); assert.equal(env.timers.size, 2); second(); await settle(); assert.equal(env.timers.size, 0); assert.equal(env.events.size, 0);
  store.dispose();
});

test('hidden page aborts requests and pauses timers; visible page resumes normal cached reads', async () => {
  const calls = []; const env = runtime({ fetch: (url, options) => { calls.push({ url, options }); return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))); } });
  const store = new env.client.UsageStore(); const off = store.subscribe(() => {});
  env.document.visibilityState = 'hidden'; env.events.get('visibilitychange')(); await settle();
  assert.equal(calls[0].options.signal.aborted, true); assert.equal(env.timers.size, 0); assert.equal(store.getSnapshot().loading, false);
  env.fire(60000); assert.equal(calls.length, 1);
  env.document.visibilityState = 'visible'; env.events.get('visibilitychange')(); assert.equal(calls.length, 2); assert.equal(calls[1].url, '/api/dsh-sub2api-usage-view/usage');
  off(); await settle(); assert.equal(env.timers.size, 0); store.dispose();
});

test('manual refresh only adds refresh=1, errors retain known values as stale', async () => {
  const calls = []; let fail = false;
  const env = runtime({ fetch: async (url) => { calls.push(url); if (fail) throw new Error('暂时离线'); return { ok: true, json: async () => usage }; } });
  const store = new env.client.UsageStore(); const off = store.subscribe(() => {}); await settle(); fail = true;
  await store.load(true); assert.equal(calls[1], '/api/dsh-sub2api-usage-view/usage?refresh=1');
  assert.equal(store.getSnapshot().data.windows.fiveHour.remainingPercent, 42.5); assert.equal(store.getSnapshot().data.stale, true);
  assert.equal(store.getSnapshot().error, '暂时离线'); off(); store.dispose();
});

test('request timeout aborts fetch and publishes a retryable message', async () => {
  const env = runtime({ fetch: (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))) });
  const store = new env.client.UsageStore(); const off = store.subscribe(() => {}); env.fire(40000); await settle();
  assert.equal(store.getSnapshot().loading, false); assert.match(store.getSnapshot().error, /超时/); off(); store.dispose();
});

test('expired window retains last known usage and UI exposes active-refresh warning and cooldown', () => {
  const env = runtime(); const store = new env.client.UsageStore();
  store.publish({ data: { ...usage, manualRefreshAvailableAt: new Date(205000).toISOString() }, now: 200000 });
  const view = env.client.UsageDock({ store }); const text = strings(view);
  assert.match(text, /42.5%/); assert.match(text, /等待刷新/); assert.match(text, /旧数据/); assert.match(text, /测试账号/);
  const refresh = walk(view, (node) => node.type === 'button')[0].props;
  assert.equal(refresh['aria-label'], '刷新账号用量');
  assert.equal(refresh.disabled, true);
  assert.match(refresh.title, /5 秒/);
  store.publish({ data: { ...usage, source: 'active', sampleTimeUnknown: true }, now: 200000 });
  const activeView = env.client.UsageDock({ store });
  assert.match(activeView.props.title, /上游未提供采集时间/);
  assert.match(walk(activeView, (node) => node.type === 'button')[0].props.title, /Codex 可能触发/);
  store.publish({ data: { enabled: true, configured: false } }); assert.match(strings(env.client.UsageDock({ store })), /插件设置/);
  store.publish({ data: { enabled: false } }); assert.equal(env.client.UsageDock({ store }), null); store.dispose();
});

test('stale partial response keeps same-account windows, but never another account', async () => {
  let data = usage; const env = runtime({ fetch: async () => ({ ok: true, json: async () => data }) });
  const store = new env.client.UsageStore(); const off = store.subscribe(() => {}); await settle();
  data = { accountId: '12', configured: true, stale: true, error: '读取失败' }; await store.load();
  assert.equal(store.getSnapshot().data.windows.fiveHour.remainingPercent, 42.5);
  data = { accountId: '13', configured: true, stale: true }; await store.load(); assert.equal(store.getSnapshot().data.windows.fiveHour.remainingPercent, null);
  await store.invalidate(); assert.equal(store.getSnapshot().data.windows.fiveHour.remainingPercent, null); off(); store.dispose();
});

test('settings field specs enforce numeric IDs, bounded refresh, boolean and source values', async () => {
  const env = runtime(); const { controller } = settings(env); await settle(); const specs = controller.form.specs;
  assert.deepEqual([...specs.keys()], ['enabled', 'baseURL', 'adminKeyRef', 'accountId', 'refreshSeconds', 'usageSource']);
  assert.equal(controller.form.secrets.has('adminKey'), true); assert.equal(specs.has('adminKey'), false);
  for (const invalid of ['29', '3601', '30.5', 'Infinity', 'NaN']) assert.equal(specs.get('refreshSeconds').parse(invalid), undefined);
  assert.equal(specs.get('refreshSeconds').parse('30').value, 30); assert.equal(specs.get('refreshSeconds').parse('3600').value, 3600);
  for (const invalid of ['abc', '0', '-1', '01', '1.5', '9007199254740992']) assert.equal(specs.get('accountId').parse(invalid), undefined);
  assert.equal(specs.get('accountId').parse('12').value, '12'); assert.equal(specs.get('accountId').parse('').kind, 'clear');
  assert.equal(specs.get('enabled').parse('false').value, false); assert.equal(specs.get('enabled').parse('yes'), undefined);
  assert.equal(specs.get('usageSource').parse('passive').value, 'passive'); assert.equal(specs.get('usageSource').parse('bad'), undefined);
  for (const invalid of ['file:///etc', 'https://user:pass@example.com', 'https://example.com?key=foo', 'https://example.com#foo']) assert.equal(specs.get('baseURL').parse(invalid), undefined);
  controller.dispose(); assert.equal(controller.scope.listeners.size, 0);
});

test('blank secret keeps credential; replacement follows accepted reference and clears only on success', async () => {
  const calls = []; const env = runtime({ fetch: async (url) => { calls.push(url); return { ok: true, json: async () => ({ accounts: [{ id: 7, name: '账号七', platform: 'claude', type: 'oauth' }] }) }; } });
  const { controller, writes, keys, scope } = settings(env); await settle();
  assert.equal(await controller.writeKey('  '), true); assert.deepEqual(writes, []);
  controller.edit('adminKeyRef', 'OTHER_REF'); await settle(); controller.edit('adminKey', ' new-key '); await controller.save();
  assert.deepEqual(writes, [{ ref: 'OTHER_REF', text: 'new-key', acceptedRef: 'OTHER_REF' }]);
  assert.equal(keys.get('SUB2API_ADMIN_KEY'), 'old-key'); assert.equal(controller.form.field('adminKey').text, ''); assert.equal(controller.saved, true);
  assert.deepEqual(scope.writes, [{ adminKeyRef: 'OTHER_REF' }]); assert.deepEqual(calls, ['/api/dsh-sub2api-usage-view/accounts']); assert.equal(controller.accounts[0].id, 7);
  controller.dispose(); assert.equal(env.timers.size, 0);
});

test('rejected config or secret save keeps typed secret and does not claim success', async () => {
  const env = runtime(); const { controller, scope, writes } = settings(env, { set: () => ({ ok: false }) }); await settle();
  controller.edit('adminKeyRef', 'OTHER_REF'); await settle(); controller.edit('adminKey', 'retained-key'); scope.reject = true; await controller.save();
  assert.equal(writes.length, 0); assert.equal(controller.form.field('adminKey').text, 'retained-key'); assert.equal(controller.saved, false);
  scope.reject = false; await controller.save(); assert.equal(writes.length, 1); assert.equal(controller.form.field('adminKey').text, 'retained-key'); assert.equal(controller.saved, false); controller.dispose();
});

test('credential metadata failure/read-only blocks writes; account draft cannot call backend until saved', async () => {
  for (const options of [{ writable: false }, { describe: () => ({ ok: false }) }]) {
    const env = runtime(); const { controller, writes } = settings(env, options); await settle();
    assert.equal(controller.store.getSnapshot().adminKeyWritable, false); assert.equal(await controller.writeKey('new-key'), false); assert.equal(writes.length, 0); controller.dispose();
  }
  const calls = []; const env = runtime({ fetch: async (url) => { calls.push(url); return { ok: true, json: async () => ({ accounts: [] }) }; } });
  const { controller } = settings(env); await settle(); controller.edit('baseURL', 'https://other.example'); await controller.loadAccounts(); assert.equal(calls.length, 0); controller.dispose();
});

test('disposed settings abort account load and ignore late credential reads', async () => {
  const pending = deferred(); let signal;
  const env = runtime({ fetch: async (_url, options) => { signal = options.signal; return pending.promise; } });
  const { controller } = settings(env); await settle(); const load = controller.loadAccounts(); assert.equal(controller.accountsLoading, true);
  controller.dispose(); assert.equal(signal.aborted, true); pending.resolve({ ok: true, json: async () => ({ accounts: [{ id: 1 }] }) }); await load;
  assert.equal(controller.accounts.length, 0); assert.equal(env.timers.size, 0);
});
