import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// A DOM boundary for client state tests. Browser acceptance separately verifies actual layout and events.
class Element {
  value = ''; textContent = ''; hidden = true; disabled = false; dataset = {}; files = []; children = []; listeners = new Map();
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  setAttribute(name, value) { this[name] = value; }
  async fire(type) { await this.listeners.get(type)?.({ preventDefault() {} }); }
}
async function client(initial) {
  const elements = new Map(); const timers = []; let current = initial; let disconnected = false;
  const element = (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  element('pace').value = '300'; element('laps').value = '2'; element('direction').value = 'forward';
  element('target').value = 'synthetic-phone'; element('route-name').value = 'Original input';
  element('points').value = '0, 0\n0, 0.001\n0.001, 0.001\n0.001, 0';
  runInNewContext(readFileSync(new URL('../web/app.js', import.meta.url), 'utf8'), {
    document: { getElementById: element, createElement: () => new Element(), createElementNS: () => new Element() },
    Option: class extends Element { constructor(text, value) { super(); this.textContent = text; this.value = value; } },
    fetch: async (path) => {
      if (disconnected) throw new Error('Service unavailable');
      return { ok: true, json: async () => path === '/api/targets' ? { targets: ['synthetic-phone'] } : structuredClone(current) };
    },
    setTimeout: (callback) => { timers.push(callback); }, setInterval: () => 1, console
  });
  await new Promise(setImmediate);
  return { element, async poll(next, offline = false) { current = next; disconnected = offline; await timers.shift()(); } };
}
const snapshot = (state, error = null) => ({ sessionId: 'synthetic-session', state, elapsedMs: 0, distanceM: 0, lap: 1,
  expected: null, sent: null, observed: null, lastError: error });

test('web_clears_resolved_session_error_but_preserves_invalid_input', async () => {
  const view = await client(snapshot('recovery_required', { code: 'CLEANUP_FAILED', message: 'native 201' }));
  assert.equal(view.element('error').hidden, false);
  await view.poll(snapshot('recovery_required', { code: 'RECOVERY_PENDING', message: 'Awaiting independent samples' }));
  assert.equal(view.element('error').hidden, true);
  await view.poll(snapshot('stopped'));
  view.element('points').value = 'broken input'; await view.element('config-form').fire('submit');
  await view.poll(snapshot('stopped'));
  assert.equal(view.element('error').hidden, false);
  assert.equal(view.element('points').value, 'broken input');
});

test('web_unverified_configuration_never_invites_start', async () => {
  const view = await client(snapshot('unknown'));
  await view.element('config-form').fire('submit');
  assert.equal(view.element('start').disabled, true);
  assert.match(view.element('config-note').textContent, /能力.*未确认/);
});

test('web_invalid_import_keeps_existing_route_fields', async () => {
  const view = await client(snapshot('ready'));
  const before = view.element('points').value;
  view.element('route-file').files = [{ size: 100, text: async () => JSON.stringify({ schemaVersion: 1, coordinateSystem: 'WGS-84',
    name: 'Invalid import', points: [{ latitude: 95, longitude: 0 }, { latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.001 }] }) }];
  await view.element('route-file').fire('change');
  assert.equal(view.element('route-name').value, 'Original input');
  assert.equal(view.element('points').value, before);
  assert.equal(view.element('error').hidden, false);
});

test('web_connection_loss_does_not_present_cached_state_as_current', async () => {
  const view = await client(snapshot('running'));
  await view.poll(snapshot('running'), true);
  assert.equal(view.element('state').textContent, '服务未连接');
  assert.equal(view.element('pause').disabled, true);
  assert.equal(view.element('start').disabled, true);
});

test('web_reloaded_session_never_uses_default_form_laps_as_actual_total', async () => {
  const view = await client({ ...snapshot('running'), lap: 3 });
  assert.equal(view.element('lap').textContent, '第 3 圈');
});

test('web_blank_coordinate_does_not_become_zero', async () => {
  const view = await client(snapshot('ready'));
  view.element('points').value = '0,\n0.001,\n0.001, 0.001';
  await view.element('preview-route').fire('click');
  assert.equal(view.element('error').hidden, false);
});

test('web_another_tabs_configuration_invalidates_local_start', async () => {
  const view = await client(snapshot('ready'));
  await view.element('config-form').fire('submit');
  assert.equal(view.element('start').disabled, false);
  await view.poll({ ...snapshot('ready'), sessionId: 'other-tabs-session' });
  assert.equal(view.element('start').disabled, true);
  assert.match(view.element('config-note').textContent, /重新应用/);
});
