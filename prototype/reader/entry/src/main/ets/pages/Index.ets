import { common } from '@kit.AbilityKit';
import { LocationReader, ObservedLocation, ReaderDiagnostic, ReaderMode } from '../location/LocationReader';

@Entry
@Component
struct Index {
  @State status: string = '尚未开始读取';
  @State latest: string = '等待真实系统定位回调';
  @State sampleCount: number = 0;
  @State busy: boolean = false;
  @State mode: ReaderMode = 'accuracy';
  @State diagnostic: string = '等待原生速度、方向和时间字段';
  @State satellites: string = '等待卫星状态（卫星数量不等于定位成功）';
  @State diagnosticStatus: string = '';
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
      }, (diagnostic: ReaderDiagnostic): void => {
        if (diagnostic.kind === 'location') {
          this.diagnostic = JSON.stringify(diagnostic, null, 2);
        } else if (diagnostic.kind === 'satellites') {
          this.satellites = `卫星报告数 ${diagnostic.satellitesNumber}，最强载噪比 ${diagnostic.strongestCarrierToNoise}`;
        } else {
          this.diagnosticStatus = JSON.stringify(diagnostic);
        }
      }, this.mode);
      this.status = '已订阅，等待系统定位回调';
    } catch (error) {
      this.status = `读取未启动：${error.message}`;
    } finally {
      this.busy = false;
    }
  }

  private async changeMode(mode: ReaderMode): Promise<void> {
    if (this.busy) {
      return;
    }
    try {
      this.reader?.stop();
      this.mode = mode;
      this.diagnostic = '等待新模式的系统定位回调';
      this.satellites = '等待新模式的卫星状态';
      this.diagnosticStatus = '';
      await this.startReading();
    } catch (error) {
      this.status = `切换未完成：${error.message}`;
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
        Text(`请求模式：${this.mode}（系统选源，不保证获得 GNSS）`).fontSize(14)
        Row({ space: 8 }) {
          Button('精度优先').enabled(!this.busy).onClick(() => { this.changeMode('accuracy'); })
          Button('轨迹场景').enabled(!this.busy).onClick(() => { this.changeMode('trajectory'); })
          Button('低功耗').enabled(!this.busy).onClick(() => { this.changeMode('low-power'); })
        }
        Text(this.latest).fontSize(14).fontFamily('monospace').width('100%')
        Text(this.satellites).fontSize(14)
        Text(this.diagnostic).fontSize(14).fontFamily('monospace').width('100%')
        Text(this.diagnosticStatus).fontSize(13).width('100%')
        Text('1.1.0：isMock 原样保留系统 isFromMock；字段不可用为 null。速度和方向来自系统回调。卫星数量不表示已获得 GNSS 定位。日志仅保留本机。')
          .fontSize(13).fontColor('#555555')
      }.padding(24).width('100%').alignItems(HorizontalAlign.Start)
    }.width('100%').height('100%').backgroundColor('#F5F7F6')
  }
}
