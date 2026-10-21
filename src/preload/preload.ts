import { contextBridge, ipcRenderer } from 'electron';

const api = {
  getState: () => ipcRenderer.invoke('app:getState'),
  getConfig: () => ipcRenderer.invoke('app:getConfig'),
  takeRemind: () => ipcRenderer.invoke('app:takeRemind'),
  testRemind: () => ipcRenderer.invoke('remind:test'),
  setConfig: (patch: Record<string, unknown>) => ipcRenderer.invoke('app:setConfig', patch),
  getSessions: () => ipcRenderer.invoke('app:getSessions'),
  getDayBuckets: (dateStr: string, bucketMin = 5) =>
    ipcRenderer.invoke('app:getDayBuckets', dateStr, bucketMin),
  clearSessions: () => ipcRenderer.invoke('app:clearSessions'),
  deleteSessions: (ids: string[]) => ipcRenderer.invoke('app:deleteSessions', ids),
  toggleBaseline: (id: string, selected: boolean) =>
    ipcRenderer.invoke('app:toggleBaseline', id, selected),
  start: () => ipcRenderer.invoke('pomodoro:start'),
  pause: () => ipcRenderer.invoke('pomodoro:pause'),
  resume: () => ipcRenderer.invoke('pomodoro:resume'),
  skip: () => ipcRenderer.invoke('pomodoro:skip'),
  reset: () => ipcRenderer.invoke('pomodoro:reset'),
  startPhase: (phase: string) => ipcRenderer.invoke('pomodoro:startPhase', phase),
  setTask: (task: string) => ipcRenderer.invoke('pomodoro:setTask', task),
  finishEarly: () => ipcRenderer.invoke('pomodoro:finishEarly'),
  reconnectHook: () => ipcRenderer.invoke('hook:reconnect'),
  onTick: (cb: (state: unknown) => void) => {
    const listener = (_: unknown, state: unknown) => cb(state);
    ipcRenderer.on('pomodoro:tick', listener);
    return () => ipcRenderer.removeListener('pomodoro:tick', listener);
  },
  onKeys: (cb: (counts: unknown) => void) => {
    const listener = (_: unknown, counts: unknown) => cb(counts);
    ipcRenderer.on('keys:update', listener);
    return () => ipcRenderer.removeListener('keys:update', listener);
  },
  onPhaseEnd: (cb: (payload: unknown) => void) => {
    const listener = (_: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on('pomodoro:phaseEnd', listener);
    return () => ipcRenderer.removeListener('pomodoro:phaseEnd', listener);
  },
  onHookStatus: (cb: (payload: unknown) => void) => {
    const listener = (_: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on('hook:status', listener);
    return () => ipcRenderer.removeListener('hook:status', listener);
  },
  onRemind: (cb: (payload: unknown) => void) => {
    const listener = (_: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on('remind:popup', listener);
    return () => ipcRenderer.removeListener('remind:popup', listener);
  },
};

contextBridge.exposeInMainWorld('tomato', api);
export type TomatoApi = typeof api;
