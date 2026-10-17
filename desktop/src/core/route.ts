import type { RouteConfig, CompiledRoute, GeoPoint } from './types.js';
import { distanceMeters, interpolatePoint, bearingDegrees } from './geo.js';

function pointKey(point: GeoPoint): string {
  const longitude = Math.abs(point.latitude) === 90 ? 0 : point.longitude === 180 ? -180 : point.longitude;
  return `${point.latitude},${longitude}`;
}

export function parseRoute(input: unknown): RouteConfig {
  let value: unknown = input;
  if (typeof input === 'string') {
    try { value = JSON.parse(input); } catch { throw new Error('路线 JSON 无法解析，请检查格式'); }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('路线必须为 JSON 对象');
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) throw new Error('路线 schemaVersion 必须为 1');
  if (typeof record.name !== 'string' || !record.name.trim()) throw new Error('请填写路线名称');
  if (record.coordinateSystem !== 'WGS-84') throw new Error('路线坐标系必须为 WGS-84');
  if (!Array.isArray(record.points)) throw new Error('路线 points 必须为坐标数组');
  const points = record.points.map((item: unknown, index: number): GeoPoint => {
    if (!item || typeof item !== 'object') throw new Error(`第 ${index + 1} 个坐标格式错误`);
    const point = item as Record<string, unknown>;
    if (typeof point.latitude !== 'number' || typeof point.longitude !== 'number') throw new Error(`第 ${index + 1} 个经纬度必须为数值`);
    const copy = { latitude: point.latitude, longitude: point.longitude };
    distanceMeters(copy, copy);
    return copy;
  });
  if (new Set(points.map(pointKey)).size < 3) throw new Error('路线至少需要三个不同位置，且总长度不能为零');
  const closed = pointKey(points[0]!) === pointKey(points.at(-1)!) ? points : [...points, points[0]!];
  for (let i = 0; i < closed.length - 1; i++) {
    const a = closed[i]!; const b = closed[i + 1]!;
    const length = distanceMeters(a, b);
    if (pointKey(a) === pointKey(b) || length <= 0) throw new Error(`第 ${i + 1} 段长度为零，请移除相邻重复坐标`);
    if (length > 500) throw new Error(`第 ${i + 1} 段超过 500 米，请检查路线连接`);
  }
  return { schemaVersion: 1, name: record.name.trim(), coordinateSystem: 'WGS-84', points };
}

export function compileRoute(route: RouteConfig): CompiledRoute {
  const parsed = parseRoute(route);
  const points = parsed.points;
  if (pointKey(points[0]!) === pointKey(points.at(-1)!)) points.pop();
  points.push({ ...points[0]! });
  const segmentLengthsM: number[] = [];
  const cumulativeLengthsM = [0];
  let lengthM = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const segment = distanceMeters(points[i]!, points[i + 1]!);
    segmentLengthsM.push(segment);
    lengthM += segment;
    cumulativeLengthsM.push(lengthM);
  }
  return { points, segmentLengthsM, cumulativeLengthsM, lengthM };
}

export function pointAtDistance(route: CompiledRoute, distanceM: number, direction: 'forward' | 'reverse'): GeoPoint & { bearingDeg: number } {
  if (!Number.isFinite(distanceM) || distanceM < 0) throw new Error('行进距离必须为非负有限数值');
  if (direction !== 'forward' && direction !== 'reverse') throw new Error('路线方向无效');
  if (!Number.isFinite(route.lengthM) || route.lengthM <= 0) throw new Error('路线长度无效');
  const wrapped = distanceM % route.lengthM;
  const position = direction === 'forward' ? wrapped : route.lengthM - wrapped;
  for (let i = 0; i < route.segmentLengthsM.length; i++) {
    const start = route.cumulativeLengthsM[i]!;
    const end = route.cumulativeLengthsM[i + 1]!;
    const selected = direction === 'forward' ? position >= start && position < end : position > start && position <= end;
    if (!selected) continue;
    const fraction = (position - start) / route.segmentLengthsM[i]!;
    const point = interpolatePoint(route.points[i]!, route.points[i + 1]!, fraction);
    const toward = route.points[direction === 'forward' ? i + 1 : i]!;
    return { ...point, bearingDeg: bearingDegrees(point, toward) };
  }
  throw new Error('路线分段数据不完整，请重新编译路线');
}
