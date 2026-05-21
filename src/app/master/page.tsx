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
  cadastro_em: string | null;
  ultimo_acesso: string | null;
  created_at: string;
};

type Solicitacao = {
  id: string;
  empresa_id: number | null;
  nome: string;
  estabelecimento: string | null;
  whatsapp: string | null;
  assunto: string;
  mensagem: string;
  status: "aberto" | "em_atendimento" | "resolvido";
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
  const [aba, setAba] = useState<"clientes" | "licencas" | "suporte">("clientes");

  // ── Suporte ───────────────────────────────────────────────────────────────
  const [solicitacoes, setSolicitacoes] = useState<Solicitacao[]>([]);
  const [supExpandido, setSupExpandido] = useState<string | null>(null);
  const [supFiltro, setSupFiltro] = useState<"todos" | "aberto" | "em_atendimento" | "resolvido">("todos");

  const carregarSolicitacoes = useCallback(async () => {
    const { data } = await supabase
      .from("suporte_solicitacoes")
      .select("*")
      .order("created_at", { ascending: false });
    setSolicitacoes((data as Solicitacao[]) || []);
  }, []);

  useEffect(() => {
    if (liberado) carregarSolicitacoes();
  }, [liberado, carregarSolicitacoes]);

  // Realtime: atualiza inbox ao chegar nova solicitação
  useEffect(() => {
    if (!liberado) return;
    const ch = supabase
      .channel("suporte-inbox")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "suporte_solicitacoes" }, () => {
        carregarSolicitacoes();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [liberado, carregarSolicitacoes]);

  async function atualizarStatus(id: string, status: Solicitacao["status"]) {
    await supabase.from("suporte_solicitacoes").update({ status }).eq("id", id);
    carregarSolicitacoes();
  }

  async function excluirSolicitacao(id: string) {
    if (!confirm("Excluir esta solicitação?")) return;
    await supabase.from("suporte_solicitacoes").delete().eq("id", id);
    carregarSolicitacoes();
  }

  // ── Presença via heartbeat (ultimo_acesso < 2 min = online) ──────────────
  const [onlineIds, setOnlineIds] = useState<Set<number>>(new Set());

  function calcularOnline(lista: ClienteLicenciado[]) {
    const limite = Date.now() - 2 * 60 * 1000; // 2 minutos
    const ids = new Set(
      lista
        .filter(c => c.ultimo_acesso && new Date(c.ultimo_acesso).getTime() > limite)
        .map(c => c.empresa_id)
    );
    setOnlineIds(ids);
  }

  useEffect(() => {
    if (!liberado) return;
    // Atualiza os online a cada 30 segundos
    const timer = setInterval(async () => {
      const { data } = await supabase
        .from('clientes_licenciados')
        .select('empresa_id, ultimo_acesso');
      if (data) calcularOnline(data as ClienteLicenciado[]);
    }, 30_000);
    return () => clearInterval(timer);
  }, [liberado]);

  // ── Clientes licenciados ──────────────────────────────────────────────────
  const [clientes, setClientes] = useState<ClienteLicenciado[]>([]);
  const [carregandoClientes, setCarregandoClientes] = useState(false);
  const [msgCliente, setMsgCliente] = useState("");
  const [nomeCliente, setNomeCliente] = useState("");
  const [codigoCliente, setCodigoCliente] = useState(() => Math.random().toString(36).slice(2, 8).toUpperCase());
  const [telefoneCliente, setTelefoneCliente] = useState("");
  const [criandoCliente, setCriandoCliente] = useState(false);
  const [clienteCriado, setClienteCriado] = useState<ClienteLicenciado | null>(null);
  const [telefoneCriado, setTelefoneCriado] = useState("");
  const [buscaCliente, setBuscaCliente] = useState("");

  const carregarClientes = useCallback(async () => {
    setCarregandoClientes(true);
    const { data } = await supabase
      .from("clientes_licenciados")
      .select("*")
      .order("empresa_id", { ascending: true });
    const lista = (data as ClienteLicenciado[]) || [];
    setClientes(lista);
    calcularOnline(lista);
    setCarregandoClientes(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function gerarCodigoAuto() {
    setCodigoCliente(Math.random().toString(36).slice(2, 8).toUpperCase());
  }

  function montarMsgWhatsApp(nome: string, codigo: string) {
    return (
      `Olá, *${nome}*! 🌿\n\n` +
      `Seja bem-vindo(a) ao *Horti Gestão PDV*!\n\n` +
      `Seu sistema está pronto para uso. Veja suas informações de acesso:\n\n` +
      `🔑 *Código de ativação:* \`${codigo}\`\n\n` +
      `🌐 *Acesse pelo navegador:*\n` +
      `https://horti-gestao.vercel.app/login\n\n` +
      `📱 *Como começar:*\n` +
      `1. Abra o link acima no celular ou computador\n` +
      `2. Digite o código de ativação\n` +
      `3. Configure seu estabelecimento e comece a vender!\n\n` +
      `Qualquer dúvida estou à disposição. 😊`
    );
  }

  function abrirWhatsApp(telefone: string, nome: string, codigo: string) {
    const fone = telefone.replace(/\D/g, "");
    const numero = fone.startsWith("55") ? fone : `55${fone}`;
    const texto = encodeURIComponent(montarMsgWhatsApp(nome, codigo));
    window.open(`https://wa.me/${numero}?text=${texto}`, "_blank");
  }

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
      .insert([{ codigo, nome_cliente: nome, empresa_id: nextId, ativo: false, cadastro_em: null }])
      .select()
      .single();

    if (error) {
      setMsgCliente(`Erro: ${error.message.includes("unique") ? "Código já existe. Use outro código." : error.message}`);
    } else {
      setClienteCriado(data as ClienteLicenciado);
      setTelefoneCriado(telefoneCliente);
      setNomeCliente("");
      setTelefoneCliente("");
      gerarCodigoAuto();
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
        <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
          {([["clientes", "👥 Clientes"], ["licencas", "🔑 Licenças"]] as const).map(([id, label]) => (
            <button key={id} onClick={() => setAba(id)} style={{
              padding: "9px 20px", borderRadius: 10, border: "1px solid",
              borderColor: aba === id ? "#16a34a" : "#1f2d3d",
              background: aba === id ? "#052e16" : "#161e2b",
              color: aba === id ? "#4ade80" : "#94a3b8",
              fontWeight: 800, fontSize: 14, cursor: "pointer",
            }}>{label}</button>
          ))}
          <button onClick={() => setAba("suporte")} style={{
            padding: "9px 20px", borderRadius: 10, border: "1px solid",
            borderColor: aba === "suporte" ? "#f59e0b" : "#1f2d3d",
            background: aba === "suporte" ? "#1c1202" : "#161e2b",
            color: aba === "suporte" ? "#fbbf24" : "#94a3b8",
            fontWeight: 800, fontSize: 14, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            📬 Suporte
            {solicitacoes.filter(s => s.status === "aberto").length > 0 && (
              <span style={{
                background: "#ef4444", color: "#fff", borderRadius: 999,
                fontSize: 11, fontWeight: 900, padding: "1px 7px", lineHeight: "18px",
              }}>
                {solicitacoes.filter(s => s.status === "aberto").length}
              </span>
            )}
          </button>
        </div>

        {/* ── ABA CLIENTES ─────────────────────────────────────────────────── */}
        {aba === "clientes" && (
          <>
            {/* Resumo */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 24 }}>
              {[
                { label: "Total de clientes", valor: clientes.length, cor: "#7dd3fc", bg: "#0c1a2e" },
                { label: "Cadastrados", valor: clientes.filter(c => c.cadastro_em).length, cor: "#4ade80", bg: "#052e16" },
                { label: "⏳ Aguardando cadastro", valor: clientes.filter(c => !c.cadastro_em).length, cor: "#fbbf24", bg: "#1c1202" },
                { label: "Online agora", valor: clientes.filter(c => onlineIds.has(c.empresa_id)).length, cor: "#a3e635", bg: "#0f1e02" },
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
                <div style={{ flex: "1 1 200px" }}>
                  <label style={lbl}>Nome do cliente *</label>
                  <input value={nomeCliente} onChange={e => setNomeCliente(e.target.value)} placeholder="Ex: João da Silva" style={inp} />
                </div>
                <div style={{ flex: "1 1 160px" }}>
                  <label style={lbl}>Código de ativação *</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      value={codigoCliente}
                      onChange={e => setCodigoCliente(e.target.value.toUpperCase().replace(/\s/g, ""))}
                      placeholder="Ex: JOAO2025"
                      style={{ ...inp, letterSpacing: 2, fontWeight: 800 }}
                    />
                    <button
                      type="button"
                      onClick={gerarCodigoAuto}
                      style={{ ...btnCinza, padding: "0 10px", flexShrink: 0 }}
                      title="Gerar código aleatório"
                    >
                      🎲
                    </button>
                  </div>
                </div>
                <div style={{ flex: "1 1 180px" }}>
                  <label style={lbl}>WhatsApp do cliente</label>
                  <input
                    value={telefoneCliente}
                    onChange={e => setTelefoneCliente(e.target.value.replace(/\D/g, ""))}
                    placeholder="Ex: 11999998888"
                    inputMode="tel"
                    maxLength={15}
                    style={inp}
                  />
                </div>
                <button type="submit" disabled={criandoCliente} style={{ ...btnVerde, height: 42, alignSelf: "flex-end", flexShrink: 0 }}>
                  {criandoCliente ? "Criando..." : "✔ Criar cliente"}
                </button>
              </form>

              {msgCliente && (
                <div style={{ marginTop: 12, color: "#f87171", fontWeight: 600, fontSize: 13 }}>{msgCliente}</div>
              )}

              {clienteCriado && (
                <div style={{ marginTop: 18, background: "#0a1a0f", border: "1px solid #16a34a44", borderRadius: 10, padding: 16 }}>
                  <div style={{ color: "#86efac", fontWeight: 700, marginBottom: 12, fontSize: 15 }}>
                    ✅ Cliente criado com sucesso!
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
                    <div>
                      <div style={{ color: "#64748b", fontSize: 11, marginBottom: 4 }}>CÓDIGO DE ATIVAÇÃO</div>
                      <code style={{ background: "#0f2a16", color: "#4ade80", padding: "10px 18px", borderRadius: 8, fontSize: 22, fontWeight: 900, letterSpacing: 3, display: "block" }}>
                        {clienteCriado.codigo}
                      </code>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <button onClick={() => navigator.clipboard.writeText(clienteCriado.codigo)} style={btnCinza}>
                        📋 Copiar código
                      </button>
                      {telefoneCriado && (
                        <button
                          onClick={() => abrirWhatsApp(telefoneCriado, clienteCriado.nome_cliente || "Cliente", clienteCriado.codigo)}
                          style={{ ...btnVerde, background: "#16a34a", fontSize: 14, padding: "9px 16px" }}
                        >
                          💬 Enviar boas-vindas via WhatsApp
                        </button>
                      )}
                    </div>
                  </div>
                  {!telefoneCriado && (
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                      <input
                        placeholder="Digite o WhatsApp para enviar mensagem"
                        inputMode="tel"
                        maxLength={15}
                        onChange={e => setTelefoneCriado(e.target.value.replace(/\D/g, ""))}
                        style={{ ...inp, maxWidth: 260 }}
                      />
                      <button
                        disabled={!telefoneCriado}
                        onClick={() => abrirWhatsApp(telefoneCriado, clienteCriado.nome_cliente || "Cliente", clienteCriado.codigo)}
                        style={{ ...btnVerde, background: "#16a34a", opacity: telefoneCriado ? 1 : 0.4 }}
                      >
                        💬 Enviar via WhatsApp
                      </button>
                    </div>
                  )}
                  <div style={{ color: "#334155", fontSize: 12, marginTop: 10 }}>
                    empresa_id: {clienteCriado.empresa_id} · {clienteCriado.nome_cliente}
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
                        {["", "Cliente", "Código", "ID", "Criado em", "Cadastro", "Ações"].map(h => (
                          <th key={h} style={{ textAlign: "left", padding: "8px 10px", color: "#64748b", fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {clientesFiltrados.map(c => (
                        <tr key={c.id} style={{ borderBottom: "1px solid #1a2535" }}>
                          <td style={{ padding: "10px 10px" }}>
                            <span title={onlineIds.has(c.empresa_id) ? "Online agora" : "Offline"} style={{
                              display: "inline-block", width: 10, height: 10, borderRadius: "50%",
                              background: onlineIds.has(c.empresa_id) ? "#4ade80" : "#334155",
                              boxShadow: onlineIds.has(c.empresa_id) ? "0 0 6px #4ade80" : "none",
                              flexShrink: 0,
                            }} />
                          </td>
                          <td style={{ padding: "10px 10px", color: "#cbd5e1", fontWeight: 600 }}>{c.nome_cliente || <span style={{ color: "#475569" }}>—</span>}</td>
                          <td style={{ padding: "10px 10px" }}>
                            <code style={{ color: "#4ade80", fontSize: 14, fontWeight: 800, letterSpacing: 1 }}>{c.codigo}</code>
                          </td>
                          <td style={{ padding: "10px 10px", color: "#475569", fontFamily: "monospace" }}>{c.empresa_id}</td>
                          <td style={{ padding: "10px 10px", color: "#94a3b8", whiteSpace: "nowrap" }}>{fmtData(c.created_at)}</td>
                          <td style={{ padding: "10px 10px" }}>
                            {c.cadastro_em ? (
                              <span title={`Cadastrado em ${new Date(c.cadastro_em).toLocaleString("pt-BR")}`} style={{ color: "#4ade80", fontWeight: 700, whiteSpace: "nowrap" }}>
                                ✅ {fmtData(c.cadastro_em)}
                              </span>
                            ) : (
                              <span style={{ color: "#fbbf24", fontWeight: 700 }}>⏳ Pendente</span>
                            )}
                          </td>
                          <td style={{ padding: "10px 10px" }}>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <button onClick={() => navigator.clipboard.writeText(c.codigo)} style={btnMinCinza} title="Copiar código">📋</button>
                              <button
                                onClick={() => {
                                  const fone = prompt(`WhatsApp de ${c.nome_cliente || c.codigo} (somente números, com DDD):`);
                                  if (fone) abrirWhatsApp(fone, c.nome_cliente || "Cliente", c.codigo);
                                }}
                                style={btnMinVerde}
                                title="Enviar boas-vindas via WhatsApp"
                              >💬</button>
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

        {/* ── ABA SUPORTE ──────────────────────────────────────────────────── */}
        {aba === "suporte" && (() => {
          const assuntoLabel: Record<string, string> = {
            duvida: "Dúvida técnica", erro: "Erro no sistema",
            sugestao: "Sugestão", outro: "Outro",
          };
          const statusCfg = {
            aberto:         { label: "Aberto",         cor: "#ef4444", bg: "#1c0202" },
            em_atendimento: { label: "Em atendimento", cor: "#f59e0b", bg: "#1c1202" },
            resolvido:      { label: "Resolvido",      cor: "#4ade80", bg: "#052e16" },
          };
          const lista = supFiltro === "todos"
            ? solicitacoes
            : solicitacoes.filter(s => s.status === supFiltro);

          return (
            <>
              {/* Resumo */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 24 }}>
                {(["aberto","em_atendimento","resolvido"] as const).map(s => (
                  <div key={s} onClick={() => setSupFiltro(supFiltro === s ? "todos" : s)}
                    style={{ background: statusCfg[s].bg, border: `1px solid ${statusCfg[s].cor}33`, borderRadius: 14, padding: "18px 22px", cursor: "pointer",
                      outline: supFiltro === s ? `2px solid ${statusCfg[s].cor}` : "none" }}>
                    <div style={{ color: statusCfg[s].cor, fontSize: 32, fontWeight: 900 }}>
                      {solicitacoes.filter(x => x.status === s).length}
                    </div>
                    <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>{statusCfg[s].label}</div>
                  </div>
                ))}
              </div>

              <div style={{ background: "#161e2b", border: "1px solid #1f2d3d", borderRadius: 16, padding: "22px 24px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
                  <div style={{ fontWeight: 900, fontSize: 17, color: "#f0fdf4" }}>
                    📬 Solicitações {supFiltro !== "todos" ? `— ${statusCfg[supFiltro as keyof typeof statusCfg].label}` : ""} ({lista.length})
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {supFiltro !== "todos" && (
                      <button onClick={() => setSupFiltro("todos")} style={btnCinza}>✕ Limpar filtro</button>
                    )}
                    <button onClick={carregarSolicitacoes} style={btnCinza}>↻</button>
                  </div>
                </div>

                {lista.length === 0 ? (
                  <div style={{ color: "#475569", textAlign: "center", padding: "40px 0", fontSize: 15 }}>
                    {supFiltro === "todos" ? "Nenhuma solicitação ainda." : `Nenhuma solicitação com status "${statusCfg[supFiltro as keyof typeof statusCfg].label}".`}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {lista.map(s => {
                      const cfg = statusCfg[s.status] ?? statusCfg.aberto;
                      const aberto = supExpandido === s.id;
                      return (
                        <div key={s.id} style={{ background: "#0f1822", border: `1px solid ${aberto ? cfg.cor + "55" : "#1f2d3d"}`, borderRadius: 14, overflow: "hidden", transition: "border-color .2s" }}>
                          {/* Cabeçalho */}
                          <div
                            onClick={() => setSupExpandido(aberto ? null : s.id)}
                            style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", cursor: "pointer", flexWrap: "wrap" }}
                          >
                            <span style={{ background: cfg.bg, color: cfg.cor, borderRadius: 999, fontSize: 11, fontWeight: 800, padding: "3px 10px", whiteSpace: "nowrap" }}>
                              {cfg.label}
                            </span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {s.estabelecimento || s.nome} — <span style={{ color: "#94a3b8", fontWeight: 400 }}>{assuntoLabel[s.assunto] ?? s.assunto}</span>
                              </div>
                              <div style={{ color: "#475569", fontSize: 12, marginTop: 2 }}>
                                {s.nome} · {new Date(s.created_at).toLocaleString("pt-BR")}
                              </div>
                            </div>
                            <span style={{ color: "#475569", fontSize: 18 }}>{aberto ? "▲" : "▼"}</span>
                          </div>

                          {/* Corpo expandido */}
                          {aberto && (
                            <div style={{ borderTop: "1px solid #1f2d3d", padding: "18px 18px" }}>
                              <div style={{ background: "#0a1118", borderRadius: 10, padding: "14px 16px", color: "#cbd5e1", fontSize: 14, lineHeight: 1.8, whiteSpace: "pre-wrap", marginBottom: 16 }}>
                                {s.mensagem}
                              </div>

                              {/* Ações */}
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                {s.whatsapp && (
                                  <a
                                    href={`https://wa.me/55${s.whatsapp.replace(/\D/g,"")}`}
                                    target="_blank" rel="noreferrer"
                                    style={{ ...btnVerde, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, padding: "7px 14px" }}
                                  >
                                    💬 {s.whatsapp}
                                  </a>
                                )}

                                {s.status !== "em_atendimento" && (
                                  <button onClick={() => atualizarStatus(s.id, "em_atendimento")} style={{ ...btnCinza, color: "#fbbf24", borderColor: "#f59e0b44" }}>
                                    ⏳ Em atendimento
                                  </button>
                                )}
                                {s.status !== "resolvido" && (
                                  <button onClick={() => atualizarStatus(s.id, "resolvido")} style={{ ...btnCinza, color: "#4ade80", borderColor: "#22c55e44" }}>
                                    ✅ Marcar resolvido
                                  </button>
                                )}
                                {s.status !== "aberto" && (
                                  <button onClick={() => atualizarStatus(s.id, "aberto")} style={{ ...btnCinza, color: "#f87171", borderColor: "#ef444444" }}>
                                    ↩ Reabrir
                                  </button>
                                )}
                                <button onClick={() => excluirSolicitacao(s.id)} style={{ ...btnCinza, marginLeft: "auto", color: "#f87171" }}>
                                  🗑️
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          );
        })()}

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
