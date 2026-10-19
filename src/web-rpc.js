// Browser transport for the settings panel.
//
// DSH 0.2.x client RPC posts a `client-request` envelope to
// `<channel>/<endpoint>` on the page origin, so a custom channel must be an
// HTTP route owned by this plugin. The route uses the host Connection service
// for authentication (`requestRejection`), answers loopback-only, and replies
// with the exact `server-response` envelope the browser caller validates.
import { RPC_CHANNEL } from './rpc.js';

const ENDPOINT_PATTERN = /^[A-Za-z0-9_$.-]+$/;
const BODY_MAX = 64 * 1024;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

/** The channel path served to the browser (`/tabellio-dsh`). */
export const ROUTE_PATH = RPC_CHANNEL;

/** Extract and validate the endpoint segment of `/tabellio-dsh/<endpoint>`. */
export function endpointOf(pathname) {
  const prefix = ROUTE_PATH + '/';
  if (!pathname.startsWith(prefix)) return undefined;
  const endpoint = pathname.slice(prefix.length);
  if (endpoint.split('/').some((seg) => seg === '' || seg === '.' || seg === '..' || !ENDPOINT_PATTERN.test(seg))) {
    return undefined;
  }
  return endpoint;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_MAX) {
        reject(new Error('payload too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function remoteIsLoopback(req) {
  const address = req.socket?.remoteAddress ?? '';
  return LOOPBACK.has(address.replace(/^::ffff:/, '::ffff:'));
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

/**
 * Mount the panel channel on the host web carrier. Returns a disposer, or null
 * when this host has no browser carrier (headless profiles keep the tools).
 *
 * `ctx` is the context that declares the `webServer` dependency (a
 * `ctx.inject(['webServer'], ...)` callback context, or a fake in tests); the
 * service is read as a property so no extra inject metadata is needed here.
 */
export function mountPanelRoute(ctx, handler) {
  const web = ctx?.webServer ?? (typeof ctx?.get === 'function' ? ctx.get('webServer') : undefined);
  if (!web?.register) return null;
  let connection;
  try {
    connection = ctx?.connection ?? (typeof ctx?.get === 'function' ? ctx.get('connection') : undefined);
  } catch {
    // `connection` is optional and may be unavailable during teardown.
    connection = undefined;
  }

  const route = async (req, res) => {
    try {
      await handleRoute(req, res);
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  };

  const handleRoute = async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' });
      res.end();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const endpoint = endpointOf(url.pathname);
    if (!endpoint) {
      sendJson(res, 404, { error: 'unknown endpoint' });
      return;
    }
    if (!remoteIsLoopback(req) && connection?.allowsRemoteAuthorities !== true) {
      res.writeHead(403);
      res.end();
      return;
    }
    // A browser request carries the page origin; refuse another site's page so
    // a random website cannot POST approvals into the local store. Non-browser
    // callers send no Origin header and stay governed by the loopback check.
    // When the carrier cannot report its own origin, fall back to comparing the
    // Origin host with the request Host header instead of trusting every site.
    const origin = req.headers?.origin;
    if (origin !== undefined) {
      const allowed = typeof web.getOrigin === 'function' ? web.getOrigin() : undefined;
      let sameOrigin = allowed !== undefined ? origin === allowed : false;
      if (allowed === undefined) {
        try {
          const parsed = new URL(origin);
          sameOrigin = (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === req.headers?.host;
        } catch {
          sameOrigin = false;
        }
      }
      if (!sameOrigin) {
        res.writeHead(403);
        res.end();
        return;
      }
    }
    const rejection = connection?.requestRejection?.({ headers: req.headers });
    if (rejection !== undefined) {
      res.writeHead(rejection);
      res.end();
      return;
    }

    let envelope;
    try {
      envelope = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { error: 'invalid JSON body' });
      return;
    }
    if (envelope?.type !== 'client-request' || typeof envelope.rpcId !== 'string' || envelope.method !== endpoint) {
      sendJson(res, 400, { error: 'invalid client-request envelope' });
      return;
    }

    const result = await handler(endpoint, envelope.payload);
    sendJson(res, 200, { type: 'server-response', rpcId: envelope.rpcId, result });
  };

  return web.register({ kind: 'prefix', path: ROUTE_PATH, handler: route });
}

/** Test helper: expose the loopback classifier without mounting a route. */
export function isLoopbackRequest(req) {
  return remoteIsLoopback(req);
}
