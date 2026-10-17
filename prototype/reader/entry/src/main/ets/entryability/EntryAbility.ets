import { UIAbility } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

export default class EntryAbility extends UIAbility {
  onWindowStageCreate(windowStage: window.WindowStage): void {
    try {
      windowStage.loadContent('pages/Index').catch((error: BusinessError): void => {
        hilog.error(0x0000, 'M0ReaderStatus', '页面加载失败：%{public}s', error.message);
      });
    } catch (error) {
      hilog.error(0x0000, 'M0ReaderStatus', '页面加载失败：%{public}s', error.message);
    }
  }
}
