import { getSessions, getConfig, type SessionRecord, type MetricScore, type EndedBy } from './store';

export const FIRST_SESSION_SCORE = 80;
const BASELINE_WINDOW = 20;   // 基线取最近 20 段
const MIN_BASELINE_SEC = 60;  // 至少 1 分钟的段才计入基线

export type MetricKey = 'output' | 'general' | 'reading';

export interface MetricDef {
  label: string;
  /** 本段该指标的原始计数 */
  countOf: (s: SessionRecord) => number;
}

/**
 * 三条专注度指标定义：
 * - output（输出专注度）= 空格
 * - general（一般专注度）= Enter + 鼠标左键点击
 * - reading（阅读专注度）= 滚轮滚动
 */
export const METRICS: Record<MetricKey, MetricDef> = {
  output: { label: '输出', countOf: (s) => s.spaceCount ?? 0 },
  general: { label: '一般', countOf: (s) => s.enterCount + (s.clickCount ?? 0) },
  reading: { label: '阅读', countOf: (s) => s.wheelCount ?? 0 },
};

export const METRIC_KEYS: MetricKey[] = ['output', 'general', 'reading'];

export function normalizeTask(t?: string): string {
  const s = (t || '').trim();
  return s || '未分类';
}

/** 单段是否可用于某指标基线：focus、该指标计数>0、≥60s、非 skip 放弃（不限任务） */
function qualifyBase(s: SessionRecord, metric: MetricKey): boolean {
  return (
    s.type === 'focus' &&
    METRICS[metric].countOf(s) > 0 &&
    s.durationSec >= MIN_BASELINE_SEC &&
    (s.endedBy ?? 'timer') !== 'skip'
  );
}

/** 自动模式用：同一任务类型的段才计入 */
function qualifyOne(s: SessionRecord, task: string, metric: MetricKey): boolean {
  return qualifyBase(s, metric) && normalizeTask(s.task) === task;
}

/** 可用于基线的会话：自动模式下取同任务最近 20 段 */
export function qualifyingSessions(
  task: string,
  sessions: SessionRecord[],
  metric: MetricKey,
): SessionRecord[] {
  return sessions.filter((s) => qualifyOne(s, task, metric)).slice(-BASELINE_WINDOW);
}

function medianRate(list: SessionRecord[], metric: MetricKey): number {
  const rates = list
    .map((s) => METRICS[metric].countOf(s) / (s.durationSec / 60))
    .sort((a, b) => a - b);
  const mid = rates.length >> 1;
  return rates.length % 2 ? rates[mid] : (rates[mid - 1] + rates[mid]) / 2;
}

/** 中位数窗口取值的半径：中位数前后各最多 3 段 */
const MEDIAN_SPREAD = 3;

/**
 * 自动基线速率 = 排序后中位数及其前后各最多 3 段（最多 7 个值）的平均，
 * 比单点中位数更稳、又不被极端值带偏；合格段不足 3 段时直接用中位数本身。
 */
function smoothedMedianRate(list: SessionRecord[], metric: MetricKey): number {
  const rates = list
    .map((s) => METRICS[metric].countOf(s) / (s.durationSec / 60))
    .sort((a, b) => a - b);
  if (rates.length < MEDIAN_SPREAD) return medianRate(list, metric);
  const mid = Math.floor((rates.length - 1) / 2);
  const win = rates.slice(
    Math.max(0, mid - MEDIAN_SPREAD),
    Math.min(rates.length, mid + MEDIAN_SPREAD + 1),
  );
  return win.reduce((a, b) => a + b, 0) / win.length;
}

export interface BaselineInfo {
  rate: number | null;   // 次/分钟（该指标）
  sampleCount: number;
  manual: boolean;       // true = 用户手动选定的样本；false = 自动中位数
}

/**
 * 认真基线 = 同任务历史段该指标速率的「中位数±3 段均值」（抗离群；已有多少合格段就取多少段，
 * 不足 3 段时直接用中位数）。
 * 若用户手动勾选了基线样本（config.baselineIds），则优先用勾选段：
 * 不限任务、不限数量，该指标计数>0 的全部计入（也不受最近 20 段窗口限制），
 * 勾选段取速率中位数；勾选段中无可数据段时回退自动。
 */
export function getBaseline(
  task: string,
  metric: MetricKey,
  sessions?: SessionRecord[],
): BaselineInfo {
  const all = sessions ?? getSessions();
  const manualIds = getConfig().baselineIds ?? [];
  if (manualIds.length > 0) {
    const manual = all.filter((s) => manualIds.includes(s.id) && qualifyBase(s, metric));
    if (manual.length > 0) {
      return { rate: medianRate(manual, metric), sampleCount: manual.length, manual: true };
    }
  }
  const list = qualifyingSessions(task, all, metric);
  if (list.length === 0) return { rate: null, sampleCount: 0, manual: false };
  return { rate: smoothedMedianRate(list, metric), sampleCount: list.length, manual: false };
}

export interface ScoreResult {
  output: MetricScore;
  general: MetricScore;
  reading: MetricScore;
}

/** 单指标速率评分：score = max(0, round(80 × 本段速率 ÷ 基线速率))，无上限 */
function scoreOne(
  count: number,
  durationSec: number,
  baseline: BaselineInfo,
): MetricScore {
  if (count === 0) {
    return { score: null, baselineRate: baseline.rate, deltaPct: null };
  }
  if (baseline.rate == null) {
    return { score: FIRST_SESSION_SCORE, baselineRate: null, deltaPct: null, first: true };
  }
  const minutes = Math.max(1, durationSec / 60);
  const rate = count / minutes;
  return {
    score: Math.max(0, Math.round((80 * rate) / baseline.rate)),
    baselineRate: baseline.rate,
    deltaPct: Math.round((rate / baseline.rate - 1) * 100),
  };
}

const NULL_SCORE: MetricScore = { score: null, baselineRate: null, deltaPct: null };

/** 三条指标基线一次性取齐（按 task 缓存时用） */
export function getBaselines(
  task: string,
  sessions?: SessionRecord[],
): Record<MetricKey, BaselineInfo> {
  return {
    output: getBaseline(task, 'output', sessions),
    general: getBaseline(task, 'general', sessions),
    reading: getBaseline(task, 'reading', sessions),
  };
}

/**
 * 专注分（基线模型，三指标独立）：
 * - 无基线（该指标该任务首段）：计数>0 → 80 分建档；计数=0 → null（无数据）
 * - 有基线：score = max(0, round(80 × 本段速率 ÷ 基线速率))，不设 100 分上限
 * - <1 分钟的段按 1 分钟折算，避免速率先真
 */
export function calcFocusScores(
  counts: { enterCount: number; spaceCount: number; clickCount: number; wheelCount: number },
  durationSec: number,
  task: string,
  sessions?: SessionRecord[],
  precomputed?: Record<MetricKey, BaselineInfo>,
): ScoreResult {
  const t = normalizeTask(task);
  const bl = precomputed ?? getBaselines(t, sessions);
  const per: Record<MetricKey, number> = {
    output: counts.spaceCount,
    general: counts.enterCount + counts.clickCount,
    reading: counts.wheelCount,
  };
  const out = {} as ScoreResult;
  for (const k of METRIC_KEYS) out[k] = scoreOne(per[k], durationSec, bl[k]);
  return out;
}

export function rescoreSessions(sessions: SessionRecord[]): SessionRecord[] {
  // 同任务段共享同一组基线，按任务缓存避免 O(n²)
  const cache = new Map<string, Record<MetricKey, BaselineInfo>>();
  const baselinesFor = (task: string): Record<MetricKey, BaselineInfo> => {
    let bl = cache.get(task);
    if (!bl) {
      bl = getBaselines(task, sessions);
      cache.set(task, bl);
    }
    return bl;
  };
  return sessions.map((s) => {
    if (s.type !== 'focus') {
      const scores = { output: NULL_SCORE, general: NULL_SCORE, reading: NULL_SCORE };
      return { ...s, scores, score: null, baselineRate: null, deltaPct: null };
    }
    const bl = baselinesFor(normalizeTask(s.task));
    const r = calcFocusScores(
      {
        enterCount: s.enterCount,
        spaceCount: s.spaceCount ?? 0,
        clickCount: s.clickCount ?? 0,
        wheelCount: s.wheelCount ?? 0,
      },
      s.durationSec,
      s.task,
      sessions,
      bl,
    );
    return {
      ...s,
      scores: r,
      // 兼容字段 = general 分，老 UI/外部脚本继续可用
      score: r.general.score,
      baselineRate: r.general.baselineRate,
      deltaPct: r.general.deltaPct,
    };
  });
}

/**
 * 归档一段：scores 为「结束时按当时基线」算出的存档值，仅供回溯；
 * UI 展示一律走 rescoreSessions 按当前基线重算的视图。
 */
export function buildSessionRecord(input: {
  type: SessionRecord['type'];
  start: Date;
  end: Date;
  durationSec: number;
  enterCount: number;
  backspaceCount: number;
  spaceCount: number;
  clickCount: number;
  wheelCount: number;
  task: string;
  endedBy?: EndedBy;
}): SessionRecord {
  const task = normalizeTask(input.task);
  const result =
    input.type === 'focus'
      ? calcFocusScores(
          {
            enterCount: input.enterCount,
            spaceCount: input.spaceCount,
            clickCount: input.clickCount,
            wheelCount: input.wheelCount,
          },
          input.durationSec,
          task,
        )
      : ({ output: NULL_SCORE, general: NULL_SCORE, reading: NULL_SCORE } as ScoreResult);
  return {
    id: `${input.start.getTime()}-${input.type}`,
    type: input.type,
    start: input.start.toISOString(),
    end: input.end.toISOString(),
    durationSec: input.durationSec,
    enterCount: input.enterCount,
    backspaceCount: input.backspaceCount,
    spaceCount: input.spaceCount,
    clickCount: input.clickCount,
    wheelCount: input.wheelCount,
    scores: result,
    // 兼容字段 = general 分
    score: result.general.score,
    task,
    endedBy: input.endedBy ?? 'timer',
    baselineRate: result.general.baselineRate,
    deltaPct: result.general.deltaPct,
  };
}
