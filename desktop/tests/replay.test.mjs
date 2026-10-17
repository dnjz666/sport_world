import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { distanceMeters } from '../dist/core/geo.js';
import { compileRoute, pointAtDistance } from '../dist/core/route.js';
import { createReplay } from '../dist/core/replay.js';

const track = JSON.parse(readFileSync(new URL('./fixtures/track.json', import.meta.url), 'utf8'));
const near = (actual, expected, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, actual + ' differs from ' + expected);

function setup(overrides = {}) {
  const route = compileRoute(track);
  const settings = { paceSecPerKm: 300, laps: 2, direction: 'forward', sampleIntervalMs: 1000, ...overrides };
  const time = { monotonic: 1234, epoch: 1800000000000 };
  const clock = { monotonicMs: () => time.monotonic, epochMs: () => time.epoch };
  const advance = (ms) => { time.monotonic += ms; time.epoch += ms; };
  return { route, settings, time, clock, advance, replay: createReplay(route, settings, clock) };
}

function atPoint(sample, expected) {
  near(sample.latitude, expected.latitude);
  near(sample.longitude, expected.longitude);
  near(sample.bearingDeg, expected.bearingDeg, 1e-5);
}

test('pace_and_elapsed_time', () => {
  const { replay, route, advance, time } = setup();
  advance(5000); // Construction time must not count as running.
  assert.equal(replay.finished(), false);
  replay.start();
  const first = replay.next();
  assert.equal(first.sequence, 1);
  assert.equal(first.elapsedMs, 0);
  advance(30000);
  const sample = replay.next();
  assert.equal(sample.sequence, 2);
  assert.equal(sample.elapsedMs, 30000);
  assert.equal(sample.epochMs, time.epoch);
  near(sample.speedMps, 1000 / 300);
  // 30 seconds at 300 seconds/km = 100 m; independent equatorial reference.
  near(distanceMeters(route.points[0], sample), 100, 0.01);
  near(sample.latitude, 0);
  near(sample.longitude, 0.0008993203637245, 1e-10);
  atPoint(sample, pointAtDistance(route, 100, 'forward'));
});

test('pause_does_not_catch_up', () => {
  const { replay, advance } = setup();
  replay.start();
  replay.next();
  advance(30000);
  const beforePause = replay.next();
  replay.pause();
  advance(60000);
  const paused = replay.next();
  assert.equal(paused.elapsedMs, beforePause.elapsedMs);
  assert.equal(paused.speedMps, 0);
  assert.ok(paused.epochMs > beforePause.epochMs);
  atPoint(paused, beforePause);
  assert.equal(paused.sequence, beforePause.sequence + 1);
  advance(60000);
  const stillPaused = replay.next();
  assert.equal(stillPaused.elapsedMs, 30000);
  atPoint(stillPaused, beforePause);
  replay.resume();
  advance(30000);
  const resumed = replay.next();
  assert.equal(resumed.elapsedMs, 60000);
  near(resumed.speedMps, 1000 / 300);
  near(resumed.latitude, 0.000798640727449, 1e-9);
  near(resumed.longitude, 0.001);
});

test('pause_between_samples_holds_last_output_and_excludes_only_paused_time', () => {
  const { replay, advance } = setup();
  replay.start();
  advance(1000);
  const before = replay.next();
  advance(250);
  replay.pause();
  advance(60000);
  const paused = replay.next();
  assert.equal(paused.elapsedMs, before.elapsedMs);
  atPoint(paused, before);
  assert.equal(paused.speedMps, 0);
  replay.resume();
  advance(1000);
  assert.equal(replay.next().elapsedMs, 2250);
});

test('repeated_pause_and_resume_do_not_reset_time', () => {
  const { replay, advance } = setup();
  replay.start();
  replay.next();
  advance(1000);
  replay.pause();
  advance(500);
  replay.pause();
  advance(500);
  replay.resume();
  advance(1000);
  replay.resume();
  advance(1000);
  assert.equal(replay.next().elapsedMs, 3000);
  replay.pause();
  advance(60000);
  replay.resume();
  advance(1000);
  assert.equal(replay.next().elapsedMs, 4000);
});

test('pause_before_first_sample_holds_start', () => {
  const { replay, route, advance } = setup();
  replay.start();
  advance(1000);
  replay.pause();
  advance(60000);
  const paused = replay.next();
  assert.equal(paused.elapsedMs, 0);
  assert.equal(paused.speedMps, 0);
  atPoint(paused, pointAtDistance(route, 0, 'forward'));
  replay.resume();
  assert.equal(replay.next().elapsedMs, 1000);
});

test('wall_clock_jump_does_not_move_runner', () => {
  const { replay, advance, time } = setup();
  replay.start();
  advance(30000);
  const before = replay.next();
  for (const jump of [-86400000, 172800000]) {
    time.epoch += jump;
    const sample = replay.next();
    atPoint(sample, before);
    assert.equal(sample.elapsedMs, before.elapsedMs);
    assert.equal(sample.epochMs, time.epoch);
    assert.equal(sample.speedMps, before.speedMps);
  }
});

test('delayed_tick_uses_elapsed_time', () => {
  const { replay, advance } = setup();
  replay.start();
  assert.equal(replay.next().sequence, 1);
  advance(30000);
  const delayed = replay.next();
  assert.equal(delayed.sequence, 2);
  assert.equal(delayed.elapsedMs, 30000);
  near(delayed.longitude, 0.0008993203637245, 1e-10);
  const current = replay.next();
  assert.equal(current.sequence, 3);
  assert.equal(current.elapsedMs, 30000);
  atPoint(current, delayed);
  advance(500);
  assert.equal(replay.next().elapsedMs, 30500);
});

test('sample_interval_does_not_determine_distance', () => {
  for (const sampleIntervalMs of [100, 1000, 10000]) {
    const { replay, advance } = setup({ sampleIntervalMs });
    replay.start();
    advance(30000);
    const sample = replay.next();
    assert.equal(sample.elapsedMs, 30000);
    near(sample.longitude, 0.0008993203637245, 1e-10);
  }
});

test('lap_end_emitted_once', () => {
  const { replay, route, time, advance } = setup();
  const startedAt = time.monotonic;
  const lapMs = route.lengthM * 300;
  replay.start();
  replay.next();
  time.monotonic = startedAt + lapMs - 1;
  const before = replay.next();
  time.monotonic = startedAt + lapMs;
  const boundary = replay.next();
  assert.equal(replay.finished(), false);
  near(boundary.latitude, 0);
  near(boundary.longitude, 0);
  assert.ok(distanceMeters(before, boundary) < 0.01);
  time.monotonic = startedAt + lapMs + 1;
  const after = replay.next();
  assert.ok(distanceMeters(boundary, after) < 0.01);
  near(after.bearingDeg, 90, 1e-5);
  time.monotonic = startedAt + lapMs * 2 - 1;
  replay.next();
  assert.equal(replay.finished(), false);
  advance(10000); // Overshoot still emits one exact terminal sample.
  assert.equal(replay.finished(), false); // Polling cannot swallow the terminal sample.
  const last = replay.next();
  near(last.elapsedMs, lapMs * 2, 1e-6);
  near(last.latitude, 0);
  near(last.longitude, 0);
  assert.equal(last.speedMps, 0);
  assert.equal(last.sequence, 6);
  assert.equal(replay.finished(), true);
  advance(10000);
  assert.throws(() => replay.next(), /完成/);
  assert.throws(() => replay.start(), /启动/);
  assert.throws(() => replay.resume(), /完成/);
  assert.throws(() => replay.pause(), /完成/);
  assert.equal(replay.finished(), true);
});

test('reverse_route_preserved', () => {
  const { replay, route, advance } = setup({ direction: 'reverse', laps: 1 });
  const original = structuredClone(route);
  replay.start();
  const start = replay.next();
  near(start.bearingDeg, 0);
  advance(30000);
  const sample = replay.next();
  near(sample.latitude, 0.0008993203637245, 1e-10);
  near(sample.longitude, 0);
  near(sample.bearingDeg, 0, 1e-5);
  atPoint(sample, pointAtDistance(route, 100, 'reverse'));
  advance(route.lengthM * 300);
  const last = replay.next();
  near(last.latitude, 0);
  near(last.longitude, 0);
  near(last.elapsedMs, route.lengthM * 300, 1e-6);
  assert.equal(replay.finished(), true);
  assert.deepEqual(route, original);
});

test('invalid_settings_rejected', () => {
  const { route, clock, settings } = setup();
  const fields = {
    paceSecPerKm: [0, -1, NaN, Infinity, -Infinity, '300', null, undefined, Number.MIN_VALUE],
    sampleIntervalMs: [0, -1, NaN, Infinity, -Infinity, '1000', null, undefined],
    laps: [0, -1, 1.5, NaN, Infinity, '2', null, undefined, Number.MAX_SAFE_INTEGER + 1],
    direction: ['sideways', null, undefined]
  };
  for (const [field, values] of Object.entries(fields)) {
    for (const value of values) {
      assert.throws(() => createReplay(route, { ...settings, [field]: value }, clock),
        new RegExp(field), field + '=' + String(value));
    }
  }
});

test('invalid_route_length_and_unrepresentable_duration_rejected', () => {
  const { route, clock, settings } = setup();
  for (const lengthM of [0, -1, NaN, Infinity]) {
    assert.throws(() => createReplay({ ...route, lengthM }, settings, clock), /路线/);
  }
  assert.throws(() => createReplay(route, { ...settings, paceSecPerKm: Number.MAX_VALUE }, clock), /时长/);
});

test('unstarted_replay_and_duplicate_start_rejected', () => {
  const { replay, advance } = setup();
  assert.equal(replay.finished(), false);
  for (const operation of ['next', 'pause', 'resume']) {
    assert.throws(() => replay[operation](), /启动/);
  }
  replay.start();
  advance(1000);
  assert.throws(() => replay.start(), /启动/);
  assert.equal(replay.next().elapsedMs, 1000);
});

test('pause_after_deadline_holds_output_until_resumed', () => {
  const { replay, advance, route } = setup({ laps: 1 });
  replay.start();
  advance(30000);
  const before = replay.next();
  advance(300000); // Logical deadline has passed, but its sample has not been emitted.
  replay.pause();
  for (let i = 0; i < 2; i++) {
    advance(1000);
    const paused = replay.next();
    assert.equal(paused.elapsedMs, before.elapsedMs);
    atPoint(paused, before);
    assert.equal(paused.speedMps, 0);
    assert.ok(paused.epochMs > before.epochMs);
    assert.equal(replay.finished(), false);
  }
  replay.resume();
  const last = replay.next();
  near(last.elapsedMs, route.lengthM * 300, 1e-6);
  near(last.latitude, 0);
  near(last.longitude, 0);
  assert.equal(last.speedMps, 0);
  assert.equal(replay.finished(), true);
  assert.throws(() => replay.next(), /完成/);
});
