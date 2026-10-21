import { EventEmitter } from 'events';
import { getConfig, appendSession, type SessionRecord, type EndedBy } from './store';
import { buildSessionRecord, normalizeTask } from './focus';
import { keyboardHook } from './hook';
import { eventLog } from './eventlog';

export type Phase = 'idle' | 'focus' | 'short' | 'long';
export type RunState = 'stopped' | 'running' | 'paused';

export interface PomodoroState {
  phase: Phase;
  runState: RunState;
  totalSec: number;
  remainingSec: number;
  endsAt: number | null; // wall-clock 时间戳，用于漂移修正/休眠补偿
  completedFocusCount: number; // 当前轮已完成的 focus 数（决定是否进 long）
  cycleFocusTotal: number;
  task: string; // 当前/下一段的工作类型
  awaitingStart: boolean; // 休息结束后等待用户手动开始下一个专注
}

interface PomodoroEvents {
  tick: [state: PomodoroState];
  phaseEnd: [record: SessionRecord | null, next: PomodoroState];
}

const TICK_MS = 250;
const CMD_DEBOUNCE_MS = 700; // 防止按键焦点风暴连跳段
const MIN_ARCHIVE_SEC = 3;   // <3s 且无按键的段不落盘（防风暴垃圾数据）
const EARLY_BREAK_SEC = 180; // 提前完成后的固定休息时长（3 分钟）

/**
 * 番茄状态机（跑在主进程）：
 * - setInterval(250ms) + wall-clock(endsAt) 漂移修正，休眠唤醒后自动补偿。
 * - 切换番茄段时把当前 E/B 快照归档成一条 session（focus 段带基线分），只归档一次。
 * - focus 到时 → 自动进入休息；休息到时 → 必须手动开始下一个专注。
 * - 提前完成（focus）→ 固定 3 分钟休息，让人可以喘口气再开始下一段。
 * - 每段一种工作类型（task），focus 进行中不允许改。
 */
export class Pomodoro extends EventEmitter {
  private state: PomodoroState = {
    phase: 'idle',
    runState: 'stopped',
    totalSec: 0,
    remainingSec: 0,
    endsAt: null,
    completedFocusCount: 0,
    cycleFocusTotal: 0,
    task: '',
    awaitingStart: false,
  };
  private timer: NodeJS.Timeout | null = null;
  private segmentStart: Date | null = null;
  private lastCmdAt = 0;

  on<K extends keyof PomodoroEvents>(event: K, listener: (...args: PomodoroEvents[K]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  emit<K extends keyof PomodoroEvents>(event: K, ...args: PomodoroEvents[K]): boolean {
    return super.emit(event, ...args);
  }

  getState(): PomodoroState {
    return { ...this.state };
  }

  /** 每段时长（秒），testMode 下全部 60 秒 */
  durationFor(phase: Exclude<Phase, 'idle'>): number {
    const cfg = getConfig();
    if (cfg.testMode) return 60;
    switch (phase) {
      case 'focus':
        return Math.max(1, cfg.focusMinutes) * 60;
      case 'short':
        return Math.max(1, cfg.shortBreakMinutes) * 60;
      case 'long':
        return Math.max(1, cfg.longBreakMinutes) * 60;
    }
  }

  /** 设置工作类型；focus 进行中不允许改（一段只做一种类型） */
  setTask(task: string): PomodoroState {
    if (this.state.phase === 'focus') return this.getState();
    this.state.task = normalizeTask(task) === '未分类' && task.trim() === '' ? '' : task.trim();
    this.emit('tick', this.getState());
    return this.getState();
  }

  private debounce(): boolean {
    const now = Date.now();
    if (now - this.lastCmdAt < CMD_DEBOUNCE_MS) return true;
    this.lastCmdAt = now;
    return false;
  }

  /** 启动一段（内部方法，不做防抖、不归档旧段） */
  private beginPhase(phase: Exclude<Phase, 'idle'>, totalSecOverride?: number): PomodoroState {
    if (phase === 'focus' && !this.state.task.trim()) {
      this.state.task = '未分类';
    }
    const totalSec = totalSecOverride ?? this.durationFor(phase);
    this.segmentStart = new Date();
    keyboardHook.resetCounts();
    eventLog.setContext(phase, `${this.segmentStart.getTime()}-${phase}`);
    this.state = {
      ...this.state,
      phase,
      runState: 'running',
      totalSec,
      remainingSec: totalSec,
      endsAt: Date.now() + totalSec * 1000,
      awaitingStart: false,
    };
    this.startTimer();
    this.emit('tick', this.getState());
    return this.getState();
  }

  /** 用户主动切换/启动某段：防抖 + 把上一段按放弃归档 */
  startPhase(phase: Exclude<Phase, 'idle'>): PomodoroState {
    if (this.debounce()) return this.getState();
    this.archiveCurrentSegment(new Date(), 'skip');
    return this.beginPhase(phase);
  }

  start(): PomodoroState {
    if (this.state.runState === 'running') return this.getState();
    if (this.state.phase === 'idle' || this.state.runState === 'stopped') {
      return this.beginPhase('focus');
    }
    // paused → resume
    return this.resume();
  }

  pause(): PomodoroState {
    if (this.state.runState !== 'running') return this.getState();
    this.state.runState = 'paused';
    this.state.endsAt = null;
    this.stopTimer();
    this.emit('tick', this.getState());
    return this.getState();
  }

  resume(): PomodoroState {
    if (this.state.runState !== 'paused') return this.getState();
    this.state.runState = 'running';
    this.state.endsAt = Date.now() + this.state.remainingSec * 1000;
    this.startTimer();
    this.emit('tick', this.getState());
    return this.getState();
  }

  /** 跳过当前段（放弃）：归档后回到待机，由用户手动开始下一段 */
  skip(): PomodoroState {
    if (this.state.phase === 'idle') return this.getState();
    if (this.debounce()) return this.getState();
    const record = this.archiveCurrentSegment(new Date(), 'skip');
    this.toAwaiting();
    this.emit('phaseEnd', record, this.getState());
    return this.getState();
  }

  /** 提前完成（仅 focus）：正常计入，然后固定 3 分钟休息 */
  finishEarly(): PomodoroState {
    if (this.state.phase !== 'focus') return this.skip();
    if (this.debounce()) return this.getState();
    const record = this.archiveCurrentSegment(new Date(), 'early');
    this.state.completedFocusCount += 1;
    this.state.cycleFocusTotal += 1;
    // 提前完成的这一段若刚好凑满一轮，也视为完成一轮长休节奏
    const every = Math.max(1, getConfig().longBreakEvery);
    if (this.state.completedFocusCount % every === 0) this.state.completedFocusCount = 0;
    this.beginPhase('short', getConfig().testMode ? 60 : EARLY_BREAK_SEC);
    this.emit('phaseEnd', record, this.getState());
    return this.getState();
  }

  reset(): PomodoroState {
    if (this.debounce()) return this.getState();
    this.archiveCurrentSegment(new Date(), 'skip', true);
    this.stopTimer();
    this.segmentStart = null;
    keyboardHook.resetCounts();
    eventLog.setContext('idle', null);
    this.state = {
      phase: 'idle',
      runState: 'stopped',
      totalSec: 0,
      remainingSec: 0,
      endsAt: null,
      completedFocusCount: this.state.completedFocusCount,
      cycleFocusTotal: this.state.cycleFocusTotal,
      task: this.state.task,
      awaitingStart: false,
    };
    this.emit('tick', this.getState());
    return this.getState();
  }

  /** focus 完成后进短休/长休：每 N 个进长休 */
  private advanceFrom(): 'short' | 'long' {
    const every = Math.max(1, getConfig().longBreakEvery);
    return this.state.completedFocusCount % every === 0 ? 'long' : 'short';
  }

  /** 回到待机并等待用户手动开始（休息结束/跳过后） */
  private toAwaiting(): void {
    this.stopTimer();
    this.segmentStart = null;
    keyboardHook.resetCounts();
    eventLog.setContext('idle', null);
    this.state = {
      ...this.state,
      phase: 'idle',
      runState: 'stopped',
      totalSec: 0,
      remainingSec: 0,
      endsAt: null,
      awaitingStart: true,
    };
    this.emit('tick', this.getState());
  }

  private startTimer(): void {
    this.stopTimer();
    this.timer = setInterval(() => this.onTick(), TICK_MS);
    if (this.timer.unref) this.timer.unref();
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private onTick(): void {
    if (this.state.runState !== 'running' || this.state.endsAt == null) return;
    // wall-clock 补偿：休眠/漂移后按 Date.now() - endsAt 直接结算
    const remaining = Math.max(0, Math.round((this.state.endsAt - Date.now()) / 1000));
    this.state.remainingSec = remaining;
    this.emit('tick', this.getState());
    if (remaining <= 0) {
      this.onPhaseComplete();
    }
  }

  private onPhaseComplete(): void {
    const now = new Date();
    const finished = this.state.phase as Exclude<Phase, 'idle'>;
    const record = this.archiveCurrentSegment(now, 'timer');
    if (finished === 'focus') {
      this.state.completedFocusCount += 1;
      this.state.cycleFocusTotal += 1;
      this.beginPhase(this.advanceFrom()); // focus 结束自动进入休息
    } else {
      // 休息结束：不自动开始专注，等用户手动点开始
      if (finished === 'long') this.state.completedFocusCount = 0; // 长休后开启新一轮
      this.toAwaiting();
    }
    this.emit('phaseEnd', record, this.getState());
  }

  /**
   * 把当前段归档落盘（同一 segment 只会归档一次）。
   * @param discardable true 时（reset），无按键且 <5s 的段直接丢弃
   */
  private archiveCurrentSegment(
    now: Date,
    endedBy: EndedBy,
    discardable = false,
  ): SessionRecord | null {
    if (this.state.phase === 'idle' || !this.segmentStart) return null;
    const start = this.segmentStart;
    this.segmentStart = null; // 立即清掉，防止同一段被归档多次
    const counts = keyboardHook.snapshot();
    const durationSec = Math.max(0, Math.round((now.getTime() - start.getTime()) / 1000));
    const anyActivity =
      counts.enter !== 0 || counts.backspace !== 0 || counts.space !== 0 ||
      counts.click !== 0 || counts.wheel !== 0;
    // 垃圾段守卫：<3s 且无任何按键/鼠标/滚轮活动（如焦点风暴造成的瞬间切段）不落盘
    if (
      (durationSec < MIN_ARCHIVE_SEC && !anyActivity) ||
      (discardable && !anyActivity && durationSec < 5)
    ) {
      return null;
    }
    const record = buildSessionRecord({
      type: this.state.phase as SessionRecord['type'],
      start,
      end: now,
      durationSec,
      enterCount: counts.enter,
      backspaceCount: counts.backspace,
      spaceCount: counts.space,
      clickCount: counts.click,
      wheelCount: counts.wheel,
      task: this.state.task,
      endedBy,
    });
    // testMode（测试模型/调试）下不归档展示数据：原始事件日志（events/*.jsonl）照常记录，
    // 便于回头分析；统计/趋势/表格里不会出现测试段
    if (getConfig().testMode) return record;
    appendSession(record);
    return record;
  }
}

export const pomodoro = new Pomodoro();
