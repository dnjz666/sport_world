import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

// Execute the actual reader class against public SDK boundaries; this is not device evidence.
function fixture() {
  const listeners = new Map(), requests = [], logs = [], removed = [];
  const location = {
    LocationRequestPriority: { ACCURACY: 513, LOW_POWER: 514, UNSET: 512 },
    LocationRequestScenario: { TRAJECTORY_TRACKING: 770 },
    on(type, request, callback) {
      if (type === 'locationChange') { requests.push(request); listeners.set(type, callback); }
      else listeners.set(type, request);
    },
    off(type, callback) { removed.push(type); if (listeners.get(type) === callback) listeners.delete(type); }
  };
  const exports = {};
  const source = readFileSync(new URL('../../prototype/reader/entry/src/main/ets/location/LocationReader.ets', import.meta.url), 'utf8');
  const code = stripTypeScriptTypes(source)
    .replace(/import \{([^}]+)\} from ('[^']+');/g, 'const {$1} = require($2);')
    .replace('export class LocationReader', 'exports.LocationReader = class LocationReader');
  const api = {
    '@kit.AbilityKit': { abilityAccessCtrl: { createAtManager: () => ({ requestPermissionsFromUser: async () => ({ authResults: [0, 0] }) }) } },
    '@kit.LocationKit': { geoLocationManager: location },
    '@kit.PerformanceAnalysisKit': { hilog: { info: (...args) => logs.push(args), error: (...args) => logs.push(args) } }
  };
  runInNewContext(code, { exports, require: (name) => { assert.ok(api[name], name); return api[name]; }, Date, Number, JSON });
  const samples = [], diagnostics = [];
  return { reader: new exports.LocationReader({}), location, listeners, requests, logs, removed, samples, diagnostics,
    async start(mode = 'accuracy') { await this.reader.start((v) => samples.push(v), (v) => diagnostics.push(v), mode); },
    emit(type, value) { assert.ok(listeners.has(type), type + ' subscription missing'); listeners.get(type)(value); }
  };
}
const point = { latitude: 0, longitude: 0.001, timeStamp: Date.now(), accuracy: 15, sourceType: 2,
  speed: 3.5, direction: 270, timeSinceBoot: 123000, speedAccuracy: 0.7, directionAccuracy: 10 };

test('reader_reports_native_metadata_without_deriving_or_inventing_values', async () => {
  const f = fixture(); await f.start(); f.emit('locationChange', point);
  const sample = f.diagnostics.find((v) => v.kind === 'location');
  assert.ok(sample, 'native diagnostic callback absent');
  assert.equal(sample.speedMps, 3.5); assert.equal(sample.directionDeg, 270);
  assert.equal(sample.speedAccuracyMps, 0.7); assert.equal(sample.directionAccuracyDeg, 10);
  assert.equal(sample.sourceCode, 2); assert.equal(sample.callbackIntervalMs, null);
  assert.equal(sample.positionAgeMs, sample.receivedAtMs - point.timeStamp);
  assert.equal(sample.timeSinceBoot, 123000);
  f.emit('locationChange', { ...point, speed: NaN, direction: Infinity, speedAccuracy: undefined, directionAccuracy: undefined });
  const next = f.diagnostics.filter((v) => v.kind === 'location').at(-1);
  assert.equal(next.speedMps, null); assert.equal(next.directionDeg, null);
  assert.equal(next.speedAccuracyMps, null); assert.equal(next.directionAccuracyDeg, null);
  assert.equal(typeof next.callbackIntervalMs, 'number');
});

test('reader_retains_system_mock_marker_and_unknown_is_not_false', async () => {
  const f = fixture(); await f.start();
  for (const marker of [undefined, false, true]) {
    f.emit('locationChange', { ...point, isFromMock: marker });
    assert.equal(f.samples.at(-1).isMock, marker ?? null);
  }
});

test('reader_modes_change_only_public_request_parameters', async () => {
  for (const [mode, priority, scenario] of [['accuracy', 513, undefined], ['trajectory', 512, 770], ['low-power', 514, undefined]]) {
    const f = fixture(); await f.start(mode); const request = f.requests[0];
    assert.equal(request.priority, priority); assert.equal(request.scenario, scenario);
    assert.equal(request.timeInterval, 1); assert.equal(request.maxAccuracy, 0);
    assert.ok(f.diagnostics.some((v) => v.kind === 'subscribed' && v.mode === mode));
  }
});

test('reader_reports_satellite_status_and_errors_without_calling_them_a_fix', async () => {
  const f = fixture(); await f.start();
  f.emit('satelliteStatusChange', { satellitesNumber: 12, carrierToNoiseDensitys: [10, 22, 35] });
  f.emit('locationError', -5);
  const status = f.diagnostics.find((v) => v.kind === 'satellites');
  assert.equal(status.satellitesNumber, 12); assert.equal(status.strongestCarrierToNoise, 35);
  assert.equal(status.fixConfirmed, undefined);
  assert.equal(f.diagnostics.find((v) => v.kind === 'location-error').errorCode, -5);
});

test('reader_unsubscribes_every_diagnostic_and_ignores_old_callbacks', async () => {
  const f = fixture(); await f.start(); const old = new Map(f.listeners);
  f.reader.stop(); assert.equal(f.listeners.size, 0);
  assert.deepEqual(f.removed.sort(), ['locationChange', 'locationError', 'satelliteStatusChange'].sort());
  const count = f.diagnostics.length;
  old.get('locationChange')(point); old.get('locationError')(-5);
  old.get('satelliteStatusChange')({ satellitesNumber: 3, carrierToNoiseDensitys: [] });
  assert.equal(f.samples.length, 0); assert.equal(f.diagnostics.length, count);
});

test('unsupported_optional_diagnostics_do_not_break_location_subscription', async () => {
  const f = fixture(), original = f.location.on;
  f.location.on = (type, ...args) => { if (type !== 'locationChange') throw new Error('Unsupported'); original(type, ...args); };
  await f.start(); f.emit('locationChange', point);
  assert.equal(f.samples.length, 1);
  assert.equal(f.diagnostics.filter((v) => v.kind === 'diagnostic-unavailable').length, 2);
  f.reader.stop();
});

test('reader_attempts_remaining_unsubscribes_when_one_channel_fails', async () => {
  const f = fixture(); await f.start(); const original = f.location.off;
  f.location.off = (type, callback) => { if (type === 'locationChange') throw new Error('Native failure'); original(type, callback); };
  assert.throws(() => f.reader.stop(), /Native failure/);
  assert.equal(f.listeners.has('satelliteStatusChange'), false);
  assert.equal(f.listeners.has('locationError'), false);
  f.location.off = original; f.reader.stop(); assert.equal(f.listeners.size, 0);
});

test('reader_keeps_failed_diagnostic_subscription_owned_until_stop_retry', async () => {
  const f = fixture(); await f.start(); const original = f.location.off;
  f.location.off = (type, callback) => { if (type === 'satelliteStatusChange') throw new Error('Satellite off failed'); original(type, callback); };
  assert.throws(() => f.reader.stop(), /Satellite off failed/);
  await assert.rejects(() => f.start('trajectory'), /先完成取消订阅/);
  f.location.off = original; f.reader.stop(); await f.start('trajectory');
  assert.equal(f.requests.length, 2); f.reader.stop();
});

test('reader_failed_location_unsubscribe_cannot_report_a_successful_restart', async () => {
  const f = fixture(); await f.start(); const original = f.location.off;
  const oldLocation = f.listeners.get('locationChange');
  f.location.off = (type, callback) => { if (type === 'locationChange') throw new Error('Location off failed'); original(type, callback); };
  assert.throws(() => f.reader.stop(), /Location off failed/);
  oldLocation(point); assert.equal(f.samples.length, 0);
  await assert.rejects(() => f.start(), /先完成取消订阅/);
  assert.equal(f.requests.length, 1);
  f.location.off = original; f.reader.stop(); await f.start();
  f.emit('locationChange', point); assert.equal(f.samples.length, 1);
  assert.equal(f.requests.length, 2); f.reader.stop();
});
