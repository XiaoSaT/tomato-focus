import { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, powerMonitor, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { keyboardHook } from './hook';
import { eventLog } from './eventlog';
import { createFullscreenWatcher } from './fgwatch';
import { pomodoro } from './pomodoro';
import { getConfig, setConfig, getSessions, clearSessions, deleteSessions, type AppConfig } from './store';
import { getBaselines, normalizeTask, rescoreSessions, type MetricKey } from './focus';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
const isTestMode = process.argv.includes('--test-mode');
const remindDemo = process.argv.find((a) => a.startsWith('--remind-demo')) ?? null;

// 单实例锁：第二个实例直接退出并唤起已有窗口，避免双钩子/双写
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // 第二个实例启动时，唤起已有窗口（否则双击图标会“无反应”）
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
}

// Windows 通知身份：Electron 默认取 `electron.app.<appName>`，这个身份系统没注册过，
// Toast 会被静默丢弃（应用内弹窗/网页渠道不受影响，但系统通知渠道就永远看不到）。
// 打包版显式用打包配置里的 appId，与 electron-builder 创建的开始菜单快捷方式的 AUMID 对齐，
// 通知才能正常显示。只在打包版设置：dev 启动器不要抢这个身份，
// 否则 Windows 会把 appId 映射到 electron.exe 的通用图标上。
if (process.platform === 'win32' && app.isPackaged) {
  app.setAppUserModelId('com.tomatofocus.app');
}

function resolveRenderer(): string {
  return path.join(__dirname, '../renderer/index.html');
}

function resolvePreload(): string {
  return path.join(__dirname, '../preload/preload.js');
}

function resolveIcon(): string {
  return path.join(__dirname, '../icon.png');
}

/** 解析 dist/assets 下的静态资源；打包后 app.asar 内的文件 Windows 通知读不到，优先用 asarUnpack 出来的真实路径 */
function resolveAsset(name: string): string | null {
  const p = path.join(__dirname, '../assets', name);
  const unpacked = p.replace('app.asar', 'app.asar.unpacked');
  if (fs.existsSync(unpacked)) return unpacked;
  return fs.existsSync(p) ? p : null;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 1000,
    minWidth: 920,
    minHeight: 720,
    backgroundColor: '#f5f3ef',
    icon: resolveIcon(),
    title: 'TomatoFocus 番茄专注',
    webPreferences: {
      preload: resolvePreload(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(resolveRenderer());
  mainWindow.on('minimize', () => {
    mainWindow?.hide();
  });
  mainWindow.on('close', (e: Electron.Event) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}

function emptySeries(): Record<string, { minuteOfDay: number; count: number }[]> {
  return { enter: [], space: [], click: [], wheel: [] };
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case 'focus':
      return '专注中';
    case 'short':
      return '短休息';
    case 'long':
      return '长休息';
    default:
      return '待机';
  }
}

/**
 * Windows 系统通知：系统字号改不了，但可以用自定义 Toast XML 挂一张 2:1 的 hero 大图
 * （推荐 364x180 @100%，我们出 728x360）。图片必须是磁盘上的真实文件。
 */
function buildToastXml(title: string, body: string, heroName?: string): string | undefined {
  const hero = heroName ? resolveAsset(heroName) : null;
  const img = hero ? `<image placement="hero" src="${pathToFileURL(hero).href}"/>` : '';
  if (!img) return undefined;
  return (
    '<toast>' +
    '<visual>' +
    '<binding template="ToastGeneric">' +
    `<text>${xmlEscape(title)}</text>` +
    `<text>${xmlEscape(body)}</text>` +
    img +
    '</binding>' +
    '</visual>' +
    '</toast>'
  );
}

/**
 * 提醒渠道日志：写 userData/logs/remind.log。打包后没有控制台，
 * 出现「到点了却没提醒」时可以直接看这个文件，区分是没触发还是被系统吃掉。
 */
function remindLog(msg: string): void {
  console.log('[remind]', msg);
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'remind.log'), `[${new Date().toISOString()}] ${msg}\n`, 'utf8');
  } catch {
    /* 日志写不进去也不影响提醒本身 */
  }
}

function notify(title: string, body: string, hero?: string): void {
  if (!Notification.isSupported()) {
    remindLog('系统通知不受支持（Notification.isSupported=false），跳过');
    return;
  }
  let toastXml: string | undefined;
  try {
    toastXml = hero ? buildToastXml(title, body, hero) : undefined;
  } catch (err) {
    // hero 图异常时回退到系统默认通知，不影响提醒本身
    remindLog(`自定义 Toast XML 构建失败，回退默认通知：${(err as Error).message}`);
  }
  // 兜底：Windows 对自定义 Toast XML（尤其带 hero 大图）可能静默丢弃，
  // 一旦收到 failed 就补一条纯文本通知，保证「到点提醒」不丢
  const plainFallback = () => {
    try {
      const fb = new Notification({ title, body });
      fb.on('click', focusMainWindow);
      fb.show();
      remindLog('已回退为纯文本通知');
    } catch (err) {
      remindLog(`回退纯文本通知也失败：${(err as Error).message}`);
    }
  };
  const n = new Notification({ title, body, toastXml });
  n.on('click', focusMainWindow);
  n.on('show', () => remindLog(`系统通知已显示（hero=${hero ?? '无'}）`));
  n.on('failed', (_e, err) => {
    remindLog(`系统通知失败：${err}${toastXml ? '，重试纯文本' : ''}`);
    if (toastXml) plainFallback();
  });
  n.show();
}

/**
 * 段结束提醒：系统通知 / 应用内大弹窗 / 浏览器网页 三个渠道，由设置里的开关各自控制。
 * 弹窗和网页版都是「一直显示、手动关闭」，保证不容易漏看。
 */
interface RemindPayload {
  kind: 'focus' | 'break';
  title: string;
  lines: string[];
  hero: string; // assets 下的文件名
}

function focusMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  // Windows 有「抢焦点保护」，单纯 focus() 可能被忽略：短暂置顶 + 闪任务栏按钮兜底
  mainWindow.setAlwaysOnTop(true);
  mainWindow.show();
  mainWindow.moveTop();
  mainWindow.focus();
  mainWindow.flashFrame(true);
  setTimeout(() => {
    if (!mainWindow) return;
    mainWindow.setAlwaysOnTop(false);
    mainWindow.flashFrame(false);
  }, 1200);
}

// 弹窗提醒可能比渲染层注册监听到得早（渲染层 init 里有多个 await），
// 所以既推也给一次「取未消费提醒」的拉取，渲染层用 id 去重。
let pendingRemind: (RemindPayload & { id: number }) | null = null;
let remindSeq = 0;

/** 窗口可能已销毁（退出中）：发消息统一走这里，别让异常打断提醒流程 */
function safeSend(channel: string, payload: unknown): void {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(channel, payload);
  } catch (err) {
    remindLog(`向渲染层发送 ${channel} 失败：${(err as Error).message}`);
  }
}

function sendPopupRemind(p: RemindPayload): void {
  pendingRemind = { ...p, id: ++remindSeq };
  const send = () => safeSend('remind:popup', pendingRemind);
  if (mainWindow && mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', send);
  else send();
  remindLog(`应用内弹窗已投递（id=${pendingRemind.id}）`);
}

/**
 * 浏览器渠道：把提醒内容烘进一份临时 HTML（Windows 会丢掉 file:// URL 上的 ?query，
 * 所以不能靠 query 传参），再用默认浏览器打开。页面模板：assets/remind.html
 */
function openWebReminder(p: RemindPayload): void {
  const tplPath = resolveAsset('remind.html');
  if (!tplPath) {
    console.warn('[remind] 未找到 assets/remind.html，跳过网页提醒');
    return;
  }
  const heroPath = resolveAsset(p.hero);
  const data = {
    kind: p.kind,
    title: p.title,
    lines: p.lines,
    heroUrl: heroPath ? pathToFileURL(heroPath).href : '',
  };

  let html: string;
  try {
    const tpl = fs.readFileSync(tplPath, 'utf8');
    // 替换 <script id="remind-data"> 里的内容；`<` 转义避免提前结束 script 标签
    const json = JSON.stringify(data).replace(/</g, '\\u003c');
    html = tpl.replace(
      /(<script id="remind-data"[^>]*>)([\s\S]*?)(<\/script>)/,
      (_m, open: string, _body: string, close: string) => open + json + close,
    );
    if (html === tpl) throw new Error('模板缺少 remind-data 占位');
  } catch (err) {
    console.warn('[remind] 生成提醒页失败，回退成 query 传参：', err);
    const q = new URLSearchParams({ k: p.kind, t: p.title, l: p.lines.join('\n'), h: p.hero });
    shell.openExternal(`${pathToFileURL(tplPath).href}?${q.toString()}`).catch(() => undefined);
    return;
  }

  // 文件名带时间戳：每次都是新 URL，避开浏览器 file:// 缓存
  const out = path.join(app.getPath('temp'), `tomato-focus-remind-${Date.now()}.html`);
  try {
    fs.writeFileSync(out, html, 'utf8');
    cleanOldRemindPages();
    remindLog(`浏览器提醒页已生成：${out}`);
    shell.openExternal(pathToFileURL(out).href).catch((err) => {
      remindLog(`打开提醒网页失败：${(err as Error).message}`);
    });
  } catch (err) {
    remindLog(`写入提醒页失败：${(err as Error).message}`);
  }
}

/** 清理 2 天前的临时提醒页，避免 %TEMP% 里越堆越多 */
function cleanOldRemindPages(): void {
  try {
    const dir = app.getPath('temp');
    const cutoff = Date.now() - 2 * 24 * 3600 * 1000;
    for (const f of fs.readdirSync(dir)) {
      if (!/^tomato-focus-remind-\d+\.html$/.test(f)) continue;
      const full = path.join(dir, f);
      if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
    }
  } catch {
    /* 清理失败无所谓 */
  }
}

/** only：覆盖配置的调试用渠道列表（--remind-demo 预览） */
function remind(p: RemindPayload, only?: string[]): void {
  const cfg = getConfig();
  const on = (name: string, configured: boolean) => (only ? only.includes(name) : configured);

  const fired: string[] = [];

  if (on('system', cfg.notifySystem !== false)) {
    fired.push('system');
    notify(p.title, p.lines.join(' · '), p.hero);
  }

  if (on('popup', cfg.notifyPopup)) {
    fired.push('popup');
    focusMainWindow();
    sendPopupRemind(p);
  }

  if (on('web', cfg.notifyWeb)) {
    fired.push('web');
    openWebReminder(p);
  }

  remindLog(
    `段结束提醒 kind=${p.kind} title="${p.title}" 渠道=[${fired.join(', ') || '无'}] ` +
      `开关(system=${cfg.notifySystem}, popup=${cfg.notifyPopup}, web=${cfg.notifyWeb})`,
  );
  if (fired.length === 0) remindLog('注意：到点了但三个提醒渠道都关着 —— 去设置里把对应开关打开');
}

function createTray(): void {
  const icon = nativeImage.createFromPath(resolveIcon());
  tray = new Tray(icon);
  tray.setToolTip('TomatoFocus 番茄专注');
  const menu = Menu.buildFromTemplate([
    { label: '显示主界面', click: () => mainWindow?.show() },
    { label: '开始专注', click: () => pomodoro.start() },
    { label: '跳过当前段', click: () => pomodoro.skip() },
    { label: '打开事件日志目录', click: () => shell.openPath(eventLog.getDir()) },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => mainWindow?.show());
}

function baselineOf(): Record<MetricKey, { rate: number | null; sampleCount: number }> {
  return getBaselines(normalizeTask(pomodoro.getState().task));
}

function broadcastTick(): void {
  safeSend('pomodoro:tick', {
    ...pomodoro.getState(),
    keys: keyboardHook.getCounts(),
    baseline: baselineOf(),
  });
}

function registerIpc(): void {
  ipcMain.handle('app:getState', () => ({
    ...pomodoro.getState(),
    keys: keyboardHook.getCounts(),
    hookRunning: keyboardHook.isRunning(),
    baseline: baselineOf(),
    baselineIds: getConfig().baselineIds ?? [],
  }));
  ipcMain.handle('app:getConfig', () => getConfig());
  // 渲染层 init 完主动来取一次：防止弹窗事件发得比监听注册早而丢掉
  // 设置页「立即测试提醒」：按当前开关真发一次，不用等到点，方便确认自己到底看不看得到
  ipcMain.handle('remind:test', () => {
    remind({
      kind: 'focus',
      title: '提醒测试 · 番茄结束（示例数据）',
      lines: ['输出 82 分（+6%）', '一般 74 分（-2%）', '阅读无数据'],
      hero: 'toast-hero-focus.png',
    });
    return getConfig();
  });
  ipcMain.handle('app:takeRemind', () => {
    const p = pendingRemind;
    pendingRemind = null;
    return p;
  });
  ipcMain.handle('app:setConfig', (_e, patch: Partial<AppConfig>) => {
    const next = setConfig(patch);
    return next;
  });
  // 展示视图：按当前生效基线（手动样本/自动中位数）实时重算分数，
  // 存储的原始记录不变，切基线后历史表格/趋势图/平均分自动跟着变
  ipcMain.handle('app:getSessions', () => rescoreSessions(getSessions()));
  // 按天聚合原始事件日志 → N 分钟桶，供趋势页粒度视图。
  // 返回四个指标的序列：enter / space / click / wheel（mouse_down 且 button=1 才算 click）
  ipcMain.handle('app:getDayBuckets', (_e, dateStr: string, bucketMin = 5) => {
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return { bucketMin, series: emptySeries() };
      const file = path.join(eventLog.getDir(), `${dateStr}.jsonl`);
      if (!fs.existsSync(file)) return { bucketMin, series: emptySeries() };
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      const maps: Record<string, Map<number, number>> = {
        enter: new Map(),
        space: new Map(),
        click: new Map(),
        wheel: new Map(),
      };
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          let metric: string | null = null;
          if (ev.kind === 'key_down' && ev.key === 'Enter') metric = 'enter';
          else if (ev.kind === 'key_down' && ev.key === 'Space') metric = 'space';
          else if (ev.kind === 'mouse_down' && Number(ev.code) === 1) metric = 'click';
          else if (ev.kind === 'wheel') metric = 'wheel';
          if (!metric) continue;
          const d = new Date(ev.t);
          const minuteOfDay = d.getHours() * 60 + d.getMinutes();
          const b = Math.floor(minuteOfDay / bucketMin) * bucketMin;
          const m = maps[metric];
          m.set(b, (m.get(b) ?? 0) + 1);
        } catch { /* 跳过坏行 */ }
      }
      const series: Record<string, { minuteOfDay: number; count: number }[]> = {};
      for (const k of Object.keys(maps)) {
        series[k] = [...maps[k].entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([minuteOfDay, count]) => ({ minuteOfDay, count }));
      }
      return { bucketMin, series };
    } catch (err) {
      console.error('[app:getDayBuckets]', err);
      return { bucketMin, series: emptySeries() };
    }
  });
  ipcMain.handle('app:clearSessions', () => {
    clearSessions();
    setConfig({ baselineIds: [] });
    return [];
  });
  // 选择性删除：按 id 删除指定 session 数据点（如测试产生的记录），同步清理基线引用
  ipcMain.handle('app:deleteSessions', (_e, ids: string[]) => {
    const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
    if (list.length > 0) {
      deleteSessions(list);
      const cfg = getConfig();
      const removed = new Set(list);
      const kept = (cfg.baselineIds ?? []).filter((id) => !removed.has(id));
      if (kept.length !== (cfg.baselineIds ?? []).length) setConfig({ baselineIds: kept });
    }
    return {
      sessions: rescoreSessions(getSessions()),
      baselineIds: getConfig().baselineIds ?? [],
      baseline: baselineOf(),
    };
  });
  ipcMain.handle('app:toggleBaseline', (_e, id: string, selected: boolean) => {
    const cfg = getConfig();
    const set = new Set(cfg.baselineIds ?? []);
    if (selected) set.add(id);
    else set.delete(id);
    setConfig({ baselineIds: [...set] });
    return { baselineIds: [...set], baseline: baselineOf() };
  });
  ipcMain.handle('pomodoro:start', () => pomodoro.start());
  ipcMain.handle('pomodoro:pause', () => pomodoro.pause());
  ipcMain.handle('pomodoro:resume', () => pomodoro.resume());
  ipcMain.handle('pomodoro:skip', () => pomodoro.skip());
  ipcMain.handle('pomodoro:reset', () => pomodoro.reset());
  ipcMain.handle('pomodoro:startPhase', (_e, phase: 'focus' | 'short' | 'long') => pomodoro.startPhase(phase));
  ipcMain.handle('pomodoro:setTask', (_e, task: string) => pomodoro.setTask(task));
  ipcMain.handle('pomodoro:finishEarly', () => pomodoro.finishEarly());
  ipcMain.handle('hook:reconnect', () => {
    keyboardHook.restart();
    return { running: keyboardHook.isRunning() };
  });
}

function wireEvents(): void {
  pomodoro.on('tick', () => broadcastTick());
  keyboardHook.on('update', (counts) => {
    safeSend('keys:update', counts);
  });
  keyboardHook.on('status', (ok, message) => {
    safeSend('hook:status', { ok, message });
  });
  pomodoro.on('phaseEnd', (record, next) => {
    safeSend('pomodoro:phaseEnd', { record, next });
    // record 为空 = 该段被当作垃圾段丢弃（<3s 且无任何操作），此时不提醒
    if (!record) remindLog(`段结束但记录被丢弃（<3s 且无操作），不发提醒；next=${next.phase}`);
    if (record && record.type === 'focus') {
      const head =
        record.endedBy === 'early' ? '提前完成' :
        record.endedBy === 'skip' ? '专注已跳过' : '番茄结束';
      const sc = record.scores;
      const parts: string[] = [];
      if (sc) {
        const fmt = (label: string, s: { score: number | null; deltaPct: number | null }) =>
          s.score == null
            ? `${label}无数据`
            : `${label} ${s.score} 分（${(s.deltaPct ?? 0) >= 0 ? '+' : ''}${s.deltaPct ?? 0}%）`;
        parts.push(fmt('输出', sc.output), fmt('一般', sc.general), fmt('阅读', sc.reading));
      } else if (record.score == null) {
        parts.push(`E=${record.enterCount}（无数据）`);
      } else {
        parts.push(`一般 ${record.score} 分`);
      }
      remind({
        kind: 'focus',
        title: `${head} · ${phaseLabel(next.phase)}开始`,
        lines: parts,
        hero: 'toast-hero-focus.png',
      });
    } else if (record) {
      // 休息段结束/跳过：不自动开始专注，提醒手动开始
      remind({
        kind: 'break',
        title: record.endedBy === 'skip' ? '休息已跳过' : '休息结束',
        lines: ['准备好后点「开始专注」进入下一个番茄'],
        hero: 'toast-hero-break.png',
      });
    }
  });
}

app.whenReady().then(() => {
  if (isTestMode) {
    setConfig({ testMode: true });
    console.log('[app] --test-mode: 已强制开启 1 分钟测试模式');
  }
  console.log(`[app] version=${app.getVersion()} packaged=${app.isPackaged} userData=${app.getPath('userData')}`);
  registerIpc();
  wireEvents();
  createWindow();
  createTray();
  eventLog.init();
  keyboardHook.start();

  // 预览提醒：electron . --remind-demo[=system,popup,web]（不带值 = 按设置里的开关走）
  // 用于调样式 / 确认自己到底能不能看到提醒，不影响正常流程。
  if (remindDemo !== null) {
    const only = remindDemo.includes('=') ? remindDemo.split('=')[1].split(',') : undefined;
    setTimeout(() => {
      remind(
        {
          kind: 'focus',
          title: '番茄结束 · 短休息开始（预览）',
          lines: ['输出 82 分（+6%）', '一般 74 分（-2%）', '阅读无数据'],
          hero: 'toast-hero-focus.png',
        },
        only,
      );
    }, 1200);
  }

  // RDP 全屏修复：mstsc 全屏时会用后装的钩子截走按键，
  // 检测到新的全屏前台窗口时重装我们的钩子（排到链头）
  try {
    const fgwatch = createFullscreenWatcher();
    fgwatch.start(() => {
      keyboardHook.restart();
      mainWindow?.webContents.send('hook:status', { ok: true, message: '全屏模式已重新接管键盘' });
    });
  } catch (err) {
    console.error('[fgwatch] unavailable:', (err as Error).message);
  }

  // 休眠唤醒补偿提示（实际补偿由 pomodoro 的 wall-clock 完成）
  powerMonitor.on('resume', () => {
    console.log('[app] system resume — pomodoro wall-clock will self-correct');
    broadcastTick();
  });

  // 启动时打一条样例基线验证公式（仅日志）
  const bl = getBaselines('未分类');
  console.log('[app] baseline(未分类):', JSON.stringify(bl));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
});

app.on('window-all-closed', () => {
  // Windows：最小化到托盘而非退出（配合 close→hide）
});

app.on('before-quit', () => {
  keyboardHook.stop();
  eventLog.close();
});
