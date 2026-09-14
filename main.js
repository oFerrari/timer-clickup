// ClickUp Timer — processo principal.
// Janela pequena sempre no topo + ícone de bandeja com Mostrar/Ocultar e Sair.
// Toda conversa com a API do ClickUp acontece aqui; a interface só pede por IPC.

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const API = 'https://api.clickup.com/api/v2';
const APP_NAME = 'ClickUp Timer';

// Ícones embutidos (verde = rodando, cinza = parado). Evita arquivos soltos.
const ICON_RUNNING =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA/ElEQVR4nOWXsRHCMAxFA0dPQcEA6VJTZQwWyGxZgDFSUafLABQUTACVOJ8iKRKWgjl+lbtY+i+S7dhV9e/afBK0PzZP7t3jNppyqgdLpjkwKgBsfric2LH389UEIb5MjSVTDQwHso0yx3FcC0kAD3MtxE4bTGlq+/dzPXRiHjw3QLMKAGXul1MQaX4SIMpcgmAn4VoqByC6/CDchnIq8PMA6Z6wGgDefKa2N4NkV6AeuiwQtxZQICYA+F1ye7YXCOQHv7BVoK1GWcvQqw2ccPlnAJEQlDkJQAV5mVMiAVLKXIilgylbAQ8Izam47HuBBKGR283IAmO9G35dLyB+iRkWWBCLAAAAAElFTkSuQmCC';
const ICON_IDLE =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA/ElEQVR4nGNgGOmAkRxN/OJa/3HJfXx5jSQziVaMz1JKHEOUA9Atb+3pw6m2uqSIJEfglUS2GJ+lxDgGl0OYaGU5uj5cUYjVAdSwnFhHYA0WmEJClmfHuMPZU5fsxKsWFh3oUYERAsRaTiqAmYceCigOoJXl+ByBMxHSCwweB9A6+GEAPRoGTwgMeQcglwl0cwB64ZMd406yQygOgalLdlLkEKpFATaHkOQAWBmNXp9T2yHodQLNcgGxoTG4siG1ogEXwFYlY4QArRxBdHsAmyZqWY4NYHUAsispdQShhinOEKCGI4hpFQ/ufgE+RxADqNYzIsUxpPYNBxwAALFujMu1JmyDAAAAAElFTkSuQmCC';

const icon = (running) =>
  nativeImage.createFromBuffer(Buffer.from(running ? ICON_RUNNING : ICON_IDLE, 'base64'));

let win = null;
let tray = null;
let running = null; // entrada de tempo em execução, ou null
let teamId = process.env.CLICKUP_TEAM_ID || null;
let userId = null;
let quitting = false;

// --------------------------------------------------------------------------- //
// Configuração
// --------------------------------------------------------------------------- //
const configFile = () => path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configFile(), 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

function getToken() {
  return process.env.CLICKUP_TOKEN || loadConfig().token || null;
}

// --------------------------------------------------------------------------- //
// API do ClickUp
// --------------------------------------------------------------------------- //
async function api(method, endpoint, body) {
  const token = getToken();
  if (!token) throw new Error('Token não configurado.');

  const res = await fetch(API + endpoint, {
    method,
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) throw new Error('Token inválido ou expirado.');
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 200);
    try {
      detail = JSON.parse(text).err || detail;
    } catch {}
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
  return text ? JSON.parse(text) : {};
}

async function bootstrap() {
  const { user } = await api('GET', '/user');
  userId = user.id;
  if (!teamId) {
    const { teams } = await api('GET', '/team');
    if (!teams?.length) throw new Error('Nenhum workspace encontrado para este token.');
    teamId = teams[0].id;
  }
  saveConfig({ ...loadConfig(), team_id: teamId });
  return user.username || user.email || 'usuário';
}

async function currentEntry() {
  const { data } = await api('GET', `/team/${teamId}/time_entries/current`);
  return data?.id ? data : null;
}

async function stopTimer() {
  return api('POST', `/team/${teamId}/time_entries/stop`);
}

// Para o timer atual e inicia o novo. Erro no stop é esperado quando nada roda.
async function switchTo(taskId) {
  try {
    await stopTimer();
  } catch {}
  return api('POST', `/team/${teamId}/time_entries/start`, { tid: taskId });
}

async function myTasks() {
  const params = new URLSearchParams({
    'assignees[]': String(userId),
    include_closed: 'false',
    subtasks: 'true',
    order_by: 'updated',
    page: '0',
  });
  const { tasks = [] } = await api('GET', `/team/${teamId}/task?${params}`);
  return tasks.map((t) => ({
    id: t.id,
    name: t.name || '(sem nome)',
    status: t.status?.status || '',
    list: t.list?.name || '',
  }));
}

// --------------------------------------------------------------------------- //
// Janela e bandeja
// --------------------------------------------------------------------------- //
function createWindow() {
  win = new BrowserWindow({
    width: 340,
    height: 460,
    minWidth: 300,
    minHeight: 360,
    alwaysOnTop: true,
    skipTaskbar: false,
    backgroundColor: '#0f172a',
    title: APP_NAME,
    icon: icon(false),
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  win.setMenuBarVisibility(false);
  win.loadFile('index.html');

  // Fechar no X esconde na bandeja; só o menu Sair encerra.
  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
      updateTray();
    }
  });
}

function trayTitle() {
  if (!running) return 'Nenhum timer rodando';
  return (running.task?.name || 'Timer').slice(0, 55);
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) {
    win.hide();
  } else {
    win.show();
    win.focus();
    win.webContents.send('refresh');
  }
  updateTray();
}

function updateTray() {
  if (!tray) return;
  tray.setImage(icon(!!running));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: trayTitle(), enabled: false },
      { type: 'separator' },
      { label: win?.isVisible() ? 'Ocultar' : 'Mostrar', click: toggleWindow },
      {
        label: 'Parar timer',
        enabled: !!running,
        click: async () => {
          try {
            await stopTimer();
            running = null;
            updateTray();
            win?.webContents.send('refresh');
          } catch {}
        },
      },
      { type: 'separator' },
      {
        label: 'Sair',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ])
  );
}

function createTray() {
  tray = new Tray(icon(false));
  tray.setToolTip(APP_NAME);
  tray.on('click', toggleWindow);
  updateTray();
}

// --------------------------------------------------------------------------- //
// Ponte com a interface
// --------------------------------------------------------------------------- //
ipcMain.handle('bootstrap', async () => {
  if (!getToken()) return { needsToken: true };
  const username = await bootstrap();
  return { needsToken: false, username };
});

ipcMain.handle('save-token', async (_e, token) => {
  saveConfig({ ...loadConfig(), token: token.trim() });
  return bootstrap();
});

ipcMain.handle('current', async () => {
  running = await currentEntry();
  updateTray();
  return running;
});

ipcMain.handle('tasks', () => myTasks());
ipcMain.handle('start', (_e, taskId) => switchTo(taskId));
ipcMain.handle('stop', () => stopTimer());

ipcMain.on('tooltip', (_e, text) => tray?.setToolTip(text));

// --------------------------------------------------------------------------- //
app.whenReady().then(() => {
  teamId = teamId || loadConfig().team_id || null;
  createWindow();
  createTray();
});

// Sem isso o app morreria ao esconder a janela.
app.on('window-all-closed', (e) => e.preventDefault());
