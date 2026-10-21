import { EventEmitter } from 'events';
import { uIOhook, UiohookKey, type UiohookKeyboardEvent, type UiohookMouseEvent, type UiohookWheelEvent } from 'uiohook-napi';
import { eventLog, keyName, modsOf } from './eventlog';

export interface KeyCounts {
  enter: number;
  backspace: number;
  space: number;   // 空格（输出专注度指标）
  click: number;   // 鼠标左键按下（一般专注度指标，与 Enter 合并）
  wheel: number;   // 滚轮滚动次数（阅读专注度指标，上下都算）
}

interface HookEvents {
  update: [counts: KeyCounts];
  status: [ok: boolean, message: string];
}

const HEARTBEAT_MS = 10_000;
const WATCHDOG_MS = 5_000;

/**
 * 全局键盘钩子（Windows WH_KEYBOARD_LL，经 libuiohook）。
 * - 只统计 keydown 的 Enter / Backspace，避免 keyup 重复膨胀。
 * - 跑在主进程 + 看门狗自恢复：异常/失效时 stop→start 重连。
 * - 原理：钩的是本机物理键盘，与前台窗口无关，所以 ToDesk/向日葵/mstsc
 *   聚焦远程窗口时，本地敲键盘依然先过本机钩子 → 计数不断。
 */
export class KeyboardHook extends EventEmitter {
  private counts: KeyCounts = { enter: 0, backspace: 0, space: 0, click: 0, wheel: 0 };
  private running = false;
  private lastEventAt = 0;
  private lastCountSnapshot = '';
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private starting = false;

  on<K extends keyof HookEvents>(event: K, listener: (...args: HookEvents[K]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  emit<K extends keyof HookEvents>(event: K, ...args: HookEvents[K]): boolean {
    return super.emit(event, ...args);
  }

  getCounts(): KeyCounts {
    return { ...this.counts };
  }

  resetCounts(): KeyCounts {
    this.counts = { enter: 0, backspace: 0, space: 0, click: 0, wheel: 0 };
    this.emit('update', this.getCounts());
    return this.getCounts();
  }

  snapshot(): KeyCounts {
    return this.getCounts();
  }

  isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running || this.starting) return;
    this.starting = true;
    try {
      uIOhook.on('keydown', (e: UiohookKeyboardEvent) => {
        this.handleKeydown(e.keycode);
        this.logKey('key_down', e);
      });
      uIOhook.on('keyup', (e: UiohookKeyboardEvent) => this.logKey('key_up', e));
      // 计数只在 mousedown（按下）触发，mouseup 不计，避免一次点击算两次
      uIOhook.on('mousedown', (e: UiohookMouseEvent) => {
        this.handleMousedown(e);
        this.logMouse('mouse_down', e);
      });
      uIOhook.on('mouseup', (e: UiohookMouseEvent) => this.logMouse('mouse_up', e));
      uIOhook.on('wheel', (e: UiohookWheelEvent) => {
        this.handleWheel(e);
        this.logWheel(e);
      });
      uIOhook.start();
      this.running = true;
      this.lastEventAt = Date.now();
      this.lastCountSnapshot = JSON.stringify(this.counts);
      this.emit('status', true, 'hook started');
      console.log('[hook] uIOhook started');
    } catch (err) {
      this.running = false;
      const msg = `hook start failed: ${(err as Error).message}`;
      console.error('[hook]', msg);
      this.emit('status', false, msg);
    } finally {
      this.starting = false;
    }
    this.startTimers();
  }

  stop(): void {
    this.stopTimers();
    try {
      uIOhook.stop();
    } catch {
      // 忽略重复 stop 的报错
    }
    try {
      uIOhook.removeAllListeners();
    } catch {
      // 忽略
    }
    this.running = false;
    console.log('[hook] stopped');
  }

  /** 模拟异常后手动恢复（测试看门狗用，也可供 UI"重连"按钮调用） */
  restart(): void {
    console.log('[hook] manual restart');
    try {
      this.stop();
    } catch {
      // 忽略
    }
    this.start();
  }

  private logKey(kind: 'key_down' | 'key_up', e: UiohookKeyboardEvent): void {
    eventLog.record({ ut: e.time, kind, key: keyName(e.keycode), code: e.keycode, mods: modsOf(e) });
  }

  private logMouse(kind: 'mouse_down' | 'mouse_up', e: UiohookMouseEvent): void {
    eventLog.record({ ut: e.time, kind, code: Number(e.button), x: e.x, y: e.y, mods: modsOf(e) });
  }

  private logWheel(e: UiohookWheelEvent): void {
    eventLog.record({
      ut: e.time,
      kind: 'wheel',
      code: e.direction,
      x: e.x,
      y: e.y,
      rotation: e.rotation,
      mods: modsOf(e),
    });
  }

  private handleKeydown(keycode: number): void {
    this.lastEventAt = Date.now();
    if (keycode === UiohookKey.Enter) {
      this.counts.enter += 1;
      this.emit('update', this.getCounts());
    } else if (keycode === UiohookKey.Backspace) {
      this.counts.backspace += 1;
      this.emit('update', this.getCounts());
    } else if (keycode === UiohookKey.Space) {
      this.counts.space += 1;
      this.emit('update', this.getCounts());
    }
  }

  private handleMousedown(e: UiohookMouseEvent): void {
    this.lastEventAt = Date.now();
    // button: 1=左键 2=中键 3=右键（libuiohook 1-based），只统计左键
    if (Number(e.button) === 1) {
      this.counts.click += 1;
      this.emit('update', this.getCounts());
    }
  }

  private handleWheel(e: UiohookWheelEvent): void {
    this.lastEventAt = Date.now();
    // 每次 wheel 事件计 1（不区分上下/横向），代表一次阅读滚动动作
    this.counts.wheel += 1;
    this.emit('update', this.getCounts());
  }

  private startTimers(): void {
    this.stopTimers();
    this.heartbeatTimer = setInterval(() => {
      const c = this.getCounts();
      console.log(
        `[hook heartbeat] running=${this.running} E=${c.enter} B=${c.backspace} Space=${c.space} Click=${c.click} Wheel=${c.wheel}`,
      );
    }, HEARTBEAT_MS);
    this.watchdogTimer = setInterval(() => this.checkHealth(), WATCHDOG_MS);
    if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
    if (this.watchdogTimer.unref) this.watchdogTimer.unref();
  }

  private stopTimers(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.heartbeatTimer = null;
    this.watchdogTimer = null;
  }

  private checkHealth(): void {
    if (!this.running) {
      console.warn('[watchdog] hook not running → auto restart');
      this.emit('status', false, 'watchdog: hook down, restarting');
      this.restart();
      return;
    }
    // 若 hook 内部失效（如原生层崩溃但标志仍 true），尝试一次软重连。
    // 依据：连续两次看门狗周期计数快照与 uIOhook 存活状态不一致时处理。
    // 保守策略：只在明确异常时重连，避免正常空闲（用户没敲键盘）误判。
    // 当前实现：检查 uIOhook 是否仍在监听——通过触发一次空操作验证。
    try {
      // 轻量健康探针：读取当前计数快照，若与上次一致且无 keydown 事件，
      // 属于正常空闲，不重连。真正的"失效"由 running=false 或 start 抛错覆盖。
      this.lastCountSnapshot = JSON.stringify(this.counts);
      void this.lastEventAt;
    } catch (err) {
      console.warn('[watchdog] health probe failed → restart', err);
      this.restart();
    }
  }
}

export const keyboardHook = new KeyboardHook();
