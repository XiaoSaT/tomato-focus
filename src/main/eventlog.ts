import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { UiohookKey } from 'uiohook-napi';

/**
 * 原始事件日志（用于后续建模分析）
 * - 每行一条 JSON（JSONL），按本地日期分文件：userData/events/YYYY-MM-DD.jsonl
 * - t：事件接收时刻的 Unix epoch 毫秒（Date.now()）
 * - ut：uiohook 原生时间（开机后毫秒，仅作参考、不是 Unix 时间）
 * - 键盘：key_down / key_up（只记键码/键名，不记录字符内容）
 * - 鼠标：mouse_down / mouse_up（只记按钮与坐标；不记录鼠标移动）
 * - 滚轮：wheel（记方向/坐标/rotation）
 * - phase / seg：事件发生时所处的番茄阶段，seg 与 sessions.id 一致，可直接 join
 */

export type EventKind = 'key_down' | 'key_up' | 'mouse_down' | 'mouse_up' | 'wheel';

export interface RawEvent {
  ut: number;          // uiohook 原生时间（开机后毫秒）
  kind: EventKind;
  key?: string;        // 键名，如 Enter / Backspace / A
  code?: number;       // 键码（键盘）、按钮编号（鼠标：1左 2右 3中）或滚轮方向（3垂直 4横向）
  x?: number;          // 鼠标坐标
  y?: number;
  rotation?: number;   // 滚轮 rotation（wheel 事件）
  mods: number;        // 修饰键位掩码：1=Shift 2=Ctrl 4=Alt 8=Meta
}

export interface LoggedEvent extends RawEvent {
  t: number;           // Unix epoch ms（接收时刻）
  phase: string;       // focus | short | long | idle
  seg: string | null;  // 番茄段 id（= sessions.id），idle 时为 null
}

const KEY_NAMES: Record<number, string> = {};
for (const [name, code] of Object.entries(UiohookKey)) {
  KEY_NAMES[code as number] = name;
}

export function keyName(code: number): string {
  return KEY_NAMES[code] ?? `code_${code}`;
}

export function modsOf(e: {
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}): number {
  return (e.shiftKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.altKey ? 4 : 0) | (e.metaKey ? 8 : 0);
}

const FLUSH_MS = 1000;
const FLUSH_BATCH = 500;

function localDay(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

class EventLog {
  private dir: string | null = null;
  private buffer: { day: string; line: string }[] = [];
  private phase = 'idle';
  private seg: string | null = null;
  private timer: NodeJS.Timeout | null = null;

  init(): void {
    this.dir = path.join(app.getPath('userData'), 'events');
    fs.mkdirSync(this.dir, { recursive: true });
    if (!this.timer) {
      this.timer = setInterval(() => this.flush(), FLUSH_MS);
      this.timer.unref?.();
    }
    console.log('[eventlog] dir =', this.dir);
  }

  getDir(): string {
    return this.dir ?? path.join(app.getPath('userData'), 'events');
  }

  /** 番茄段切换时调用：之后的事件都会打上这个 phase/seg */
  setContext(phase: string, seg: string | null): void {
    this.phase = phase;
    this.seg = seg;
  }

  record(raw: RawEvent): void {
    if (!this.dir) return; // 未初始化时丢弃（启动早期）
    const t = Date.now();
    const ev: LoggedEvent = { t, ...raw, phase: this.phase, seg: this.seg };
    this.buffer.push({ day: localDay(t), line: JSON.stringify(ev) });
    if (this.buffer.length >= FLUSH_BATCH) this.flush();
  }

  flush(): void {
    if (!this.dir || this.buffer.length === 0) return;
    const batch = this.buffer.splice(0, this.buffer.length);
    const byDay = new Map<string, string[]>();
    for (const b of batch) {
      const arr = byDay.get(b.day) ?? [];
      arr.push(b.line);
      byDay.set(b.day, arr);
    }
    for (const [day, lines] of byDay) {
      try {
        fs.appendFileSync(path.join(this.dir, `${day}.jsonl`), lines.join('\n') + '\n', 'utf8');
      } catch (err) {
        console.error('[eventlog] write failed', err);
      }
    }
  }

  close(): void {
    this.flush();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export const eventLog = new EventLog();
