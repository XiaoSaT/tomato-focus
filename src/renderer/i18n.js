/* i18n: 界面文案词典 + 静态节点翻译（无依赖，原生 JS）
 * 用法：
 *   - HTML：<span data-i18n="key">中文</span> / data-i18n-html / data-i18n-ph / data-i18n-title
 *   - JS：  I18N.t('key', { task: 'xxx' })
 *   - 切换：I18N.setLang('en'); I18N.apply(); 然后重新 render
 */
(function () {
  'use strict';

  const zh = {
    // 顶部
    'app.title': 'TomatoFocus 番茄专注',
    'app.subtitle': '番茄专注 · 键盘专注度',
    'badge.test': '测试模式 · 每段 1 分钟',
    'nav.trend': '专注趋势',
    'hook.connecting': '连接中',
    'hook.ok': '钩子运行中',
    'hook.bad': '钩子异常',
    'hook.reconnect': '点击重连',

    // 计时卡
    'task.placeholder': '本段做什么？如：写代码 / 写文档（一段一种类型）',
    'seg.focus': '专注',
    'seg.short': '短休',
    'seg.long': '长休',
    'phase.idle': '待机',
    'phase.focus': '专注中',
    'phase.short': '短休息',
    'phase.long': '长休息',
    'phase.paused': '已暂停',
    'pill.idle': '开始一段番茄吧',
    'pill.noData': '本段暂无按键数据',
    'pill.break': '休息一下，不计分',
    'pill.awaitingStart': '休息结束 · 点「开始专注」进入下一个番茄',
    'pill.ready': '输入任务，开始一段番茄',
    'key.enter': 'Enter · 本段',
    'key.backspace': 'Backspace · 本段',
    'key.space': '空格 · 本段',
    'key.click': '左键 · 本段',
    'key.wheel': '滚轮 · 本段',
    'btn.start': '开始专注',
    'btn.resume': '继续',
    'btn.pause': '暂停',
    'btn.finish': '提前完成',
    'btn.skip': '跳过本段',
    'btn.reset': '复位',
    'metric.short.output': '输',
    'metric.short.general': '一',
    'metric.short.reading': '阅',

    // 分数档位
    'tier.good': '超级认真',
    'tier.mid': '状态稳定',
    'tier.low': '有所下降',

    // 概览
    'stats.title': '累计概览',
    'stats.focusCount': '专注段',
    'stats.totalEnter': '总 Enter',
    'stats.avgScore': '平均专注分',
    'formula': '专注分 = 80 × 本段速率 ÷ 基线速率（同任务），首段 80 分建档',

    // 设置
    'cfg.title': '设置',
    'cfg.focusMin': '专注时长',
    'cfg.shortMin': '短休时长',
    'cfg.longMin': '长休时长',
    'cfg.every': '几段进长休',
    'cfg.unitMin': '分钟',
    'cfg.unitCount': '个',
    'cfg.testMode': '测试模式',
    'cfg.save': '保存',
    'cfg.lang': '语言',
    'cfg.lang.zh': '中文',
    'cfg.lang.en': 'English',
    'cfg.lang.note': '切换后界面立即变为该语言',
    'cfg.remind.title': '段结束提醒',
    'cfg.remind.note': '开关改动立即生效（不用点保存），三个渠道各自独立',
    'cfg.remind.system': '系统通知',
    'cfg.remind.popup': '应用内大弹窗',
    'cfg.remind.web': '浏览器网页',
    'cfg.remind.test': '立即测试提醒',
    'cfg.remind.hint': '发一条示例提醒，确认这三个渠道你是否都能看到',

    // 趋势页
    'trend.back': '返回专注',
    'trend.prevDay': '前一天',
    'trend.nextDay': '后一天',
    'trend.todayBtn': '回到今天',
    'trend.clear': '清空历史',
    'trend.focusMin': '专注分钟',
    'trend.chartTitle': '当天专注趋势',
    'trend.legend.day': '专注分 · 一天内按时间连续展示',
    'trend.m.general': '一般',
    'trend.m.output': '输出',
    'trend.m.reading': '阅读',
    'trend.mode.day': '整天',
    'trend.mode.fine': '5 分钟',
    'trend.legend.fine.general': '一般（Enter+左键）',
    'trend.legend.fine.output': '输出（空格）',
    'trend.legend.fine.reading': '阅读（滚轮）',
    'trend.legend.fineSuffix': ' · 每 5 分钟按所在段基线折算，分段连线',
    'day.today': '今天',
    'day.yesterday': '昨天',
    'day.month': '{m}月',
    'day.date': '{m}月{d}日',
    'week.0': '周日',
    'week.1': '周一',
    'week.2': '周二',
    'week.3': '周三',
    'week.4': '周四',
    'week.5': '周五',
    'week.6': '周六',
    'weekShort.1': '一',
    'weekShort.3': '三',
    'weekShort.5': '五',

    // 基线
    'baseline.cap': '基线 · {task}',
    'bl.output': '输出 · 空格',
    'bl.general': '一般 · Enter+左键',
    'bl.reading': '阅读 · 滚轮',
    'bl.none': '无基线',
    'bl.unit.output': '空格/分',
    'bl.unit.general': 'Enter+左键/分',
    'bl.unit.reading': '滚轮/分',
    'bl.title.none': '完成一段带该动作（≥1分钟）的专注后自动建档 80 分',
    'bl.title.auto': '自动基线（中位数±3 段均值） · {n} 段',
    'bl.title.manual': '手动选定样本 · {n} 段',
    'bl.samples.title': '基线样本',
    'bl.samples.auto': '恢复自动基线',
    'bl.samples.hint': '觉得哪几段状态不错？勾选它们作为 80 分基线；不勾选则自动取该任务最近 20 段的「中位数±3 段均值」。基线变更后，趋势图/概览分数实时重算。',
    'bl.samples.empty': '完成几段专注后，这里可以勾选基线样本',
    'bl.manualDone': '手动基线已生效：一般 {rate} 次/分（{n} 段）',
    'bl.autoDone': '已恢复自动基线',
    'bl.autoDoneLong': '已恢复自动基线（中位数±3 段均值）',

    // 热力图
    'heat.title': '专注热力图',
    'heat.less': '少',
    'heat.more': '多',
    'heat.none': '无专注记录',
    'heat.count': '{n} 段专注',
    'heat.avg': '平均分 {n}',
    'heat.noScore': '无评分',
    'heat.click': '点击查看该天趋势',
    'heat.month': '{m}月',

    // 记录表
    'table.title': '当天记录',
    'table.type': '类型',
    'table.task': '任务',
    'table.start': '开始',
    'table.counts': '计数 E/S/C/W',
    'table.empty': '本日暂无记录',
    'table.delete': '删除这条记录（原始事件日志保留）',
    'table.confirmDelete': '删除这条记录？（原始事件日志保留，不受影响）',
    'type.focus': '专注',
    'type.short': '短休',
    'type.long': '长休',
    'task.uncategorized': '未分类',
    'ended.early': '提前完成',
    'ended.skip': '已放弃',
    'ended.timer': '到时结束',
    'tooltip.started': '{time} 开始 · {metric}：{score}',
    'tooltip.noScore': '—',
    'tooltip.points': '{n} 分',
    'tooltip.line2': '{state}',
    'tooltip.rate': '{rate} Enter/分',
    'tooltip.task': '任务：{task}',
    'chart.emptyToday': '新的一天 · 完成一段专注后，趋势将从这里重新开始',
    'chart.emptyDay': '这一天还没有专注记录',
    'fine.emptyToday': '今天还没有按键明细 · 开始一段专注后，这里会出现 5 分钟粒度曲线',
    'fine.emptyDay': '这一天没有按键明细记录',
    'fine.emptyNoBaseline': '这一天没有可折算分数的专注段明细（基线未建档，或按键都在段外）',
    'fine.perMin': '次/分',
    'fine.countUnit': '次',
    'fine.firstBaseline': '首段建档',
    'fine.vsBaseline': 'vs 基线 {d}',

    // 引导弹窗
    'guide.title': '开始前，30 秒看懂 3 件事',
    'guide.s1.title': '一个番茄 = 25 分钟专注 + 5 分钟休息',
    'guide.s1.focus': '专注 25',
    'guide.s1.long': '长休 15',
    'guide.s1.shortTitle': '短休 5 分钟',
    'guide.s1.note': '每 4 个番茄后来一次长休息；所有时长都能在「设置」里改。',
    'guide.s2.title': '休息自动进入，下一个番茄要手动开始',
    'guide.s2.focus': '专注',
    'guide.s2.break': '休息',
    'guide.s2.auto': '自动',
    'guide.s2.manual': '⚠ 手动点「开始专注」',
    'guide.s2.warn': '休息结束不会自动开始 —— 忘了点，时间就白白溜走！',
    'guide.s3.title': '测一段就有基线，越测越准',
    'guide.s3.output': '空格 → 输出',
    'guide.s3.general': '→ 一般',
    'guide.s3.reading': '滚轮 → 阅读',
    'guide.s3.fig1a': '第 1 段',
    'guide.s3.fig1b': '80 分建档',
    'guide.s3.fig2a': '几段之后',
    'guide.s3.fig2b': '中位数 ±3 段定基线',
    'guide.s3.fig3a': '20 段之后',
    'guide.s3.fig3b': '基线稳 · 分数可信',
    'guide.s3.note': '之后每段：<b>专注分 = 80 × 本段速率 ÷ 基线速率</b>，达到基线 = 80 分。三项指标各算各的基线，也可在「基线样本」里手动勾选状态好的段。',
    'guide.ack': '我已知晓，不再出现',
    'guide.close': '关闭',

    // 提醒弹窗
    'remind.kicker.focus': 'TomatoFocus · 本段结果',
    'remind.kicker.break': 'TomatoFocus · 休息结束',
    'remind.start': '开始专注',
    'remind.close': '知道了',
    'remind.line.focusReady': '准备好后点「开始专注」进入下一个番茄',

    // Toast / 其它
    'toast.noKeys': '本段无按键数据',
    'toast.scores': '输出 {o} · 一般 {g} · 阅读 {r}',
    'toast.noData': '—',
    'toast.scoreUnit': '{n} 分',
    'toast.breakOver': '休息结束 · 手动开始下一个专注',
    'toast.hookReconnected': '钩子已重连',
    'toast.hookReconnectFail': '钩子重连失败，请查看日志',
    'toast.switchOn': '已开启',
    'toast.switchOff': '已关闭',
    'toast.switchDone': '{state}：{label}（立即生效）',
    'toast.testSent': '已发送测试提醒',
    'toast.testSentTo': '已发送：{names}',
    'toast.testNone': '三个渠道都关着',
    'toast.testNoneHint': '三个开关都关着，先打开一个再测',
    'toast.savedTest': '已保存 · 测试模式每段 1 分钟',
    'toast.saved': '设置已保存',
    'toast.langChanged': '界面语言已切换',
    'toast.cleared': '历史已清空',
    'toast.deleted': '已删除该条记录',
    'toast.noPreload': 'preload 未加载，请用 electron 启动。',
    'label.output': '输出',
    'label.general': '一般',
    'label.reading': '阅读',
    'unit.pts': '分',
  };

  const en = {
    'app.title': 'TomatoFocus',
    'app.subtitle': 'Pomodoro · keyboard focus tracking',
    'badge.test': 'Test mode · 1-minute sessions',
    'nav.trend': 'Focus trend',
    'hook.connecting': 'Connecting',
    'hook.ok': 'Hook running',
    'hook.bad': 'Hook error',
    'hook.reconnect': 'click to reconnect',

    'task.placeholder': 'What are you doing? e.g. coding / writing (one task per session)',
    'seg.focus': 'Focus',
    'seg.short': 'Short',
    'seg.long': 'Long',
    'phase.idle': 'Idle',
    'phase.focus': 'Focusing',
    'phase.short': 'Short break',
    'phase.long': 'Long break',
    'phase.paused': 'paused',
    'pill.idle': 'Start a pomodoro',
    'pill.noData': 'No keystrokes yet this session',
    'pill.break': 'Break — not scored',
    'pill.awaitingStart': 'Break over · click "Start" for the next pomodoro',
    'pill.ready': 'Name a task, then start',
    'key.enter': 'Enter · session',
    'key.backspace': 'Backspace · session',
    'key.space': 'Space · session',
    'key.click': 'L-click · session',
    'key.wheel': 'Wheel · session',
    'btn.start': 'Start focus',
    'btn.resume': 'Resume',
    'btn.pause': 'Pause',
    'btn.finish': 'Finish early',
    'btn.skip': 'Skip this session',
    'btn.reset': 'Reset',
    'metric.short.output': 'O',
    'metric.short.general': 'G',
    'metric.short.reading': 'R',

    'tier.good': 'Super focused',
    'tier.mid': 'Steady',
    'tier.low': 'Slipping',

    'stats.title': 'Totals',
    'stats.focusCount': 'Sessions',
    'stats.totalEnter': 'Total Enter',
    'stats.avgScore': 'Avg score',
    'formula': 'score = 80 × this session\'s rate ÷ your baseline rate (same task); first session is recorded as 80',

    'cfg.title': 'Settings',
    'cfg.focusMin': 'Focus length',
    'cfg.shortMin': 'Short break',
    'cfg.longMin': 'Long break',
    'cfg.every': 'Long break every',
    'cfg.unitMin': 'min',
    'cfg.unitCount': 'sessions',
    'cfg.testMode': 'Test mode',
    'cfg.save': 'Save',
    'cfg.lang': 'Language',
    'cfg.lang.zh': '中文',
    'cfg.lang.en': 'English',
    'cfg.lang.note': 'The UI switches instantly',
    'cfg.remind.title': 'End-of-session reminders',
    'cfg.remind.note': 'Toggles save instantly (no need to press Save); the three channels are independent',
    'cfg.remind.system': 'System notification',
    'cfg.remind.popup': 'In-app modal',
    'cfg.remind.web': 'Browser page',
    'cfg.remind.test': 'Send a test reminder',
    'cfg.remind.hint': 'Fires one sample reminder so you can check which channels you actually see',

    'trend.back': 'Back',
    'trend.prevDay': 'Previous day',
    'trend.nextDay': 'Next day',
    'trend.todayBtn': 'Back to today',
    'trend.clear': 'Clear history',
    'trend.focusMin': 'Focus minutes',
    'trend.chartTitle': "Today's focus trend",
    'trend.legend.day': 'Focus score · plotted along the day',
    'trend.m.general': 'General',
    'trend.m.output': 'Output',
    'trend.m.reading': 'Reading',
    'trend.mode.day': 'Whole day',
    'trend.mode.fine': '5 min',
    'trend.legend.fine.general': 'General (Enter + left click)',
    'trend.legend.fine.output': 'Output (Space)',
    'trend.legend.fine.reading': 'Reading (wheel)',
    'trend.legend.fineSuffix': ' · each 5-min bucket scored against its session baseline',
    'day.today': 'Today',
    'day.yesterday': 'Yesterday',
    'day.month': '{m}',
    'day.date': '{m}/{d}',
    'week.0': 'Sun',
    'week.1': 'Mon',
    'week.2': 'Tue',
    'week.3': 'Wed',
    'week.4': 'Thu',
    'week.5': 'Fri',
    'week.6': 'Sat',
    'weekShort.1': 'M',
    'weekShort.3': 'W',
    'weekShort.5': 'F',

    'baseline.cap': 'Baseline · {task}',
    'bl.output': 'Output · Space',
    'bl.general': 'General · Enter+Click',
    'bl.reading': 'Reading · Wheel',
    'bl.none': 'No baseline',
    'bl.unit.output': 'space/min',
    'bl.unit.general': 'enter+click/min',
    'bl.unit.reading': 'wheel/min',
    'bl.title.none': 'Finish one session (≥1 min) containing this action to register a baseline of 80',
    'bl.title.auto': 'Auto baseline (median ±3 sessions) · {n} sessions',
    'bl.title.manual': 'Hand-picked samples · {n} sessions',
    'bl.samples.title': 'Baseline samples',
    'bl.samples.auto': 'Back to auto baseline',
    'bl.samples.hint': 'Pick the sessions where you felt sharp — they become the 80-point baseline. Leave nothing selected and the baseline is the median ±3 sessions of the last 20 for that task. Charts and averages are recalculated instantly.',
    'bl.samples.empty': 'Finish a few sessions and you can hand-pick baseline samples here',
    'bl.manualDone': 'Manual baseline active: general {rate}/min ({n} sessions)',
    'bl.autoDone': 'Auto baseline restored',
    'bl.autoDoneLong': 'Auto baseline restored (median ±3 sessions)',

    'heat.title': 'Focus heatmap',
    'heat.less': 'Less',
    'heat.more': 'More',
    'heat.none': 'No focus sessions',
    'heat.count': '{n} sessions',
    'heat.avg': 'avg {n}',
    'heat.noScore': 'no score',
    'heat.click': 'Click to view that day',
    'heat.month': '{m}',

    'table.title': "Today's sessions",
    'table.type': 'Type',
    'table.task': 'Task',
    'table.start': 'Start',
    'table.counts': 'E/S/C/W',
    'table.empty': 'No sessions today',
    'table.delete': 'Delete this record (raw event log is kept)',
    'table.confirmDelete': 'Delete this record? The raw event log stays untouched.',
    'type.focus': 'Focus',
    'type.short': 'Short',
    'type.long': 'Long',
    'task.uncategorized': 'Uncategorized',
    'ended.early': 'finished early',
    'ended.skip': 'abandoned',
    'ended.timer': 'timer ended',
    'tooltip.started': '{time} · {metric}: {score}',
    'tooltip.noScore': '—',
    'tooltip.points': '{n} pts',
    'tooltip.line2': '{state}',
    'tooltip.rate': '{rate} Enter/min',
    'tooltip.task': 'Task: {task}',
    'chart.emptyToday': 'New day · your trend restarts here after one focus session',
    'chart.emptyDay': 'No focus sessions on this day',
    'fine.emptyToday': 'No keystroke detail yet · start a session to get 5-minute resolution',
    'fine.emptyDay': 'No keystroke detail on this day',
    'fine.emptyNoBaseline': 'No scorable session detail for this day (baseline not established, or the keys landed outside sessions)',
    'fine.perMin': '/min',
    'fine.countUnit': 'counts',
    'fine.firstBaseline': 'first session',
    'fine.vsBaseline': 'vs baseline {d}',

    'guide.title': 'Three things to know in 30 seconds',
    'guide.s1.title': 'One pomodoro = 25 min focus + 5 min break',
    'guide.s1.focus': 'Focus 25',
    'guide.s1.long': 'Long 15',
    'guide.s1.shortTitle': '5 min short break',
    'guide.s1.note': 'A long break comes after every 4 pomodoros; all durations are configurable in Settings.',
    'guide.s2.title': 'Breaks start automatically, the next pomodoro does not',
    'guide.s2.focus': 'Focus',
    'guide.s2.break': 'Break',
    'guide.s2.auto': 'auto',
    'guide.s2.manual': '⚠ you click "Start focus"',
    'guide.s2.warn': 'When the break ends nothing starts by itself — forget the click and the time just drains away!',
    'guide.s3.title': 'One session builds a baseline; it sharpens over time',
    'guide.s3.output': 'Space → Output',
    'guide.s3.general': '→ General',
    'guide.s3.reading': 'Wheel → Reading',
    'guide.s3.fig1a': 'Session 1',
    'guide.s3.fig1b': 'baseline = 80',
    'guide.s3.fig2a': 'After a few',
    'guide.s3.fig2b': 'median ±3 sessions',
    'guide.s3.fig3a': 'After ~20',
    'guide.s3.fig3b': 'stable, trustworthy',
    'guide.s3.note': 'Then each session: <b>score = 80 × this rate ÷ baseline rate</b>, hitting your baseline scores 80. Each of the three metrics keeps its own baseline, and you can hand-pick good sessions under "Baseline samples".',
    'guide.ack': "Got it, don't show again",
    'guide.close': 'Close',

    'remind.kicker.focus': 'TomatoFocus · Session result',
    'remind.kicker.break': 'TomatoFocus · Break over',
    'remind.start': 'Start focus',
    'remind.close': 'Got it',
    'remind.line.focusReady': 'Click "Start focus" when you are ready',

    'toast.noKeys': 'No keystrokes this session',
    'toast.scores': 'Output {o} · General {g} · Reading {r}',
    'toast.noData': '—',
    'toast.scoreUnit': '{n} pts',
    'toast.breakOver': 'Break over · start the next session manually',
    'toast.hookReconnected': 'Hook reconnected',
    'toast.hookReconnectFail': 'Hook reconnect failed, check the log',
    'toast.switchOn': 'On',
    'toast.switchOff': 'Off',
    'toast.switchDone': '{state}: {label} (applied instantly)',
    'toast.testSent': 'Test reminder sent',
    'toast.testSentTo': 'Sent to: {names}',
    'toast.testNone': 'All three channels are off',
    'toast.testNoneHint': 'All three switches are off — turn one on first',
    'toast.savedTest': 'Saved · test mode uses 1-minute sessions',
    'toast.saved': 'Settings saved',
    'toast.langChanged': 'UI language switched',
    'toast.cleared': 'History cleared',
    'toast.deleted': 'Record deleted',
    'toast.noPreload': 'preload failed to load — start with electron.',
    'label.output': 'Output',
    'label.general': 'General',
    'label.reading': 'Reading',
    'unit.pts': 'pts',
  };

  const DICT = { zh: zh, en: en };
  let lang = 'zh';

  function t(key, params) {
    const table = DICT[lang] || DICT.zh;
    let s = table[key];
    if (s == null) s = DICT.zh[key];
    if (s == null) return key;
    if (params) {
      for (const k in params) {
        if (Object.prototype.hasOwnProperty.call(params, k)) {
          s = s.split('{' + k + '}').join(String(params[k]));
        }
      }
    }
    return s;
  }

  /** 只替换元素里最后一个非空文本节点，保留前面的 svg 图标等子元素 */
  function setText(el, str) {
    if (!el) return;
    for (let i = el.childNodes.length - 1; i >= 0; i--) {
      const n = el.childNodes[i];
      if (n.nodeType === 3 && n.nodeValue.trim()) {
        const lead = /^\s*/.exec(n.nodeValue)[0];
        n.nodeValue = lead + str;
        return;
      }
    }
    el.appendChild(document.createTextNode(str));
  }

  /** 把页面上所有 data-i18n* 节点按当前语言刷新一遍 */
  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((el) => setText(el, t(el.getAttribute('data-i18n'))));
    scope.querySelectorAll('[data-i18n-html]').forEach((el) => {
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    });
    scope.querySelectorAll('[data-i18n-ph]').forEach((el) => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
    });
    scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });
    if (!root) {
      document.documentElement.setAttribute('lang', lang === 'zh' ? 'zh-CN' : 'en');
      document.title = t('app.title');
    }
  }

  function setLang(next) {
    lang = next === 'en' ? 'en' : 'zh';
  }

  window.I18N = { t: t, apply: apply, setLang: setLang, getLang: () => lang, DICT: DICT };
})();
