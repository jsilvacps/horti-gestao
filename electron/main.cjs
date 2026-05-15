/**
 * electron/main.cjs
 * Processo principal do Electron — Horti Gestão PDV
 *
 * Em produção (app empacotado):
 *   1. Inicia o servidor Next.js standalone em background (porta 3210)
 *   2. Espera o servidor subir (polling HTTP)
 *   3. Abre janela maximizada apontando para localhost:3210/pdv
 *
 * Em desenvolvimento (npm run electron:dev):
 *   - Aponta direto para localhost:3000 (servidor next dev já rodando)
 */

"use strict";

const { app, BrowserWindow, Menu, shell, dialog } = require("electron");
const path   = require("path");
const http   = require("http");
const https  = require("https");
const { spawn } = require("child_process");

// URL pública onde fica o version.json (no Vercel)
const VERSION_URL = "https://horti-gestao.vercel.app/version.json";

const PORT     = 3210;
const DEV_URL  = "http://localhost:3000/login";   // dev: login detecta se precisa de setup
const PROD_URL = `http://localhost:${PORT}/login`; // prod: login detecta se precisa de setup

let mainWindow  = null;
let admWindow   = null;
let serverProc  = null;

// ── Encontra server.js dentro de standalone (o Next no Windows cria subpastas) ──
function findServerJs(standaloneDir) {
  const fs = require("fs");
  const direct = path.join(standaloneDir, "server.js");
  if (fs.existsSync(direct)) return direct;
  function buscar(dir, depth) {
    if (depth > 6) return null;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    for (const e of entries) {
      if (!e.isDirectory() && e.name === "server.js") return path.join(dir, e.name);
    }
    for (const e of entries) {
      if (e.isDirectory() && e.name !== "node_modules") {
        const found = buscar(path.join(dir, e.name), depth + 1);
        if (found) return found;
      }
    }
    return null;
  }
  return buscar(standaloneDir, 0);
}

// ── Log em arquivo (para debug de problemas no .exe) ────────────────────────
const fs = require("fs");
const logPath = path.join(app.getPath("userData"), "horti-server.log");
function log(msg) {
  const linha = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(logPath, linha); } catch {}
  console.log(msg);
}

// ── Mata qualquer processo ocupando a porta (Windows) ───────────────────────
function killPortProcesses(port) {
  return new Promise((resolve) => {
    const { exec } = require("child_process");
    exec(`netstat -ano | findstr :${port}`, (err, stdout) => {
      if (err || !stdout.trim()) { resolve(); return; }
      const pids = new Set();
      for (const line of stdout.trim().split("\n")) {
        if (!line.includes(`:${port} `)) continue;
        const parts = line.trim().split(/\s+/);
        const pid   = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid) && pid !== "0") pids.add(pid);
      }
      if (pids.size === 0) { resolve(); return; }
      log(`Matando ${pids.size} processo(s) na porta ${port}: ${[...pids].join(", ")}`);
      let done = 0;
      for (const pid of pids) {
        exec(`taskkill /F /PID ${pid}`, () => {
          done++;
          if (done === pids.size) setTimeout(resolve, 800); // aguarda SO liberar a porta
        });
      }
    });
  });
}

// ── Inicia o servidor Next.js standalone (com retry para EBUSY no Windows) ──
function startServer() {
  const standaloneDir = path.join(process.resourcesPath, "standalone");
  const serverPath    = findServerJs(standaloneDir);

  log(`standaloneDir: ${standaloneDir}`);
  log(`serverPath: ${serverPath}`);

  if (!serverPath) {
    dialog.showErrorBox("Erro", `server.js não encontrado em:\n${standaloneDir}`);
    app.quit();
    return;
  }

  const serverDir = path.dirname(serverPath);
  log(`serverDir: ${serverDir}`);
  log(`process.execPath: ${process.execPath}`);

  const serverEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    ELECTRON_NO_ASAR: "1",
    PORT: String(PORT),
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "production",
  };

  function tentarSpawn(tentativa) {
    log(`Iniciando servidor (tentativa ${tentativa})...`);

    let proc;
    try {
      if (process.platform === "win32") {
        // No Windows, usar cmd.exe como intermediário evita EBUSY
        // (o exe não consegue se auto-spawnar diretamente enquanto está rodando)
        proc = spawn("cmd.exe", ["/c", process.execPath, serverPath], {
          env: serverEnv,
          cwd: serverDir,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } else {
        proc = spawn(process.execPath, [serverPath], {
          env: serverEnv,
          cwd: serverDir,
          stdio: ["ignore", "pipe", "pipe"],
        });
      }
    } catch (err) {
      log(`[server SPAWN-THROW] ${err.message} (code=${err.code})`);
      if (err.code === "EBUSY" && tentativa < 5) {
        const delay = tentativa * 2000;
        log(`Retentando em ${delay}ms...`);
        setTimeout(() => tentarSpawn(tentativa + 1), delay);
      } else {
        dialog.showErrorBox("Erro ao iniciar servidor", `Erro: ${err.message}\n\nFeche o app, aguarde alguns segundos e abra novamente.`);
      }
      return;
    }

    proc.stdout?.on("data", (d) => log(`[server] ${d.toString().trim()}`));
    proc.stderr?.on("data", (d) => log(`[server ERR] ${d.toString().trim()}`));
    proc.on("exit", (code) => log(`[server EXIT] code=${code}`));
    proc.on("error", (err) => {
      log(`[server CRASH] ${err.message} (code=${err.code})`);
      if (err.code === "EBUSY" && tentativa < 5) {
        const delay = tentativa * 2000;
        log(`EBUSY — retentando em ${delay}ms...`);
        setTimeout(() => tentarSpawn(tentativa + 1), delay);
      } else {
        dialog.showErrorBox("Erro ao iniciar servidor", `Erro: ${err.message}\n\nFeche o app, aguarde alguns segundos e abra novamente.`);
      }
    });

    serverProc = proc;
  }

  // Garante que a porta esteja livre antes de tentar subir o servidor
  killPortProcesses(PORT).then(() => tentarSpawn(1));
}

// ── Janela de progresso do download ─────────────────────────────────────────
let progressWin = null;

function abrirJanelaProgresso(versao) {
  progressWin = new BrowserWindow({
    width: 480, height: 220,
    resizable: false, minimizable: false, maximizable: false,
    alwaysOnTop: true, frame: true,
    title: "Atualizando Horti Gestão PDV",
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  progressWin.setMenuBarVisibility(false);
  progressWin.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(`
    <!DOCTYPE html><html><head><meta charset="utf-8">
    <style>
      body { font-family: 'Segoe UI', sans-serif; background: #f0fdf4;
             display: flex; flex-direction: column; align-items: center;
             justify-content: center; height: 100vh; margin: 0; }
      h2   { color: #14532d; font-size: 16px; margin: 0 0 6px; }
      p    { color: #16a34a; font-size: 13px; margin: 0 0 18px; }
      .bar-bg { width: 380px; height: 18px; background: #d1fae5; border-radius: 9px; overflow: hidden; }
      .bar    { height: 100%; width: 0%; background: #15803d; border-radius: 9px;
                transition: width .3s; }
      .pct { margin-top: 8px; color: #166534; font-weight: 700; font-size: 14px; }
      .sub { margin-top: 4px; color: #4b7a5e; font-size: 12px; }
    </style></head><body>
    <h2>⬇️ Baixando versão ${versao}...</h2>
    <p>Aguarde. O instalador será iniciado automaticamente.</p>
    <div class="bar-bg"><div class="bar" id="bar"></div></div>
    <div class="pct" id="pct">0%</div>
    <div class="sub" id="sub">Calculando...</div>
    <script>
      window.__setProgress = function(pct, sub) {
        document.getElementById('bar').style.width = pct + '%';
        document.getElementById('pct').textContent = pct + '%';
        if (sub) document.getElementById('sub').textContent = sub;
      };
    </script></body></html>
  `));
  return progressWin;
}

// ── Download com progresso e instalação automática ───────────────────────────
function baixarEInstalar(urlDownload, versao) {
  const os  = require("os");
  const destino = path.join(os.tmpdir(), `HortiGestao-Setup-${versao}.exe`);

  abrirJanelaProgresso(versao);

  function fazer(url, redirs = 0) {
    if (redirs > 10) {
      if (progressWin) progressWin.close();
      dialog.showErrorBox("Erro", "Muitos redirecionamentos ao baixar a atualização.");
      return;
    }

    const mod = url.startsWith("https") ? https : http;
    mod.get(url, (res) => {
      // Segue redirecionamentos
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fazer(res.headers.location, redirs + 1);
      }
      if (res.statusCode !== 200) {
        if (progressWin) progressWin.close();
        dialog.showErrorBox("Erro", `Falha ao baixar atualização (HTTP ${res.statusCode}).`);
        return;
      }

      const total = parseInt(res.headers["content-length"] || "0", 10);
      let baixado = 0;
      const arquivo = fs.createWriteStream(destino);

      res.on("data", (chunk) => {
        baixado += chunk.length;
        arquivo.write(chunk);
        const pct = total > 0 ? Math.round((baixado / total) * 100) : 0;
        const mb  = (baixado / 1048576).toFixed(1);
        const tot = total > 0 ? `/ ${(total / 1048576).toFixed(1)} MB` : "";
        // Atualiza barra de progresso
        if (progressWin && !progressWin.isDestroyed()) {
          progressWin.webContents.executeJavaScript(
            `window.__setProgress(${pct}, "${mb} MB ${tot}")` ).catch(() => {});
          mainWindow?.setProgressBar(total > 0 ? baixado / total : -1);
        }
      });

      res.on("end", () => {
        arquivo.end(() => {
          mainWindow?.setProgressBar(-1);
          if (progressWin && !progressWin.isDestroyed()) progressWin.close();

          log(`Download concluído: ${destino}`);

          // 1) Mata TODOS os processos na porta (incluindo instâncias anteriores
          //    que ficaram rodando), libera locks de arquivo do standalone/
          if (serverProc) {
            try { serverProc.kill(); } catch {}
            serverProc = null;
          }
          // killPortProcesses já aguarda 800ms internamente para o OS liberar a porta
          killPortProcesses(PORT).then(() => {
            const proc = spawn(destino, [], {
              detached: true,
              stdio: "ignore",
            });
            proc.unref();
            proc.on("error", (err) => {
              log(`[installer ERROR] ${err.message}`);
              dialog.showErrorBox("Erro ao instalar", `Não foi possível iniciar o instalador:\n${err.message}\n\nO arquivo foi salvo em:\n${destino}`);
            });
            // Sai imediatamente — o instalador oneClick instala e relança o app
            app.exit(0);
          });
        });
      });

      res.on("error", (err) => {
        arquivo.end();
        if (progressWin) progressWin.close();
        dialog.showErrorBox("Erro no download", err.message);
      });
    }).on("error", (err) => {
      if (progressWin) progressWin.close();
      dialog.showErrorBox("Erro", `Não foi possível baixar a atualização:\n${err.message}`);
    });
  }

  fazer(urlDownload);
}

// ── Verifica atualização disponível ─────────────────────────────────────────
function verificarAtualizacao() {
  if (!app.isPackaged) return; // só no .exe instalado

  https.get(VERSION_URL, { timeout: 8000 }, (res) => {
    let body = "";
    res.on("data", (c) => { body += c; });
    res.on("end", () => {
      try {
        const remoto      = JSON.parse(body);
        const versaoAtual = app.getVersion();
        const versaoRemota= remoto.version  || "";
        const notas       = remoto.notas    || "";
        const urlDownload = remoto.download || "";

        if (!versaoRemota || !urlDownload) return;

        // Compara semver simples
        const p = (v) => v.split(".").map(Number);
        const [ma, mi, pa] = p(versaoAtual);
        const [mr, mir, pr] = p(versaoRemota);
        const temUpdate = mr > ma || (mr === ma && mir > mi) || (mr === ma && mir === mi && pr > pa);
        if (!temUpdate) return;

        // Aguarda 5s para o app carregar, depois pergunta
        setTimeout(() => {
          if (!mainWindow) return;
          const resp = dialog.showMessageBoxSync(mainWindow, {
            type: "info",
            title: "Atualização disponível — Horti Gestão PDV",
            message: `🚀 Nova versão ${versaoRemota} disponível!`,
            detail: (notas ? `O que há de novo:\n${notas}\n\n` : "")
              + `Versão atual: ${versaoAtual}\n\nDeseja baixar e instalar agora?\nO aplicativo será fechado e reiniciado automaticamente.`,
            buttons: ["⬇️  Atualizar agora", "Lembrar depois"],
            defaultId: 0,
            cancelId: 1,
          });

          if (resp === 0) baixarEInstalar(urlDownload, versaoRemota);
        }, 5000);

      } catch { /* JSON inválido */ }
    });
  }).on("error", () => { /* offline — ignora */ });
}

// ── Aguarda o servidor responder (polling) ───────────────────────────────────
function waitForServer(url, maxTentativas = 80) {  // 80 × 500ms = 40 segundos
  return new Promise((resolve, reject) => {
    let tentativas = 0;
    function check() {
      http.get(url, (res) => {
        log(`Servidor respondeu: HTTP ${res.statusCode}`);
        resolve(true);
      }).on("error", (err) => {
        tentativas++;
        if (tentativas % 10 === 0) log(`Aguardando servidor... tentativa ${tentativas}`);
        if (tentativas >= maxTentativas) {
          // Lê o log para mostrar na mensagem de erro
          let logConteudo = "";
          try { logConteudo = fs.readFileSync(logPath, "utf8").slice(-1500); } catch {}
          reject(new Error(`Servidor não respondeu após 40s.\n\nLog:\n${logConteudo}`));
        } else {
          setTimeout(check, 500);
        }
      });
    }
    check();
  });
}

// ── Cria a janela principal ─────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 600,
    autoHideMenuBar: true,
    title: "Horti Gestão — PDV",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Remove menu padrão (sem Alt, sem barra de menu)
  Menu.setApplicationMenu(null);

  mainWindow.maximize();

  // Splash enquanto carrega
  mainWindow.loadURL("data:text/html,<html><body style='background:#0c121a;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'><div style='color:#1faa4a;font-size:28px;font-family:Segoe UI,sans-serif;font-weight:900;letter-spacing:4px'>HORTI GESTÃO</div></body></html>");

  const url = app.isPackaged ? PROD_URL : DEV_URL;
  mainWindow.webContents.once("did-finish-load", () => {
    setTimeout(() => mainWindow?.loadURL(url), app.isPackaged ? 200 : 0);
  });

  if (!app.isPackaged) {
    // Em dev: carrega direto
    mainWindow.loadURL(url);
  }

  mainWindow.on("closed", () => { mainWindow = null; });

  // Ctrl+Shift+I abre DevTools mesmo no .exe instalado (para debug)
  mainWindow.webContents.on("before-input-event", (_ev, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === "i") {
      mainWindow?.webContents.toggleDevTools();
    }
  });

  // Links externos abrem no browser do sistema; localhost abre nova janela interna
  mainWindow.webContents.setWindowOpenHandler(({ url: u }) => {
    if (u.includes("localhost") || u.includes("127.0.0.1")) {
      return { action: "allow" };
    }
    if (u.startsWith("http")) shell.openExternal(u);
    return { action: "deny" };
  });

  // Configura janelas abertas via window.open (ex.: botão ADM no PDV)
  mainWindow.webContents.on("did-create-window", (win) => {
    win.setTitle("Horti Gestão — ADM");
    win.setMenuBarVisibility(false);
    win.setSize(1280, 800);
    win.center();
    admWindow = win;
    win.on("closed", () => { admWindow = null; });
  });
}

// ── Janela ADM separada ─────────────────────────────────────────────────────
function createAdmWindow() {
  if (admWindow && !admWindow.isDestroyed()) {
    admWindow.focus();
    return;
  }
  const baseUrl = app.isPackaged ? `http://localhost:${PORT}` : "http://localhost:3000";
  admWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    autoHideMenuBar: true,
    title: "Horti Gestão — ADM",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  Menu.setApplicationMenu(null);
  admWindow.loadURL(`${baseUrl}/adm`);
  admWindow.on("closed", () => { admWindow = null; });
}

// ── Ciclo de vida do app ─────────────────────────────────────────────────────

// Garante uma única instância do app — evita múltiplos servidores na mesma porta
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  // Outra instância já está rodando — foca ela e encerra esta
  app.quit();
} else {
  app.on("second-instance", () => {
    // Usuário tentou abrir uma segunda instância — traz a janela existente
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  if (!gotTheLock) return; // não prossegue se não tem o lock

  if (app.isPackaged) {
    try {
      startServer(); // já inclui killPortProcesses(PORT) internamente
      await waitForServer(`http://127.0.0.1:${PORT}`);
    } catch (err) {
      dialog.showErrorBox(
        "Erro ao iniciar PDV",
        `Não foi possível iniciar o servidor.\n\n${err instanceof Error ? err.message : err}`
      );
      app.quit();
      return;
    }
  }
  createWindow();
  // Abre ADM em janela separada após o PDV carregar
  setTimeout(() => createAdmWindow(), app.isPackaged ? 2000 : 1500);
  verificarAtualizacao(); // verifica update após abrir (silencioso se offline)
  // Re-verifica a cada 30 minutos (caso o Vercel ainda estivesse deployando no startup)
  setInterval(verificarAtualizacao, 30 * 60 * 1000);
});

app.on("window-all-closed", () => {
  if (serverProc) {
    serverProc.kill("SIGTERM");
    serverProc = null;
  }
  app.quit();
});

app.on("activate", () => {
  if (!mainWindow) createWindow();
});
