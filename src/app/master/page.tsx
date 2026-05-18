'use client';

import React, { useEffect, useState, useCallback } from "react";
import type { CSSProperties } from "react";
import { supabase } from "@/lib/supabaseClient";
import { gerarChave } from "@/lib/licenca";

const SENHA_MASTER = "D@na2014";

type Licenca = {
  id: string;
  chave: string;
  plano: string;
  cliente: string | null;
  ativo: boolean;
  ativado_em: string | null;
  validade: string | null;
  criado_em: string;
  notas: string | null;
};

type ClienteLicenciado = {
  id: number;
  codigo: string;
  nome_cliente: string | null;
  empresa_id: number;
  ativo: boolean;
  created_at: string;
};

function fmtData(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function diasAte(iso: string | null) {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export default function MasterPage() {
  const [liberado, setLiberado] = useState(false);
  const [senhaInput, setSenhaInput] = useState("");
  const [erroSenha, setErroSenha] = useState("");
  const [aba, setAba] = useState<"clientes" | "licencas">("clientes");

  // ── Clientes licenciados ──────────────────────────────────────────────────
  const [clientes, setClientes] = useState<ClienteLicenciado[]>([]);
  const [carregandoClientes, setCarregandoClientes] = useState(false);
  const [msgCliente, setMsgCliente] = useState("");
  const [nomeCliente, setNomeCliente] = useState("");
  const [codigoCliente, setCodigoCliente] = useState("");
  const [criandoCliente, setCriandoCliente] = useState(false);
  const [clienteCriado, setClienteCriado] = useState<ClienteLicenciado | null>(null);
  const [buscaCliente, setBuscaCliente] = useState("");

  const carregarClientes = useCallback(async () => {
    setCarregandoClientes(true);
    const { data } = await supabase
      .from("clientes_licenciados")
      .select("*")
      .order("empresa_id", { ascending: true });
    setClientes((data as ClienteLicenciado[]) || []);
    setCarregandoClientes(false);
  }, []);

  async function criarCliente(e: React.FormEvent) {
    e.preventDefault();
    const codigo = codigoCliente.trim().toUpperCase();
    const nome   = nomeCliente.trim();
    if (!codigo) { setMsgCliente("Informe o código de ativação."); return; }
    if (!nome)   { setMsgCliente("Informe o nome do cliente."); return; }
    setCriandoCliente(true); setMsgCliente(""); setClienteCriado(null);

    // Próximo empresa_id = max + 1
    const { data: maxData } = await supabase
      .from("clientes_licenciados")
      .select("empresa_id")
      .order("empresa_id", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextId = ((maxData as { empresa_id: number } | null)?.empresa_id ?? 0) + 1;

    const { data, error } = await supabase
      .from("clientes_licenciados")
      .insert([{ codigo, nome_cliente: nome, empresa_id: nextId, ativo: true }])
      .select()
      .single();

    if (error) {
      setMsgCliente(`Erro: ${error.message.includes("unique") ? "Código já existe. Use outro código." : error.message}`);
    } else {
      setClienteCriado(data as ClienteLicenciado);
      setCodigoCliente(""); setNomeCliente("");
      setMsgCliente("");
      carregarClientes();
    }
    setCriandoCliente(false);
  }

  async function toggleCliente(id: number, ativo: boolean) {
    await supabase.from("clientes_licenciados").update({ ativo: !ativo }).eq("id", id);
    carregarClientes();
  }

  async function excluirCliente(id: number, codigo: string) {
    if (!confirm(`Excluir cliente ${codigo}? Esta ação não pode ser desfeita.`)) return;
    await supabase.from("clientes_licenciados").delete().eq("id", id);
    carregarClientes();
  }

  // ── Licenças (antigo sistema) ──────────────────────────────────────────────
  const [licencas, setLicencas] = useState<Licenca[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [msg, setMsg] = useState("");
  const [qtd, setQtd] = useState(1);
  const [clienteNovo, setClienteNovo] = useState("");
  const [notasNovo, setNotasNovo] = useState("");
  const [gerando, setGerando] = useState(false);
  const [novasChaves, setNovasChaves] = useState<string[]>([]);
  const [busca, setBusca] = useState("");

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data } = await supabase
      .from("licencas")
      .select("*")
      .order("criado_em", { ascending: false });
    setLicencas((data as Licenca[]) || []);
    setCarregando(false);
  }, []);

  useEffect(() => {
    if (liberado) { carregarClientes(); carregar(); }
  }, [liberado, carregarClientes, carregar]);

  function entrar(e: React.FormEvent) {
    e.preventDefault();
    if (senhaInput === SENHA_MASTER) { setLiberado(true); }
    else { setErroSenha("Senha incorreta."); }
  }

  async function gerarNovas(e: React.FormEvent) {
    e.preventDefault();
    setGerando(true);
    setNovasChaves([]);
    const chaves = Array.from({ length: qtd }, () => gerarChave());
    const validade = new Date();
    validade.setFullYear(validade.getFullYear() + 1);
    const rows = chaves.map((chave) => ({
      chave, plano: "pro",
      cliente: clienteNovo.trim() || null,
      notas: notasNovo.trim() || null,
      ativo: true,
      validade: validade.toISOString(),
    }));
    const { error } = await supabase.from("licencas").insert(rows);
    if (error) { setMsg(`Erro: ${error.message}`); }
    else {
      setNovasChaves(chaves);
      setClienteNovo(""); setNotasNovo("");
      setMsg(`${qtd} chave(s) criada(s) com sucesso!`);
      carregar();
    }
    setGerando(false);
    setTimeout(() => setMsg(""), 5000);
  }

  async function revogar(id: string, chave: string) {
    if (!confirm(`Revogar a chave ${chave}? O cliente perderá acesso.`)) return;
    await supabase.from("licencas").update({ ativo: false }).eq("id", id);
    carregar();
  }

  async function reativar(id: string) {
    await supabase.from("licencas").update({ ativo: true }).eq("id", id);
    carregar();
  }

  async function excluir(id: string, chave: string) {
    if (!confirm(`Excluir permanentemente a chave ${chave}?`)) return;
    await supabase.from("licencas").delete().eq("id", id);
    carregar();
  }

  if (!liberado) {
    return (
      <main style={{ minHeight: "100vh", background: "#0c121a", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Segoe UI, Arial, sans-serif" }}>
        <form onSubmit={entrar} style={{ background: "#161e2b", border: "1px solid #1f2d3d", borderRadius: 20, padding: "40px 44px", width: 340, boxShadow: "0 20px 60px rgba(0,0,0,.5)" }}>
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div style={{ fontSize: 36 }}>🔑</div>
            <div style={{ color: "#e2e8f0", fontWeight: 900, fontSize: 22, marginTop: 8 }}>Painel Master</div>
            <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>Horti Gestão — Área restrita</div>
          </div>
          <input
            type="password"
            placeholder="Senha master"
            value={senhaInput}
            onChange={(e) => setSenhaInput(e.target.value)}
            autoFocus
            style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #2d3f54", background: "#0f1822", color: "#e2e8f0", fontSize: 15, boxSizing: "border-box", outline: "none" }}
          />
          {erroSenha && <div style={{ color: "#f87171", fontSize: 13, marginTop: 8 }}>{erroSenha}</div>}
          <button type="submit" style={{ marginTop: 16, width: "100%", padding: "12px", borderRadius: 10, background: "#16a34a", border: "none", color: "#fff", fontWeight: 800, fontSize: 15, cursor: "pointer" }}>
            Entrar
          </button>
        </form>
      </main>
    );
  }

  const clientesFiltrados = clientes.filter((c) => {
    const q = buscaCliente.toLowerCase();
    return !q || c.codigo.toLowerCase().includes(q) || (c.nome_cliente ?? "").toLowerCase().includes(q);
  });

  const licencasFiltradas = licencas.filter((l) => {
    const q = busca.toLowerCase();
    return !q || l.chave.toLowerCase().includes(q) || (l.cliente ?? "").toLowerCase().includes(q) || (l.notas ?? "").toLowerCase().includes(q);
  });

  const totalAtivas    = licencas.filter((l) => l.ativo && l.ativado_em).length;
  const totalPendentes = licencas.filter((l) => l.ativo && !l.ativado_em).length;
  const totalRevogadas = licencas.filter((l) => !l.ativo).length;

  return (
    <main style={{ minHeight: "100vh", background: "#0c121a", fontFamily: "Segoe UI, Arial, sans-serif", color: "#e2e8f0", padding: "28px 24px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 26, fontWeight: 900, color: "#f0fdf4" }}>🌿 Painel Master</div>
            <div style={{ color: "#64748b", fontSize: 13 }}>Horti Gestão — Área restrita</div>
          </div>
          <button onClick={() => setLiberado(false)} style={{ background: "transparent", border: "1px solid #2d3f54", borderRadius: 8, color: "#94a3b8", padding: "7px 16px", cursor: "pointer", fontSize: 13 }}>
            Sair
          </button>
        </div>

        {/* Abas */}
        <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          {([["clientes", "👥 Clientes"], ["licencas", "🔑 Licenças"]] as const).map(([id, label]) => (
            <button key={id} onClick={() => setAba(id)} style={{
              padding: "9px 20px", borderRadius: 10, border: "1px solid",
              borderColor: aba === id ? "#16a34a" : "#1f2d3d",
              background: aba === id ? "#052e16" : "#161e2b",
              color: aba === id ? "#4ade80" : "#94a3b8",
              fontWeight: 800, fontSize: 14, cursor: "pointer",
            }}>{label}</button>
          ))}
        </div>

        {/* ── ABA CLIENTES ─────────────────────────────────────────────────── */}
        {aba === "clientes" && (
          <>
            {/* Resumo */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 24 }}>
              {[
                { label: "Total de clientes", valor: clientes.length, cor: "#7dd3fc", bg: "#0c1a2e" },
                { label: "Ativos", valor: clientes.filter(c => c.ativo).length, cor: "#4ade80", bg: "#052e16" },
                { label: "Inativos", valor: clientes.filter(c => !c.ativo).length, cor: "#f87171", bg: "#1c0202" },
              ].map(({ label, valor, cor, bg }) => (
                <div key={label} style={{ background: bg, border: `1px solid ${cor}33`, borderRadius: 14, padding: "18px 22px" }}>
                  <div style={{ color: cor, fontSize: 32, fontWeight: 900 }}>{valor}</div>
                  <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Formulário novo cliente */}
            <div style={{ background: "#161e2b", border: "1px solid #1f2d3d", borderRadius: 16, padding: "22px 24px", marginBottom: 24 }}>
              <div style={{ fontWeight: 900, fontSize: 17, color: "#f0fdf4", marginBottom: 16 }}>➕ Cadastrar novo cliente</div>
              <form onSubmit={criarCliente} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label style={lbl}>Nome do cliente *</label>
                  <input value={nomeCliente} onChange={e => setNomeCliente(e.target.value)} placeholder="Ex: João da Silva" style={inp} />
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label style={lbl}>Código de ativação *</label>
                  <input
                    value={codigoCliente}
                    onChange={e => setCodigoCliente(e.target.value.toUpperCase().replace(/\s/g, ""))}
                    placeholder="Ex: JOAO2025"
                    style={{ ...inp, letterSpacing: 2, fontWeight: 800 }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setCodigoCliente(Math.random().toString(36).slice(2, 8).toUpperCase())}
                  style={{ ...btnCinza, height: 42, alignSelf: "flex-end" }}
                  title="Gerar código aleatório"
                >
                  🎲 Auto
                </button>
                <button type="submit" disabled={criandoCliente} style={{ ...btnVerde, height: 42, alignSelf: "flex-end" }}>
                  {criandoCliente ? "Criando..." : "✔ Criar cliente"}
                </button>
              </form>

              {msgCliente && (
                <div style={{ marginTop: 12, color: "#f87171", fontWeight: 600, fontSize: 13 }}>{msgCliente}</div>
              )}

              {clienteCriado && (
                <div style={{ marginTop: 18, background: "#0a1a0f", border: "1px solid #16a34a44", borderRadius: 10, padding: 16 }}>
                  <div style={{ color: "#86efac", fontWeight: 700, marginBottom: 10, fontSize: 14 }}>
                    ✅ Cliente criado! Envie o código abaixo:
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <code style={{ background: "#0f2a16", color: "#4ade80", padding: "8px 16px", borderRadius: 8, fontSize: 20, fontWeight: 900, letterSpacing: 3 }}>
                      {clienteCriado.codigo}
                    </code>
                    <button
                      onClick={() => navigator.clipboard.writeText(clienteCriado.codigo)}
                      style={btnCinza}
                    >
                      📋 Copiar código
                    </button>
                  </div>
                  <div style={{ color: "#475569", fontSize: 12, marginTop: 8 }}>
                    empresa_id: {clienteCriado.empresa_id} · cliente: {clienteCriado.nome_cliente}
                  </div>
                </div>
              )}
            </div>

            {/* Lista de clientes */}
            <div style={{ background: "#161e2b", border: "1px solid #1f2d3d", borderRadius: 16, padding: "22px 24px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
                <div style={{ fontWeight: 900, fontSize: 17, color: "#f0fdf4" }}>📋 Clientes ({clientes.length})</div>
                <div style={{ display: "flex", gap: 10 }}>
                  <input value={buscaCliente} onChange={e => setBuscaCliente(e.target.value)} placeholder="Buscar..." style={{ ...inp, width: 200 }} />
                  <button onClick={carregarClientes} disabled={carregandoClientes} style={btnCinza}>{carregandoClientes ? "..." : "↻"}</button>
                </div>
              </div>

              {clientesFiltrados.length === 0 ? (
                <div style={{ color: "#475569", textAlign: "center", padding: "32px 0" }}>
                  {carregandoClientes ? "Carregando..." : "Nenhum cliente encontrado."}
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #1f2d3d" }}>
                        {["Cliente", "Código", "ID", "Cadastrado em", "Status", "Ações"].map(h => (
                          <th key={h} style={{ textAlign: "left", padding: "8px 10px", color: "#64748b", fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {clientesFiltrados.map(c => (
                        <tr key={c.id} style={{ borderBottom: "1px solid #1a2535" }}>
                          <td style={{ padding: "10px 10px", color: "#cbd5e1", fontWeight: 600 }}>{c.nome_cliente || <span style={{ color: "#475569" }}>—</span>}</td>
                          <td style={{ padding: "10px 10px" }}>
                            <code style={{ color: "#4ade80", fontSize: 14, fontWeight: 800, letterSpacing: 1 }}>{c.codigo}</code>
                          </td>
                          <td style={{ padding: "10px 10px", color: "#475569", fontFamily: "monospace" }}>{c.empresa_id}</td>
                          <td style={{ padding: "10px 10px", color: "#94a3b8", whiteSpace: "nowrap" }}>{fmtData(c.created_at)}</td>
                          <td style={{ padding: "10px 10px" }}>
                            <span style={{ color: c.ativo ? "#4ade80" : "#f87171", fontWeight: 700 }}>
                              {c.ativo ? "✅ Ativo" : "🚫 Inativo"}
                            </span>
                          </td>
                          <td style={{ padding: "10px 10px" }}>
                            <div style={{ display: "flex", gap: 6 }}>
                              <button onClick={() => navigator.clipboard.writeText(c.codigo)} style={btnMinCinza} title="Copiar código">📋</button>
                              <button onClick={() => toggleCliente(c.id, c.ativo)} style={c.ativo ? btnMinVermelho : btnMinVerde} title={c.ativo ? "Desativar" : "Ativar"}>
                                {c.ativo ? "🚫" : "✅"}
                              </button>
                              <button onClick={() => excluirCliente(c.id, c.codigo)} style={btnMinVermelho} title="Excluir">🗑️</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── ABA LICENÇAS ─────────────────────────────────────────────────── */}
        {aba === "licencas" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 28 }}>
              {[
                { label: "Ativas", valor: totalAtivas, cor: "#16a34a", bg: "#052e16" },
                { label: "Aguardando ativação", valor: totalPendentes, cor: "#eab308", bg: "#1c1202" },
                { label: "Revogadas", valor: totalRevogadas, cor: "#ef4444", bg: "#1c0202" },
              ].map(({ label, valor, cor, bg }) => (
                <div key={label} style={{ background: bg, border: `1px solid ${cor}33`, borderRadius: 14, padding: "18px 22px" }}>
                  <div style={{ color: cor, fontSize: 32, fontWeight: 900 }}>{valor}</div>
                  <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>{label}</div>
                </div>
              ))}
            </div>

            <div style={{ background: "#161e2b", border: "1px solid #1f2d3d", borderRadius: 16, padding: "22px 24px", marginBottom: 24 }}>
              <div style={{ fontWeight: 900, fontSize: 17, color: "#f0fdf4", marginBottom: 16 }}>➕ Gerar novas chaves</div>
              {msg && <div style={{ background: "#14532d", border: "1px solid #16a34a", borderRadius: 10, padding: "10px 16px", marginBottom: 16, color: "#bbf7d0", fontWeight: 700 }}>{msg}</div>}
              <form onSubmit={gerarNovas} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div>
                  <label style={lbl}>Quantidade</label>
                  <input type="number" min={1} max={50} value={qtd} onChange={(e) => setQtd(Number(e.target.value))} style={{ ...inp, width: 80 }} />
                </div>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <label style={lbl}>Cliente (opcional)</label>
                  <input value={clienteNovo} onChange={(e) => setClienteNovo(e.target.value)} placeholder="Nome do cliente" style={inp} />
                </div>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <label style={lbl}>Observação (opcional)</label>
                  <input value={notasNovo} onChange={(e) => setNotasNovo(e.target.value)} placeholder="Ex: Loja centro SP" style={inp} />
                </div>
                <button type="submit" disabled={gerando} style={{ ...btnVerde, height: 42, alignSelf: "flex-end" }}>
                  {gerando ? "Gerando..." : "🔑 Gerar"}
                </button>
              </form>

              {novasChaves.length > 0 && (
                <div style={{ marginTop: 18, background: "#0a1a0f", border: "1px solid #16a34a44", borderRadius: 10, padding: 16 }}>
                  <div style={{ color: "#86efac", fontWeight: 700, marginBottom: 10, fontSize: 14 }}>✅ Chaves geradas:</div>
                  {novasChaves.map((c) => (
                    <div key={c} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                      <code style={{ background: "#0f2a16", color: "#4ade80", padding: "6px 12px", borderRadius: 7, fontSize: 15, fontWeight: 700, letterSpacing: 1, flex: 1 }}>{c}</code>
                      <button onClick={() => navigator.clipboard.writeText(c)} style={btnCinza}>📋 Copiar</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ background: "#161e2b", border: "1px solid #1f2d3d", borderRadius: 16, padding: "22px 24px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
                <div style={{ fontWeight: 900, fontSize: 17, color: "#f0fdf4" }}>📋 Todas as licenças ({licencas.length})</div>
                <div style={{ display: "flex", gap: 10 }}>
                  <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar..." style={{ ...inp, width: 230 }} />
                  <button onClick={carregar} disabled={carregando} style={btnCinza}>{carregando ? "..." : "↻ Atualizar"}</button>
                </div>
              </div>

              {licencasFiltradas.length === 0 ? (
                <div style={{ color: "#475569", textAlign: "center", padding: "32px 0" }}>
                  {carregando ? "Carregando..." : "Nenhuma licença encontrada."}
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #1f2d3d" }}>
                        {["Chave", "Cliente", "Status", "Ativado em", "Expira em", "Restam", "Ações"].map((h) => (
                          <th key={h} style={{ textAlign: "left", padding: "8px 10px", color: "#64748b", fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {licencasFiltradas.map((l) => {
                        const dias = diasAte(l.validade);
                        const status = !l.ativo ? "revogada" : !l.ativado_em ? "pendente" : dias !== null && dias <= 0 ? "expirada" : "ativa";
                        const statusCor: Record<string, string> = { ativa: "#4ade80", pendente: "#fde047", revogada: "#f87171", expirada: "#fb923c" };
                        const statusLabel: Record<string, string> = { ativa: "✅ Ativa", pendente: "⏳ Pendente", revogada: "🚫 Revogada", expirada: "⚠️ Expirada" };
                        return (
                          <tr key={l.id} style={{ borderBottom: "1px solid #1a2535" }}>
                            <td style={{ padding: "10px 10px" }}><code style={{ color: "#7dd3fc", fontSize: 13 }}>{l.chave}</code></td>
                            <td style={{ padding: "10px 10px", color: "#cbd5e1" }}>{l.cliente || <span style={{ color: "#475569" }}>—</span>}</td>
                            <td style={{ padding: "10px 10px" }}><span style={{ color: statusCor[status], fontWeight: 700 }}>{statusLabel[status]}</span></td>
                            <td style={{ padding: "10px 10px", color: "#94a3b8", whiteSpace: "nowrap" }}>{fmtData(l.ativado_em)}</td>
                            <td style={{ padding: "10px 10px", color: "#94a3b8", whiteSpace: "nowrap" }}>{fmtData(l.validade)}</td>
                            <td style={{ padding: "10px 10px", whiteSpace: "nowrap" }}>
                              {dias === null ? <span style={{ color: "#475569" }}>—</span>
                                : dias <= 0 ? <span style={{ color: "#fb923c" }}>Expirada</span>
                                : dias <= 30 ? <span style={{ color: "#fb923c", fontWeight: 700 }}>{dias}d</span>
                                : <span style={{ color: "#86efac" }}>{Math.floor(dias / 365)}a {Math.floor((dias % 365) / 30)}m</span>}
                            </td>
                            <td style={{ padding: "10px 10px" }}>
                              <div style={{ display: "flex", gap: 6 }}>
                                <button onClick={() => navigator.clipboard.writeText(l.chave)} style={btnMinCinza} title="Copiar">📋</button>
                                {l.ativo
                                  ? <button onClick={() => revogar(l.id, l.chave)} style={btnMinVermelho} title="Revogar">🚫</button>
                                  : <button onClick={() => reativar(l.id)} style={btnMinVerde} title="Reativar">✅</button>}
                                <button onClick={() => excluir(l.id, l.chave)} style={btnMinVermelho} title="Excluir">🗑️</button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

const lbl: CSSProperties = { display: "block", color: "#94a3b8", fontSize: 12, fontWeight: 700, marginBottom: 5 };
const inp: CSSProperties = { background: "#0f1822", border: "1px solid #2d3f54", borderRadius: 8, color: "#e2e8f0", fontSize: 14, padding: "9px 12px", outline: "none", width: "100%", boxSizing: "border-box" };
const btnVerde: CSSProperties = { background: "#16a34a", border: "none", borderRadius: 8, color: "#fff", fontWeight: 800, fontSize: 14, padding: "9px 20px", cursor: "pointer", whiteSpace: "nowrap" };
const btnCinza: CSSProperties = { background: "#1e2d3d", border: "1px solid #2d3f54", borderRadius: 8, color: "#94a3b8", fontSize: 13, padding: "7px 14px", cursor: "pointer", whiteSpace: "nowrap" };
const btnMinCinza: CSSProperties = { background: "#1e2d3d", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 13 };
const btnMinVermelho: CSSProperties = { background: "#3b0a0a", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 13 };
const btnMinVerde: CSSProperties = { background: "#052e16", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 13 };
