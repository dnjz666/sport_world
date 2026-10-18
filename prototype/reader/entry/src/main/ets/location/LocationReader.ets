import { abilityAccessCtrl, common } from '@kit.AbilityKit';
import { geoLocationManager } from '@kit.LocationKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

export interface ObservedLocation {
  latitude: number;
  longitude: number;
  epochMs: number;
  receivedAtMs: number;
  accuracyM: number | null;
  source: string | null;
  isMock: boolean | null;
}

export type ReaderMode = 'accuracy' | 'trajectory' | 'low-power';

export interface ReaderDiagnostic {
  kind: string;
  mode: ReaderMode;
  receivedAtMs: number;
  positionEpochMs?: number;
  positionAgeMs?: number;
  callbackIntervalMs?: number | null;
  speedMps?: number | null;
  directionDeg?: number | null;
  speedAccuracyMps?: number | null;
  directionAccuracyDeg?: number | null;
  timeSinceBoot?: number | null;
  accuracyM?: number | null;
  sourceCode?: number | null;
  isFromMock?: boolean | null;
  satellitesNumber?: number | null;
  strongestCarrierToNoise?: number | null;
  errorCode?: number;
  detail?: string;
}

// This class reads public system callbacks; it has no injection dependency.
export class LocationReader {
  private context: common.UIAbilityContext;
  private callback: ((location: geoLocationManager.Location) => void) | undefined = undefined;
  private satelliteCallback: ((status: geoLocationManager.SatelliteStatusInfo) => void) | undefined = undefined;
  private errorCallback: ((error: geoLocationManager.LocationError) => void) | undefined = undefined;
  private generation: number = 0;
  private cleanupPending: boolean = false;

  constructor(context: common.UIAbilityContext) {
    this.context = context;
  }

  private numberOrNull(value: number | undefined): number | null {
    return value !== undefined && Number.isFinite(value) ? value : null;
  }

  async start(onSample: (sample: ObservedLocation) => void,
    onDiagnostic: ((diagnostic: ReaderDiagnostic) => void) | undefined = undefined,
    mode: ReaderMode = 'accuracy'): Promise<void> {
    if (this.cleanupPending) {
      throw new Error('请先完成取消订阅，再开始读取');
    }
    if (this.callback !== undefined) {
      return;
    }
    try {
      const generation: number = ++this.generation;
      const result = await abilityAccessCtrl.createAtManager().requestPermissionsFromUser(
        this.context, ['ohos.permission.APPROXIMATELY_LOCATION', 'ohos.permission.LOCATION']);
      if (generation !== this.generation) {
        throw new Error('读取已取消，请重新开始');
      }
      if (result.authResults.length !== 2 || result.authResults.some((status: number) => status !== 0)) {
        throw new Error('需要允许精确定位；请检查应用的位置权限');
      }
      const request: geoLocationManager.LocationRequest = {
        priority: mode === 'low-power' ? geoLocationManager.LocationRequestPriority.LOW_POWER :
          mode === 'trajectory' ? geoLocationManager.LocationRequestPriority.UNSET :
            geoLocationManager.LocationRequestPriority.ACCURACY,
        timeInterval: 1,
        distanceInterval: 0,
        maxAccuracy: 0
      };
      if (mode === 'trajectory') {
        request.scenario = geoLocationManager.LocationRequestScenario.TRAJECTORY_TRACKING;
      }
      const emit = (diagnostic: ReaderDiagnostic): void => {
        if (generation !== this.generation) {
          return;
        }
        hilog.info(0x0000, 'M0ReaderDiagnostic', '%{public}s', JSON.stringify(diagnostic));
        onDiagnostic?.(diagnostic);
      };
      let previousReceivedAtMs: number | undefined = undefined;
      const callback = (location: geoLocationManager.Location): void => {
        if (generation !== this.generation) {
          return;
        }
        const sample: ObservedLocation = {
          latitude: location.latitude,
          longitude: location.longitude,
          epochMs: location.timeStamp,
          receivedAtMs: Date.now(),
          accuracyM: Number.isFinite(location.accuracy) ? location.accuracy : null,
          source: location.sourceType === undefined ? null : location.sourceType.toString(),
          isMock: typeof location.isFromMock === 'boolean' ? location.isFromMock : null
        };
        hilog.info(0x0000, 'M0Reader', '%{public}s', JSON.stringify(sample));
        onSample(sample);
        emit({ kind: 'location', mode, receivedAtMs: sample.receivedAtMs,
          positionEpochMs: sample.epochMs, positionAgeMs: sample.receivedAtMs - sample.epochMs,
          callbackIntervalMs: previousReceivedAtMs === undefined ? null : sample.receivedAtMs - previousReceivedAtMs,
          speedMps: this.numberOrNull(location.speed), directionDeg: this.numberOrNull(location.direction),
          speedAccuracyMps: this.numberOrNull(location.speedAccuracy),
          directionAccuracyDeg: this.numberOrNull(location.directionAccuracy),
          timeSinceBoot: this.numberOrNull(location.timeSinceBoot), accuracyM: sample.accuracyM,
          sourceCode: this.numberOrNull(location.sourceType), isFromMock: sample.isMock });
        previousReceivedAtMs = sample.receivedAtMs;
      };
      geoLocationManager.on('locationChange', request, callback);
      this.callback = callback;
      emit({ kind: 'subscribed', mode, receivedAtMs: Date.now(), detail: JSON.stringify(request) });
      // Optional diagnostic failures do not cancel the independent location channel.
      try {
        const satelliteCallback = (status: geoLocationManager.SatelliteStatusInfo): void => {
          const strengths: number[] = status.carrierToNoiseDensitys.filter((value: number) => Number.isFinite(value));
          emit({ kind: 'satellites', mode, receivedAtMs: Date.now(),
            satellitesNumber: this.numberOrNull(status.satellitesNumber),
            strongestCarrierToNoise: strengths.length === 0 ? null : Math.max(...strengths) });
        };
        geoLocationManager.on('satelliteStatusChange', satelliteCallback);
        this.satelliteCallback = satelliteCallback;
      } catch (error) {
        emit({ kind: 'diagnostic-unavailable', mode, receivedAtMs: Date.now(), detail: `satellites: ${error.message}` });
      }
      try {
        const errorCallback = (error: geoLocationManager.LocationError): void => {
          emit({ kind: 'location-error', mode, receivedAtMs: Date.now(), errorCode: error });
        };
        geoLocationManager.on('locationError', errorCallback);
        this.errorCallback = errorCallback;
      } catch (error) {
        emit({ kind: 'diagnostic-unavailable', mode, receivedAtMs: Date.now(), detail: `location-error: ${error.message}` });
      }
    } catch (error) {
      hilog.error(0x0000, 'M0ReaderStatus', '订阅失败：%{public}s', error.message);
      throw new Error(`订阅失败：${error.message}`);
    }
  }

  stop(): void {
    this.cleanupPending = true;
    ++this.generation;
    const errors: string[] = [];
    const callback = this.callback;
    if (callback !== undefined) {
      try {
        geoLocationManager.off('locationChange', callback);
        this.callback = undefined;
      } catch (error) {
        errors.push(error.message);
      }
    }
    if (this.satelliteCallback !== undefined) {
      try {
        geoLocationManager.off('satelliteStatusChange', this.satelliteCallback);
        this.satelliteCallback = undefined;
      } catch (error) { errors.push(error.message); }
    }
    if (this.errorCallback !== undefined) {
      try {
        geoLocationManager.off('locationError', this.errorCallback);
        this.errorCallback = undefined;
      } catch (error) { errors.push(error.message); }
    }
    if (errors.length > 0) {
      hilog.error(0x0000, 'M0ReaderStatus', '取消订阅失败：%{public}s', errors.join('; '));
      throw new Error(`取消订阅失败：${errors.join('; ')}`);
    }
    this.cleanupPending = false;
  }
}
