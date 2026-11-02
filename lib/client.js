// Generated from client.js by scripts/build-client.mjs.
window.__ModuleLoader__.load({
  id: "dsh-sub2api-usage-view",
  factory(require) {
const React = require("react");
const {
  Button, SettingsForm, SettingsFormModel, SettingsSecretField, SettingsValueField,
  Tag, settingsNumberField, settingsTextField,
} = require("@deepseek-ai/dsh-client-ui-primitives");

const name = 'sub2api-usage-view';
const inject = ['slots', 'configForms', 'remote', 'remote.credentials'];
const NS = 'sub2api-usage-view';
const DEFAULT_REF = 'SUB2API_ADMIN_KEY';
const API = '/api/dsh-sub2api-usage-view';
const h = React.createElement;

function remainingPercent(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function countdown(resetAt, now = Date.now()) {
  const end = typeof resetAt === 'string' ? Date.parse(resetAt) : NaN;
  if (!Number.isFinite(end)) return '重置时间未知';
  const seconds = Math.ceil((end - now) / 1000);
  if (seconds <= 0) return '等待刷新';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const rest = seconds % 60;
  return `${days ? `${days}天 ` : ''}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function windowView(value, now) {
  const percent = remainingPercent(value?.remainingPercent);
  const end = typeof value?.resetAt === 'string' ? Date.parse(value.resetAt) : NaN;
  return {
    percent, text: percent === null ? '未知' : `${Number(percent.toFixed(1))}%`,
    reset: countdown(value?.resetAt, now), expired: Number.isFinite(end) && end <= now,
  };
}

function refreshDelay(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(30, Math.min(3600, value)) * 1000 : 60000;
}

async function fetchJSON(url, controller, timeoutMs = 40000) {
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`请求失败（${response.status}）`);
    const result = await response.json();
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('服务返回的数据格式无效');
    return result;
  } finally {
    clearTimeout(timer);
  }
}

// One provider instance serves every session mount; only subscriptions own timers.
class UsageStore {
  constructor() {
    this.listeners = new Set();
    this.snapshot = { data: null, loading: false, error: null, now: Date.now() };
    this.inFlight = null;
    this.controller = null;
    this.generation = 0;
    this.disposed = false;
    this.lastAttempt = 0;
    this.onVisibility = () => {
      if (this.hidden()) this.suspend();
      else if (this.listeners.size) { this.startTicker(); void this.load(); }
    };
    this.getSnapshot = () => this.snapshot;
    this.subscribe = (listener) => {
      if (this.disposed) return () => {};
      this.listeners.add(listener);
      if (this.listeners.size === 1) {
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
        if (!this.hidden()) {
          this.startTicker();
          if (!this.snapshot.data || Date.now() - this.lastAttempt >= refreshDelay(this.snapshot.data.refreshSeconds)) void this.load();
          else this.schedule();
        }
      }
      return () => {
        this.listeners.delete(listener);
        if (!this.listeners.size) {
          this.suspend();
          if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
        }
      };
    };
  }

  hidden() { return typeof document !== 'undefined' && document.visibilityState === 'hidden'; }
  publish(patch) {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  startTicker() {
    if (this.tick) return;
    this.publish({ now: Date.now() });
    this.tick = setInterval(() => this.publish({ now: Date.now() }), 1000);
  }
  schedule() {
    clearTimeout(this.poll);
    if (!this.listeners.size || this.hidden() || this.disposed) return;
    const data = this.snapshot.data;
    if (data && (data.enabled === false || data.configured === false || !data.accountId)) return;
    this.poll = setTimeout(() => { this.poll = null; void this.load(); }, refreshDelay(data?.refreshSeconds));
  }
  suspend() {
    clearInterval(this.tick); this.tick = null;
    clearTimeout(this.poll); this.poll = null;
    this.generation += 1;
    this.controller?.abort(); this.controller = null; this.inFlight = null;
    this.publish({ loading: false });
  }
  invalidate() {
    // Config/account changes must never show an earlier account's numbers.
    this.suspend();
    this.lastAttempt = 0;
    this.publish({ data: null, error: null });
    if (this.listeners.size && !this.hidden()) { this.startTicker(); return this.load(); }
    return Promise.resolve();
  }
  load(refresh = false) {
    if (this.disposed || this.hidden() || !this.listeners.size) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    clearTimeout(this.poll); this.poll = null;
    const controller = new AbortController();
    const generation = ++this.generation;
    this.controller = controller;
    this.lastAttempt = Date.now();
    this.publish({ loading: true, error: null });
    const work = (async () => {
      try {
        const data = await fetchJSON(`${API}/usage${refresh ? '?refresh=1' : ''}`, controller);
        if (generation !== this.generation || this.disposed) return;
        if (data.windows !== undefined && (!data.windows || typeof data.windows !== 'object' || Array.isArray(data.windows))) throw new Error('服务返回的用量数据无效');
        const previous = this.snapshot.data;
        const sameAccount = previous && data.accountId != null && String(previous.accountId) === String(data.accountId);
        // A failed/partial refresh may omit windows: keep only this account's known values.
        const windows = {};
        for (const key of ['fiveHour', 'sevenDay']) {
          const incoming = data.windows?.[key];
          const retained = sameAccount ? previous.windows?.[key] : undefined;
          windows[key] = {
            remainingPercent: remainingPercent(incoming?.remainingPercent) ?? (data.stale || data.error ? remainingPercent(retained?.remainingPercent) : null),
            resetAt: typeof incoming?.resetAt === 'string' ? incoming.resetAt : (data.stale || data.error ? retained?.resetAt ?? null : null),
          };
        }
        this.publish({ data: { ...data, windows }, error: null, now: Date.now() });
      } catch (error) {
        if (generation !== this.generation || this.disposed) return;
        this.publish({ error: error?.name === 'AbortError' ? '请求超时，请稍后重试。' : error?.message || '暂时无法读取用量。', data: this.snapshot.data ? { ...this.snapshot.data, stale: true } : null });
      } finally {
        if (generation === this.generation && !this.disposed) {
          this.controller = null; this.inFlight = null;
          this.publish({ loading: false });
          this.schedule();
        }
      }
    })();
    this.inFlight = work;
    return work;
  }
  dispose() {
    if (this.disposed) return;
    this.suspend(); this.disposed = true;
    this.listeners.clear();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
  }
}

const dockCSS = `
.sub2api-usage{display:inline-flex;align-items:center;flex-wrap:wrap;gap:4px 10px;min-width:0;max-width:100%;box-sizing:border-box;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:20px;font-variant-numeric:tabular-nums}
.sub2api-usage__title{color:var(--dsw-alias-label-tertiary);font-size:10px;letter-spacing:.02em}
.sub2api-usage__window{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.sub2api-usage__value{font-weight:600;color:var(--dsw-alias-label-primary)}
.sub2api-usage__time{font-size:10px;color:var(--dsw-alias-label-tertiary)}
.sub2api-usage__bar{width:24px;height:3px;overflow:hidden;border-radius:4px;background:var(--dsw-alias-border-l3)}
.sub2api-usage__fill{display:block;height:100%;border-radius:inherit;background:var(--dsw-alias-state-business-primary,#7281db)}
.sub2api-usage__button{display:inline-flex;align-items:center;justify-content:center;width:23px;height:23px;flex:none;padding:2px;border:0;border-radius:var(--dsw-radius-md,6px);background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.sub2api-usage__button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.sub2api-usage__button:focus-visible,.sub2api-usage summary:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.sub2api-usage__button:disabled{opacity:.5;cursor:default}
.sub2api-usage details{min-width:0;max-width:100%}.sub2api-usage summary{cursor:pointer;color:var(--dsw-alias-label-tertiary)}
.sub2api-usage__details{max-width:380px;white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0;color:var(--dsw-alias-label-secondary)}
@media(max-width:520px){.sub2api-usage{gap:2px 7px}.sub2api-usage__bar{display:none}}
`;

function UsageDock({ store }) {
  const { data, loading, error, now } = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  if (data?.enabled === false) return null;
  const five = windowView(data?.windows?.fiveHour, now);
  const seven = windowView(data?.windows?.sevenDay, now);
  const stale = Boolean(data?.stale || error || five.expired || seven.expired);
  const prompt = data && (!data.configured || !data.accountId) ? '请在插件设置中填写服务地址、管理密钥并选择账号' : null;
  let fetched = '尚未获取';
  if (typeof data?.fetchedAt === 'string' && Number.isFinite(Date.parse(data.fetchedAt))) fetched = new Date(data.fetchedAt).toLocaleString('zh-CN');
  const observed = typeof data?.observedAt === 'string' && Number.isFinite(Date.parse(data.observedAt)) ? new Date(data.observedAt).toLocaleString('zh-CN') : null;
  const detail = [`账号：${data?.accountName || data?.accountId || '尚未选择'}${data?.platform ? ` · ${data.platform}` : ''}`, `上次获取：${fetched}`, observed ? `用量采集：${observed}` : '', stale ? '当前为旧数据，等待刷新。' : '', data?.error || error || ''].filter(Boolean).join('\n');
  const renderWindow = (label, view) => h('span', { className: 'sub2api-usage__window', key: label, 'aria-label': `${label}剩余${view.text}，${view.reset}` },
    h('span', null, label), h('span', { className: 'sub2api-usage__value' }, view.text),
    view.percent === null ? null : h('span', { className: 'sub2api-usage__bar', 'aria-hidden': true }, h('span', { className: 'sub2api-usage__fill', style: { width: `${view.percent}%` } })),
    h('span', { className: 'sub2api-usage__time' }, view.reset));
  return h('div', { className: 'sub2api-usage', role: 'group', 'aria-label': 'Sub2API 账号用量', 'aria-busy': loading, title: detail },
    h('style', null, dockCSS), h('span', { className: 'sub2api-usage__title' }, 'Sub2API'),
    prompt ? h('span', { role: 'status' }, prompt) : !data && loading ? h('span', { role: 'status' }, '正在读取用量…')
      : h(React.Fragment, null, renderWindow('5小时', five), renderWindow('7天', seven)),
    h('button', { type: 'button', className: 'sub2api-usage__button', disabled: loading, 'aria-label': '刷新账号用量', title: '刷新用量缓存', onClick: () => void store.load(true) },
      h('svg', { viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true },
        h('path', { d: 'M20 7v5h-5M4 17v-5h5M6.2 7a7 7 0 0 1 11.6-1L20 9M4 15l2.2 3A7 7 0 0 0 17.8 17', strokeLinecap: 'round', strokeLinejoin: 'round' }))),
    h('details', null, h('summary', { 'aria-label': '查看用量详情' }, error || data?.error ? '读取异常' : stale ? '旧数据' : '详情'), h('p', { className: 'sub2api-usage__details' }, detail)));
}

const fields = [
  { field: 'enabled', label: '显示账号用量', hint: '在输入框下方显示账号剩余额度。默认开启。', options: [['true', '开启'], ['false', '关闭']] },
  { field: 'baseURL', label: 'Sub2API 地址', hint: '必填：填写你自己的 Sub2API 服务地址，不带账号密码、查询参数或片段。' },
  { field: 'adminKeyRef', label: '管理密钥凭据名称', hint: '默认 SUB2API_ADMIN_KEY。密钥仅通过 DSH 凭据存储保存。' },
  { field: 'accountId', label: '账号 ID', hint: '可从下方账号列表选择，或直接填写数字 ID。留空时提示先选择账号。' },
  { field: 'refreshSeconds', label: '刷新间隔（秒）', hint: '默认 60 秒，范围 30–3600 秒。倒计时每秒在本地更新，隐藏页面时暂停请求。', numeric: true },
  { field: 'usageSource', label: '用量来源', hint: '自动读取已采集的账号快照。主动模式可能触发上游用量探测，Claude 被动模式读取被动采集数据。', options: [['auto', '自动（读取已采集快照，推荐）'], ['active', '主动（可能触发上游用量探测）'], ['passive', 'Claude 被动']] },
];
const formStyle = {
  field: { display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 0' },
  heading: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: 13, color: 'var(--dsw-alias-label-primary)' },
  hint: { margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--dsw-alias-label-tertiary)' },
  select: { width: '100%', minHeight: 34, boxSizing: 'border-box', padding: '0 10px', borderRadius: 'var(--dsw-radius-md,8px)', border: '.5px solid var(--dsw-alias-border-l4)', background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: 13 },
};
function textField(field, valid) {
  const spec = settingsTextField(field);
  return { ...spec, parse(text) { const parsed = spec.parse(text); return parsed?.kind === 'clear' || parsed?.kind === 'set' && valid(parsed.value) ? parsed : undefined; } };
}
function fieldSpecs() {
  const number = settingsNumberField('refreshSeconds');
  return [
    { field: 'enabled', format: (value) => typeof value === 'boolean' ? String(value) : '', parse(text) { const value = text.trim(); return !value ? { kind: 'clear' } : ['true', 'false'].includes(value) ? { kind: 'set', value: value === 'true' } : undefined; } },
    textField('baseURL', (value) => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash; } catch { return false; } }),
    textField('adminKeyRef', (value) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)),
    textField('accountId', (value) => /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))),
    { ...number, parse(text) { const parsed = number.parse(text); return parsed?.kind === 'clear' || parsed?.kind === 'set' && Number.isSafeInteger(parsed.value) && parsed.value >= 30 && parsed.value <= 3600 ? parsed : undefined; } },
    textField('usageSource', (value) => ['auto', 'active', 'passive'].includes(value)),
  ];
}
function savedRef(snapshot) { return snapshot.value?.adminKeyRef?.trim() || DEFAULT_REF; }

function UsageSettingsCard(props) {
  const state = props.useSub2apiUsageCard((snapshot) => snapshot);
  if (props.view === 'summary') return '设置 Sub2API 管理密钥、账号与用量刷新方式。';
  const disabled = !state.writable || state.saving;
  return h(SettingsForm, { state, labels: { unavailable: '插件当前未加载，暂时无法配置。', readOnly: '本部署的设置为只读。', saveFailed: '保存未完成，已保留输入，请检查设置或密钥状态后重试。', save: '保存', saving: '保存中…' }, onSave: props.save, onDiscard: props.discard },
    h(SettingsSecretField, { id: 'sub2api-admin-key', label: '管理密钥', hint: `留空保留当前密钥；填写新密钥后点击保存替换。当前引用：${state.credentialRef}。`, disabled: !state.adminKeyWritable, text: state.adminKey.text, configured: state.adminKeyConfigured,
      stateLabel: state.credentialLoading ? '正在读取密钥状态…' : state.credentialFailed ? '密钥状态读取失败' : state.adminKeyConfigured ? '已配置密钥' : '尚未配置密钥', onEdit: (text) => props.edit('adminKey', text) }),
    state.credentialFailed ? h('div', { style: formStyle.field, role: 'status' }, h('p', { style: formStyle.hint }, '无法确认密钥状态，请先重试。'), h(Button, { variant: 'ghost', size: 'sm', disabled: state.saving, onClick: props.retryCredential }, '重试密钥状态'))
      : !state.credentialLoading && !state.credentialWritable ? h('p', { role: 'status', style: formStyle.hint }, '当前密钥来源为只读，无法在这里替换。') : null,
    ...fields.map((definition) => {
      const value = state[definition.field];
      const id = `sub2api-config-${definition.field}`;
      return definition.options ? h('div', { key: definition.field, style: formStyle.field },
        h('div', { style: formStyle.heading }, h('label', { htmlFor: id }, definition.label), value.overridden ? h('span', null, h(Tag, { tone: 'neutral' }, '已覆盖'), h(Button, { variant: 'ghost', size: 'sm', disabled, onClick: () => props.resetField(definition.field) }, '恢复默认')) : null),
        h('select', { id, disabled, value: value.text, style: formStyle.select, 'aria-describedby': `${id}-hint`, 'aria-invalid': value.invalid || undefined, onChange: (event) => props.edit(definition.field, event.target.value) }, h('option', { value: '' }, '使用默认值'), ...definition.options.map(([key, label]) => h('option', { key, value: key }, label))),
        h('p', { id: `${id}-hint`, style: formStyle.hint }, value.invalid ? '请选择有效选项。' : definition.hint))
        : h(SettingsValueField, { key: definition.field, id, label: definition.label, hint: definition.hint, numeric: definition.numeric, ...value, disabled, overriddenLabel: '已覆盖', resetLabel: '恢复默认', invalidLabel: definition.field === 'refreshSeconds' ? '请填写 30–3600 之间的整数。' : definition.field === 'accountId' ? '请填写数字账号 ID，或留空。' : '请填写有效值。', onEdit: (text) => props.edit(definition.field, text), onReset: () => props.resetField(definition.field) });
    }),
    h('div', { style: formStyle.field }, h('div', { style: formStyle.heading }, h('label', { htmlFor: 'sub2api-account-picker' }, '选择账号'), h(Button, { variant: 'ghost', size: 'sm', disabled: state.accountsLoading || !state.canLoadAccounts || state.saving, onClick: props.loadAccounts }, state.accountsLoading ? '读取中…' : '读取账号列表')),
      h('select', { id: 'sub2api-account-picker', style: formStyle.select, disabled: disabled || !state.canLoadAccounts || state.accountsLoading, value: state.accounts.some((account) => String(account.id) === state.accountId.text) ? state.accountId.text : '', 'aria-describedby': 'sub2api-account-picker-hint', onChange: (event) => { if (event.target.value) props.edit('accountId', event.target.value); } },
        h('option', { value: '' }, '选择账号（也可手填 ID）'), ...state.accounts.map((account) => h('option', { key: String(account.id), value: String(account.id) }, `${account.name || account.id}${account.platform ? ` · ${account.platform}` : ''}${account.type ? ` · ${account.type}` : ''}`))),
      h('p', { id: 'sub2api-account-picker-hint', style: formStyle.hint, role: state.accountsError ? 'status' : undefined }, state.accountsError || (!state.canLoadAccounts ? '请先保存管理密钥、凭据名称及接口地址，再读取账号列表。' : !state.accounts.length && !state.accountsLoading ? '尚无账号列表，可点击读取或手填账号 ID。' : '选择账号后点击保存。'))),
    state.saved ? h('p', { role: 'status', style: formStyle.hint }, '已保存。') : null);
}

class UsageSettingsController {
  constructor(scope, ctx, usage) {
    this.scope = scope; this.ctx = ctx; this.usage = usage;
    this.disposed = false; this.readGeneration = 0; this.saved = false;
    this.credential = { ref: '', configured: false, writable: false, loading: true, failed: false };
    this.accounts = []; this.accountsLoading = false; this.accountsError = null;
    this.form = new SettingsFormModel(scope, fieldSpecs(), [{ field: 'adminKey', write: (text) => this.writeKey(text) }]);
    this.store = this.form.bind(() => this.projection());
    this.actions = this.form.actions();
    this.configSignature = this.signature();
    this.unsubscribe = scope.subscribe(() => {
      const signature = this.signature();
      if (signature !== this.configSignature) {
        this.configSignature = signature; this.clearAccounts(); void this.usage?.invalidate();
      }
      void this.readCredential();
    });
    void this.readCredential();
  }
  signature() { return JSON.stringify(this.scope.getSnapshot().value); }
  projection() {
    const shell = this.form.shell();
    return { ...shell, ...Object.fromEntries(fields.map(({ field }) => [field, this.form.field(field)])), adminKey: this.form.field('adminKey'),
      adminKeyConfigured: this.credential.configured, adminKeyWritable: shell.available && shell.writable && !shell.saving && this.credential.writable && !this.credential.loading && !this.credential.failed,
      credentialRef: this.credential.ref || DEFAULT_REF, credentialLoading: this.credential.loading, credentialFailed: this.credential.failed, credentialWritable: this.credential.writable,
      accounts: this.accounts, accountsLoading: this.accountsLoading, accountsError: this.accountsError, canLoadAccounts: this.canLoadAccounts(), saved: this.saved };
  }
  publish() { if (!this.disposed) this.store.set(this.projection()); }
  draftRef() { return this.form.field('adminKeyRef').text.trim() || this.scope.getSnapshot().base?.adminKeyRef?.trim() || DEFAULT_REF; }
  canLoadAccounts() {
    const snapshot = this.scope.getSnapshot();
    const draftURL = this.form.field('baseURL').text.trim() || snapshot.base?.baseURL || '';
    return Boolean(draftURL) && snapshot.status === 'ready' && this.credential.configured && !this.credential.loading && !this.credential.failed && savedRef(snapshot) === this.draftRef() && draftURL === (snapshot.value?.baseURL || '');
  }
  async readCredential() {
    if (this.disposed) return false;
    const ref = this.draftRef(); const generation = ++this.readGeneration;
    this.credential = { ref, configured: ref === this.credential.ref && this.credential.configured, writable: false, loading: true, failed: false }; this.publish();
    try {
      const response = await this.ctx.remote.credentials.describe([ref]);
      if (this.disposed || generation !== this.readGeneration || ref !== this.draftRef()) return false;
      const value = response.ok ? response.value?.[ref] : null;
      if (!value || typeof value.configured !== 'boolean' || typeof value.writable !== 'boolean') throw new Error('凭据状态无效');
      this.credential = { ref, configured: value.configured, writable: value.writable, loading: false, failed: false }; this.publish(); return true;
    } catch {
      if (!this.disposed && generation === this.readGeneration) { this.credential = { ...this.credential, writable: false, loading: false, failed: true }; this.publish(); }
      return false;
    }
  }
  async writeKey(value) {
    const text = value.trim(); if (!text) return true;
    const snapshot = this.scope.getSnapshot();
    if (this.disposed || snapshot.status !== 'ready' || !snapshot.writable) return false;
    // The official model commits settings first. Only the accepted ref may receive a secret.
    const ref = savedRef(snapshot);
    if (ref !== this.draftRef() || !await this.readCredential() || !this.credential.writable) return false;
    try {
      const response = await this.ctx.remote.credentials.set(ref, text);
      if (!response.ok) return false;
      return await this.readCredential() && this.credential.ref === ref && this.credential.configured;
    } catch { return false; }
  }
  edit(field, text) {
    const state = this.projection();
    if (this.disposed || !state.available || !state.writable || state.saving || field === 'adminKey' && !state.adminKeyWritable) return;
    this.saved = false; this.actions.edit(field, text);
    if (field === 'adminKeyRef') { this.clearAccounts(); void this.readCredential(); }
    if (field === 'baseURL') this.clearAccounts();
  }
  resetField(field) {
    const state = this.form.shell(); if (this.disposed || !state.available || !state.writable || state.saving) return;
    this.saved = false; this.actions.resetField(field);
    if (field === 'adminKeyRef') { this.clearAccounts(); void this.readCredential(); }
    if (field === 'baseURL') this.clearAccounts();
  }
  clearAccounts() { this.accountAbort?.abort(); this.accountAbort = null; this.accounts = []; this.accountsLoading = false; this.accountsError = null; this.publish(); }
  async loadAccounts() {
    if (this.disposed || !this.canLoadAccounts() || this.accountsLoading) return;
    const controller = new AbortController(); this.accountAbort = controller;
    this.accountsLoading = true; this.accountsError = null; this.publish();
    try {
      const data = await fetchJSON(`${API}/accounts`, controller, 60000);
      if (this.disposed || this.accountAbort !== controller) return;
      if (!Array.isArray(data.accounts)) throw new Error('账号列表格式无效');
      this.accounts = data.accounts.filter((account) => account && /^[1-9]\d*$/.test(String(account.id)) && Number.isSafeInteger(Number(account.id)));
      this.accountsError = typeof data.error === 'string' ? data.error : null;
    } catch (error) {
      if (!this.disposed && this.accountAbort === controller) this.accountsError = error?.name === 'AbortError' ? '读取账号超时，请重试。' : error?.message || '读取账号失败，请重试。';
    } finally {
      if (!this.disposed && this.accountAbort === controller) { this.accountAbort = null; this.accountsLoading = false; this.publish(); }
    }
  }
  async save() {
    const before = this.form.shell(); if (this.disposed || !before.available || !before.writable || !before.dirty || before.invalid || before.saving) return;
    this.saved = false; await this.form.save(); if (this.disposed) return;
    const after = this.form.shell(); this.saved = !after.failed && !after.dirty; this.publish();
    if (this.saved) { void this.usage?.invalidate(); await this.readCredential(); await this.loadAccounts(); }
  }
  discard() { if (this.disposed) return; this.saved = false; this.actions.discard(); this.clearAccounts(); void this.readCredential(); }
  refreshCredential(ref) { if (ref === this.draftRef()) { this.clearAccounts(); void this.readCredential(); void this.usage?.invalidate(); } }
  inject() { return { hooks: { sub2apiUsageCard: this.store }, edit: (field, text) => this.edit(field, text), resetField: (field) => this.resetField(field), save: () => this.save(), discard: () => this.discard(), retryCredential: () => this.readCredential(), loadAccounts: () => this.loadAccounts() }; }
  dispose() { if (this.disposed) return; this.disposed = true; this.readGeneration += 1; this.accountAbort?.abort(); this.actions.discard(); this.unsubscribe(); this.form.dispose(); }
}

function apply(ctx) {
  const usage = new UsageStore();
  const card = new UsageSettingsController(ctx.configForms.get(NS), ctx, usage);
  ctx.effect(() => () => { card.dispose(); usage.dispose(); }, `${NS}: 状态清理`);
  ctx.effect(() => ctx.remote.$on('credentials/reference-updated', (ref) => card.refreshCredential(ref)), `${NS}: 凭据更新`);
  ctx.effect(() => ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({ name: 'conversation.composer.dock', id: NS, order: 40, inject: () => ({ store: usage }) }, UsageDock)), `${NS}: 输入框用量`);
  ctx.effect(() => ctx.configForms.whileServed([NS], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({ name: 'plugins.item', id: NS, order: 42, label: () => 'Sub2API 账号用量', inject: () => card.inject() }, UsageSettingsCard))), `${NS}: 设置卡片`);
}

    return { name, inject, remainingPercent, countdown, windowView, UsageStore, UsageDock, UsageSettingsCard, UsageSettingsController, apply };
  }
});
