import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';

const require = createRequire(import.meta.url);
const PRIMITIVES = '@deepseek-ai/dsh-client-ui-primitives';
const manifest = JSON.parse(readFileSync(require.resolve(`${PRIMITIVES}/package.json`), 'utf8'));
const plain = (value) => JSON.parse(JSON.stringify(value));

function observableAdapter(initial) {
  let snapshot = initial;
  const listeners = new Set();
  return { getSnapshot: () => snapshot, set(value) { snapshot = value; for (const listener of listeners) listener(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
}
function publishedRegion(source, path) {
  const marker = `//#region lib/types/${path}.js`;
  const start = source.indexOf(marker); assert.notEqual(start, -1, `Published SDK region exists: ${path}`);
  const end = source.indexOf('//#endregion', start); assert.notEqual(end, -1, `Published SDK region ends: ${path}`);
  return source.slice(start + marker.length, end);
}
async function loadPrimitives() {
  try { return { module: await import(PRIMITIVES), mode: 'actual package exports' }; }
  catch (error) {
    // The published browser entry imports CSS and browser-only dependencies.
    // Execute the exact installed settings regions; no parser, planner, save or
    // secret-field implementation is re-created by this test.
    assert.ok(['ERR_MODULE_NOT_FOUND', 'ERR_UNKNOWN_FILE_EXTENSION'].includes(error.code), `Unexpected SDK import error ${error.code}: ${error.message}`);
    const source = readFileSync(require.resolve(PRIMITIVES), 'utf8');
    const paths = ['Button', 'Tag', 'settings-form/SettingsForm', 'settings-form/fields', 'settings-form/form-model'];
    const module = new vm.Script(`${paths.map((path) => publishedRegion(source, path)).join('\n')}\n;({ Button, Tag, SettingsForm, SettingsSecretField, SettingsValueField, SettingsFormModel, settingsTextField, settingsNumberField });`, { filename: 'installed-sdk-settings-regions.js' })
      .runInNewContext({ ...React, ...jsxRuntime, createSnapshotStore: observableAdapter });
    return { module, mode: `exact installed browser SDK regions (${error.code})` };
  }
}
const loaded = await loadPrimitives();
let registration;
const fetches = [];
new vm.Script(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), { filename: 'lib/client.js' }).runInNewContext({
  URL, AbortController, setTimeout, clearTimeout,
  fetch: async (url) => { fetches.push(url); return { ok: true, json: async () => ({ accounts: [{ id: 12, name: '测试账号', platform: 'openai', type: 'oauth' }] }) }; },
  window: { __ModuleLoader__: { load(value) { registration = value; } } },
});
assert.equal(registration.id, 'dsh-sub2api-usage-view');
const client = registration.factory((specifier) => {
  if (specifier === 'react') return React;
  if (specifier === PRIMITIVES) return loaded.module;
  throw new Error(`Unexpected factory dependency: ${specifier}`);
});
const REF_A = 'SUB2API_ADMIN_KEY';
const REF_B = 'SUB2API_SECOND_ADMIN_KEY';
function createScope() {
  const base = { enabled: true, baseURL: 'https://fixture.invalid', adminKeyRef: REF_A, accountId: '', refreshSeconds: 60, usageSource: 'auto' };
  const store = observableAdapter({ status: 'ready', writable: true, revision: 10, base, user: {}, value: { ...base } });
  const mutations = []; const events = []; let rejectNext = false;
  return { getSnapshot: store.getSnapshot, subscribe: store.subscribe, mutations, events,
    rejectNext() { rejectNext = true; },
    externalUpdate(patch) { const snapshot = store.getSnapshot(); const user = { ...snapshot.user, ...patch }; store.set({ ...snapshot, revision: snapshot.revision + 1, user, value: { ...base, ...user } }); },
    async mutate(ops, expectedRevision) {
      const snapshot = store.getSnapshot(); mutations.push({ ops: plain(ops), expectedRevision }); events.push({ kind: 'config', expectedRevision });
      if (rejectNext || expectedRevision !== snapshot.revision) { rejectNext = false; return false; }
      const user = { ...snapshot.user };
      for (const op of ops) {
        assert.equal(op.path.length, 1); assert.notEqual(op.path[0], 'adminKey', 'Secret text must never enter config mutation');
        if (op.op === 'set') user[op.path[0]] = op.value;
        else if (op.op === 'unset') delete user[op.path[0]];
        else assert.fail(`Unknown config op ${op.op}`);
      }
      store.set({ ...snapshot, revision: snapshot.revision + 1, user, value: { ...base, ...user } }); return true;
    },
  };
}
async function setup(t) {
  const scope = createScope(); const keys = new Map([[REF_A, 'fixture-old-key']]); const writes = [];
  let failNext = false; let throwNext = false;
  const ctx = { remote: { credentials: {
    async describe(refs) { return { ok: true, value: Object.fromEntries(refs.map((ref) => [ref, { configured: keys.has(ref), writable: true }])) }; },
    async set(ref, text) {
      writes.push({ ref, text, acceptedRef: scope.getSnapshot().value.adminKeyRef }); scope.events.push({ kind: 'key', ref });
      if (throwNext) { throwNext = false; throw new Error('fixture transport failure'); }
      if (failNext) { failNext = false; return { ok: false }; }
      keys.set(ref, text); return { ok: true };
    },
  } } };
  let invalidations = 0;
  const controller = new client.UsageSettingsController(scope, ctx, { invalidate() { invalidations++; } });
  t.after(() => controller.dispose()); await controller.readCredential();
  return { controller, scope, keys, writes, invalidations: () => invalidations, failNextKey: () => { failNext = true; }, throwNextKey: () => { throwNext = true; } };
}

test('classic factory runs installed SettingsFormModel with real React', async (t) => {
  t.diagnostic(`SDK ${manifest.version}: ${loaded.mode}; scope and credential RPC are test fixtures, DOM is outside this test.`);
  assert.equal(manifest.version, '0.2.2-rc.1');
  const { controller } = await setup(t);
  assert.ok(controller.form instanceof loaded.module.SettingsFormModel);
  assert.equal(controller.form.shell().available, true); assert.equal(controller.store.getSnapshot().adminKeyConfigured, true);
  assert.equal(typeof React.createElement, 'function');
});

test('real SDK batches typed config fields into one revision-fenced save', async (t) => {
  const { controller, scope, writes } = await setup(t);
  controller.edit('enabled', 'false'); controller.edit('accountId', '12'); controller.edit('refreshSeconds', '120'); controller.edit('usageSource', 'passive');
  assert.equal(scope.mutations.length, 0); await controller.save();
  assert.deepEqual(scope.mutations, [{ expectedRevision: 10, ops: [
    { op: 'set', path: ['enabled'], value: false }, { op: 'set', path: ['accountId'], value: '12' },
    { op: 'set', path: ['refreshSeconds'], value: 120 }, { op: 'set', path: ['usageSource'], value: 'passive' },
  ] }]);
  assert.equal(scope.getSnapshot().revision, 11); assert.equal(controller.form.shell().dirty, false);
  assert.equal(controller.store.getSnapshot().saved, true); assert.deepEqual(writes, []);
});

test('simultaneous reference + key saves config first and writes only accepted new reference', async (t) => {
  const { controller, scope, writes, keys } = await setup(t);
  controller.edit('adminKeyRef', REF_B); await controller.readCredential(); controller.edit('adminKey', '  fixture-new-key  '); await controller.save();
  assert.deepEqual(scope.mutations, [{ expectedRevision: 10, ops: [{ op: 'set', path: ['adminKeyRef'], value: REF_B }] }]);
  assert.deepEqual(writes, [{ ref: REF_B, text: 'fixture-new-key', acceptedRef: REF_B }]);
  assert.deepEqual(scope.events.map(({ kind }) => kind), ['config', 'key']); assert.equal(keys.get(REF_A), 'fixture-old-key');
  assert.equal(keys.get(REF_B), 'fixture-new-key'); assert.equal(controller.store.getSnapshot().adminKey.text, '');
  assert.equal(controller.form.shell().dirty, false); assert.equal(controller.store.getSnapshot().saved, true);
  assert.equal(controller.accounts[0].id, 12, 'Account picker loads only after accepted save');
});

test('rejected settings save preserves both drafts and performs no credential write', async (t) => {
  const { controller, scope, writes } = await setup(t);
  controller.edit('adminKeyRef', REF_B); await controller.readCredential(); controller.edit('adminKey', 'fixture-retained'); scope.rejectNext(); await controller.save();
  assert.equal(scope.getSnapshot().revision, 10); assert.equal(scope.getSnapshot().value.adminKeyRef, REF_A); assert.deepEqual(writes, []);
  assert.equal(controller.form.shell().failed, true); assert.equal(controller.store.getSnapshot().adminKeyRef.text, REF_B);
  assert.equal(controller.store.getSnapshot().adminKey.text, 'fixture-retained'); assert.equal(controller.store.getSnapshot().saved, false);
  await controller.save(); assert.equal(writes.length, 1); assert.equal(controller.store.getSnapshot().saved, true);
});

test('concurrent external revision rejects stale edit fence before any secret write', async (t) => {
  const { controller, scope, writes } = await setup(t);
  controller.edit('adminKeyRef', REF_B); await controller.readCredential(); controller.edit('adminKey', 'fixture-conflict');
  scope.externalUpdate({ refreshSeconds: 180 }); await controller.readCredential(); await controller.save();
  assert.equal(scope.mutations[0].expectedRevision, 10); assert.equal(scope.getSnapshot().revision, 11);
  assert.equal(scope.getSnapshot().value.adminKeyRef, REF_A); assert.deepEqual(writes, []);
  assert.equal(controller.form.shell().failed, true); assert.equal(controller.store.getSnapshot().adminKey.text, 'fixture-conflict');
});

test('credential rejection after accepted config retains secret and retry skips already accepted config', async (t) => {
  const { controller, scope, writes, keys, failNextKey } = await setup(t);
  controller.edit('adminKeyRef', REF_B); await controller.readCredential(); controller.edit('adminKey', 'fixture-retry'); failNextKey(); await controller.save();
  assert.equal(scope.getSnapshot().value.adminKeyRef, REF_B); assert.equal(scope.getSnapshot().revision, 11); assert.equal(keys.has(REF_B), false);
  assert.equal(controller.form.shell().failed, true); assert.equal(controller.form.shell().dirty, true);
  assert.equal(controller.store.getSnapshot().adminKey.text, 'fixture-retry'); assert.equal(controller.store.getSnapshot().saved, false);
  await controller.save(); assert.equal(scope.mutations.length, 1); assert.equal(writes.length, 2); assert.equal(keys.get(REF_B), 'fixture-retry');
  assert.equal(controller.store.getSnapshot().adminKey.text, ''); assert.equal(controller.form.shell().failed, false); assert.equal(controller.store.getSnapshot().saved, true);
});

test('credential transport throw retains secret and clears it only after retry succeeds', async (t) => {
  const { controller, writes, throwNextKey } = await setup(t);
  controller.edit('adminKey', 'fixture-network-retry'); throwNextKey(); await controller.save();
  assert.equal(controller.form.shell().failed, true); assert.equal(controller.store.getSnapshot().adminKey.text, 'fixture-network-retry');
  await controller.save(); assert.equal(writes.length, 2); assert.equal(controller.form.shell().dirty, false); assert.equal(controller.store.getSnapshot().adminKey.text, '');
});

test('whitespace-only secret is no-op and existing key survives config save', async (t) => {
  const { controller, scope, writes, keys } = await setup(t);
  controller.edit('adminKey', '   '); assert.equal(controller.form.shell().dirty, false); await controller.save(); assert.deepEqual(scope.mutations, []);
  controller.edit('accountId', '12'); await controller.save(); assert.equal(scope.mutations.length, 1); assert.deepEqual(writes, []);
  assert.equal(keys.get(REF_A), 'fixture-old-key'); assert.equal(controller.store.getSnapshot().adminKey.text, '');
});

test('real SDK validation blocks invalid refresh and manual account ID before persistence', async (t) => {
  const { controller, scope, writes } = await setup(t);
  controller.edit('refreshSeconds', '29'); controller.edit('accountId', 'not-an-id'); controller.edit('adminKey', 'fixture-no-write');
  assert.equal(controller.form.shell().invalid, true); await controller.save(); assert.deepEqual(scope.mutations, []); assert.deepEqual(writes, []);
  assert.equal(controller.store.getSnapshot().adminKey.text, 'fixture-no-write'); controller.discard(); assert.equal(controller.form.shell().dirty, false);
  assert.equal(controller.store.getSnapshot().adminKey.text, '');
});
