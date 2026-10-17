import type { GeoPoint } from './types.js';

export const EARTH_RADIUS_M = 6371008.8;
const radians = (degrees: number): number => degrees * Math.PI / 180;
const degrees = (radians: number): number => radians * 180 / Math.PI;

export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  for (const point of [a, b]) {
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) || Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180) {
      throw new Error('经纬度必须为范围内的有限数值');
    }
  }
  const latA = radians(a.latitude);
  const latB = radians(b.latitude);
  const h = Math.sin((latB - latA) / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(radians(b.longitude - a.longitude) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}

export function interpolatePoint(a: GeoPoint, b: GeoPoint, fraction: number): GeoPoint {
  if (fraction === 0) return { ...a };
  if (fraction === 1) return { ...b };
  const angle = distanceMeters(a, b) / EARTH_RADIUS_M;
  const weightA = Math.sin((1 - fraction) * angle) / Math.sin(angle);
  const weightB = Math.sin(fraction * angle) / Math.sin(angle);
  const latA = radians(a.latitude); const lonA = radians(a.longitude);
  const latB = radians(b.latitude); const lonB = radians(b.longitude);
  const x = weightA * Math.cos(latA) * Math.cos(lonA) + weightB * Math.cos(latB) * Math.cos(lonB);
  const y = weightA * Math.cos(latA) * Math.sin(lonA) + weightB * Math.cos(latB) * Math.sin(lonB);
  const z = weightA * Math.sin(latA) + weightB * Math.sin(latB);
  return { latitude: degrees(Math.atan2(z, Math.hypot(x, y))), longitude: degrees(Math.atan2(y, x)) };
}

export function bearingDegrees(from: GeoPoint, to: GeoPoint): number {
  const latA = radians(from.latitude); const latB = radians(to.latitude);
  const deltaLon = radians(to.longitude - from.longitude);
  const y = Math.sin(deltaLon) * Math.cos(latB);
  const x = Math.cos(latA) * Math.sin(latB) - Math.sin(latA) * Math.cos(latB) * Math.cos(deltaLon);
  return (degrees(Math.atan2(y, x)) + 360) % 360;
}
