import { common } from '@kit.AbilityKit';
import { LocationReader, ObservedLocation } from '../location/LocationReader';

@Entry
@Component
struct Index {
  @State status: string = '尚未开始读取';
  @State latest: string = '等待真实系统定位回调';
  @State sampleCount: number = 0;
  @State busy: boolean = false;
  private reader: LocationReader | undefined = undefined;

  private async startReading(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.status = '申请定位权限并订阅中';
    try {
      if (this.reader === undefined) {
        const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
        this.reader = new LocationReader(context);
      }
      await this.reader.start((sample: ObservedLocation): void => {
        this.sampleCount += 1;
        this.latest = JSON.stringify(sample, null, 2);
        this.status = '已收到系统定位回调';
      });
      this.status = '已订阅，等待系统定位回调';
    } catch (error) {
      this.status = `读取未启动：${error.message}`;
    } finally {
      this.busy = false;
    }
  }

  private stopReading(): void {
    try {
      this.reader?.stop();
      this.status = '已停止读取；此操作不修改手机定位';
    } catch (error) {
      this.status = `取消订阅失败：${error.message}`;
    }
  }

  aboutToDisappear(): void {
    this.stopReading();
  }

  onPageHide(): void {
    this.stopReading();
  }

  build() {
    Scroll() {
      Column({ space: 18 }) {
        Text('M0 独立定位读取').fontSize(25).fontWeight(FontWeight.Bold)
        Text('只读取前台系统定位。请保持此页面打开，以便电脑进行固定点与恢复验证。')
          .fontSize(16)
        Text(this.status).fontSize(17)
        Text(`已收到 ${this.sampleCount} 个样本`).fontSize(16)
        Button('开始读取').enabled(!this.busy).onClick(() => { this.startReading(); })
        Button('停止读取').onClick(() => { this.stopReading(); })
        Text(this.latest).fontSize(14).fontFamily('monospace').width('100%')
        Text('样本写入本机 M0Reader 调试日志。isMock=null 表示本原型未读取模拟标记，不能据此判定为真实位置。')
          .fontSize(13).fontColor('#555555')
      }.padding(24).width('100%').alignItems(HorizontalAlign.Start)
    }.width('100%').height('100%').backgroundColor('#F5F7F6')
  }
}
