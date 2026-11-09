/** Read-only Sub2API account usage client. Secrets and raw accounts never leave the host. */
export function normalizeBaseURL(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('接口地址必须为不含用户名、密码或查询参数的 HTTP(S) 地址。');
  }
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/, '').replace(/\/v1$/, '');
  return url.href.replace(/\/+$/, '');
}

function timestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function normalizeWindow(window, observedAt = null) {
  const value = window?.utilization;
  const remainingPercent = typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.max(0, Math.min(100, 100 - value)) : null;
  let resetAt = timestamp(window?.resets_at);
  // Only a positive interval and an explicit sample timestamp can define a reset.
  if (!resetAt && timestamp(observedAt) && Number.isFinite(window?.remaining_seconds) && window.remaining_seconds > 0) {
    const epoch = Date.parse(observedAt) + window.remaining_seconds * 1000;
    if (Number.isFinite(epoch) && Math.abs(epoch) <= 8.64e15) resetAt = new Date(epoch).toISOString();
  }
  return { remainingPercent, resetAt };
}

export function normalizeSnapshot(account) {
  const extra = account.extra ?? {};
  if (account.platform === 'openai') {
    const observedAt = timestamp(extra.codex_usage_updated_at);
    let short = 'primary', long = 'secondary';
    const p = extra.codex_primary_window_minutes, s = extra.codex_secondary_window_minutes;
    if (typeof p === 'number' && p > 0 && typeof s === 'number' && s > 0) {
      if (p > s) [short, long] = [long, short];
    } else if (typeof p === 'number' && p > 0) {
      if (p > 360) [short, long] = [long, short];
    } else if (typeof s === 'number' && s > 0) {
      if (s <= 360) [short, long] = [long, short];
    } else [short, long] = [long, short];
    const window = (canonical, legacy) => {
      const field = `codex_${canonical}`;
      const hasCanonical = typeof extra[`${field}_used_percent`] === 'number';
      const prefix = hasCanonical ? field : `codex_${legacy}`;
      return normalizeWindow({ utilization: extra[`${prefix}_used_percent`], resets_at: extra[`${prefix}_reset_at`], remaining_seconds: extra[`${prefix}_reset_after_seconds`] }, observedAt);
    };
    return { fiveHour: window('5h', short), sevenDay: window('7d', long), observedAt };
  }
  const fraction = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value * 100 : undefined;
  const reset = extra.passive_usage_7d_reset;
  const resetTime = typeof reset === 'number' && reset > 0 && reset < 8.64e12 ? new Date(reset * 1000).toISOString() : null;
  return {
    fiveHour: normalizeWindow({ utilization: fraction(extra.session_window_utilization), resets_at: account.session_window_end }),
    sevenDay: normalizeWindow({ utilization: fraction(extra.passive_usage_7d_utilization), resets_at: resetTime }),
    observedAt: timestamp(extra.passive_usage_sampled_at),
  };
}

function publicError(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return '用量请求超时，请稍后重试。';
  if (error instanceof UsageError) return error.message;
  return '无法连接 sub2api，请检查服务地址、网络和证书。';
}

export class UsageError extends Error {}

export class UsageService {
  constructor({ resolveConfig, resolveKey, fetchImpl = globalThis.fetch, now = Date.now }) {
    this.resolveConfig = resolveConfig;
    this.resolveKey = resolveKey;
    this.fetch = fetchImpl;
    this.now = now;
    this.entries = new Map();
    this.disposed = false;
    this.controllers = new Set();
  }

  async context() {
    const config = this.resolveConfig();
    const refreshSeconds = Math.max(30, Math.min(3600, Number(config.refreshSeconds) || 60));
    const key = config.enabled === false ? '' : (await this.resolveKey(config.adminKeyRef))?.trim() || '';
    const accountId = String(config.accountId ?? '').trim();
    // The key participates in an in-memory cache identity, never a log or response.
    return { ...config, refreshSeconds, accountId, key, identity: JSON.stringify([config.baseURL, accountId, key, config.usageSource]) };
  }

  async request(ctx, endpoint) {
    if (this.disposed) throw new UsageError('插件已停止。');
    let base;
    try { base = normalizeBaseURL(ctx.baseURL); }
    catch { throw new UsageError('请填写有效的 sub2api 服务地址。'); }
    const controller = new AbortController();
    this.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 15_000);
    timeout.unref?.();
    try {
      const response = await this.fetch(`${base}/api/v1/admin/${endpoint}`, {
        method: 'GET', headers: { 'x-api-key': ctx.key, Accept: 'application/json' },
        signal: controller.signal, redirect: 'error',
      });
      if (response.status === 401 || response.status === 403) throw new UsageError('管理员密钥无效或没有管理员权限，请在插件设置中更新。');
      if (response.status === 404) throw new UsageError('未找到账号或管理接口，请检查服务地址和账号 ID。');
      if (response.status === 429) throw new UsageError('sub2api 请求过于频繁，请稍后刷新。');
      if (!response.ok) throw new UsageError(`sub2api 暂时不可用（HTTP ${response.status}）。`);
      const text = await readLimited(response, 2 * 1024 * 1024);
      let body;
      try { body = JSON.parse(text); } catch { throw new UsageError('sub2api 返回了非 JSON 数据，请检查服务地址。'); }
      if (body.code !== 0 || !body.data || typeof body.data !== 'object') throw new UsageError('sub2api 返回异常，请检查管理员权限和服务版本。');
      return body.data;
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(controller);
    }
  }

  async accounts() {
    try {
      const ctx = await this.context();
      if (!ctx.key) return { accounts: [], error: '请先保存 sub2api 管理员 API Key。' };
      const result = [];
      for (let page = 1; page <= 20; page++) {
        const data = await this.request(ctx, `accounts?page=${page}&page_size=100&lite=true`);
        if (!Array.isArray(data.items)) throw new UsageError('账号列表格式不受支持。');
        for (const a of data.items) {
          if (Number.isSafeInteger(a.id) && a.id > 0 && ['openai', 'anthropic'].includes(a.platform) && ['oauth', 'setup-token'].includes(a.type)) {
            result.push({ id: a.id, name: String(a.name ?? a.id).slice(0, 160), platform: a.platform, type: a.type });
          }
        }
        if (data.items.length < 100 || page >= data.pages || page * 100 >= data.total) return { accounts: result };
      }
      return { accounts: result, error: '仅显示前 2000 个账号；也可以直接填写账号 ID。' };
    } catch (error) { return { accounts: [], error: publicError(error) }; }
  }

  async usage({ refresh = false } = {}) {
    let ctx;
    try { ctx = await this.context(); }
    catch { return emptyResult({}, '无法读取本机凭据，请检查 DSH 凭据服务。'); }
    const empty = emptyResult(ctx);
    if (ctx.enabled === false) return empty;
    try { normalizeBaseURL(ctx.baseURL); }
    catch { return { ...empty, error: '请在插件设置中填写自己的 sub2api 服务地址。' }; }
    if (!ctx.key) return { ...empty, error: '请在插件设置中保存 sub2api 管理员 API Key。' };
    if (!/^[1-9]\d*$/.test(ctx.accountId) || !Number.isSafeInteger(Number(ctx.accountId))) return { ...empty, error: '请在插件设置中选择订阅账号。' };
    empty.configured = true;
    let entry = this.entries.get(ctx.identity);
    if (!entry) {
      // Clear older configuration/credential identities; never cross account boundaries.
      this.entries.clear();
      entry = { nextRead: 0, result: null, pending: null, manualAfter: 0 };
      this.entries.set(ctx.identity, entry);
    }
    if (entry.pending) return entry.pending;
    const manual = refresh && this.now() >= entry.manualAfter;
    if (!manual && this.now() < entry.nextRead && entry.result) return { ...entry.result, refreshSeconds: ctx.refreshSeconds };
    entry.manualAfter = this.now() + 10_000;
    entry.pending = this.load(ctx, empty, entry.result).then(result => {
      entry.result = result;
      entry.nextRead = this.now() + ctx.refreshSeconds * 1000;
      return result;
    }).finally(() => { entry.pending = null; });
    return entry.pending;
  }

  async load(ctx, empty, previous) {
    try {
      const account = await this.request(ctx, `accounts/${ctx.accountId}`);
      if (!['openai', 'anthropic'].includes(account.platform) || !['oauth', 'setup-token'].includes(account.type)) {
        throw new UsageError('该账号不是支持用量窗口的 Codex / Claude 订阅账号。');
      }
      const source = ['passive', 'active'].includes(ctx.usageSource) ? ctx.usageSource : 'snapshot';
      if (source === 'passive' && account.platform !== 'anthropic') throw new UsageError('Codex 账号不支持被动用量源，请选择自动或 active。');
      let fiveHour, sevenDay, observedAt;
      if (source === 'snapshot') {
        ({ fiveHour, sevenDay, observedAt } = normalizeSnapshot(account));
      } else {
        const data = await this.request(ctx, `accounts/${ctx.accountId}/usage?source=${source}`);
        if (data.error || data.error_code) throw new UsageError('sub2api 暂时无法读取此账号用量，请检查后台账号状态后重试。');
        // A live usage response carries its own sample time; the stored account
        // snapshot may be much older and would wrongly mark fresh windows stale.
        observedAt = timestamp(data.updated_at)
          ?? timestamp(account.platform === 'openai' ? account.extra?.codex_usage_updated_at : account.extra?.passive_usage_sampled_at);
        fiveHour = normalizeWindow(data.five_hour, observedAt);
        sevenDay = normalizeWindow(data.seven_day, observedAt);
      }
      const fetchedAt = new Date(this.now()).toISOString();
      const windows = { fiveHour, sevenDay };
      const hasAnyValue = [fiveHour, sevenDay].some(w => w.remainingPercent !== null);
      const stale = !hasAnyValue || !observedAt || Object.values(windows).some(w => w.resetAt && Date.parse(w.resetAt) <= this.now())
        || !!observedAt && this.now() - Date.parse(observedAt) > Math.max(ctx.refreshSeconds * 2000, 300_000);
      return { ...empty, configured: true, accountName: String(account.name ?? ctx.accountId).slice(0, 160), platform: account.platform,
        windows, fetchedAt, observedAt, source, stale, error: hasAnyValue ? null : 'sub2api 尚未采集到用量；请先使用该订阅账号发起一次请求。' };
    } catch (error) {
      return { ...(previous ?? empty), enabled: empty.enabled, configured: true, refreshSeconds: ctx.refreshSeconds, stale: true, error: publicError(error) };
    }
  }

  dispose() {
    this.disposed = true;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    this.entries.clear();
  }
}

function emptyResult(ctx, error = null) {
  return { enabled: ctx.enabled !== false, configured: false, accountId: ctx.accountId ?? '', accountName: '', platform: '',
    windows: { fiveHour: { remainingPercent: null, resetAt: null }, sevenDay: { remainingPercent: null, resetAt: null } },
    fetchedAt: null, observedAt: null, stale: false, error, refreshSeconds: ctx.refreshSeconds ?? 60 };
}

async function readLimited(response, maxBytes) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) throw new UsageError('sub2api 响应过大。');
    return text;
  }
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new UsageError('sub2api 响应过大。'); }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { reader.releaseLock(); }
}
