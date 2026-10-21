/* Renderer: vanilla JS, no bundler. Talks to main via window.tomato (preload). */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const api = window.tomato;

  const R = 108;
  const CIRC = 2 * Math.PI * R;
  const ringFg = $('ringFg');
  ringFg.style.strokeDasharray = String(CIRC);
  ringFg.style.strokeDashoffset = '0';

  // ====== 视图 & 日期状态 ======
  let allSessions = [];   // 全部历史记录（数据永久保留，只是视图按天展示）
  let viewOffset = 0;     // 0 = 今天，-1 = 昨天……趋势页按天查看
  let chartMode = 'day';  // 'day' = 每段专注分时间线 | 'fine' = 5 分钟粒度
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function dayKey(d) {
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }
  function viewDay() {
    const d = new Date();
    d.setDate(d.getDate() + viewOffset);
    return d;
  }
  function isToday() { return viewOffset === 0; }
  function fmtClock(ms) {
    const d = new Date(ms);
    return p2(d.getHours()) + ':' + p2(d.getMinutes());
  }
  /** 筛选当前查看日期的记录；新的一天 → 图表从零开始，历史数据仍可用日期切换回看 */
  function sessionsOfDay(sessions) {
    const key = dayKey(viewDay());
    return sessions.filter((s) => dayKey(new Date(s.start)) === key);
  }

  // 趋势图悬停：找最近点，重绘并显示数据浮层
  const historyChart = $('historyChart');
  let chartPts = [];
  let chartHover = -1;
  function chartHit(e) {
    const rect = historyChart.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    let hit = -1, best = 18 * 18;
    chartPts.forEach((p, i) => {
      const d2 = (p.x - mx) * (p.x - mx) + (p.y - my) * (p.y - my);
      if (d2 < best) { best = d2; hit = i; }
    });
    return hit;
  }
  historyChart.addEventListener('mousemove', (e) => {
    const hit = chartHit(e);
    if (hit !== chartHover) {
      chartHover = hit;
      historyChart.style.cursor = hit >= 0 ? 'pointer' : 'default';
      if (allSessions.length) drawTrend();
    }
  });
  historyChart.addEventListener('mouseleave', () => {
    if (chartHover !== -1) {
      chartHover = -1;
      historyChart.style.cursor = 'default';
      if (allSessions.length) drawTrend();
    }
  });

  const TYPE_NAME = { focus: '专注', short: '短休', long: '长休' };
  const DEFAULT_TASK = '未分类';
  let lastState = null;
  let lastKeys = { enter: 0, backspace: 0, space: 0, click: 0, wheel: 0 };
  let cfg = { testMode: false };
  let baselineIds = [];
  const p2 = (n) => String(n).padStart(2, '0');

  // 关键修复：按钮点击后立即失焦，防止之后按 Enter/空格 误触按钮
  // （这正是之前"按 Enter 段乱跳、计数清零"的根源）
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('button') : null;
    if (btn) btn.blur();
  });
  document.addEventListener('keydown', (e) => {
    // Enter/空格 只用于输入框，避免在按钮聚焦时触发
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.tagName === 'BUTTON') {
      e.preventDefault();
    }
  });

  function fmt(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function scoreTier(s) {
    return s >= 90 ? 'good' : s >= 75 ? 'mid' : 'low';
  }
  function tierText(s) {
    return s >= 90 ? '超级认真' : s >= 75 ? '状态稳定' : '有所下降';
  }

  /** 实时预览：三条指标分别与各自基线速率比较（与主进程 calcFocusScores 同一公式） */
  const LIVE_METRICS = [
    { key: 'output', label: '输', countOf: (k) => k.space },
    { key: 'general', label: '一', countOf: (k) => k.enter + k.click },
    { key: 'reading', label: '阅', countOf: (k) => k.wheel },
  ];
  function liveScores(state) {
    const bl = state.baseline || {};
    const elapsedMin = Math.max(1, (state.totalSec - state.remainingSec) / 60);
    return LIVE_METRICS.map((m) => {
      const b = bl[m.key] || { rate: null, sampleCount: 0 };
      const cnt = m.countOf(lastKeys);
      if (cnt === 0) return { label: m.label, score: null, deltaPct: null, first: false };
      if (b.rate == null) return { label: m.label, score: 80, deltaPct: null, first: true };
      const rate = cnt / elapsedMin;
      return {
        label: m.label,
        score: Math.max(0, Math.round((80 * rate) / b.rate)),
        deltaPct: Math.round((rate / b.rate - 1) * 100),
        first: false,
      };
    });
  }

  function setSeg(state) {
    $('btnFocus').className = 'seg-btn' + (state.phase === 'focus' ? ' active-focus' : '');
    $('btnShort').className = 'seg-btn' + (state.phase === 'short' ? ' active-break' : '');
    $('btnLong').className = 'seg-btn' + (state.phase === 'long' ? ' active-break' : '');
  }

  function render(state) {
    if (!state) return;
    lastState = state;
    if (state.keys) lastKeys = state.keys;

    const idle = state.phase === 'idle';
    const running = state.runState === 'running';
    const paused = state.runState === 'paused';
    const isBreak = state.phase === 'short' || state.phase === 'long';

    const phaseText = { focus: '专注中', short: '短休息', long: '长休息', idle: '待机' }[state.phase] || '待机';
    $('phaseLabel').textContent = paused ? phaseText + ' · 已暂停' : phaseText;
    $('timeLabel').textContent = idle ? '25:00' : fmt(state.remainingSec);

    const frac = state.totalSec > 0 ? state.remainingSec / state.totalSec : 1;
    ringFg.style.strokeDashoffset = String(CIRC * (1 - frac));
    ringFg.setAttribute('class', 'ring-fg' + (idle ? ' is-idle' : isBreak ? ' is-break' : ''));

    const pill = $('liveScore');
    if (state.phase === 'focus') {
      const lv = liveScores(state);
      const anyData = lv.some((x) => x.score != null);
      if (!anyData) {
        pill.textContent = '本段暂无按键数据';
        pill.className = 'score-pill';
      } else {
        pill.textContent = lv
          .map((x) => (x.score == null ? x.label + '—' : x.label + ' ' + x.score))
          .join(' · ');
        // pill 颜色按一般分（主指标）取档
        const g = lv.find((x) => x.label === '一');
        pill.className = 'score-pill ' + (g && g.score != null ? scoreTier(g.score) : 'mid');
      }
    } else if (isBreak) {
      pill.textContent = '休息一下，不计分';
      pill.className = 'score-pill';
    } else if (state.awaitingStart) {
      pill.textContent = '休息结束 · 点「开始专注」进入下一个番茄';
      pill.className = 'score-pill mid';
    } else {
      pill.textContent = '输入任务，开始一段番茄';
      pill.className = 'score-pill';
    }

    $('enterCount').textContent = lastKeys.enter;
    $('backspaceCount').textContent = lastKeys.backspace;
    $('spaceCount').textContent = lastKeys.space;
    $('clickCount').textContent = lastKeys.click;
    $('wheelCount').textContent = lastKeys.wheel;

    // 任务输入：focus 进行中锁定（一段一种类型）
    const taskInput = $('taskInput');
    if (document.activeElement !== taskInput) taskInput.value = state.task || '';
    taskInput.disabled = state.phase === 'focus';

    // 基线展示（三条指标各自基线，分格展示）
    const bl = state.baseline || {};
    $('baselineCap').textContent = '基线 · ' + (state.task || DEFAULT_TASK);
    [
      { id: 'blCellOutput', key: 'output', unit: '空格/分' },
      { id: 'blCellGeneral', key: 'general', unit: 'Enter+左键/分' },
      { id: 'blCellReading', key: 'reading', unit: '滚轮/分' },
    ].forEach((d) => {
      const cell = $(d.id);
      const b = bl[d.key];
      const val = cell.querySelector('.bl-val');
      if (!b || b.rate == null) {
        val.textContent = '无基线';
        val.title = '完成一段带该动作（≥1分钟）的专注后自动建档 80 分';
        cell.classList.add('none');
      } else {
        val.textContent = b.rate.toFixed(1) + ' ' + d.unit;
        val.title = (b.manual ? '手动选定样本 · ' : '自动基线（中位数±3 段均值） · ') + b.sampleCount + ' 段';
        cell.classList.remove('none');
      }
    });

    // 按钮显隐
    $('btnStart').hidden = running || paused;
    $('btnPause').hidden = !running;
    $('btnResume').hidden = !paused;
    $('btnFinish').hidden = state.phase !== 'focus';
    $('btnSkip').hidden = !isBreak;
    $('btnReset').hidden = idle;

    setSeg(state);
  }

  function setHook(ok, message) {
    const el = $('hookStatus');
    $('hookText').textContent = (ok ? '钩子运行中' : '钩子异常') + ' · 点击重连';
    el.className = 'hook ' + (ok ? 'ok' : 'bad');
    el.title = message || '';
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), 4200);
  }

  /* ---------- 段结束提醒大弹窗（一直显示，手动关闭） ---------- */
  let remindSeenId = 0;

  function showRemind(p) {
    if (!p) return;
    // 推送与拉取可能重复投递同一条提醒，用 id 去重
    if (p.id && p.id <= remindSeenId) return;
    remindSeenId = p.id || remindSeenId;

    const card = $('remindCard');
    card.dataset.kind = p.kind === 'break' ? 'break' : 'focus';
    $('remindKicker').textContent = p.kind === 'break' ? 'TomatoFocus · 休息结束' : 'TomatoFocus · 本段结果';
    $('remindTitle').textContent = p.title || '';

    const hero = $('remindHero');
    if (p.hero) {
      hero.src = '../assets/' + p.hero;
      hero.hidden = false;
    } else {
      hero.hidden = true;
    }

    const box = $('remindLines');
    box.innerHTML = '';
    for (const raw of p.lines || []) {
      const div = document.createElement('div');
      div.className = 'remind-line';
      const m = /^(\S+?)\s+(.*)$/.exec(raw);
      if (m) {
        const k = document.createElement('span');
        k.className = 'k';
        k.textContent = m[1];
        const v = document.createElement('span');
        v.className = 'v';
        v.textContent = m[2];
        div.appendChild(k);
        div.appendChild(v);
      } else {
        div.textContent = raw;
      }
      if (/无数据|—/.test(raw)) div.classList.add('dim');
      box.appendChild(div);
    }

    $('btnRemindFocus').hidden = p.kind !== 'break';
    $('remindMask').hidden = false;
  }

  function hideRemind() {
    $('remindMask').hidden = true;
  }

  /* ---------- 趋势页图表 ---------- */
  // 5 分钟桶：{ [metric]: [{ minuteOfDay, count }] }，metric ∈ enter/space/click/wheel
  let fineBuckets = { enter: [], space: [], click: [], wheel: [] };
  let fineDay = '';       // 已加载桶对应的日期+指标（避免悬停重绘时重复读日志）
  let fineMetric = 'general'; // fine 模式当前指标：general=Enter+左键 / output=空格 / reading=滚轮
  const FINE_SRC = {
    general: ['enter', 'click'],
    output: ['space'],
    reading: ['wheel'],
  };
  const FINE_SCORE_KEY = { general: 'general', output: 'output', reading: 'reading' };

  /** 按当前指标把原始序列合并成桶数组（general = enter+click 同桶相加） */
  function fineSeries(metric) {
    const srcs = FINE_SRC[metric].map((k) => fineBuckets[k] || []);
    if (srcs.length === 1) return srcs[0];
    const merged = new Map();
    for (const src of srcs) {
      for (const b of src) merged.set(b.minuteOfDay, (merged.get(b.minuteOfDay) || 0) + b.count);
    }
    return [...merged.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([minuteOfDay, count]) => ({ minuteOfDay, count }));
  }

  /** 悬停提示浮层（共享） */
  function drawTooltip(ctx, W, padL, padR, x, y, lines) {
    ctx.save();
    ctx.font = '11px ' + getComputedStyle(document.body).fontFamily;
    const lh = 16, padX = 10, padY = 8;
    const tw = Math.max.apply(null, lines.map((t) => ctx.measureText(t).width));
    const bw2 = tw + padX * 2, bh2 = lines.length * lh + padY * 2 - 4;
    let bx = Math.min(Math.max(x - bw2 / 2, padL), W - padR - bw2);
    let by = y - bh2 - 12;
    if (by < 2) by = y + 14;
    ctx.fillStyle = 'rgba(31,29,26,.94)';
    ctx.beginPath();
    ctx.roundRect(bx, by, bw2, bh2, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    lines.forEach((t, i) => ctx.fillText(t, bx + padX, by + padY + 4 + i * lh));
    ctx.restore();
  }

  function chartCanvas() {
    const cv = historyChart;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth || 900, H = cv.clientHeight || 420;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    return { ctx, W, H };
  }

  /** x 轴固定为当天 0:00–24:00：5 分钟一格浅色网格，整点标时间（两个模式共用） */
  function drawFixedDayAxis(ctx, W, H, padL, padR, padT, plotH) {
    const base = viewDay(); base.setHours(0, 0, 0, 0);
    const t0 = +base, t1 = t0 + 24 * 3600000;
    const xOf = (ms) => padL + ((ms - t0) / (t1 - t0)) * (W - padL - padR);
    // 5 分钟一格浅色网格
    ctx.lineWidth = 1;
    for (let t = t0; t <= t1; t += 5 * 60000) {
      const x = Math.round(xOf(t)) + 0.5;
      ctx.strokeStyle = '#f3efe8';
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
    }
    // 整点：稍深网格 + 时间标签（宽度不够时每 2 小时标一次）
    const labelStep = W - padL - padR >= 1100 ? 1 : 2;
    ctx.textAlign = 'center';
    for (let h = 0; h <= 24; h++) {
      const x = Math.round(xOf(t0 + h * 3600000)) + 0.5;
      ctx.strokeStyle = '#e9e4da';
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
      if (h % labelStep === 0 && h < 24) {
        ctx.fillStyle = '#958e84';
        ctx.fillText(p2(h) + ':00', x + 16, H - 8);
      }
    }
    ctx.textAlign = 'left';
    return xOf;
  }

  async function drawTrend() {
    if (chartMode === 'fine') {
      const key = dayKey(viewDay());
      const cacheKey = key + '|' + fineMetric;
      if (fineDay !== cacheKey) {
        try {
          const res = await api.getDayBuckets(key, 5);
          fineBuckets = (res && res.series) || { enter: [], space: [], click: [], wheel: [] };
        } catch { fineBuckets = { enter: [], space: [], click: [], wheel: [] }; }
        fineDay = cacheKey;
      }
      const names = { general: '一般（Enter+左键）', output: '输出（空格）', reading: '阅读（滚轮）' };
      $('trendLegend').innerHTML = '<i></i>' + names[fineMetric] + ' · 每 5 分钟按所在段基线折算，分段连线';
      drawFineChart();
    } else {
      const legend = [
        { color: '#3b7dd8', label: '输出' },
        { color: '#e5534b', label: '一般' },
        { color: '#2e9a71', label: '阅读' },
      ]
        .map((m) => '<i style="background:' + m.color + '"></i>' + m.label)
        .join('');
      $('trendLegend').innerHTML = legend + '<span style="margin-left:6px">· 一天内按时间连续展示</span>';
      drawDayChart();
    }
  }

  /** 整天模式：一天内每段的三条指标分（输出/一般/阅读）沿固定时间轴各连一条曲线 */
  const SERIES_DEF = [
    { key: 'output', label: '输出', color: '#3b7dd8' },
    { key: 'general', label: '一般', color: '#e5534b' },
    { key: 'reading', label: '阅读', color: '#2e9a71' },
  ];

  function drawDayChart() {
    const { ctx, W, H } = chartCanvas();
    const padL = 30, padR = 16, padT = 16, padB = 28;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    chartPts = [];

    // 只看当天：新的一天 → 图表为空、重新开始；历史数据保留，可切换日期回看
    const focus = sessionsOfDay(allSessions)
      .filter((s) => s.type === 'focus' && s.scores &&
        SERIES_DEF.some((m) => s.scores[m.key] && s.scores[m.key].score != null))
      .sort((a, b) => new Date(a.start) - new Date(b.start));

    // 纵轴上限自适应：三条指标一起取最大，分数可超 100，向上取整到 50 的倍数（至少 100）
    let maxScore = 0;
    for (const s of focus) {
      for (const m of SERIES_DEF) {
        const sc = s.scores[m.key] && s.scores[m.key].score;
        if (sc != null) maxScore = Math.max(maxScore, sc);
      }
    }
    const yMax = Math.max(100, Math.ceil(maxScore / 50) * 50);
    const yOf = (v) => padT + plotH - (v / yMax) * plotH;

    ctx.font = '11px ' + getComputedStyle(document.body).fontFamily;
    [0, yMax / 2, yMax].forEach((v) => {
      const y = yOf(v);
      ctx.strokeStyle = v === 0 ? '#e6e1d8' : '#f1ede6';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, y + 0.5); ctx.lineTo(W - padR, y + 0.5); ctx.stroke();
      ctx.fillStyle = '#958e84';
      ctx.textAlign = 'right';
      ctx.fillText(String(v), padL - 8, y + 4);
    });

    // 100 分基准线：超过 = 超过满分水平（≥ 基线 1.25 倍速率）
    if (yMax > 100) {
      const y100 = yOf(100);
      ctx.save();
      ctx.strokeStyle = 'rgba(229,83,75,.55)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(padL, y100 + 0.5); ctx.lineTo(W - padR, y100 + 0.5); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#e5534b';
      ctx.font = '600 11px ' + getComputedStyle(document.body).fontFamily;
      ctx.textAlign = 'right';
      ctx.fillText('100', padL - 8, y100 + 4);
      ctx.font = '11px ' + getComputedStyle(document.body).fontFamily;
    }
    ctx.textAlign = 'left';

    // 固定时间轴 0:00–24:00（5 分钟一格）
    const xOf = drawFixedDayAxis(ctx, W, H, padL, padR, padT, plotH);

    if (focus.length === 0) {
      ctx.fillStyle = '#958e84';
      ctx.font = '13px ' + getComputedStyle(document.body).fontFamily;
      ctx.textAlign = 'center';
      ctx.fillText(
        isToday() ? '新的一天 · 完成一段专注后，趋势将从这里重新开始' : '这一天还没有专注记录',
        padL + plotW / 2, padT + plotH / 2 + 4
      );
      ctx.textAlign = 'left';
      return;
    }

    // 每条指标一条曲线：输出 → 阅读 → 一般（一般为主指标，画在最上层）
    const drawOrder = ['output', 'reading', 'general'];
    const hoverInfo = chartHover;
    for (const key of drawOrder) {
      const def = SERIES_DEF.find((m) => m.key === key);
      const pts = focus
        .map((s) => ({ x: xOf(+new Date(s.start)), s, score: s.scores[def.key] ? s.scores[def.key].score : null }))
        .filter((p) => p.score != null)
        .map((p) => ({ x: p.x, y: yOf(p.score), s: p.s }));
      if (pts.length === 0) continue;
      const isMain = def.key === 'general';

      const g = ctx.createLinearGradient(0, padT, 0, padT + plotH);
      g.addColorStop(0, def.color + (isMain ? '29' : '1f'));
      g.addColorStop(1, def.color + '00');
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.lineTo(pts[pts.length - 1].x, padT + plotH);
      ctx.lineTo(pts[0].x, padT + plotH);
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();

      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.strokeStyle = def.color;
      ctx.lineWidth = isMain ? 2 : 1.5;
      ctx.lineJoin = 'round';
      ctx.stroke();

      pts.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, isMain ? 3 : 2.2, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.lineWidth = isMain ? 2 : 1.5;
        ctx.strokeStyle = def.color;
        ctx.stroke();
      });

      // 悬停命中点（每条曲线都参与命中）
      pts.forEach((p) => chartPts.push({ x: p.x, y: p.y, s: p.s, metric: def.key, color: def.color }));

      // 末段分数徽标：只标主指标（一般）
      if (isMain) {
        const last = pts[pts.length - 1];
        const label = String(last.s.scores.general.score);
        ctx.font = '600 12px ' + getComputedStyle(document.body).fontFamily;
        const tw = ctx.measureText(label).width;
        const bw = tw + 14, bh = 22;
        const bx = Math.min(Math.max(last.x - bw / 2, padL), W - padR - bw);
        const by = Math.max(2, last.y - bh - 10);
        ctx.fillStyle = '#1f1d1a';
        ctx.beginPath();
        ctx.roundRect(bx, by, bw, bh, 7);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(label, bx + 7, by + 15);
      }
    }

    // 悬停提示浮层
    if (hoverInfo >= 0 && hoverInfo < chartPts.length) {
      const p = chartPts[hoverInfo];
      const s = p.s;
      const rate = (s.enterCount / (s.durationSec / 60)).toFixed(1);
      const def = SERIES_DEF.find((m) => m.key === p.metric);
      const lines = [
        fmtClock(+new Date(s.start)) + ' 开始 · ' + def.label + '：' +
          (s.scores[def.key] && s.scores[def.key].score != null ? s.scores[def.key].score + ' 分' : '—'),
        (s.endedBy === 'early' ? '提前完成' : s.endedBy === 'skip' ? '已放弃' : '到时结束'),
        'E=' + s.enterCount + ' S=' + (s.spaceCount || 0) + ' C=' + (s.clickCount || 0) + ' W=' + (s.wheelCount || 0),
        rate + ' Enter/分',
      ];
      if (s.scores) {
        const f = (label, x) => label + (x.score == null ? '—' : ' ' + x.score);
        lines.push(f('输出', s.scores.output) + ' · ' + f('一般', s.scores.general) + ' · ' + f('阅读', s.scores.reading));
      }
      if (s.task && s.task !== DEFAULT_TASK) lines.push('任务：' + s.task);
      drawTooltip(ctx, W, padL, padR, p.x, p.y, lines);
      // 高亮悬停点
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = def.color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }
  }

  /** 5 分钟模式：每个 5 分钟桶折算成分数，口径与整天一致 ——
   *  速率 = 桶内 Enter ÷ 5（Enter/分），分数 = 80 × 速率 ÷ 所在专注段的基线速率，
   *  悬停可看与基线的百分比差；颜色按分数档位（绿=超级认真 / 琥珀=状态稳定 / 红=有所下降）。 */
  function drawFineChart() {
    const { ctx, W, H } = chartCanvas();
    const padL = 30, padR = 16, padT = 16, padB = 28;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    chartPts = [];

    const BM = 5 * 60000;
    const base = viewDay(); base.setHours(0, 0, 0, 0);
    const baseMs = +base;
    const daySess = sessionsOfDay(allSessions).sort((a, b) => new Date(a.start) - new Date(b.start));
    const buckets = fineSeries(fineMetric);
    const scoreKey = FINE_SCORE_KEY[fineMetric];

    if (buckets.length === 0) {
      ctx.fillStyle = '#958e84';
      ctx.font = '13px ' + getComputedStyle(document.body).fontFamily;
      ctx.textAlign = 'center';
      ctx.fillText(
        isToday() ? '今天还没有按键明细 · 开始一段专注后，这里会出现 5 分钟粒度曲线' : '这一天没有按键明细记录',
        padL + plotW / 2, padT + plotH / 2 + 4
      );
      ctx.textAlign = 'left';
      return;
    }

    // 固定时间轴 0:00–24:00（5 分钟一格）；背景带：专注（番茄红）/ 休息（绿）
    const xOf = drawFixedDayAxis(ctx, W, H, padL, padR, padT, plotH);
    for (const s of daySess) {
      const a = +new Date(s.start), z = a + (s.durationSec || 0) * 1000;
      ctx.fillStyle = s.type === 'focus' ? 'rgba(229,83,75,.08)' : 'rgba(46,154,113,.10)';
      ctx.fillRect(xOf(a), padT, Math.max(1, xOf(z) - xOf(a)), plotH);
    }

    // 桶 → 所在专注段 → 按当前指标的基线折算分数（无法折算的桶不画，只保留背景带）
    const pts = [];
    for (const b of buckets) {
      const t = baseMs + b.minuteOfDay * 60000;
      const mid = t + BM / 2;
      const sess = daySess.find((s) => {
        const a = +new Date(s.start), z = a + (s.durationSec || 0) * 1000;
        return mid >= a && mid <= z;
      });
      if (!sess || sess.type !== 'focus') continue;
      const ms = sess.scores && sess.scores[scoreKey];
      const baseRate = ms ? ms.baselineRate : (scoreKey === 'general' ? sess.baselineRate : null);
      if (baseRate == null) continue;
      const rate = b.count / 5; // 次/分
      const score = Math.max(0, Math.round((80 * rate) / baseRate));
      pts.push({ t, b, sess, score });
    }

    const emptyMsg = (msg) => {
      ctx.fillStyle = '#958e84';
      ctx.font = '13px ' + getComputedStyle(document.body).fontFamily;
      ctx.textAlign = 'center';
      ctx.fillText(msg, padL + plotW / 2, padT + plotH / 2 + 4);
      ctx.textAlign = 'left';
    };

    if (pts.length === 0) {
      emptyMsg('这一天没有可折算分数的专注段明细（基线未建档，或按键都在段外）');
      return;
    }

    // 纵轴 = 分数，与整天模式同口径：上限至少 100，超出则取整到 50 的倍数
    const maxScore = pts.reduce((m, p) => Math.max(m, p.score), 0);
    const yMax = Math.max(100, Math.ceil(maxScore / 50) * 50);
    const yOf = (v) => padT + plotH - (v / yMax) * plotH;
    ctx.font = '11px ' + getComputedStyle(document.body).fontFamily;
    [0, yMax / 2, yMax].forEach((v) => {
      const y = yOf(v);
      ctx.strokeStyle = v === 0 ? '#e6e1d8' : '#f1ede6';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, y + 0.5); ctx.lineTo(W - padR, y + 0.5); ctx.stroke();
      ctx.fillStyle = '#958e84';
      ctx.textAlign = 'right';
      ctx.fillText(String(v), padL - 8, y + 4);
    });
    if (yMax > 100) {
      const y100 = yOf(100);
      ctx.save();
      ctx.strokeStyle = 'rgba(229,83,75,.55)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(padL, y100 + 0.5); ctx.lineTo(W - padR, y100 + 0.5); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#e5534b';
      ctx.font = '600 11px ' + getComputedStyle(document.body).fontFamily;
      ctx.textAlign = 'right';
      ctx.fillText('100', padL - 8, y100 + 4);
    }
    ctx.textAlign = 'left';

    pts.forEach((p) => {
      p.x = xOf(p.t + BM / 2); // 点取桶中心
      p.y = yOf(p.score);
    });
    chartPts = pts;

    // 分段折线：同一专注段内的桶连成一段，段间（休息/空闲）断开
    const groups = [];
    for (const p of pts) {
      const g = groups[groups.length - 1];
      if (g && g.sessId === p.sess.id) g.items.push(p);
      else groups.push({ sessId: p.sess.id, items: [p] });
    }
    for (const g of groups) {
      const items = g.items;
      if (items.length === 0) continue;
      const gg = ctx.createLinearGradient(0, padT, 0, padT + plotH);
      gg.addColorStop(0, 'rgba(229,83,75,.14)');
      gg.addColorStop(1, 'rgba(229,83,75,0)');
      ctx.beginPath();
      items.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.lineTo(items[items.length - 1].x, padT + plotH);
      ctx.lineTo(items[0].x, padT + plotH);
      ctx.closePath();
      ctx.fillStyle = gg;
      ctx.fill();

      ctx.beginPath();
      items.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.strokeStyle = '#e5534b';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    pts.forEach((p, i) => {
      const hov = i === chartHover;
      ctx.beginPath();
      ctx.arc(p.x, p.y, hov ? 5 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = hov ? '#e5534b' : '#fff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = hov ? '#c73e37' : '#e5534b';
      ctx.stroke();
    });

    // 悬停提示
    if (chartHover >= 0 && chartHover < pts.length) {
      const p = pts[chartHover];
      const s = p.sess;
      const rate = p.b.count / 5;
      const ms = s.scores && s.scores[scoreKey];
      const baseRate = ms ? ms.baselineRate : (scoreKey === 'general' ? s.baselineRate : null);
      const d = baseRate != null ? Math.round((rate / baseRate) * 100 - 100) : null;
      const lines = [
        fmtClock(p.t) + ' – ' + fmtClock(p.t + BM),
        p.score + ' 分（' + tierText(p.score) + '）',
        p.b.count + ' 次 · ' + rate.toFixed(1) + ' 次/分',
        d == null ? '首段建档' : 'vs 基线 ' + (d >= 0 ? '+' : '') + d + '%',
      ];
      if (s.task && s.task !== DEFAULT_TASK) lines.push('任务：' + s.task);
      drawTooltip(ctx, W, padL, padR, p.x, p.y, lines);
    }
  }

  /* ---------- 专注热力图（GitHub 风格，按天专注段数上色） ---------- */
  const heatChart = $('heatChart');
  let heatHover = null; // { c, r } 当前列/行
  const HEAT_LV = ['#efede8', '#f6c1bd', '#ef8d86', '#e5534b', '#b23229'];

  function heatGeom() {
    const W = heatChart.clientWidth || 900, H = heatChart.clientHeight || 150;
    const padL = 24, padT = 18, gap = 3;
    const cell = Math.max(6, Math.floor(Math.min(16, (H - padT - 6) / 7 - gap)));
    const weeks = Math.max(8, Math.floor((W - padL - 8) / (cell + gap)));
    return { W, H, padL, padT, gap, cell, weeks };
  }
  function heatLevel(n) { return n === 0 ? 0 : n <= 2 ? 1 : n <= 4 ? 2 : n <= 6 ? 3 : 4; }
  function heatStart(today, weeks) {
    const dow = (today.getDay() + 6) % 7; // 周一 = 0
    const start = new Date(today);
    start.setDate(start.getDate() - (weeks - 1) * 7 - dow); // 第一列的周一
    return start;
  }

  function drawHeatmap() {
    const { W, H, padL, padT, gap, cell, weeks } = heatGeom();
    const dpr = window.devicePixelRatio || 1;
    heatChart.width = Math.round(W * dpr);
    heatChart.height = Math.round(H * dpr);
    const ctx = heatChart.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = '10.5px ' + getComputedStyle(document.body).fontFamily;

    // 每天的专注段数 & 平均分
    const byDay = new Map();
    for (const s of allSessions) {
      if (s.type !== 'focus') continue;
      const k = dayKey(new Date(s.start));
      const o = byDay.get(k) || { count: 0, scores: [] };
      o.count += 1;
      if (s.score != null) o.scores.push(s.score);
      byDay.set(k, o);
    }

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start = heatStart(today, weeks);
    const viewKey = dayKey(viewDay());
    let prevMonth = -1;

    for (let c = 0; c < weeks; c++) {
      for (let r = 0; r < 7; r++) {
        const d = new Date(start);
        d.setDate(start.getDate() + c * 7 + r);
        if (d > today) continue; // 未来格不画
        const k = dayKey(d);
        const info = byDay.get(k);
        const cnt = info ? info.count : 0;
        const x = padL + c * (cell + gap);
        const y = padT + r * (cell + gap);
        ctx.fillStyle = HEAT_LV[heatLevel(cnt)];
        ctx.beginPath();
        ctx.roundRect(x, y, cell, cell, 3);
        ctx.fill();
        if (k === viewKey || (heatHover && heatHover.c === c && heatHover.r === r)) {
          ctx.strokeStyle = '#1f1d1a';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        if (heatHover && heatHover.c === c && heatHover.r === r) {
          const lines = [
            (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEK[d.getDay()],
            cnt === 0 ? '无专注记录' : cnt + ' 段专注',
            info && info.scores.length
              ? '平均分 ' + Math.round(info.scores.reduce((a, b) => a + b, 0) / info.scores.length)
              : '无评分',
            '点击查看该天趋势',
          ];
          drawTooltip(ctx, W, padL, 8, x + cell / 2, y, lines);
        }
      }
      // 月份标签：该列第一天的月份变化时标注
      const d0 = new Date(start); d0.setDate(start.getDate() + c * 7);
      if (d0.getMonth() !== prevMonth) {
        prevMonth = d0.getMonth();
        ctx.fillStyle = '#958e84';
        ctx.textAlign = 'left';
        ctx.fillText((d0.getMonth() + 1) + '月', padL + c * (cell + gap), padT - 6);
      }
    }
    // 星期标签（周一 / 周三 / 周五）
    ctx.fillStyle = '#958e84';
    ctx.textAlign = 'left';
    ['一', '三', '五'].forEach((t, i) => {
      ctx.fillText(t, 4, padT + i * 2 * (cell + gap) + cell / 2 + 4);
    });
  }

  heatChart.addEventListener('mousemove', (e) => {
    const rect = heatChart.getBoundingClientRect();
    const { padL, padT, gap, cell, weeks } = heatGeom();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const c = Math.floor((mx - padL) / (cell + gap));
    const r = Math.floor((my - padT) / (cell + gap));
    const inCell = mx - padL - c * (cell + gap) <= cell && my - padT - r * (cell + gap) <= cell;
    const next = c >= 0 && c < weeks && r >= 0 && r < 7 && inCell ? { c, r } : null;
    const changed = JSON.stringify(next) !== JSON.stringify(heatHover);
    heatHover = next;
    heatChart.style.cursor = next ? 'pointer' : 'default';
    if (changed) drawHeatmap();
  });
  heatChart.addEventListener('mouseleave', () => {
    if (heatHover) { heatHover = null; drawHeatmap(); }
  });
  heatChart.addEventListener('click', () => {
    if (!heatHover) return;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start = heatStart(today, heatGeom().weeks);
    const d = new Date(start);
    d.setDate(start.getDate() + heatHover.c * 7 + heatHover.r);
    const diff = Math.round((+today - +d) / 86400000);
    if (diff < 0) return; // 未来
    viewOffset = -diff;
    refreshSessions();
  });

  function setFineMetric(metric) {
    fineMetric = metric;
    chartHover = -1;
    $('btnMGeneral').classList.toggle('active', metric === 'general');
    $('btnMOutput').classList.toggle('active', metric === 'output');
    $('btnMReading').classList.toggle('active', metric === 'reading');
    drawTrend();
  }

  function setChartMode(mode) {
    chartMode = mode;
    chartHover = -1;
    $('btnModeDay').classList.toggle('active', mode === 'day');
    $('btnModeFine').classList.toggle('active', mode === 'fine');
    $('metricSeg').hidden = mode !== 'fine';
    drawTrend();
  }

  /** 趋势页当天概览 */
  function renderDayStats(sessions) {
    const day = sessionsOfDay(sessions);
    const focus = day.filter((s) => s.type === 'focus');
    const mins = Math.round(focus.reduce((a, s) => a + (s.durationSec || 0), 0) / 60);
    const scored = focus.filter((s) => s.score != null);
    $('dayFocusCount').textContent = focus.length;
    $('dayFocusMin').textContent = mins;
    $('dayTotalE').textContent = day.reduce((a, s) => a + s.enterCount, 0).toLocaleString();
    $('dayAvgScore').textContent = scored.length === 0
      ? '--'
      : Math.round(scored.reduce((a, s) => a + s.score, 0) / scored.length);
  }

  function renderDayLabel() {
    const d = viewDay();
    const prefix = viewOffset === 0 ? '今天 · ' : viewOffset === -1 ? '昨天 · ' : '';
    $('dayLabel').textContent = prefix + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEK[d.getDay()];
    $('btnNextDay').disabled = isToday();
    $('btnToday').hidden = isToday();
  }

  function showView(name) {
    const trend = name === 'trend';
    $('viewMain').hidden = trend;
    $('viewTrend').hidden = !trend;
    window.scrollTo(0, 0);
    if (trend) refreshSessions();
  }

  /* ---------- 表格 & 概览 ---------- */
  function renderTable(sessions) {
    const tb = document.querySelector('#historyTable tbody');
    tb.innerHTML = '';
    const rows = sessions.slice(-14).reverse();
    if (rows.length === 0) {
      tb.innerHTML = '<tr><td colspan="8" class="empty">本日暂无记录</td></tr>';
      return;
    }
    const scoreCell = (x) =>
      x == null || x.score == null
        ? '<span class="nodata">—</span>'
        : '<span class="sc ' + scoreTier(x.score) + '">' + x.score + '</span>';
    rows.forEach((s) => {
      const d = new Date(s.start);
      const when = p2(d.getHours()) + ':' + p2(d.getMinutes());
      const ended = s.endedBy === 'early' ? ' ✓' : s.endedBy === 'skip' ? ' ✗' : '';
      const counts =
        'E' + s.enterCount + ' S' + (s.spaceCount || 0) +
        ' C' + (s.clickCount || 0) + ' W' + (s.wheelCount || 0);
      const sc = s.type !== 'focus'
        ? { output: null, general: null, reading: null }
        : s.scores || { output: null, general: { score: s.score }, reading: null };
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td><span class="pill ' + s.type + '">' + (TYPE_NAME[s.type] || s.type) + '</span></td>' +
        '<td class="task-cell" title="' + (s.task || '') + '">' + (s.task || '—') + ended + '</td>' +
        '<td>' + when + '</td>' +
        '<td class="counts-cell">' + counts + '</td>' +
        '<td>' + scoreCell(sc.output) + '</td>' +
        '<td>' + scoreCell(sc.general) + '</td>' +
        '<td>' + scoreCell(sc.reading) + '</td>' +
        '<td class="del-cell"><button class="btn-del" data-id="' + s.id + '" title="删除这条记录（原始事件日志保留）">✕</button></td>';
      tb.appendChild(tr);
    });
  }

  function renderStats(sessions) {
    const focus = sessions.filter((s) => s.type === 'focus');
    $('statFocusCount').textContent = focus.length;
    $('statTotalE').textContent = sessions.reduce((a, s) => a + s.enterCount, 0).toLocaleString();
    const scored = focus.filter((s) => s.score != null);
    $('statAvgScore').textContent = scored.length === 0
      ? '--'
      : Math.round(scored.reduce((a, s) => a + s.score, 0) / scored.length);
  }

  /** 最近用过的任务类型快捷选择 */
  function renderTaskChips(sessions) {
    const seen = [];
    for (let i = sessions.length - 1; i >= 0 && seen.length < 4; i--) {
      const t = (sessions[i].task || '').trim();
      if (t && t !== DEFAULT_TASK && !seen.includes(t)) seen.push(t);
    }
    const box = $('taskChips');
    box.innerHTML = '';
    seen.forEach((t) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'task-chip';
      chip.textContent = t;
      chip.onclick = () => {
        $('taskInput').value = t;
        api.setTask(t).then(render);
      };
      box.appendChild(chip);
    });
  }

  /** 基线样本选择：列出可选的专注段，勾选即作为 80 分基线 */
  function renderBaselineList(sessions) {
    const list = $('baselineList');
    list.innerHTML = '';
    const cands = sessions
      .filter((s) => s.type === 'focus' && s.enterCount > 0 && s.durationSec >= 60 && (s.endedBy ?? 'timer') !== 'skip')
      .slice(-12)
      .reverse();
    if (cands.length === 0) {
      list.innerHTML = '<p class="empty" style="padding:10px 0">完成几段专注后，这里可以勾选基线样本</p>';
    }
    cands.forEach((s) => {
      const d = new Date(s.start);
      const when = p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
      const rate = (s.enterCount / (s.durationSec / 60)).toFixed(1);
      const sel = baselineIds.includes(s.id);
      const item = document.createElement('label');
      item.className = 'bl-item' + (sel ? ' sel' : '');
      item.innerHTML =
        '<input type="checkbox" ' + (sel ? 'checked' : '') + '/>' +
        '<span class="bl-when">' + when + '</span>' +
        '<span class="bl-task" title="' + (s.task || '') + '">' + (s.task || '—') + '</span>' +
        '<span class="bl-meta">E=' + s.enterCount + ' · ' + rate + '/分 · ' +
        Math.round(s.durationSec / 60) + '分' + (s.score != null ? ' · ' + s.score + '分' : '') + '</span>';
      const cb = item.querySelector('input');
      cb.addEventListener('change', async () => {
        const res = await api.toggleBaseline(s.id, cb.checked);
        baselineIds = res.baselineIds || [];
        item.classList.toggle('sel', cb.checked);
        $('btnAutoBaseline').hidden = baselineIds.length === 0;
        if (lastState) {
          lastState.baseline = res.baseline;
          render(lastState);
        }
        // 基线变了 → 历史分数实时重算（趋势图/表格/平均分跟着变）
        await refreshSessions();
        const gb = res.baseline && res.baseline.general;
        toast(gb && gb.rate != null && gb.manual
          ? '手动基线已生效：一般 ' + gb.rate.toFixed(1) + ' 次/分（' + gb.sampleCount + ' 段）'
          : '已恢复自动基线');
      });
      list.appendChild(item);
    });
    $('btnAutoBaseline').hidden = baselineIds.length === 0;
  }

  async function refreshSessions() {
    allSessions = await api.getSessions();
    fineDay = ''; // 数据可能更新，5 分钟明细重新加载
    renderDayLabel();
    renderDayStats(allSessions);
    renderStats(allSessions);
    renderTaskChips(allSessions);
    renderBaselineList(allSessions);
    renderTable(sessionsOfDay(allSessions));
    drawHeatmap();
    await drawTrend();
  }

  /* ---------- 初始化 ---------- */
  async function init() {
    if (!api) {
      document.body.innerHTML = '<p style="padding:40px">preload 未加载，请用 electron 启动。</p>';
      return;
    }
    cfg = await api.getConfig();
    $('cfgFocus').value = cfg.focusMinutes;
    $('cfgShort').value = cfg.shortBreakMinutes;
    $('cfgLong').value = cfg.longBreakMinutes;
    $('cfgEvery').value = cfg.longBreakEvery;
    $('cfgTest').checked = !!cfg.testMode;
    $('cfgNotifySystem').checked = cfg.notifySystem !== false;
    $('cfgNotifyPopup').checked = !!cfg.notifyPopup;
    $('cfgNotifyWeb').checked = !!cfg.notifyWeb;
    $('testBadge').hidden = !cfg.testMode;

    // 提醒渠道开关：即改即存（之前必须再点上面的「保存」才生效，
    // 而「保存」在上一行、开关在下一块，很容易拨完开关却什么也没存上）
    const notifySwitches = [
      ['cfgNotifySystem', 'notifySystem'],
      ['cfgNotifyPopup', 'notifyPopup'],
      ['cfgNotifyWeb', 'notifyWeb'],
    ];
    for (const [elId, key] of notifySwitches) {
      $(elId).onchange = async () => {
        const checked = $(elId).checked;
        cfg = await api.setConfig({ [key]: checked });
        const label = $(elId).closest('label').textContent.trim();
        toast((checked ? '已开启' : '已关闭') + '：' + label + '（立即生效）');
      };
    }
    $('btnTestRemind').onclick = async () => {
      const res = await api.testRemind();
      cfg = res || cfg;
      const names = [];
      if (cfg.notifySystem !== false) names.push('系统通知');
      if (cfg.notifyPopup) names.push('应用内弹窗');
      if (cfg.notifyWeb) names.push('浏览器网页');
      $('remindTestHint').textContent =
        names.length > 0 ? '已发送：' + names.join(' + ') : '三个开关都关着，先打开一个再测';
      toast(names.length > 0 ? '已发送测试提醒' : '三个渠道都关着');
    };

    $('btnRemindClose').onclick = hideRemind;
    $('remindMask').onclick = (e) => {
      if (e.target === $('remindMask')) hideRemind();
    };
    $('btnRemindFocus').onclick = async () => {
      hideRemind();
      render(await api.startPhase('focus'));
    };
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('remindMask').hidden) hideRemind();
    });

    // 启动强提醒：基线规则 + 手动开始提醒（点「我已知晓」后才不再出现）
    if (!cfg.guideAck) $('guideMask').hidden = false;
    $('btnGuideAck').onclick = async () => {
      cfg = await api.setConfig({ guideAck: true });
      $('guideMask').hidden = true;
    };
    $('btnGuideClose').onclick = () => { $('guideMask').hidden = true; };

    const st = await api.getState();
    baselineIds = st.baselineIds || [];
    render(st);
    await refreshSessions();

    api.onTick(render);
    api.onKeys((counts) => {
      lastKeys = counts;
      $('enterCount').textContent = counts.enter;
      $('backspaceCount').textContent = counts.backspace;
      $('spaceCount').textContent = counts.space;
      $('clickCount').textContent = counts.click;
      $('wheelCount').textContent = counts.wheel;
      if (lastState && lastState.phase === 'focus') render(lastState);
    });
    api.onPhaseEnd(async ({ record }) => {
      if (record && record.type === 'focus') {
        const sc = record.scores;
        if (!sc) {
          toast(record.score == null ? '本段无按键数据' : record.score + ' 分');
        } else {
          const f = (x) => (x.score == null ? '—' : x.score + ' 分');
          toast('输出 ' + f(sc.output) + ' · 一般 ' + f(sc.general) + ' · 阅读 ' + f(sc.reading));
        }
      } else if (record) {
        toast('休息结束 · 手动开始下一个专注');
      }
      await refreshSessions();
    });
    api.onRemind((p) => showRemind(p));
    showRemind(await api.takeRemind());
    api.onHookStatus(({ ok, message }) => setHook(ok, message));

    $('taskInput').addEventListener('change', () => {
      api.setTask($('taskInput').value).then(render);
    });

    $('btnStart').onclick = async () => render(await api.start());
    $('btnPause').onclick = async () => render(await api.pause());
    $('btnResume').onclick = async () => render(await api.resume());
    $('btnFinish').onclick = async () => { render(await api.finishEarly()); await refreshSessions(); };
    $('btnSkip').onclick = async () => { render(await api.skip()); await refreshSessions(); };
    $('btnReset').onclick = async () => { render(await api.reset()); await refreshSessions(); };
    $('btnFocus').onclick = async () => render(await api.startPhase('focus'));
    $('btnShort').onclick = async () => render(await api.startPhase('short'));
    $('btnLong').onclick = async () => render(await api.startPhase('long'));
    $('hookStatus').onclick = async () => {
      const r = await api.reconnectHook();
      setHook(r.running, r.running ? '' : '重连失败，见主进程日志');
      toast(r.running ? '钩子已重连' : '钩子重连失败，请查看日志');
    };

    // 视图切换 & 趋势页
    $('btnTrendView').onclick = () => showView('trend');
    $('btnBackMain').onclick = () => showView('main');
    $('btnPrevDay').onclick = () => { viewOffset = Math.max(viewOffset - 1, -366); chartHover = -1; refreshSessions(); };
    $('btnNextDay').onclick = () => { viewOffset = Math.min(viewOffset + 1, 0); chartHover = -1; refreshSessions(); };
    $('btnToday').onclick = () => { viewOffset = 0; chartHover = -1; refreshSessions(); };
    $('btnModeDay').onclick = () => setChartMode('day');
    $('btnModeFine').onclick = () => setChartMode('fine');
    $('btnMGeneral').onclick = () => setFineMetric('general');
    $('btnMOutput').onclick = () => setFineMetric('output');
    $('btnMReading').onclick = () => setFineMetric('reading');

    $('btnSaveCfg').onclick = async () => {
      cfg = await api.setConfig({
        focusMinutes: Math.max(1, +$('cfgFocus').value || 25),
        shortBreakMinutes: Math.max(1, +$('cfgShort').value || 5),
        longBreakMinutes: Math.max(1, +$('cfgLong').value || 15),
        longBreakEvery: Math.max(1, +$('cfgEvery').value || 4),
        testMode: $('cfgTest').checked,
        notifySystem: $('cfgNotifySystem').checked,
        notifyPopup: $('cfgNotifyPopup').checked,
        notifyWeb: $('cfgNotifyWeb').checked,
      });
      $('testBadge').hidden = !cfg.testMode;
      toast(cfg.testMode ? '已保存 · 测试模式每段 1 分钟' : '设置已保存');
    };
    $('cfgTest').onchange = async () => {
      cfg = await api.setConfig({ testMode: $('cfgTest').checked });
      $('testBadge').hidden = !cfg.testMode;
    };
    $('btnClear').onclick = async () => {
      await api.clearSessions();
      baselineIds = [];
      $('btnAutoBaseline').hidden = true;
      await refreshSessions();
      toast('历史已清空');
    };

    // 表格行内删除：只删展示用的 session 记录（如测试产生的数据点），
    // 原始事件日志（events/*.jsonl）不受影响；若删的是基线样本，基线自动回退
    document.querySelector('#historyTable tbody').addEventListener('click', async (e) => {
      const btn = e.target.closest('.btn-del');
      if (!btn) return;
      if (!window.confirm('删除这条记录？（原始事件日志保留，不受影响）')) return;
      const res = await api.deleteSessions([btn.dataset.id]);
      baselineIds = res.baselineIds || [];
      $('btnAutoBaseline').hidden = baselineIds.length === 0;
      await refreshSessions();
      if (lastState) render(lastState);
      toast('已删除该条记录');
    });

    $('btnAutoBaseline').onclick = async () => {
      // 逐个取消勾选：发送一次空切换即可 —— 直接把当前所有选中 id 取消
      for (const id of [...baselineIds]) {
        await api.toggleBaseline(id, false);
      }
      baselineIds = [];
      $('btnAutoBaseline').hidden = true;
      await refreshSessions();
      if (lastState) render(lastState);
      toast('已恢复自动基线（中位数±3 段均值）');
    };

    window.addEventListener('resize', () => refreshSessions());
  }

  document.addEventListener('DOMContentLoaded', init);
})();
