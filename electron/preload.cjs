/**
 * electron/preload.cjs
 * Rodado num contexto isolado antes de carregar a página.
 * Por segurança: sem nodeIntegration, apenas contextBridge se necessário.
 */

"use strict";

const { ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");

// ── Captura erros JS do renderer e grava no log ──────────────────────────────
const logPath = path.join(
  process.env.APPDATA || process.env.HOME || ".",
  "Horti Gestão PDV",
  "horti-renderer.log"
);

function logRenderer(tipo, msg) {
  const linha = `[${new Date().toISOString()}] [${tipo}] ${msg}\n`;
  try { fs.appendFileSync(logPath, linha); } catch {}
}

window.addEventListener("error", (e) => {
  logRenderer("ERROR", `${e.message} @ ${e.filename}:${e.lineno}:${e.colno}\n${e.error?.stack || ""}`);
});

window.addEventListener("unhandledrejection", (e) => {
  logRenderer("UNHANDLED_REJECTION", String(e.reason?.stack || e.reason || e));
});

// Nada exposto por enquanto — o app usa apenas Supabase (HTTPS) e IndexedDB.
// Para futuras integrações com o SO (impressora, USB, etc.), adicione aqui via
// contextBridge.exposeInMainWorld('hortiAPI', { ... });
