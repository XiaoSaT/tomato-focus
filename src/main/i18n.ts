import { app } from 'electron';
import { getConfig } from './store';

/**
 * 主进程侧文案（托盘、窗口标题、系统通知、浏览器提醒页）。
 * 渲染层的文案在 src/renderer/i18n.js，两边键名/语义保持一致。
 */

export type Lang = 'zh' | 'en';

const zh: Record<string, string> = {
  'win.title': 'TomatoFocus 番茄专注',
  'tray.tooltip': 'TomatoFocus 番茄专注',
  'tray.show': '显示主界面',
  'tray.start': '开始专注',
  'tray.skip': '跳过当前段',
  'tray.logs': '打开事件日志目录',
  'tray.autostart': '开机自启',
  'tray.quit': '退出',

  'phase.focus': '专注中',
  'phase.short': '短休息',
  'phase.long': '长休息',
  'phase.idle': '待机',

  'label.output': '输出',
  'label.general': '一般',
  'label.reading': '阅读',

  'notify.head.timer': '番茄结束',
  'notify.head.early': '提前完成',
  'notify.head.skip': '专注已跳过',
  'notify.head.break': '休息结束',
  'notify.head.breakSkip': '休息已跳过',
  'notify.headNext': '{head} · {phase}开始',
  'notify.line.score': '{label} {score} 分（{delta}%）',
  'notify.line.struct': '{label} {score}',
  'notify.line.noData': '{label}无数据',
  'notify.enterOnly': 'E={n}（无数据）',
  'notify.breakBody': '准备好后点「开始专注」进入下一个番茄',

  'demo.testTitle': '提醒测试 · 番茄结束（示例数据）',
  'demo.previewTitle': '番茄结束 · 短休息开始（预览）',
  'demo.line.output': '输出 82 分（+6%）',
  'demo.line.general': '一般 74 分（-2%）',
  'demo.line.reading': '阅读无数据',
  'demo.breakLine': '准备好后点「开始专注」进入下一个番茄',

  'page.kicker.focus': 'TomatoFocus · 本段结果',
  'page.kicker.break': 'TomatoFocus · 休息结束',
  'page.close': '此页可随时关闭',
  'page.foot': '回到 <b>番茄专注</b> 窗口继续下一段',
  'page.fallback': '准备开始下一段',
  'page.titleSuffix': ' · 番茄专注',
};

const en: Record<string, string> = {
  'win.title': 'TomatoFocus',
  'tray.tooltip': 'TomatoFocus — focus timer',
  'tray.show': 'Show window',
  'tray.start': 'Start focus',
  'tray.skip': 'Skip current session',
  'tray.logs': 'Open event log folder',
  'tray.autostart': 'Run at login',
  'tray.quit': 'Quit',

  'phase.focus': 'Focusing',
  'phase.short': 'Short break',
  'phase.long': 'Long break',
  'phase.idle': 'Idle',

  'label.output': 'Output',
  'label.general': 'General',
  'label.reading': 'Reading',

  'notify.head.timer': 'Pomodoro done',
  'notify.head.early': 'Finished early',
  'notify.head.skip': 'Focus skipped',
  'notify.head.break': 'Break over',
  'notify.head.breakSkip': 'Break skipped',
  'notify.headNext': '{head} · {phase} starts',
  'notify.line.score': '{label} {score} pts ({delta}%)',
  'notify.line.struct': '{label} {score}',
  'notify.line.noData': '{label}: no data',
  'notify.enterOnly': 'E={n} (no data)',
  'notify.breakBody': 'Click "Start focus" when you are ready for the next pomodoro',

  'demo.testTitle': 'Reminder test · pomodoro finished (sample data)',
  'demo.previewTitle': 'Pomodoro finished · short break starts (preview)',
  'demo.line.output': 'Output 82 pts (+6%)',
  'demo.line.general': 'General 74 pts (-2%)',
  'demo.line.reading': 'Reading: no data',
  'demo.breakLine': 'Click "Start focus" when you are ready',

  'page.kicker.focus': 'TomatoFocus · Session result',
  'page.kicker.break': 'TomatoFocus · Break over',
  'page.close': 'You can close this page anytime',
  'page.foot': 'Back to the <b>TomatoFocus</b> window for the next session',
  'page.fallback': 'Ready for the next session',
  'page.titleSuffix': ' · TomatoFocus',
};

const DICT: Record<Lang, Record<string, string>> = { zh, en };

/** 系统语言兜底：中文环境用中文，其余用英文 */
export function systemLang(): Lang {
  try {
    return String(app.getLocale() || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
  } catch {
    return 'zh';
  }
}

/** 当前生效语言：配置里的值优先，空/异常时跟随系统 */
export function currentLang(): Lang {
  const v = (getConfig() as { lang?: string }).lang;
  return v === 'zh' || v === 'en' ? v : systemLang();
}

export function t(lang: Lang, key: string, params?: Record<string, string | number>): string {
  const table = DICT[lang] || DICT.zh;
  let s = table[key] ?? DICT.zh[key] ?? key;
  if (params) {
    for (const k of Object.keys(params)) s = s.split('{' + k + '}').join(String(params[k]));
  }
  return s;
}

/** 用当前语言取文案 */
export function tc(key: string, params?: Record<string, string | number>): string {
  return t(currentLang(), key, params);
}
