import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { distanceMeters } from '../dist/core/geo.js';
import { parseRoute, compileRoute, pointAtDistance } from '../dist/core/route.js';
const track = JSON.parse(readFileSync(new URL('./fixtures/track.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(track);
const near = (actual, expected, tolerance) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);

test('invalid_route_rejected', () => {
  const cases = [null, [], '{broken', {}, { ...copy(), schemaVersion: 2 }, { ...copy(), name: ' ' },
    { ...copy(), coordinateSystem: 'GCJ-02' }, { ...copy(), points: [] }, { ...copy(), points: track.points.slice(0, 2) },
    { ...copy(), points: [track.points[0], track.points[1], track.points[0]] }];
  for (const value of [NaN, Infinity, -Infinity, '0', null, 91, -91]) {
    const input = copy(); input.points[0].latitude = value; cases.push(input);
  }
  for (const value of [181, -181, NaN, Infinity]) {
    const input = copy(); input.points[0].longitude = value; cases.push(input);
  }
  cases.push({ ...copy(), points: [track.points[0], track.points[0], track.points[1], track.points[2]] });
  for (const input of cases) assert.throws(() => parseRoute(input));
});

test('long_segment_rejected_including_the_closing_segment', () => {
  const input = copy(); input.points[1].longitude = 0.01;
  assert.throws(() => parseRoute(input), /500/);
  const closing = { ...copy(), points: [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.003 }, { latitude: 0, longitude: 0.006 }] };
  assert.throws(() => compileRoute(closing), /500/);
});

test('compile_validates_even_when_called_without_parse', () => {
  assert.throws(() => compileRoute({ ...copy(), coordinateSystem: 'GCJ-02' }));
});

test('numerically_zero_length_segments_are_rejected', () => {
  const input = { ...copy(), points: [{ latitude: 0, longitude: 0 }, { latitude: Number.MIN_VALUE, longitude: 0 }, { latitude: 0, longitude: Number.MIN_VALUE }] };
  assert.throws(() => compileRoute(input), /长度/);
});

test('parses_json_and_keeps_caller_mutation_out_of_the_compiled_route', () => {
  const input = parseRoute(JSON.stringify(track)); const compiled = compileRoute(input);
  input.points[0].latitude = 40;
  assert.deepEqual(pointAtDistance(compiled, 0, 'forward'), { latitude: 0, longitude: 0, bearingDeg: 90 });
});

test('distance_matches_independent_equatorial_reference', () => {
  near(distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.001 }), 111.1950802335, 0.01);
});

test('route_is_closed_exactly_once', () => {
  const open = compileRoute(copy()); const closed = compileRoute({ ...copy(), points: [...track.points, track.points[0]] });
  assert.equal(open.points.length, 5); assert.deepEqual(open, closed);
  assert.equal(open.segmentLengthsM.length, 4); assert.equal(open.cumulativeLengthsM.length, 5);
  near(open.lengthM, 444.7803209, 0.01);
});

test('interpolation_and_forward_bearing_follow_the_line', () => {
  const route = compileRoute(copy()); const point = pointAtDistance(route, 55.59754011675, 'forward');
  near(point.latitude, 0, 1e-9); near(point.longitude, 0.0005, 1e-9); near(point.bearingDeg, 90, 1e-6);
  const corner = pointAtDistance(route, route.segmentLengthsM[0], 'forward');
  near(corner.latitude, 0, 1e-9); near(corner.longitude, 0.001, 1e-9); near(corner.bearingDeg, 0, 1e-6);
});

test('reverse_traverses_the_same_route_with_equal_length', () => {
  const route = compileRoute(copy()); const reverse = pointAtDistance(route, 55.59754011675, 'reverse');
  near(reverse.latitude, 0.0005, 1e-9); near(reverse.longitude, 0, 1e-9); near(reverse.bearingDeg, 0, 1e-6);
  for (const direction of ['forward', 'reverse']) {
    const start = pointAtDistance(route, 0, direction);
    assert.deepEqual(pointAtDistance(route, route.lengthM, direction), start);
    const wrapped = pointAtDistance(route, route.lengthM * 2 + 55.59754011675, direction);
    const firstLap = pointAtDistance(route, 55.59754011675, direction);
    near(wrapped.latitude, firstLap.latitude, 1e-9); near(wrapped.longitude, firstLap.longitude, 1e-9);
  }
});

test('invalid_travel_arguments_are_rejected', () => {
  const route = compileRoute(copy());
  for (const value of [NaN, Infinity, -1]) assert.throws(() => pointAtDistance(route, value, 'forward'));
  assert.throws(() => pointAtDistance(route, 0, 'sideways'));
});

test('short_dateline_crossing_uses_the_short_arc', () => {
  const route = compileRoute({ ...copy(), points: [{ latitude: 0, longitude: 179.999 }, { latitude: 0, longitude: -179.999 }, { latitude: 0.001, longitude: -179.999 }] });
  const point = pointAtDistance(route, 111.1950802335, 'forward');
  near(Math.abs(point.longitude), 180, 1e-7); near(point.latitude, 0, 1e-9); near(point.bearingDeg, 90, 1e-6);
});
