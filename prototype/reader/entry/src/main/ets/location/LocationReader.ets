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

// This class reads public system callbacks; it has no injection dependency.
export class LocationReader {
  private context: common.UIAbilityContext;
  private callback: ((location: geoLocationManager.Location) => void) | undefined = undefined;
  private generation: number = 0;

  constructor(context: common.UIAbilityContext) {
    this.context = context;
  }

  async start(onSample: (sample: ObservedLocation) => void): Promise<void> {
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
        priority: geoLocationManager.LocationRequestPriority.ACCURACY,
        timeInterval: 1,
        distanceInterval: 0,
        maxAccuracy: 0
      };
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
          isMock: null
        };
        hilog.info(0x0000, 'M0Reader', '%{public}s', JSON.stringify(sample));
        onSample(sample);
      };
      geoLocationManager.on('locationChange', request, callback);
      this.callback = callback;
    } catch (error) {
      hilog.error(0x0000, 'M0ReaderStatus', '订阅失败：%{public}s', error.message);
      throw new Error(`订阅失败：${error.message}`);
    }
  }

  stop(): void {
    ++this.generation;
    const callback = this.callback;
    if (callback !== undefined) {
      try {
        geoLocationManager.off('locationChange', callback);
        this.callback = undefined;
      } catch (error) {
        hilog.error(0x0000, 'M0ReaderStatus', '取消订阅失败：%{public}s', error.message);
        throw new Error(`取消订阅失败：${error.message}`);
      }
    }
  }
}
