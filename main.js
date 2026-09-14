// ClickUp Timer - processo principal (Electron).
// Janela principal sem moldura + bolinha flutuante translucida + icone de bandeja.
// Toda conversa com a API do ClickUp acontece AQUI; as interfaces so pedem via IPC.
//
// Diagnostico: npm run debug   (imprime cada requisicao no terminal)

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const API = 'https://api.clickup.com/api/v2';
const APP_NAME = 'ClickUp Timer';
const DEBUG = process.argv.includes('--debug');
const START_HIDDEN = process.argv.includes('--hidden');   // usado pelo atalho de inicializacao
const ICON_FILE = path.join(__dirname, 'icon.ico');

const log = (...args) => { if (DEBUG) console.log('[clickup-timer]', ...args); };
const logErr = (...args) => console.error('[clickup-timer]', ...args);

// Icones embutidos (verde = rodando, roxo = parado). Evita arquivos soltos.
const ICON_RUNNING =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA/ElEQVR4nOWXsRHCMAxFA0dPQcEA6VJTZQwWyGxZgDFSUafLABQUTACVOJ8iKRKWgjl+lbtY+i+S7dhV9e/afBK0PzZP7t3jNppyqgdLpjkwKgBsfric2LH389UEIb5MjSVTDQwHso0yx3FcC0kAD3MtxE4bTGlq+/dzPXRiHjw3QLMKAGXul1MQaX4SIMpcgmAn4VoqByC6/CDchnIq8PMA6Z6wGgDefKa2N4NkV6AeuiwQtxZQICYA+F1ye7YXCOQHv7BVoK1GWcvQqw2ccPlnAJEQlDkJQAV5mVMiAVLKXIilgylbAQ8Izam47HuBBKGR283IAmO9G35dLyB+iRkWWBCLAAAAAElFTkSuQmCC';
const ICON_IDLE =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA/ElEQVR4nGNgGOmAkRxN/OJa/3HJfXx5jSQziVaMz1JKHEOUA9Atb+3pw6m2uqSIJEfglUS2GJ+lxDgGl0OYaGU5uj5cUYjVAdSwnFhHYA0WmEJClmfHuMPZU5fsxKsWFh3oUYERAsRaTiqAmYceCigOoJXl+ByBMxHSCwweB9A6+GEAPRoGTwgMeQcglwl0cwB64ZMd406yQygOgalLdlLkEKpFATaHkOQAWBmNXp9T2yHodQLNcgGxoTG4siG1ogEXwFYlY4QArRxBdHsAmyZqWY4NYHUAsispdQShhinOEKCGI4hpFQ/ufgE+RxADqNYzIsUxpPYNBxwAALFujMu1JmyDAAAAAElFTkSuQmCC';

const TRAY_FILES = {
  idle: path.join(__dirname, 'tray-idle.ico'),
  running: path.join(__dirname, 'tray-running.ico'),
};

// Icone da bandeja: usa os .ico da marca (16/20/24/32/48 px) e cai para os
// embutidos em base64 se os arquivos nao estiverem la.
const icon = (running) => {
  const file = running ? TRAY_FILES.running : TRAY_FILES.idle;
  try {
    if (fs.existsSync(file)) {
      const img = nativeImage.createFromPath(file);
      if (!img.isEmpty()) return img;
    }
  } catch (err) {
    logErr('icone da bandeja:', err.message);
  }
  return nativeImage.createFromBuffer(Buffer.from(running ? ICON_RUNNING : ICON_IDLE, 'base64'));
};

const appIcon = () => (fs.existsSync(ICON_FILE) ? ICON_FILE : icon(false));

// Logo do app. Usa o logo.png embutido, mas aceita um personalizado
// colocado em %APPDATA%/ClickUp Timer/logo.png (tem prioridade).
function logoUrl() {
  for (const file of [path.join(app.getPath('userData'), 'logo.png'), path.join(__dirname, 'logo.png')]) {
    try {
      if (fs.existsSync(file)) return `${pathToFileURL(file).href}?v=${fs.statSync(file).mtimeMs}`;
    } catch {}
  }
  return null;
}

// --------------------------------------------------------------------------- //
// Iniciar com o Windows
// --------------------------------------------------------------------------- //
function autostartEnabled() {
  if (!app.isPackaged) return !!loadConfig().autostart;
  try {
    return app.getLoginItemSettings({ path: process.execPath, args: ['--hidden'] }).openAtLogin;
  } catch {
    return !!loadConfig().autostart;
  }
}

function setAutostart(on) {
  saveConfig({ autostart: !!on });
  if (!app.isPackaged) return !!on;   // em dev isso apontaria para o electron.exe
  try {
    app.setLoginItemSettings({
      openAtLogin: !!on,
      path: process.execPath,
      args: ['--hidden'],             // sobe direto na bandeja, sem abrir o painel
    });
  } catch (err) {
    logErr('setLoginItemSettings:', err.message);
  }
  return !!on;
}

let win = null;
let bubble = null;
let tray = null;
let running = null;       // entrada de tempo em execucao, ou null
let teamId = process.env.CLICKUP_TEAM_ID || null;
let me = null;
let teams = [];
let quitting = false;
let switching = false;   // segura o broadcast durante a troca de tarefa

// --------------------------------------------------------------------------- //
// Configuracao (%APPDATA%/ClickUp Timer/config.json)
// --------------------------------------------------------------------------- //
const configFile = () => path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configFile(), 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(patch) {
  const cfg = { ...loadConfig(), ...patch };
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2), { mode: 0o600 });
  return cfg;
}

function getToken() {
  return process.env.CLICKUP_TOKEN || loadConfig().token || null;
}

const bubbleOpacity = () => {
  const v = loadConfig().bubble_opacity;
  return typeof v === 'number' ? Math.min(1, Math.max(0.15, v)) : 0.72;
};

function teamName() {
  return teams.find((t) => t.id === teamId)?.name || 'Workspace';
}

// --------------------------------------------------------------------------- //
// API do ClickUp
// --------------------------------------------------------------------------- //
async function api(method, endpoint, body) {
  const token = getToken();
  if (!token) throw new Error('Token nao configurado. Abra as configuracoes e cole seu Personal API Token.');

  let res;
  try {
    res = await fetch(API + endpoint, {
      method,
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    logErr('falha de rede em', method, endpoint, err);
    throw new Error('Falha de rede ao falar com o ClickUp (verifique internet/proxy da rede).');
  }

  log(method, endpoint, '->', res.status);
  const text = await res.text();

  if (!res.ok) {
    let detail = text.slice(0, 200);
    try { detail = JSON.parse(text).err || detail; } catch {}
    logErr(method, endpoint, res.status, detail);

    if (res.status === 401) throw new Error('401 - Token invalido ou expirado. Gere outro em Settings > Apps > API Token.');
    if (res.status === 403) throw new Error('403 - Seu token nao tem permissao nesse workspace.');
    if (res.status === 429) throw new Error('429 - Limite de requisicoes do ClickUp atingido. Aguarde um minuto.');
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }

  return text ? JSON.parse(text) : {};
}

async function fetchTasks(team, page = 0, scope = 'mine') {
  const params = new URLSearchParams({
    include_closed: 'false',
    subtasks: 'true',
    order_by: 'updated',
    page: String(page),
  });
  if (scope === 'mine' && me?.id != null) params.append('assignees[]', String(me.id));

  const { tasks = [] } = await api('GET', `/team/${team}/task?${params}`);
  return tasks;
}

async function bootstrap() {
  const { user } = await api('GET', '/user');
  me = {
    id: user.id,
    username: user.username || user.email || 'usuario',
    email: user.email || '',
    color: user.color || '#7B68EE',
  };
  log('usuario:', me.id, me.username);

  const res = await api('GET', '/team');
  teams = (res.teams || []).map((t) => ({ id: t.id, name: t.name, color: t.color || '#7B68EE' }));
  if (!teams.length) throw new Error('Nenhum workspace encontrado para este token.');
  log('workspaces:', teams.map((t) => `${t.name} (${t.id})`).join(', '));

  if (teamId && !teams.some((t) => t.id === teamId)) {
    log('team_id configurado nao pertence a este token, ignorando:', teamId);
    teamId = null;
  }

  if (!teamId) {
    teamId = teams[0].id;
    for (const team of teams) {
      try {
        const found = await fetchTasks(team.id, 0, 'mine');
        log('workspace', team.name, team.id, '->', found.length, 'tarefas');
        if (found.length) { teamId = team.id; break; }
      } catch (err) {
        log('falha ao testar workspace', team.id, String(err.message || err));
      }
    }
  }

  log('workspace escolhido:', teamName(), teamId);
  saveConfig({ team_id: teamId });

  const cfg = loadConfig();
  if (cfg.bubble) showBubble(true);

  return {
    needsToken: false,
    user: me,
    workspaces: teams,
    teamId,
    workspace: teamName(),
    theme: cfg.theme || 'light',
    scope: cfg.scope || 'mine',
    bubble: !!cfg.bubble,
    bubbleOpacity: bubbleOpacity(),
    autostart: autostartEnabled(),
  };
}

// Normaliza uma entrada de tempo (mesmo formato vindo de /current e de /start).
function shapeEntry(data) {
  if (!data?.id) return null;
  return {
    id: data.id,
    start: Number(data.start) || Date.now(),
    taskId: data.task?.id || null,
    taskName: data.task?.name || data.description || 'Timer sem tarefa',
    status: data.task?.status?.status || '',
    color: data.task?.status?.color || '#7B68EE',
    url: data.task?.url || (data.task?.id ? `https://app.clickup.com/t/${data.task.id}` : ''),
  };
}

async function currentEntry() {
  const { data } = await api('GET', `/team/${teamId}/time_entries/current`);
  return shapeEntry(data);
}

async function stopTimer() {
  const out = await api('POST', `/team/${teamId}/time_entries/stop`);
  setRunning(null);
  return out;
}

// Inicia o timer da tarefa. Caminho rapido: uma unica requisicao quando nada roda.
async function switchTo(taskId) {
  switching = true;
  try {
    if (running) {
      try { await stopTimer(); } catch (err) { log('stop antes do start:', String(err.message || err)); }
    }

    let res;
    try {
      res = await api('POST', `/team/${teamId}/time_entries/start`, { tid: taskId });
    } catch (err) {
      // Havia um timer que o app nao conhecia: para e tenta de novo.
      log('start falhou, tentando parar antes:', String(err.message || err));
      try { await stopTimer(); } catch {}
      res = await api('POST', `/team/${teamId}/time_entries/start`, { tid: taskId });
    }

    running = shapeEntry(res.data);
  } finally {
    switching = false;
  }

  setRunning(running);
  return running;
}

function shapeTask(t) {
  return {
    id: t.id,
    name: t.name || '(sem nome)',
    status: t.status?.status || '',
    color: t.status?.color || '#7B68EE',
    list: t.list?.name || '',
    space: t.space?.name || '',
    url: t.url || `https://app.clickup.com/t/${t.id}`,
    priority: t.priority?.priority || '',
    due: t.due_date ? Number(t.due_date) : null,
  };
}

async function myTasks(scope = 'mine') {
  let raw = [];
  const maxPages = scope === 'mine' ? 5 : 2;
  for (let page = 0; page < maxPages; page++) {
    const batch = await fetchTasks(teamId, page, scope);
    raw = raw.concat(batch);
    if (batch.length < 100) break;
  }

  if (!raw.length && teams.length > 1) {
    for (const team of teams) {
      if (team.id === teamId) continue;
      const batch = await fetchTasks(team.id, 0, scope);
      if (batch.length) {
        log('trocando para o workspace', team.name, team.id);
        teamId = team.id;
        saveConfig({ team_id: teamId });
        raw = batch;
        break;
      }
    }
  }

  log('tarefas carregadas:', raw.length);
  return { workspace: teamName(), teamId, tasks: raw.map(shapeTask) };
}

async function diagnose() {
  const lines = [];
  const token = getToken();
  lines.push(token ? `Token: configurado (${token.slice(0, 6)}...${token.slice(-4)})` : 'Token: AUSENTE');
  if (!token) return lines.join('\n');

  try {
    const { user } = await api('GET', '/user');
    lines.push(`Usuario: ${user.username || user.email} (id ${user.id})`);
  } catch (err) {
    lines.push(`GET /user falhou -> ${err.message}`);
    return lines.join('\n');
  }

  try {
    const res = await api('GET', '/team');
    const list = res.teams || [];
    lines.push(`Workspaces: ${list.length}`);
    for (const t of list) lines.push(`  - ${t.name} (id ${t.id})${t.id === teamId ? '  <= ativo' : ''}`);
  } catch (err) {
    lines.push(`GET /team falhou -> ${err.message}`);
    return lines.join('\n');
  }

  try {
    const mine = await fetchTasks(teamId, 0, 'mine');
    const all = await fetchTasks(teamId, 0, 'all');
    lines.push(`Tarefas atribuidas a voce no workspace ativo: ${mine.length}`);
    lines.push(`Tarefas visiveis no workspace ativo (todas): ${all.length}`);
    if (!mine.length && all.length) lines.push('Dica: nenhuma tarefa esta atribuida a voce. Use o filtro "Todas".');
  } catch (err) {
    lines.push(`Busca de tarefas falhou -> ${err.message}`);
  }

  try {
    const cur = await currentEntry();
    lines.push(cur ? `Timer rodando: ${cur.taskName}` : 'Timer rodando: nenhum');
  } catch (err) {
    lines.push(`time_entries/current falhou -> ${err.message}`);
  }

  return lines.join('\n');
}

// --------------------------------------------------------------------------- //
// Estado compartilhado entre janelas
// --------------------------------------------------------------------------- //
function setRunning(entry) {
  running = entry;
  updateTray();
  broadcast();
}

function broadcast() {
  if (switching) return;   // evita o "piscar" para Parado durante a troca
  const payload = { running, opacity: bubbleOpacity(), logo: logoUrl() };
  if (win && !win.isDestroyed()) win.webContents.send('state', payload);
  if (bubble && !bubble.isDestroyed()) bubble.webContents.send('state', payload);
}

// --------------------------------------------------------------------------- //
// Janela principal
// --------------------------------------------------------------------------- //
function createWindow() {
  const cfg = loadConfig();
  win = new BrowserWindow({
    width: 400,
    height: 640,
    minWidth: 360,
    minHeight: 460,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: cfg.theme === 'dark' ? '#1F2123' : '#FFFFFF',
    title: APP_NAME,
    icon: appIcon(),
    show: !START_HIDDEN,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'index.html'));
  if (DEBUG) win.webContents.openDevTools({ mode: 'detach' });

  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
      updateTray();
    }
  });
}

// --------------------------------------------------------------------------- //
// Bolinha flutuante
// --------------------------------------------------------------------------- //
const BUBBLE_W = 224;
const BUBBLE_H = 60;

function defaultBubblePosition() {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: area.x + area.width - BUBBLE_W - 24,
    y: area.y + area.height - BUBBLE_H - 24,
  };
}

function createBubble() {
  const cfg = loadConfig();
  const pos =
    Number.isInteger(cfg.bubble_x) && Number.isInteger(cfg.bubble_y)
      ? { x: cfg.bubble_x, y: cfg.bubble_y }
      : defaultBubblePosition();

  bubble = new BrowserWindow({
    width: BUBBLE_W,
    height: BUBBLE_H,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  bubble.setAlwaysOnTop(true, 'screen-saver');
  bubble.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  bubble.loadFile(path.join(__dirname, 'bubble.html'));
  bubble.webContents.on('did-finish-load', broadcast);

  const remember = () => {
    if (!bubble || bubble.isDestroyed()) return;
    const [x, y] = bubble.getPosition();
    saveConfig({ bubble_x: x, bubble_y: y });
  };
  bubble.on('moved', remember);
  bubble.on('closed', () => { bubble = null; });
}

function showBubble(on) {
  saveConfig({ bubble: !!on });
  if (on) {
    if (!bubble || bubble.isDestroyed()) createBubble();
    else bubble.show();
  } else if (bubble && !bubble.isDestroyed()) {
    bubble.close();
    bubble = null;
  }
  updateTray();
  return !!on;
}

// --------------------------------------------------------------------------- //
// Bandeja
// --------------------------------------------------------------------------- //
function trayTitle() {
  if (!running) return 'Nenhum timer rodando';
  return (running.taskName || 'Timer').slice(0, 55);
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible() && win.isFocused()) {
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
      { label: win?.isVisible() ? 'Ocultar painel' : 'Mostrar painel', click: toggleWindow },
      {
        label: 'Bolinha flutuante',
        type: 'checkbox',
        checked: !!(bubble && !bubble.isDestroyed()),
        click: (item) => {
          showBubble(item.checked);
          win?.webContents.send('refresh');
        },
      },
      {
        label: 'Parar timer',
        enabled: !!running,
        click: async () => {
          try { await stopTimer(); } catch (err) { logErr('parar timer pela bandeja:', err.message); }
          win?.webContents.send('refresh');
        },
      },
      { type: 'separator' },
      { label: 'Sair', click: () => { quitting = true; app.quit(); } },
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
// Ponte com as interfaces
// --------------------------------------------------------------------------- //
ipcMain.handle('app:bootstrap', async () => {
  const cfg = loadConfig();
  if (!getToken()) return { needsToken: true, theme: cfg.theme || 'light' };
  return bootstrap();
});

ipcMain.handle('app:save-token', async (_e, token) => {
  saveConfig({ token: String(token || '').trim() });
  teamId = process.env.CLICKUP_TEAM_ID || null;
  return bootstrap();
});

ipcMain.handle('app:set-team', async (_e, id) => {
  teamId = id;
  saveConfig({ team_id: id });
  return { teamId, workspace: teamName() };
});

ipcMain.handle('app:set-theme', (_e, theme) => {
  saveConfig({ theme });
  win?.setBackgroundColor(theme === 'dark' ? '#1F2123' : '#FFFFFF');
  return true;
});

ipcMain.handle('app:set-scope', (_e, scope) => { saveConfig({ scope }); return true; });
ipcMain.handle('app:set-bubble', (_e, on) => showBubble(on));

// Transparencia: aplica na hora na bolinha, grava em disco so quando o arrasto para.
let opacitySaveTimer = null;
ipcMain.handle('app:set-bubble-opacity', (_e, value) => {
  const v = Math.min(1, Math.max(0.15, Number(value) || 0.72));
  if (bubble && !bubble.isDestroyed()) bubble.webContents.send('state', { opacity: v });
  clearTimeout(opacitySaveTimer);
  opacitySaveTimer = setTimeout(() => saveConfig({ bubble_opacity: v }), 400);
  return v;
});
ipcMain.handle('app:set-autostart', (_e, on) => setAutostart(on));
ipcMain.handle('app:diagnose', () => diagnose());

ipcMain.handle('tasks:list', (_e, scope) => myTasks(scope || 'mine'));

ipcMain.handle('timer:current', async () => {
  setRunning(await currentEntry());
  return running;
});

ipcMain.handle('timer:start', (_e, taskId) => switchTo(taskId));
ipcMain.handle('timer:stop', () => stopTimer());

ipcMain.handle('shell:open', (_e, url) => shell.openExternal(url));
ipcMain.handle('win:minimize', () => win?.minimize());
ipcMain.handle('win:hide', () => { win?.hide(); updateTray(); });
ipcMain.handle('win:toggle-main', () => toggleWindow());
ipcMain.on('tray:tooltip', (_e, text) => tray?.setToolTip(text));

// --------------------------------------------------------------------------- //
// Instancia unica: abrir o app de novo traz a janela que ja existe, em vez de
// subir outro processo (que criaria um segundo icone na bandeja).
// --------------------------------------------------------------------------- //
if (!app.requestSingleInstanceLock()) {
  log('ja existe uma instancia rodando, encerrando esta.');
  app.quit();
} else {
  // Disparado na instancia ORIGINAL quando alguem abre o app de novo.
  app.on('second-instance', (_event, argv) => {
    log('segunda instancia bloqueada, trazendo a janela para a frente.');
    if (!win || win.isDestroyed()) return;
    if (argv.includes('--hidden')) return;   // atalho de inicializacao: fica na bandeja
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send('refresh');
    updateTray();
  });

  app.whenReady().then(() => {
    teamId = teamId || loadConfig().team_id || null;

    // Primeira execucao do app instalado: ja deixa ligado com o Windows.
    if (loadConfig().autostart === undefined) setAutostart(true);

    createWindow();
    createTray();
  });
}

// Sem isso o app morreria ao esconder a janela.
app.on('window-all-closed', (e) => e.preventDefault());

// Tira o icone da bandeja na saida; sem isso o Windows deixa um icone fantasma
// que so some quando o mouse passa por cima.
app.on('before-quit', () => {
  quitting = true;
  try { tray?.destroy(); } catch {}
  try { if (bubble && !bubble.isDestroyed()) bubble.destroy(); } catch {}
  tray = null;
  bubble = null;
});
