import Store from 'electron-store';

export interface AppConfig {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakEvery: number;
  testMode: boolean; // 1分钟一段，方便验证
  smoothC: number;    // 平滑常数，默认 5
  baselineIds: string[]; // 手动选定的基线样本 session id（选定后优先于自动中位数）
  guideAck: boolean;  // 启动引导弹窗「我已知晓，不再出现」已确认
  // 段结束提醒渠道（可各自独立开关）
  notifySystem: boolean; // Windows 系统通知（带 hero 大图）
  notifyPopup: boolean;  // 应用内大弹窗（把主窗口拉到前台，一直显示、手动关闭）
  notifyWeb: boolean;    // 默认浏览器打开提醒网页（大图大字）
}

export interface SessionRecord {
  id: string;
  type: 'focus' | 'short' | 'long';
  start: string; // ISO
  end: string;   // ISO
  durationSec: number;
  enterCount: number;
  backspaceCount: number;
  spaceCount?: number;   // 空格（旧记录缺省为 0）
  clickCount?: number;   // 鼠标左键点击（旧记录缺省为 0）
  wheelCount?: number;   // 滚轮滚动次数（旧记录缺省为 0）
  /**
   * 三条专注分（focus 段才有；无数据为 null）。
   * - output：空格速率基线分
   * - general：Enter+左键 速率基线分
   * - reading：滚轮速率基线分
   * 旧记录无 scores 字段时，由旧 score/baselineRate/deltaPct 合成为 general。
   */
  scores?: {
    output: MetricScore;
    general: MetricScore;
    reading: MetricScore;
  };
  score: number | null;       // 兼容字段：= general.score（新记录同步写入，旧 UI/外部脚本可继续用）
  task: string;               // 工作类型（用户输入），基线按类型分算
  endedBy: EndedBy;           // 段如何结束：timer=到时 early=提前完成 skip=放弃
  baselineRate: number | null;// 兼容字段：= general.baselineRate
  deltaPct: number | null;    // 兼容字段：= general.deltaPct
}

export interface MetricScore {
  score: number | null;        // null = 该指标无数据（本段计数为 0）或非 focus 段
  baselineRate: number | null; // 评分时的该指标基线速率（次/分）
  deltaPct: number | null;     // 相对基线 ±%
  first?: boolean;             // 首段建档（无基线，给 80 分）
}

export type EndedBy = 'timer' | 'early' | 'skip';

interface StoreSchema {
  config: AppConfig;
  sessions: SessionRecord[];
}

const defaults: StoreSchema = {
  config: {
    focusMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    longBreakEvery: 4,
    testMode: false,
    smoothC: 5,
    baselineIds: [],
    guideAck: false,
    notifySystem: true,
    notifyPopup: false,
    // 网页提醒默认开：系统通知容易被专注助手/勿扰吞掉或被忽略，浏览器大字页最不容易漏看
    notifyWeb: true,
  },
  sessions: [],
};

const store = new Store<StoreSchema>({
  defaults,
  // electron-store 自动注入 app.getVersion() 作为 projectVersion：升级后触发 migrations，老字段结构平滑迁移
  migrations: {
    // 0.1.x → 0.2.0：config 新增 guideAck（启动引导已确认标记），补默认值 false
    // 注意：只补新字段，**不要** `{...defaults.config, ...}` 把当时的默认值写死进存储，
    // 否则以后改默认值（如 notifyWeb）对老用户永不生效
    '0.2.0': (s) => {
      const cfg = s.get('config') ?? ({} as AppConfig);
      s.set('config', { ...cfg, guideAck: cfg.guideAck ?? false });
    },
  },
});

export function getConfig(): AppConfig {
  // 合并默认值：旧版本 config.json 缺少新字段（如 baselineIds）时补齐
  return { ...defaults.config, ...store.get('config') };
}

export function setConfig(patch: Partial<AppConfig>): AppConfig {
  const next = { ...store.get('config'), ...patch };
  store.set('config', next);
  return next;
}

export function getSessions(): SessionRecord[] {
  const list = store.get('sessions');
  // 旧版本状态机会把同一段重复归档（同 id 多条），读取时去重（保留首条）并写回
  const seen = new Set<string>();
  const out = list.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
  if (out.length !== list.length) store.set('sessions', out);
  // 旧记录兼容：补新计数字段缺省 + 合成 scores.general
  return out.map(migrateRecord);
}

/** 旧记录读时补齐新字段；新记录原样返回（不重写存储，避免每次读都落盘） */
export function migrateRecord(s: SessionRecord): SessionRecord {
  const spaceCount = s.spaceCount ?? 0;
  const clickCount = s.clickCount ?? 0;
  const wheelCount = s.wheelCount ?? 0;
  const needsPatch =
    spaceCount !== s.spaceCount || clickCount !== s.clickCount || wheelCount !== s.wheelCount;
  const scores =
    s.scores ??
    ({
      output: { score: null, baselineRate: null, deltaPct: null },
      general: { score: s.score, baselineRate: s.baselineRate, deltaPct: s.deltaPct },
      reading: { score: null, baselineRate: null, deltaPct: null },
    } as SessionRecord['scores']);
  if (!needsPatch && s.scores) return s;
  return { ...s, spaceCount, clickCount, wheelCount, scores };
}

export function appendSession(s: SessionRecord): SessionRecord[] {
  const list = store.get('sessions');
  list.push(s);
  // 上限保留 5000 条，防止 JSON 无限膨胀（PLAN：上万再迁 sqlite）
  const trimmed = list.length > 5000 ? list.slice(list.length - 5000) : list;
  store.set('sessions', trimmed);
  return trimmed;
}

export function clearSessions(): void {
  store.set('sessions', []);
}

/** 选择性删除：按 id 删除指定 session 记录（如测试产生的数据点）；原始事件日志不受影响 */
export function deleteSessions(ids: string[]): SessionRecord[] {
  const rm = new Set(ids);
  const out = getSessions().filter((s) => !rm.has(s.id));
  store.set('sessions', out);
  return out;
}
