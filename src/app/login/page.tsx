"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { masterSupabase, db } from "@/lib/supabaseClient";
import { salvarEmpresaId, isConfigurado } from "@/lib/supabaseClient";
import { useIsMobile } from "@/hooks/useIsMobile";

/* ── Tipos ── */
type Tela = "verificando" | "setup" | "login" | "ja_configurado";
type Passo = 1 | 2 | 3 | 4;

/* ── Helpers ── */
function mascararCNPJ(v: string) {
  return v.replace(/\D/g, "").slice(0, 14)
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/\.(\d{3})(\d)/, ".$1.$2")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/\/(\d{4})(\d)/, "/$1-$2");
}
function mascararTel(v: string) {
  return v.replace(/\D/g, "").slice(0, 11)
    .replace(/^(\d{2})(\d)/, "($1) $2")
    .replace(/\) (\d{5})(\d)/, ") $1-$2");
}

/* ══════════════════════════════════════════════════════════ */
export default function LoginPage() {
  const router = useRouter();
  const isMobile = useIsMobile();

  /* ── Controle de tela ── */
  const [tela, setTela] = useState<Tela>("verificando");

  /* ── Passo 1: Código de ativação ── */
  const [passo, setPasso]   = useState<Passo>(1);
  const [codigo, setCodigo] = useState("");
  const [testando, setTestando]       = useState(false);
  const [erroConexao, setErroConexao] = useState("");
  const [nomeEmpresaPronta, setNomeEmpresaPronta] = useState("");
  const refSbUrl = useRef<HTMLInputElement>(null);

  /* ── Passo 2: Dados da empresa ── */
  const [nomeFant, setNomeFant]       = useState("");
  const [cnpj, setCnpj]               = useState("");
  const [telefone, setTelefone]       = useState("");
  const [endereco, setEndereco]       = useState("");
  const [larguraCupom, setLarguraCupom] = useState<58 | 80>(80);

  /* ── Passo 3: Credenciais ADM ── */
  const [adminUser, setAdminUser]     = useState("");
  const [adminNome, setAdminNome]     = useState("");
  const [admSenha, setAdmSenha]       = useState("");
  const [admSenha2, setAdmSenha2]     = useState("");

  /* ── Passo 4: Salvando ── */
  const [salvando, setSalvando]       = useState(false);
  const [erroSalvar, setErroSalvar]   = useState("");
  const [concluido, setConcluido]     = useState(false);

  /* ── Login normal ── */
  const [username, setUsername]       = useState("");
  const [senha, setSenha]             = useState("");
  const [erroLogin, setErroLogin]     = useState("");
  const [showSenha, setShowSenha]     = useState(false);
  const [entrando, setEntrando]       = useState(false);

  /* ── Esqueci minha senha ── */
  type EsqueciEtapa = "fechado" | "usuario" | "nova_senha";
  const [esqueciEtapa, setEsqueciEtapa]   = useState<EsqueciEtapa>("fechado");
  const [esqueciUser, setEsqueciUser]     = useState("");
  const [esqueciNovaSenha, setEsqueciNovaSenha]   = useState("");
  const [esqueciConfirma, setEsqueciConfirma]     = useState("");
  const [esqueciErro, setEsqueciErro]     = useState("");
  const [esqueciOk, setEsqueciOk]         = useState(false);
  const [esqueciCarreg, setEsqueciCarreg] = useState(false);

  async function buscarUsuario() {
    if (!esqueciUser.trim()) { setEsqueciErro("Informe o usuário."); return; }
    setEsqueciCarreg(true); setEsqueciErro("");
    const { data } = await db("operadores").select("id").eq("username", esqueciUser.trim().toLowerCase()).maybeSingle();
    setEsqueciCarreg(false);
    if (!data) { setEsqueciErro("Usuário não encontrado."); return; }
    setEsqueciEtapa("nova_senha");
  }

  async function salvarNovaSenha() {
    if (esqueciNovaSenha.length < 4) { setEsqueciErro("Mínimo 4 caracteres."); return; }
    if (esqueciNovaSenha !== esqueciConfirma) { setEsqueciErro("As senhas não coincidem."); return; }
    setEsqueciCarreg(true); setEsqueciErro("");
    const { error } = await db("operadores").update({ password: esqueciNovaSenha }).eq("username", esqueciUser.trim().toLowerCase());
    setEsqueciCarreg(false);
    if (error) { setEsqueciErro("Erro ao salvar: " + error.message); return; }
    setEsqueciOk(true);
  }

  function fecharEsqueci() {
    setEsqueciEtapa("fechado");
    setEsqueciUser(""); setEsqueciNovaSenha(""); setEsqueciConfirma("");
    setEsqueciErro(""); setEsqueciOk(false); setEsqueciCarreg(false);
  }

  /* ── Detecta se precisa de setup na montagem ── */
  useEffect(() => {
    async function detectar() {
      try {
        if (!isConfigurado()) {
          setTela("setup");
          setTimeout(() => refSbUrl.current?.focus(), 200);
          return;
        }
        const { data } = await db("empresa").select("empresa_id").maybeSingle();
        setTela(data?.empresa_id ? "login" : "setup");
      } catch {
        // Erro de rede ou Supabase — vai para setup para o usuário tentar de novo
        setTela("setup");
      }
    }
    detectar();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Login normal ── */
  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErroLogin("");
    setEntrando(true);
    const { data, error } = await db("operadores")
      .select("id, nome, username, blocked")
      .eq("username", username)
      .eq("password", senha)
      .limit(1)
      .maybeSingle();
    if (error || !data) {
      setErroLogin("Usuário ou senha inválidos.");
      setEntrando(false);
      return;
    }
    if ((data as { blocked?: boolean }).blocked) {
      setErroLogin("Operador bloqueado.");
      setEntrando(false);
      return;
    }
    window.sessionStorage.setItem("operador_logado", JSON.stringify(data));
    router.push("/pdv");
  }

  /* ── Setup: valida código de ativação ── */
  async function ativarCodigo() {
    const cod = codigo.trim().toUpperCase();
    if (!cod) { setErroConexao("Informe o código de ativação."); return; }
    setTestando(true); setErroConexao("");
    try {
      // 1. Valida código
      const { data, error } = await masterSupabase
        .from("clientes_licenciados")
        .select("empresa_id, nome_cliente")
        .eq("codigo", cod)
        .eq("ativo", true)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) { setErroConexao("Código não encontrado ou inativo."); setTestando(false); return; }

      // 2. Salva empresa_id localmente
      salvarEmpresaId(data.empresa_id);

      // 3. Verifica se esse empresa_id já tem configuração completa
      const { data: emp } = await masterSupabase
        .from("empresa")
        .select("nome_fantasia")
        .eq("empresa_id", data.empresa_id)
        .not("nome_fantasia", "is", null)
        .maybeSingle();

      if (emp?.nome_fantasia) {
        // Já configurado: mostra tela de boas-vindas
        setNomeEmpresaPronta(emp.nome_fantasia as string);
        setTela("ja_configurado");
      } else {
        // Ainda não configurado: abre wizard
        setPasso(2);
      }
    } catch (e: unknown) {
      setErroConexao(e instanceof Error ? e.message : String(e));
    } finally { setTestando(false); }
  }

  function validarPasso3(): string {
    if (!adminUser.trim()) return "Informe o usuário ADM.";
    if (!adminNome.trim()) return "Informe o nome do responsável.";
    if (admSenha.length < 4) return "Senha mínima de 4 caracteres.";
    if (admSenha !== admSenha2) return "As senhas não coincidem.";
    return "";
  }

  async function salvarTudo() {
    const errV = validarPasso3();
    if (errV) { setErroSalvar(errV); return; }
    if (!nomeFant.trim()) { setErroSalvar("Informe o nome da empresa."); return; }
    setSalvando(true); setErroSalvar("");
    try {
      // Empresa: atualiza se já existe, insere se não
      const { data: empExist } = await db("empresa").select("empresa_id").maybeSingle();
      if (empExist) {
        await db("empresa").update({
          nome_fantasia: nomeFant.trim(),
          cnpj:          cnpj.replace(/\D/g, "") || null,
          telefone:      telefone.replace(/\D/g, "") || null,
          endereco:      endereco.trim() || null,
          cupom_largura: larguraCupom,
        });
      } else {
        const { error: eEmp } = await db("empresa").insert([{
          nome_fantasia: nomeFant.trim(),
          cnpj:          cnpj.replace(/\D/g, "") || null,
          telefone:      telefone.replace(/\D/g, "") || null,
          endereco:      endereco.trim() || null,
          cupom_largura: larguraCupom,
        }]);
        if (eEmp) throw new Error(eEmp.message);
      }

      // Senhas: atualiza se já existe, insere se não
      const { data: senhaExist } = await db("senhas_operacionais").select("id").maybeSingle();
      if (senhaExist) {
        await db("senhas_operacionais").update({ adm_password: admSenha });
      } else {
        await db("senhas_operacionais").insert([{ adm_password: admSenha }]);
      }

      // Operador ADM: insere se não existir
      const { error: eOp } = await db("operadores").insert([{
        username: adminUser.trim().toLowerCase(),
        nome:     adminNome.trim(),
        password: admSenha,
        blocked:  false,
        perm_finalizar: true, perm_cancelar_item: true, perm_cancelar_venda: true,
        perm_sangria: true, perm_relatorios: true, perm_desconto: true, perm_buscar_cupons: true,
      }]);
      if (eOp && !eOp.message.includes("duplicate")) throw new Error(eOp.message);
      setConcluido(true);
    } catch (e: unknown) {
      setErroSalvar(e instanceof Error ? e.message : String(e));
    } finally { setSalvando(false); }
  }

  /* ── Estilos comuns ── */
  const inp: React.CSSProperties = {
    width: "100%", height: isMobile ? 54 : 48, borderRadius: 12, border: "1px solid #d1d5db",
    padding: "0 16px", fontSize: 16, outline: "none", color: "#111827", background: "#fff",
    boxSizing: "border-box",
  };
  const lbl: React.CSSProperties = {
    display: "block", fontWeight: 700, fontSize: isMobile ? 15 : 13, color: "#374151", marginBottom: 6,
  };
  const btnP: React.CSSProperties = {
    width: "100%", height: isMobile ? 56 : 52, border: "none", borderRadius: 14,
    background: "#15803d", color: "#fff", fontWeight: 900, fontSize: isMobile ? 18 : 16, cursor: "pointer",
  };
  const btnS: React.CSSProperties = {
    width: "100%", height: isMobile ? 56 : 52, border: "1px solid #d1d5db", borderRadius: 14,
    background: "#f9fafb", color: "#374151", fontWeight: 700, fontSize: isMobile ? 16 : 15, cursor: "pointer",
  };
  const indicador = (n: number) => ({
    width: 32, height: 32, borderRadius: "50%",
    display: "flex" as const, alignItems: "center" as const, justifyContent: "center" as const,
    fontWeight: 900, fontSize: 14,
    background: passo > n ? "#15803d" : passo === n ? "#1fb14e" : "#e5e7eb",
    color: passo >= n ? "#fff" : "#9ca3af",
  });

  /* ── Tela de verificação ── */
  if (tela === "verificando") {
    return (
      <main style={{ minHeight: "100vh", background: "#0c121a", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "#1faa4a", fontSize: 22, fontFamily: "Segoe UI, sans-serif", fontWeight: 900 }}>
          HORTI GESTÃO…
        </div>
      </main>
    );
  }

  /* ── Tela: já configurado (boas-vindas) ── */
  if (tela === "ja_configurado") {
    return (
      <main style={{ minHeight: "100vh", background: "#f3f5f7", display: "grid", placeItems: "center", padding: isMobile ? "12px 10px" : 20 }}>
        <div style={{ width: "100%", maxWidth: 460, background: "#fff", border: "1px solid #dde3ea", borderRadius: 28, padding: isMobile ? "28px 20px" : 36, boxShadow: "0 12px 30px rgba(15,23,42,.06)", textAlign: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="logo" style={{ width: isMobile ? 80 : 72, height: isMobile ? 80 : 72, marginBottom: 16 }} />
          <div style={{ fontSize: isMobile ? 32 : 28, fontWeight: 900, color: "#11243d" }}>Tudo pronto! 🎉</div>
          <div style={{ fontSize: isMobile ? 22 : 20, fontWeight: 700, color: "#1fb14e", marginTop: 8 }}>
            {nomeEmpresaPronta}
          </div>
          <div style={{ color: "#66758a", marginTop: 12, marginBottom: 28, fontSize: isMobile ? 17 : 16, lineHeight: 1.6 }}>
            Cadastro já configurado.<br />Boas vendas!
          </div>
          <button
            onClick={() => router.push("/")}
            style={{ width: "100%", background: "linear-gradient(135deg,#25c15c,#1a9e49)", color: "#fff", border: "none", borderRadius: 16, padding: `${isMobile ? 18 : 14}px 0`, fontSize: isMobile ? 19 : 17, fontWeight: 800, cursor: "pointer" }}
          >
            Ir para o sistema →
          </button>
        </div>
      </main>
    );
  }

  /* ── Tela de login normal ── */
  if (tela === "login") {
    return (
      <main style={{ minHeight: "100vh", background: "#f3f5f7", display: "grid", placeItems: "center", padding: isMobile ? "12px 10px" : 20 }}>
        <div style={{ width: "100%", maxWidth: 460, background: "#fff", border: "1px solid #dde3ea", borderRadius: 28, padding: isMobile ? "28px 20px" : 28, boxShadow: "0 12px 30px rgba(15,23,42,.06)" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="logo" style={{ width: isMobile ? 72 : 56, height: isMobile ? 72 : 56, marginBottom: 12 }} />
          <div style={{ fontSize: isMobile ? 36 : 32, fontWeight: 900, color: "#11243d", marginTop: 4 }}>Entrar no PDV</div>
          <div style={{ color: "#66758a", marginTop: 6, marginBottom: isMobile ? 24 : 18, fontSize: isMobile ? 16 : 14 }}>Informe suas credenciais de operador.</div>
          <form onSubmit={entrar}>
            <label style={{ display: "block", fontWeight: 800, color: "#1d3049", fontSize: isMobile ? 16 : 15, marginBottom: 6 }}>Usuário</label>
            <input style={{ ...inp, marginBottom: isMobile ? 18 : 14 }} value={username} onChange={e => setUsername(e.target.value)} placeholder="usuário" autoFocus autoComplete="username" />
            <label style={{ display: "block", fontWeight: 800, color: "#1d3049", fontSize: isMobile ? 16 : 15, marginBottom: 6 }}>Senha</label>
            <div style={{ position: "relative", marginBottom: 8 }}>
              <input style={{ ...inp, paddingRight: 56 }} type={showSenha ? "text" : "password"} value={senha} onChange={e => setSenha(e.target.value)} placeholder="senha" autoComplete="current-password" />
              <button type="button" onClick={() => setShowSenha(!showSenha)}
                style={{ position: "absolute", right: 10, top: isMobile ? 10 : 8, height: isMobile ? 36 : 32, width: isMobile ? 36 : 32, borderRadius: 8, border: "1px solid #dbe2ea", background: "#fff", cursor: "pointer", fontSize: isMobile ? 18 : 15 }}>
                {showSenha ? "🙈" : "👁"}
              </button>
            </div>
            {erroLogin && (
              <div style={{ marginBottom: 12, color: "#991b1b", background: "#fef2f2", border: "1px solid #fecaca", padding: "12px 16px", borderRadius: 12, fontWeight: 700, fontSize: isMobile ? 15 : 14 }}>
                {erroLogin}
              </div>
            )}
            <button type="submit" disabled={entrando} style={{ ...btnP, marginTop: 12 }}>
              {entrando ? "Entrando..." : "→ Entrar"}
            </button>
            <button type="button" onClick={() => { setEsqueciEtapa("usuario"); setEsqueciErro(""); }}
              style={{ width: "100%", background: "none", border: "none", color: "#6b7280", fontSize: isMobile ? 15 : 13, marginTop: 16, cursor: "pointer", textDecoration: "underline", padding: "8px 0" }}>
              Esqueci minha senha
            </button>
          </form>
        </div>

        {/* ── Modal Esqueci minha senha ── */}
        {esqueciEtapa !== "fechado" && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center", zIndex: 999, padding: isMobile ? 0 : 20 }}>
            <div style={{ background: "#fff", borderRadius: isMobile ? "24px 24px 0 0" : 20, padding: isMobile ? "28px 20px 36px" : 28, width: "100%", maxWidth: isMobile ? "100%" : 400, boxShadow: "0 20px 60px rgba(0,0,0,.2)" }}>
              {esqueciOk ? (
                <>
                  <div style={{ textAlign: "center", fontSize: 56, marginBottom: 12 }}>✅</div>
                  <div style={{ fontWeight: 900, fontSize: isMobile ? 20 : 18, color: "#14532d", textAlign: "center", marginBottom: 8 }}>Senha alterada!</div>
                  <div style={{ color: "#4b5563", fontSize: isMobile ? 15 : 14, textAlign: "center", marginBottom: 24, lineHeight: 1.6 }}>
                    A senha do usuário <strong>{esqueciUser}</strong> foi atualizada com sucesso.
                  </div>
                  <button onClick={fecharEsqueci} style={{ ...btnP }}>Fazer login →</button>
                </>
              ) : esqueciEtapa === "usuario" ? (
                <>
                  <div style={{ fontWeight: 900, fontSize: isMobile ? 20 : 17, color: "#111827", marginBottom: 6 }}>🔑 Redefinir senha</div>
                  <div style={{ color: "#6b7280", fontSize: isMobile ? 15 : 13, marginBottom: 20 }}>Informe o usuário para continuar.</div>
                  <label style={lbl}>Usuário</label>
                  <input autoFocus value={esqueciUser} onChange={e => setEsqueciUser(e.target.value.toLowerCase().replace(/\s/g, ""))}
                    placeholder="ex: admin"
                    style={{ ...inp, marginBottom: 12 }}
                    onKeyDown={e => e.key === "Enter" && buscarUsuario()} />
                  {esqueciErro && <div style={{ color: "#dc2626", fontSize: isMobile ? 15 : 13, marginBottom: 12, fontWeight: 600 }}>{esqueciErro}</div>}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
                    <button onClick={fecharEsqueci} style={btnS}>Cancelar</button>
                    <button onClick={buscarUsuario} disabled={esqueciCarreg} style={btnP}>{esqueciCarreg ? "Buscando..." : "Continuar →"}</button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontWeight: 900, fontSize: isMobile ? 20 : 17, color: "#111827", marginBottom: 6 }}>🔒 Nova senha</div>
                  <div style={{ color: "#6b7280", fontSize: isMobile ? 15 : 13, marginBottom: 20 }}>
                    Usuário: <strong>{esqueciUser}</strong>
                  </div>
                  <label style={lbl}>Nova senha</label>
                  <input autoFocus type="password" value={esqueciNovaSenha} onChange={e => setEsqueciNovaSenha(e.target.value)}
                    placeholder="Mínimo 4 caracteres" style={{ ...inp, marginBottom: isMobile ? 18 : 14 }} />
                  <label style={lbl}>Confirmar nova senha</label>
                  <input type="password" value={esqueciConfirma} onChange={e => setEsqueciConfirma(e.target.value)}
                    placeholder="Repita a senha" style={{ ...inp, marginBottom: 12 }}
                    onKeyDown={e => e.key === "Enter" && salvarNovaSenha()} />
                  {esqueciErro && <div style={{ color: "#dc2626", fontSize: isMobile ? 15 : 13, marginBottom: 12, fontWeight: 600 }}>{esqueciErro}</div>}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
                    <button onClick={() => setEsqueciEtapa("usuario")} style={btnS}>← Voltar</button>
                    <button onClick={salvarNovaSenha} disabled={esqueciCarreg} style={btnP}>{esqueciCarreg ? "Salvando..." : "Salvar ✔"}</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </main>
    );
  }

  /* ── Tela de setup ── */
  const gap = isMobile ? 16 : 14;
  return (
    <main style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 50%, #bbf7d0 100%)",
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      padding: isMobile ? "20px 10px 40px" : 20, fontFamily: "Segoe UI, Arial, sans-serif",
    }}>
      <div style={{ width: "100%", maxWidth: 520 }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: isMobile ? 20 : 28 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="Horti Gestão" style={{ width: isMobile ? 88 : 80, height: isMobile ? 88 : 80, marginBottom: 12 }} />
          <div style={{ fontSize: isMobile ? 28 : 26, fontWeight: 900, color: "#14532d" }}>Horti Gestão PDV</div>
          <div style={{ color: "#16a34a", fontSize: isMobile ? 16 : 15, marginTop: 4 }}>Configuração inicial do sistema</div>
        </div>

        {/* Indicador de passos */}
        {!concluido && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0, marginBottom: isMobile ? 20 : 24 }}>
            {[1, 2, 3].map((n, i) => (
              <div key={n} style={{ display: "flex", alignItems: "center" }}>
                <div style={{ ...indicador(n), width: isMobile ? 36 : 32, height: isMobile ? 36 : 32, fontSize: isMobile ? 16 : 14 }}>{passo > n ? "✓" : n}</div>
                {i < 2 && <div style={{ width: isMobile ? 48 : 60, height: 2, background: passo > n ? "#15803d" : "#e5e7eb" }} />}
              </div>
            ))}
          </div>
        )}

        {/* Card */}
        <div style={{ background: "#fff", borderRadius: isMobile ? 24 : 20, padding: isMobile ? "24px 18px" : 28, boxShadow: "0 12px 40px rgba(0,0,0,.08)", border: "1px solid rgba(21,128,61,.1)" }}>

          {/* PASSO 1 */}
          {passo === 1 && !concluido && (
            <>
              <div style={{ fontWeight: 900, fontSize: isMobile ? 22 : 18, color: "#0f172a", marginBottom: 6 }}>🔑 Código de ativação</div>
              <div style={{ color: "#64748b", fontSize: isMobile ? 15 : 13, marginBottom: 20, lineHeight: 1.7 }}>
                Insira o código fornecido pela Horti Gestão para ativar o sistema.
              </div>
              <label style={lbl}>Código de ativação</label>
              <input
                ref={refSbUrl}
                value={codigo}
                onChange={e => setCodigo(e.target.value.toUpperCase())}
                placeholder="ex: JOAO2025"
                autoCapitalize="characters"
                style={{ ...inp, marginBottom: 10, fontSize: isMobile ? 24 : 20, fontWeight: 800, letterSpacing: 4, textAlign: "center" }}
                onKeyDown={e => e.key === "Enter" && ativarCodigo()}
              />
              {erroConexao && <div style={{ color: "#dc2626", fontSize: isMobile ? 15 : 13, marginBottom: 12, fontWeight: 600 }}>{erroConexao}</div>}
              <div style={{ marginTop: 18 }}>
                <button onClick={ativarCodigo} disabled={testando} style={btnP}>
                  {testando ? "Verificando código..." : "Ativar →"}
                </button>
              </div>
            </>
          )}

          {/* PASSO 2 */}
          {passo === 2 && !concluido && (
            <>
              <div style={{ fontWeight: 900, fontSize: isMobile ? 22 : 18, color: "#0f172a", marginBottom: 6 }}>🏪 Dados do estabelecimento</div>
              <div style={{ color: "#64748b", fontSize: isMobile ? 15 : 13, marginBottom: 20, lineHeight: 1.6 }}>Estas informações aparecem no cupom fiscal e nos relatórios.</div>
              <label style={lbl}>Nome fantasia *</label>
              <input value={nomeFant} onChange={e => setNomeFant(e.target.value)} placeholder="Ex: Hortifruti do João" autoFocus style={{ ...inp, marginBottom: gap }} />
              <label style={lbl}>CNPJ</label>
              <input value={cnpj} onChange={e => setCnpj(mascararCNPJ(e.target.value))} placeholder="00.000.000/0001-00" inputMode="numeric" style={{ ...inp, marginBottom: gap }} />
              <label style={lbl}>Telefone</label>
              <input value={telefone} onChange={e => setTelefone(mascararTel(e.target.value))} placeholder="(00) 00000-0000" inputMode="tel" style={{ ...inp, marginBottom: gap }} />
              <label style={lbl}>Endereço</label>
              <input value={endereco} onChange={e => setEndereco(e.target.value)} placeholder="Rua, número, bairro, cidade" style={{ ...inp, marginBottom: gap }} />
              <label style={lbl}>Largura da impressora térmica</label>
              <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                {([58, 80] as const).map(mm => (
                  <button key={mm} type="button" onClick={() => setLarguraCupom(mm)} style={{
                    flex: 1, height: isMobile ? 52 : 44, borderRadius: 12, border: "2px solid",
                    borderColor: larguraCupom === mm ? "#15803d" : "#e2e8f0",
                    background:  larguraCupom === mm ? "#f0fdf4" : "#f9fafb",
                    color:       larguraCupom === mm ? "#15803d" : "#64748b",
                    fontWeight: 800, fontSize: isMobile ? 17 : 15, cursor: "pointer",
                  }}>{mm}mm</button>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <button onClick={() => setPasso(1)} style={btnS}>← Voltar</button>
                <button onClick={() => { if (!nomeFant.trim()) return; setPasso(3); }} style={btnP}>Continuar →</button>
              </div>
            </>
          )}

          {/* PASSO 3 */}
          {passo === 3 && !concluido && (
            <>
              <div style={{ fontWeight: 900, fontSize: isMobile ? 22 : 18, color: "#0f172a", marginBottom: 6 }}>🔑 Acesso do administrador</div>
              <div style={{ color: "#64748b", fontSize: isMobile ? 15 : 13, marginBottom: 20, lineHeight: 1.6 }}>Crie o usuário principal do sistema. Guarde bem essa senha.</div>
              <label style={lbl}>Usuário (login) *</label>
              <input value={adminUser} onChange={e => setAdminUser(e.target.value.toLowerCase().replace(/\s/g, ""))} placeholder="admin" autoFocus style={{ ...inp, marginBottom: gap }} />
              <label style={lbl}>Nome completo *</label>
              <input value={adminNome} onChange={e => setAdminNome(e.target.value)} placeholder="João da Silva" style={{ ...inp, marginBottom: gap }} />
              <label style={lbl}>Senha ADM *</label>
              <input type="password" value={admSenha} onChange={e => setAdmSenha(e.target.value)} placeholder="Mínimo 4 caracteres" style={{ ...inp, marginBottom: gap }} />
              <label style={lbl}>Confirmar senha *</label>
              <input type="password" value={admSenha2} onChange={e => setAdmSenha2(e.target.value)} placeholder="Repita a senha" style={{ ...inp, marginBottom: 10 }} onKeyDown={e => e.key === "Enter" && salvarTudo()} />
              {erroSalvar && <div style={{ color: "#dc2626", fontSize: isMobile ? 15 : 13, marginBottom: 12, fontWeight: 600 }}>{erroSalvar}</div>}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
                <button onClick={() => setPasso(2)} style={btnS}>← Voltar</button>
                <button onClick={salvarTudo} disabled={salvando} style={btnP}>{salvando ? "Configurando..." : "✔ Finalizar"}</button>
              </div>
            </>
          )}

          {/* CONCLUÍDO */}
          {concluido && (
            <div style={{ textAlign: "center", padding: "8px 0" }}>
              <div style={{ fontSize: isMobile ? 72 : 64, marginBottom: 16 }}>🎉</div>
              <div style={{ fontWeight: 900, fontSize: isMobile ? 26 : 22, color: "#14532d", marginBottom: 10 }}>Sistema configurado!</div>
              <div style={{ color: "#16a34a", fontSize: isMobile ? 17 : 15, marginBottom: 28, lineHeight: 1.7 }}>
                <strong>{nomeFant}</strong> está pronto para usar.<br />
                Faça login com o usuário <strong>{adminUser}</strong>.
              </div>
              <button onClick={() => setTela("login")} style={btnP}>🚀 Ir para o login</button>
            </div>
          )}

        </div>
        <div style={{ textAlign: "center", marginTop: 14, color: "#86efac", fontSize: 12 }}>
          Horti Gestão PDV © {new Date().getFullYear()}
        </div>
      </div>
    </main>
  );
}
