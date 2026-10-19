// Browser transport tests: the route must authenticate, validate the
// client-request envelope, echo rpcId, and answer with server-response.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { endpointOf, mountPanelRoute } from '../src/web-rpc.js';

function fakeRes() {
  return {
    status: 0,
    headers: undefined,
    body: '',
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(chunk) {
      this.body = chunk ?? '';
    },
  };
}

function fakeReq({ method = 'POST', url = '/tabellio-dsh/status', headers = {}, body = undefined, remoteAddress = '127.0.0.1' } = {}) {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  stream.method = method;
  stream.url = url;
  stream.headers = headers;
  stream.socket = { remoteAddress };
  return stream;
}

async function settle(promise) {
  await promise;
  await new Promise((resolve) => setImmediate(resolve));
}

function mount({ rejection, allowsRemoteAuthorities = false, origin = 'http://127.0.0.1:57077' } = {}) {
  const captured = {};
  const web = {
    getOrigin: () => origin,
    register(route) {
      captured.route = route.handler;
      return () => {};
    },
  };
  const connection = {
    allowsRemoteAuthorities,
    requestRejection: () => rejection,
  };
  const ctx = {
    get(name) {
      if (name === 'webServer') return web;
      if (name === 'connection') return connection;
      return undefined;
    },
  };
  const handler = async (endpoint, payload) => ({ ok: true, value: { endpoint, payload } });
  const dispose = mountPanelRoute(ctx, handler);
  assert.equal(typeof dispose, 'function');
  return { route: captured.route };
}

test('endpointOf only accepts one safe segment under the channel', () => {
  assert.equal(endpointOf('/tabellio-dsh/status'), 'status');
  assert.equal(endpointOf('/tabellio-dsh/inbox.list'), 'inbox.list');
  assert.equal(endpointOf('/tabellio-dsh/'), undefined);
  assert.equal(endpointOf('/tabellio-dsh/a/b'), 'a/b');
  assert.equal(endpointOf('/tabellio-dsh/../x'), undefined);
  assert.equal(endpointOf('/other/status'), undefined);
});

test('route answers the exact server-response envelope', async () => {
  const { route } = mount();
  const req = fakeReq({ body: { type: 'client-request', rpcId: 'r-1', method: 'status', payload: { a: 1 } } });
  const res = fakeRes();
  await settle(route(req, res));
  assert.equal(res.status, 200);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.type, 'server-response');
  assert.equal(parsed.rpcId, 'r-1');
  assert.deepEqual(parsed.result, { ok: true, value: { endpoint: 'status', payload: { a: 1 } } });
});

test('route rejects wrong method, unknown endpoint, remote peers and failed auth', async () => {
  const { route } = mount({ rejection: 401 });
  const getRes = fakeRes();
  await settle(route(fakeReq({ method: 'GET' }), getRes));
  assert.equal(getRes.status, 405);

  const missing = fakeRes();
  await settle(route(fakeReq({ url: '/tabellio-dsh/' }), missing));
  assert.equal(missing.status, 404);

  const remote = fakeRes();
  await settle(route(fakeReq({ remoteAddress: '10.0.0.9' }), remote));
  assert.equal(remote.status, 403);

  const unauthorized = fakeRes();
  await settle(route(fakeReq({ body: { type: 'client-request', rpcId: 'r', method: 'status', payload: {} } }), unauthorized));
  assert.equal(unauthorized.status, 401);
});

test('route rejects malformed envelopes', async () => {
  const { route } = mount();
  const wrongType = fakeRes();
  await settle(route(fakeReq({ body: { type: 'nope', rpcId: 'r', method: 'status', payload: {} } }), wrongType));
  assert.equal(wrongType.status, 400);

  const wrongMethod = fakeRes();
  await settle(route(fakeReq({ body: { type: 'client-request', rpcId: 'r', method: 'inbox.list', payload: {} } }), wrongMethod));
  assert.equal(wrongMethod.status, 400);
});

test('route refuses a foreign page origin (CSRF from another site)', async () => {
  const { route } = mount();
  const res = fakeRes();
  await settle(
    route(
      fakeReq({
        headers: { origin: 'https://evil.example' },
        body: { type: 'client-request', rpcId: 'r', method: 'status', payload: {} },
      }),
      res,
    ),
  );
  assert.equal(res.status, 403);
});

test('mountPanelRoute reads webServer from a context that declares it', () => {
  const registered = [];
  const ctx = {
    webServer: {
      register(route) {
        registered.push(route);
        return () => {};
      },
    },
  };
  const dispose = mountPanelRoute(ctx, async () => ({ ok: true }));
  assert.equal(typeof dispose, 'function');
  assert.equal(registered.length, 1);
  assert.equal(registered[0].kind, 'prefix');
  assert.equal(registered[0].path, '/tabellio-dsh');
});

test('origin is checked against the Host header when the carrier has no getOrigin', async () => {
  const captured = {};
  const web = {
    register(route) {
      captured.route = route.handler;
      return () => {};
    },
  };
  const ctx = { webServer: web };
  const handler = async () => ({ ok: true, value: {} });
  assert.equal(typeof mountPanelRoute(ctx, handler), 'function');

  const envelope = { type: 'client-request', rpcId: 'r-9', method: 'status', payload: {} };
  const same = fakeRes();
  await settle(captured.route(fakeReq({ headers: { host: '127.0.0.1:57077', origin: 'http://127.0.0.1:57077' }, body: envelope }), same));
  assert.equal(same.status, 200);

  const foreign = fakeRes();
  await settle(captured.route(fakeReq({ headers: { host: '127.0.0.1:57077', origin: 'https://evil.example' }, body: envelope }), foreign));
  assert.equal(foreign.status, 403);

  const nullOrigin = fakeRes();
  await settle(captured.route(fakeReq({ headers: { host: '127.0.0.1:57077', origin: 'null' }, body: envelope }), nullOrigin));
  assert.equal(nullOrigin.status, 403);
});
