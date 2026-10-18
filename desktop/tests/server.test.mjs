import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createControlServer } from '../dist/server.js';
import { controlFixture, waitFor } from './helpers/control-fixture.mjs';

async function setup(t, options) {
  const fixture = controlFixture(options);
  const server = await createControlServer(fixture.controller, fixture.hdc);
  t.after(() => server.close());
  const post = (command, headers = {}) => fetch(server.url + '/api/session', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: server.url, ...headers }, body: JSON.stringify(command) });
  return { ...fixture, ...server, post };
}

test('bad_json_is_rejected', async (t) => {
  const { controller, url } = await setup(t);
  const before = controller.snapshot();
  const response = await fetch(url + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url }, body: '{broken' });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'INVALID_JSON');
  assert.equal(controller.snapshot().state, before.state);
  assert.equal(controller.snapshot().sessionId, before.sessionId);
});

test('unsupported_capability_cannot_start', async (t) => {
  const { post, command, controller } = await setup(t, { verified: false });
  assert.equal((await post(command)).status, 200);
  const response = await post({ type: 'start' });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'CAPABILITY_UNAVAILABLE');
  assert.equal(controller.snapshot().state, 'unknown');
});

test('unselected_target_cannot_start', async (t) => {
  const { post, command, controller } = await setup(t);
  const before = controller.snapshot();
  const response = await post({ ...command, targetId: '' });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'TARGET_REQUIRED');
  assert.deepEqual(controller.snapshot(), before);
});

test('foreign_origin_refused', async (t) => {
  const { post, command, url, controller } = await setup(t);
  for (const origin of ['https://foreign.example', 'null', url.replace('127.0.0.1', 'localhost')]) {
    const response = await post(command, { Origin: origin });
    assert.equal(response.status, 403);
    assert.equal(response.headers.has('Access-Control-Allow-Origin'), false);
  }
  assert.equal((await fetch(url + '/api/state', { headers: { Origin: 'https://foreign.example' } })).status, 403);
  assert.equal(controller.snapshot().sessionId, null);
});

test('requests_require_json_and_valid_commands_without_mutating_session', async (t) => {
  const { post, command, url, controller } = await setup(t);
  const before = controller.snapshot();
  assert.equal((await post(command, { 'Content-Type': 'text/plain' })).status, 415);
  for (const input of [null, [], { type: 'shell', args: 'anything' }, { ...command, settings: { ...command.settings, laps: 0 } },
    { ...command, route: { ...command.route, coordinateSystem: 'unknown' } }]) {
    assert.equal((await post(input)).status, 400);
    assert.deepEqual(controller.snapshot(), before);
  }
  assert.equal((await fetch(url + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
});

test('oversized_body_rejected_before_dispatch', async (t) => {
  const { url, controller } = await setup(t);
  const response = await fetch(url + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url },
    body: JSON.stringify({ type: 'start', padding: 'x'.repeat(300000) }) });
  assert.equal(response.status, 413);
  assert.equal(controller.snapshot().sessionId, null);
});

test('loopback_host_is_exact_and_static_files_are_allowlisted', async (t) => {
  const { url } = await setup(t);
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
  const response = await new Promise((done, reject) => {
    request(url + '/api/state', { headers: { Host: 'foreign.example' } }, (res) => { res.resume(); done(res); }).on('error', reject).end();
  });
  assert.equal(response.statusCode, 403);
  for (const path of ['/package.json', '/src/server.ts', '/%2e%2e/package.json', '/api/unknown']) assert.equal((await fetch(url + path)).status, 404);
  const html = await fetch(url);
  assert.equal(html.status, 200);
  assert.match(html.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  assert.match(html.headers.get('Content-Type'), /text\/html/);
  for (const path of ['/app.js', '/styles.css']) assert.equal((await fetch(url + path)).status, 200);
});

test('http_controls_schedule_output_and_keep_recovery_observation_separate', async (t) => {
  const { post, command, controller, device, url } = await setup(t);
  assert.deepEqual(await (await fetch(url + '/api/targets')).json(), { targets: ['synthetic-phone'] });
  assert.equal((await post(command)).status, 200);
  assert.equal((await post({ type: 'start' })).status, 200);
  await waitFor(() => controller.snapshot().sent !== null);
  assert.equal((await post({ type: 'pause' })).status, 200);
  assert.equal((await (await fetch(url + '/api/state')).json()).state, 'paused');
  assert.equal((await post({ type: 'resume' })).status, 200);
  const response = await post({ type: 'stop' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).state, 'recovery_required');
  const count = device.samples.length;
  await waitFor(() => controller.snapshot().state === 'stopped');
  assert.equal(device.samples.length, count);
  assert.equal(controller.snapshot().observed.latitude, 0.01);
  assert.equal(controller.snapshot().sent.sample.latitude, 0);
});

test('disconnected_target_and_cleanup_failure_remain_actionable_over_http', async (t) => {
  const { post, command, controller, device } = await setup(t);
  device.connected = false;
  const failed = await post(command);
  assert.equal(failed.status, 409);
  assert.match((await failed.json()).message, /USB/);
  device.connected = true;
  await post(command); await post({ type: 'start' });
  device.stopAccepted = false;
  const response = await post({ type: 'stop' });
  const state = await response.json();
  assert.equal(state.state, 'recovery_required');
  assert.match(state.lastError.message, /201/);
  assert.equal((await post({ type: 'start' })).status, 409);
  assert.equal(controller.snapshot().state, 'recovery_required');
});

test('stale_page_cannot_start_a_replaced_configuration', async (t) => {
  const { post, command, controller } = await setup(t);
  const first = await (await post(command)).json();
  const second = await (await post({ ...command, route: { ...command.route, name: 'Other tab route' } })).json();
  assert.notEqual(first.sessionId, second.sessionId);
  const response = await post({ type: 'start' }, { 'X-Session-Id': first.sessionId });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'SESSION_CHANGED');
  assert.equal(controller.snapshot().sessionId, second.sessionId);
  assert.equal(controller.snapshot().state, 'ready');
});
