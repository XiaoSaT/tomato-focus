import koffi from 'koffi';

/**
 * 前台全屏窗口监视（RDP 全屏钩子问题的修复）：
 * mstsc 全屏时会安装自己的 WH_KEYBOARD_LL 钩子抓按键转发远程，且后装的钩子
 * 先被调用、它不往下传 → 我们的钩子（装得更早）收不到键。
 * 对策：检测到"新的全屏前台窗口"时重装我们的钩子，让我们排到链头。
 */

const user32 = koffi.load('user32.dll');

const RECT = koffi.struct('RECT', {
  left: 'long',
  top: 'long',
  right: 'long',
  bottom: 'long',
});
const MONITORINFO = koffi.struct('MONITORINFO', {
  cbSize: 'uint32',
  rcMonitor: 'RECT',
  rcWork: 'RECT',
  dwFlags: 'uint32',
});

const GetForegroundWindow = user32.func('void *GetForegroundWindow()');
const GetWindowRect = user32.func('bool GetWindowRect(void *hwnd, _Out_ RECT *rect)');
const MonitorFromWindow = user32.func('void *MonitorFromWindow(void *hwnd, uint32 dwFlags)');
const GetMonitorInfoW = user32.func('bool GetMonitorInfoW(void *hMonitor, _Inout_ MONITORINFO *info)');

const MONITOR_DEFAULTTONEAREST = 2;
const EDGE_TOLERANCE = 8; // 容忍 8px 的四边舍入误差

export interface FullscreenWatcher {
  start(onFullscreenEnter: (hwnd: string) => void): void;
  stop(): void;
  /** 仅供测试：检查当前前台窗口是否全屏 */
  isForegroundFullscreen(): boolean;
}

export function createFullscreenWatcher(): FullscreenWatcher {
  let timer: NodeJS.Timeout | null = null;
  let lastFullscreenHwnd: string | null = null;
  let lastForeground: string | null = null;
  let currentlyFullscreen = false;

  function readForeground(): { hwnd: string | null; fullscreen: boolean } {
    try {
      const hwnd = GetForegroundWindow();
      if (!hwnd || (typeof hwnd === 'object' && Buffer.isBuffer(hwnd) && hwnd.length === 0)) {
        return { hwnd: null, fullscreen: false };
      }
      const key = hwnd.toString();
      const rect = {};
      if (!GetWindowRect(hwnd, rect)) return { hwnd: key, fullscreen: false };
      const r = rect as { left: number; top: number; right: number; bottom: number };
      const hmon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
      if (!hmon) return { hwnd: key, fullscreen: false };
      const mi = { cbSize: koffi.sizeof(MONITORINFO), rcMonitor: {}, rcWork: {}, dwFlags: 0 };
      if (!GetMonitorInfoW(hmon, mi)) return { hwnd: key, fullscreen: false };
      const m = (mi.rcMonitor ?? {}) as { left: number; top: number; right: number; bottom: number };
      // 窗口覆盖整个显示器（±容差）才算全屏；最大化窗口底边停在任务栏上沿，不会误判
      const t = EDGE_TOLERANCE;
      const fullscreen =
        r.left <= m.left + t &&
        r.top <= m.top + t &&
        r.right >= m.right - t &&
        r.bottom >= m.bottom - t;
      return { hwnd: key, fullscreen };
    } catch {
      return { hwnd: null, fullscreen: false };
    }
  }

  return {
    start(onFullscreenEnter) {
      this.stop();
      timer = setInterval(() => {
        const { hwnd, fullscreen } = readForeground();
        if (hwnd !== lastForeground) {
          // 前台窗口变化：离开上一个全屏窗口时清除记忆，便于再次进入时重新触发
          if (hwnd !== lastFullscreenHwnd) lastFullscreenHwnd = null;
          lastForeground = hwnd;
          currentlyFullscreen = false;
        }
        if (fullscreen && hwnd && hwnd !== lastFullscreenHwnd) {
          lastFullscreenHwnd = hwnd;
          currentlyFullscreen = true;
          console.log('[fgwatch] fullscreen foreground detected → re-hook (hwnd=' + hwnd + ')');
          onFullscreenEnter(hwnd);
        } else if (!fullscreen && currentlyFullscreen) {
          currentlyFullscreen = false;
        }
      }, 1000);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    isForegroundFullscreen() {
      return readForeground().fullscreen;
    },
  };
}
