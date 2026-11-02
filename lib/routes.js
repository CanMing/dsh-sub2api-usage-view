import { isIP } from 'node:net';

/** Match the local DSH browser origin as well as its loopback peer. */
export function allowedRequest(req, origin) {
  const peer = req.socket?.remoteAddress;
  if (!(peer === '::1' || peer === '::ffff:127.0.0.1' || isIP(peer ?? '') === 4 && peer.startsWith('127.'))) return false;
  let host;
  try { host = new URL(`http://${req.headers.host}`); } catch { return false; }
  if (!['localhost', '[::1]'].includes(host.hostname) && !(isIP(host.hostname) === 4 && host.hostname.startsWith('127.'))) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  if (origin) {
    try { if (host.host !== new URL(origin).host) return false; } catch { return false; }
  }
  if (req.headers.origin) {
    try { if (new URL(req.headers.origin).origin !== new URL(origin ?? `http://${req.headers.host}`).origin) return false; } catch { return false; }
  }
  return true;
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}

export function createRoutes(service, getOrigin) {
  return ['usage', 'accounts'].map(kind => ({
    kind: 'exact', path: `/api/dsh-sub2api-usage-view/${kind}`,
    async handler(req, res) {
      if (!allowedRequest(req, getOrigin?.())) return json(res, 403, { error: '此插件仅供本机 DSH 界面访问。' });
      if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return json(res, 405, { error: '仅支持 GET。' }); }
      try {
        const refresh = new URL(req.url, 'http://localhost').searchParams.get('refresh') === '1';
        const data = kind === 'usage' ? await service.usage({ refresh }) : await service.accounts();
        return json(res, 200, data);
      } catch { return json(res, 500, { error: '用量插件暂时不可用，请重试。' }); }
    },
  }));
}
