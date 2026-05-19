'use client';

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import HeaderCebolao from "@/components/HeaderCebolao";
import { supabase, db, isConfigurado } from "@/lib/supabaseClient";
import { useIsMobile } from "@/hooks/useIsMobile";
import { gerarChave } from "@/lib/licenca";

const MASTER_USERNAME = "jeansilva3323@gmail.com";

const SENHA_PADRAO = "1234";
const SENHA_MASTER = "D@na2014";

type Empresa = {
  id?: string;
  empresa_id?: number;
  nome_fantasia?: string | null;
  logo_url?: string | null;
  cnpj?: string | null;
  telefone?: string | null;
  endereco?: string | null;
  cupom_largura?: number | null;
  cupom_cabecalho?: string | null;
  cupom_rodape?: string | null;
};

type Operador = {
  id: string;
  nome?: string | null;
  username: string;
  blocked?: boolean | null;
  perm_finalizar?:      boolean | null;
  perm_cancelar_item?:  boolean | null;
  perm_cancelar_venda?: boolean | null;
  perm_sangria?:        boolean | null;
  perm_relatorios?:     boolean | null;
  perm_desconto?:       boolean | null;
  perm_buscar_cupons?:  boolean | null;
};

type Produto = {
  id: string;
  nome: string;
  preco: number | null;
  preco_cartao: number | null;
};

type Venda = {
  id: string;
  total: number | null;
  tipo_pagamento: string | null;
  created_at: string;
};

type Cancelado = {
  id: string;
  motivo?: string | null;
  created_at: string;
  operador?: string | null;
  produto_nome?: string | null;
  total?: number | null;
};

type SenhasOperacionais = {
  id?: string;
  adm_password?: string | null;
  senha_cancelar_item?: string | null;
  senha_cancelar_venda?: string | null;
  senha_sangria?: string | null;
  senha_suprimento?: string | null;
  senha_alterar_preco?: string | null;
  senha_reabrir_caixa?: string | null;
};

type CategoriaProduto = {
  id: string;
  nome: string;
};

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

function moeda(v: number | null | undefined) {
  return `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;
}

export default function AdmPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [aba, setAba] = useState("config");
  const isDev = (() => {
    if (typeof window === "undefined") return false;
    try {
      const op = JSON.parse(sessionStorage.getItem("operador_logado") || "{}");
      return (op.username ?? "").toLowerCase() === MASTER_USERNAME.toLowerCase();
    } catch { return false; }
  })();
  const [senha, setSenha] = useState("");
  const [liberado, setLiberado] = useState(false);
  const [erro, setErro] = useState("");
  const [msg, setMsg] = useState("");
  const [logoNomeArquivo, setLogoNomeArquivo] = useState("");

  const [empresa, setEmpresa] = useState<Empresa>({});
  const [operadores, setOperadores] = useState<Operador[]>([]);
  const [vendas, setVendas] = useState<Venda[]>([]);
  const [itensCancelados, setItensCancelados] = useState<Cancelado[]>([]);
  const [cuponsCancelados, setCuponsCancelados] = useState<Cancelado[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [produtoBusca, setProdutoBusca] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");

  const permPadrao = {
    perm_finalizar: true, perm_cancelar_item: true, perm_cancelar_venda: true,
    perm_sangria: true, perm_relatorios: true, perm_desconto: true, perm_buscar_cupons: true,
  };
  const [novoOperador, setNovoOperador] = useState({ nome: "", username: "", password: "", confirm: "", ...permPadrao });
  const [editandoOpId, setEditandoOpId] = useState<string | null>(null);
  const [showSenha1, setShowSenha1] = useState(false);
  const [showSenha2, setShowSenha2] = useState(false);
  const [categoriasProduto, setCategoriasProduto] = useState<CategoriaProduto[]>([]);
  const [novaCategoria, setNovaCategoria] = useState("");
  const [qtdEtiquetas, setQtdEtiquetas] = useState(1);
  const [larguraEtiqueta, setLarguraEtiqueta] = useState<58 | 80>(58);

  // ── Abrir PDV ───────────────────────────────────────────────────────────────
  const [modalDownloadPDV, setModalDownloadPDV] = useState(false);
  const [urlDownloadPDV, setUrlDownloadPDV] = useState("https://github.com/jsilvacps/horti-gestao/releases/latest");

  function abrirCaixaPDV() {
    let abriu = false;
    const onBlur = () => { abriu = true; window.removeEventListener("blur", onBlur); };
    window.addEventListener("blur", onBlur);
    window.location.href = "hortigestao://open";
    setTimeout(() => {
      window.removeEventListener("blur", onBlur);
      if (!abriu) {
        // Busca URL do instalador mais recente
        fetch("https://horti-gestao.vercel.app/version.json")
          .then(r => r.json())
          .then(j => { if (j.download) setUrlDownloadPDV(j.download); })
          .catch(() => {});
        setModalDownloadPDV(true);
      }
    }, 800);
  }

  // ── Licenças ────────────────────────────────────────────────────────────────
  const [licencas, setLicencas] = useState<Licenca[]>([]);
  const [novaLicCliente, setNovaLicCliente] = useState("");
  const [novaLicNotas, setNovaLicNotas] = useState("");
  const [novaLicQtd, setNovaLicQtd] = useState(1);
  const [licencasGeradas, setLicencasGeradas] = useState<string[]>([]);
  const [licCopied, setLicCopied] = useState(false);

  const [senhasOp, setSenhasOp] = useState<SenhasOperacionais>({
    adm_password: SENHA_PADRAO,
    senha_cancelar_item: "",
    senha_cancelar_venda: "",
    senha_sangria: "",
    senha_suprimento: "",
    senha_alterar_preco: "",
    senha_reabrir_caixa: "",
  });

  // Carrega apenas o essencial na abertura (empresa, operadores, senhas, categorias)
  const carregarTudo = useCallback(async () => {
    const [{ data: empresaData }, { data: opData }, { data: senhasData }, { data: categoriasData }] = await Promise.all([
      db("empresa").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      db("operadores").select("id, nome, username, blocked, perm_finalizar, perm_cancelar_item, perm_cancelar_venda, perm_sangria, perm_relatorios, perm_desconto, perm_buscar_cupons").order("username", { ascending: true }),
      db("senhas_operacionais").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      db("categorias_produto").select("id, nome").order("nome", { ascending: true }),
    ]);
    if (empresaData) setEmpresa(empresaData as Empresa);
    setOperadores((opData || []) as Operador[]);
    setCategoriasProduto((categoriasData || []) as CategoriaProduto[]);
    if (senhasData) setSenhasOp(senhasData as SenhasOperacionais);
  }, []);

  // Carrega relatórios e cancelamentos só quando a aba for aberta (lazy)
  const carregarRelatorios = useCallback(async () => {
    const inicio = dataInicio || new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const fim    = dataFim    || new Date().toISOString().slice(0, 10);
    const [{ data: vendasData }, { data: itensData }, { data: cuponsData }] = await Promise.all([
      db("vendas").select("id, total, tipo_pagamento, created_at")
        .gte("created_at", inicio).lte("created_at", fim + "T23:59:59")
        .order("created_at", { ascending: false }).limit(500),
      db("itens_cancelados").select("*")
        .gte("created_at", inicio).lte("created_at", fim + "T23:59:59")
        .order("created_at", { ascending: false }).limit(500),
      db("cupons_cancelados").select("*")
        .gte("created_at", inicio).lte("created_at", fim + "T23:59:59")
        .order("created_at", { ascending: false }).limit(500),
    ]);
    setVendas((vendasData || []) as Venda[]);
    setItensCancelados((itensData || []) as Cancelado[]);
    setCuponsCancelados((cuponsData || []) as Cancelado[]);
  }, [dataInicio, dataFim]);

  // Carrega produtos só quando a aba etiquetas for aberta (lazy)
  const carregarProdutos = useCallback(async () => {
    const { data } = await db("produtos").select("id, nome, preco, preco_cartao").order("nome", { ascending: true }).limit(1000);
    setProdutos((data || []) as Produto[]);
  }, []);

  useEffect(() => {
    if (!isConfigurado()) { router.replace("/login"); return; }
    const ok = typeof window !== "undefined" ? window.sessionStorage.getItem("adm_gerencial_ok") : null;
    if (ok === "1") setLiberado(true);
    carregarTudo();
  }, [carregarTudo, router]);

  // Lazy: carrega dados pesados só quando a aba é aberta pela primeira vez
  const [abasCarregadas, setAbasCarregadas] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!liberado) return;
    if ((aba === "relatorios") && !abasCarregadas.has("relatorios")) {
      setAbasCarregadas((s) => new Set(s).add("relatorios"));
      carregarRelatorios();
    }
    if ((aba === "etiquetas") && !abasCarregadas.has("etiquetas")) {
      setAbasCarregadas((s) => new Set(s).add("etiquetas"));
      carregarProdutos();
    }
  }, [aba, liberado, abasCarregadas, carregarRelatorios, carregarProdutos]);

  async function adicionarCategoria(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const nome = novaCategoria.trim();
    if (!nome) {
      setMsg("Digite o nome da categoria.");
      return;
    }
    const { error } = await db("categorias_produto").insert([{ nome }]);
    if (error) {
      setMsg("Erro ao salvar categoria: " + error.message);
      return;
    }
    setNovaCategoria("");
    setMsg("Categoria salva com sucesso.");
    carregarTudo();
  }

  async function excluirCategoria(id: string) {
    const { error } = await db("categorias_produto").delete().eq("id", id);
    if (error) {
      setMsg("Erro ao excluir categoria: " + error.message);
      return;
    }
    setMsg("Categoria excluída com sucesso.");
    carregarTudo();
  }

  // ── Handlers de licenças ──────────────────────────────────────────────────

  const carregarLicencas = useCallback(async () => {
    const { data } = await supabase
      .from("licencas")
      .select("id, chave, plano, cliente, ativo, ativado_em, validade, criado_em, notas")
      .order("criado_em", { ascending: false });
    setLicencas((data || []) as Licenca[]);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (aba === "licencas") carregarLicencas();
  }, [aba, carregarLicencas]);

  async function gerarNovasChaves(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const qtd = Math.max(1, Math.min(50, novaLicQtd));
    const novas: { chave: string; plano: string; cliente: string | null; notas: string | null; ativo: boolean }[] = [];
    for (let i = 0; i < qtd; i++) {
      novas.push({
        chave:   gerarChave(),
        plano:   "pro",
        cliente: novaLicCliente.trim() || null,
        notas:   novaLicNotas.trim() || null,
        ativo:   true,
      });
    }
    const { error } = await supabase.from("licencas").insert(novas);
    if (error) {
      setMsg("Erro ao gerar chaves: " + error.message);
      return;
    }
    setLicencasGeradas(novas.map((n) => n.chave));
    setNovaLicCliente("");
    setNovaLicNotas("");
    setNovaLicQtd(1);
    setMsg(`${qtd} chave(s) gerada(s) com sucesso!`);
    carregarLicencas();
  }

  async function revogarLicenca(id: string) {
    if (!confirm("Revogar esta chave? O cliente perderá o acesso.")) return;
    const { error } = await supabase.from("licencas").update({ ativo: false }).eq("id", id);
    if (error) { setMsg("Erro ao revogar: " + error.message); return; }
    setMsg("Chave revogada.");
    carregarLicencas();
  }

  async function reativarLicenca(id: string) {
    const { error } = await supabase.from("licencas").update({ ativo: true }).eq("id", id);
    if (error) { setMsg("Erro ao reativar: " + error.message); return; }
    setMsg("Chave reativada.");
    carregarLicencas();
  }

  async function excluirLicenca(id: string) {
    if (!confirm("Excluir permanentemente esta chave?")) return;
    const { error } = await supabase.from("licencas").delete().eq("id", id);
    if (error) { setMsg("Erro ao excluir: " + error.message); return; }
    carregarLicencas();
  }

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    const senhaAtual = senhasOp.adm_password || SENHA_PADRAO;
    if (senha === senhaAtual || senha === SENHA_MASTER) {
      setLiberado(true);
      if (typeof window !== "undefined") window.sessionStorage.setItem("adm_gerencial_ok", "1");
      return;
    }
    setErro("Senha gerencial inválida.");
  }

  function sair() {
    setLiberado(false);
    setSenha("");
    if (typeof window !== "undefined") window.sessionStorage.removeItem("adm_gerencial_ok");
  }

  async function salvarEmpresa(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    // upsert garante que funciona tanto na criação quanto na atualização
    const { error } = await db("empresa").upsert([empresa], { onConflict: "empresa_id" });
    if (!error) setMsg("Configuração da empresa salva.");
    carregarTudo();
  }

  function handleLogoFile(event: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = event.target.files?.[0];
    if (!arquivo) return;

    setLogoNomeArquivo(arquivo.name);

    const reader = new FileReader();
    reader.onload = () => {
      const resultado = typeof reader.result === "string" ? reader.result : "";
      setEmpresa((prev) => ({ ...prev, logo_url: resultado }));
      setMsg("Logo carregada. Clique em salvar configuração para aplicar.");
    };
    reader.onerror = () => {
      setMsg("Não foi possível ler a imagem selecionada.");
    };
    reader.readAsDataURL(arquivo);
  }

  function abrirEdicaoOp(op: Operador) {
    setEditandoOpId(op.id);
    setNovoOperador({
      nome: op.nome || "", username: op.username, password: "", confirm: "",
      perm_finalizar:      op.perm_finalizar      ?? true,
      perm_cancelar_item:  op.perm_cancelar_item  ?? true,
      perm_cancelar_venda: op.perm_cancelar_venda ?? true,
      perm_sangria:        op.perm_sangria        ?? true,
      perm_relatorios:     op.perm_relatorios     ?? true,
      perm_desconto:       op.perm_desconto       ?? true,
      perm_buscar_cupons:  op.perm_buscar_cupons  ?? true,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelarEdicaoOp() {
    setEditandoOpId(null);
    setNovoOperador({ nome: "", username: "", password: "", confirm: "", ...permPadrao });
  }

  async function salvarOperador(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    if (!novoOperador.username) { setMsg("Preencha o usuário."); return; }
    if (!editandoOpId && !novoOperador.password) { setMsg("Preencha a senha."); return; }
    if (novoOperador.password && novoOperador.password !== novoOperador.confirm) {
      setMsg("Senha e confirmação não conferem."); return;
    }

    const perms = {
      perm_finalizar:      novoOperador.perm_finalizar,
      perm_cancelar_item:  novoOperador.perm_cancelar_item,
      perm_cancelar_venda: novoOperador.perm_cancelar_venda,
      perm_sangria:        novoOperador.perm_sangria,
      perm_relatorios:     novoOperador.perm_relatorios,
      perm_desconto:       novoOperador.perm_desconto,
      perm_buscar_cupons:  novoOperador.perm_buscar_cupons,
    };

    if (editandoOpId) {
      const payload: Record<string, unknown> = {
        nome: novoOperador.nome || novoOperador.username,
        username: novoOperador.username,
        ...perms,
      };
      if (novoOperador.password) payload.password = novoOperador.password;
      const { error } = await db("operadores").update(payload).eq("id", editandoOpId);
      if (error) { setMsg("Erro ao atualizar: " + error.message); return; }
      setMsg("Operador atualizado.");
      cancelarEdicaoOp();
    } else {
      const { error } = await db("operadores").insert([{
        nome: novoOperador.nome || novoOperador.username,
        username: novoOperador.username,
        password: novoOperador.password,
        blocked: false,
        ...perms,
      }]);
      if (error) { setMsg("Erro ao salvar operador: " + error.message); return; }
      setNovoOperador({ nome: "", username: "", password: "", confirm: "", ...permPadrao });
      setMsg("Operador salvo com sucesso.");
    }
    carregarTudo();
  }

  async function toggleOperador(id: string, blocked: boolean | null | undefined) {
    const { error } = await db("operadores").update({ blocked: !blocked }).eq("id", id);
    if (!error) {
      setMsg(!blocked ? "Operador bloqueado." : "Operador desbloqueado.");
      carregarTudo();
    }
  }

  async function salvarSenhas(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    if (senhasOp.id) {
      const { error } = await db("senhas_operacionais").update(senhasOp).eq("id", senhasOp.id);
      if (!error) setMsg("Senhas operacionais salvas.");
    } else {
      const { error } = await db("senhas_operacionais").insert([senhasOp]);
      if (!error) setMsg("Senhas operacionais salvas.");
    }
    carregarTudo();
  }

  const vendasFiltradas = useMemo(() => {
    return vendas.filter((v) => {
      const dt = new Date(v.created_at);
      const ini = dataInicio ? new Date(dataInicio + "T00:00:00") : null;
      const fim = dataFim ? new Date(dataFim + "T23:59:59") : null;
      return (!ini || dt >= ini) && (!fim || dt <= fim);
    });
  }, [vendas, dataInicio, dataFim]);

  const produtoEtiqueta = useMemo(() => {
    const termo = produtoBusca.trim().toLowerCase();
    if (!termo) return null;
    return produtos.find((p) => p.nome.toLowerCase().includes(termo)) || null;
  }, [produtos, produtoBusca]);

  if (!liberado) {
    return (
      <main style={{ minHeight: "100vh", background: "#f3f5f7", display: "grid", placeItems: "center", padding: 20 }}>
        <div style={{ width: "100%", maxWidth: 480, background: "#fff", border: "1px solid #dde3ea", borderRadius: 28, boxShadow: "0 12px 30px rgba(15,23,42,.06)", padding: 28 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#6b7280" }}>Horti Gestão</div>
          <div style={{ fontSize: 34, fontWeight: 900, color: "#11243d", marginTop: 6 }}>ADM protegido</div>
          <div style={{ color: "#66758a", marginTop: 8, marginBottom: 18 }}>Digite a senha gerencial para entrar.</div>

          <form onSubmit={entrar}>
            <label style={fieldLabelStyle}>Senha gerencial</label>
            <input style={input} type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Digite a senha" />
            {erro ? <div style={errorBox}>{erro}</div> : null}
            <button type="submit" style={saveButton}>Entrar no ADM</button>
          </form>

          <div style={{ marginTop: 14, fontSize: 13, color: "#6b7280" }}>
            Dúvidas? Contate o administrador do sistema.
          </div>
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100vh", background: "#f3f5f7", padding: 12 }}>
      <div style={{ maxWidth: 1460, margin: "0 auto" }}>
        <HeaderCebolao />

        <section style={{ ...card, marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
            <div>
              <div style={title}>ADM</div>
              <div style={subtitle}>Configurações completas do sistema.</div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={abrirCaixaPDV} style={{ padding: isMobile ? "12px 18px" : "9px 20px", borderRadius: 10, border: "none", background: "#16a34a", color: "#fff", fontWeight: 700, fontSize: isMobile ? 15 : 14, cursor: "pointer" }}>
                🖥️ Abrir Caixa (PDV)
              </button>
              <button onClick={sair} style={{ ...lightButton, fontSize: isMobile ? 15 : 16, height: isMobile ? 46 : 42 }}>Sair do ADM</button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
            {[
              ["config", "⚙️ Empresa"],
              ["cupom", "🖨️ Cupom"],
              ["operadores", "👤 Operadores"],
              ["relatorios", "📊 Relatórios"],
              ["etiquetas", "🏷️ Etiquetas"],
              ["senhas", "🔒 Senhas"],
              ...(isDev ? [["licencas", "🔑 Licenças"]] : []),
            ].map(([key, labelText]) => (
              <button key={key} onClick={() => setAba(key)} style={{ ...tabBtn, background: aba === key ? "#1fb14e" : "#fff", color: aba === key ? "#fff" : "#223042", whiteSpace: "nowrap", flexShrink: 0 }}>
                {labelText}
              </button>
            ))}
            <button
              onClick={() => router.push("/produtos")}
              style={{ ...tabBtn, background: "#fff", color: "#223042", whiteSpace: "nowrap", flexShrink: 0 }}
            >
              📦 Produtos
            </button>
          </div>
        </section>

        {msg ? <div style={msgBox}>{msg}</div> : null}

        {aba === "config" && (
          <section style={card}>
            <div style={title}>Configuração da empresa</div>
            <div style={subtitle}>Nome exibido no sistema e logo do estabelecimento.</div>
            <form onSubmit={salvarEmpresa}>
              <div style={{ ...grid2, gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0,1fr))" }}>
                <Field label="Nome fantasia">
                  <input style={input} value={empresa.nome_fantasia || ""} onChange={(e) => setEmpresa({ ...empresa, nome_fantasia: e.target.value })} />
                </Field>

                <Field label="Buscar logo">
                  <div style={{ display: "grid", gap: 10 }}>
                    <label style={{ ...input, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
                      <span style={{ color: logoNomeArquivo ? "#10243d" : "#6b7280", fontWeight: 700 }}>
                        {logoNomeArquivo || "Selecionar imagem do computador ou celular"}
                      </span>
                      <span style={{ color: "#1fb14e", fontWeight: 900 }}>Buscar</span>
                      <input type="file" accept="image/*" onChange={handleLogoFile} style={{ display: "none" }} />
                    </label>

                    {empresa.logo_url ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ width: 96, height: 96, borderRadius: 18, border: "1px solid #dde3ea", background: "#fff", overflow: "hidden", display: "grid", placeItems: "center", flexShrink: 0 }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={empresa.logo_url} alt="Prévia da logo" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                        </div>
                        <button
                          type="button"
                          onClick={() => { setEmpresa((prev) => ({ ...prev, logo_url: null })); setLogoNomeArquivo(""); }}
                          style={{ background: "#fee2e2", color: "#dc2626", border: "none", borderRadius: 10, padding: "8px 14px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}
                        >
                          Remover logo
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/logo.svg" alt="Logo padrão" style={{ width: 64, height: 64, objectFit: "contain", opacity: 0.5 }} />
                        <span style={{ color: "#6b7280", fontSize: 13 }}>Padrão Horti Gestão</span>
                      </div>
                    )}
                  </div>
                </Field>

                <Field label="CNPJ">
                  <input style={input} value={empresa.cnpj || ""} onChange={(e) => setEmpresa({ ...empresa, cnpj: e.target.value })} />
                </Field>
                <Field label="Telefone">
                  <input style={input} value={empresa.telefone || ""} onChange={(e) => setEmpresa({ ...empresa, telefone: e.target.value })} />
                </Field>
                <Field label="Endereço">
                  <input style={input} value={empresa.endereco || ""} onChange={(e) => setEmpresa({ ...empresa, endereco: e.target.value })} />
                </Field>
              </div>
              <button type="submit" style={saveButton}>Salvar configuração</button>
            </form>

            <div style={{ ...cardSoft, marginTop: 20 }}>
              <div style={{ ...title, fontSize: 20 }}>Categorias de produto</div>
              <div style={{ color: "#66758a", marginBottom: 14 }}>
                Cadastre aqui as opções do campo categoria da aba Produtos.
              </div>

              <form onSubmit={adicionarCategoria} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
                <div style={{ flex: "1 1 280px" }}>
                  <label style={fieldLabelStyle}>Nova categoria</label>
                  <input style={input} value={novaCategoria} onChange={(e) => setNovaCategoria(e.target.value)} placeholder="Ex.: Hortaliça" />
                </div>
                <button type="submit" style={saveButton}>Adicionar categoria</button>
              </form>

              <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
                {categoriasProduto.length === 0 ? (
                  <div style={{ color: "#66758a" }}>Nenhuma categoria cadastrada.</div>
                ) : (
                  categoriasProduto.map((cat) => (
                    <div key={cat.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", border: "1px solid #e5e7eb", borderRadius: 14, padding: "12px 14px", background: "#fff" }}>
                      <div style={{ fontWeight: 800, color: "#11243d" }}>{cat.nome}</div>
                      <button type="button" onClick={() => excluirCategoria(cat.id)} style={orangeSmall}>Excluir</button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        )}

        {aba === "cupom" && (
          <section style={card}>
            <div style={title}>🖨️ Cupom Fiscal</div>
            <div style={subtitle}>Configure o modelo do cupom impresso no PDV.</div>

            <form onSubmit={salvarEmpresa}>
              {/* Largura do papel */}
              <div style={{ marginBottom: 22 }}>
                <div style={fieldLabelStyle}>Largura do papel (mm)</div>
                <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                  {[58, 80].map((mm) => (
                    <button
                      key={mm}
                      type="button"
                      onClick={() => setEmpresa({ ...empresa, cupom_largura: mm })}
                      style={{
                        height: 52, width: 120, border: "2px solid",
                        borderRadius: 14, fontWeight: 800, fontSize: 16, cursor: "pointer",
                        borderColor: (empresa.cupom_largura ?? 80) === mm ? "#1fb14e" : "#dde3ea",
                        background:  (empresa.cupom_largura ?? 80) === mm ? "#edfdf0" : "#fff",
                        color:       (empresa.cupom_largura ?? 80) === mm ? "#14803b" : "#66758a",
                      }}
                    >
                      {mm} mm
                    </button>
                  ))}
                </div>
                <div style={{ color: "#66758a", fontSize: 13, marginTop: 8 }}>
                  58 mm = impressora menor · 80 mm = impressora padrão
                </div>
              </div>

              {/* Cabeçalho */}
              <Field label="Cabeçalho do cupom">
                <textarea
                  rows={5}
                  value={empresa.cupom_cabecalho || ""}
                  onChange={(e) => setEmpresa({ ...empresa, cupom_cabecalho: e.target.value })}
                  placeholder={"Linha 1 do cabeçalho\nLinha 2\nCNPJ: XX.XXX.XXX/0001-XX\nEndereço completo"}
                  style={{ ...input, height: "auto", padding: "12px 16px", resize: "vertical", fontFamily: "monospace", fontSize: 14 }}
                />
                <div style={{ color: "#66758a", fontSize: 12, marginTop: 4 }}>
                  Cada linha é exibida separada no cupom. Use para nome, CNPJ, endereço, slogan, etc.
                </div>
              </Field>

              {/* Rodapé */}
              <Field label="Rodapé do cupom">
                <textarea
                  rows={4}
                  value={empresa.cupom_rodape || ""}
                  onChange={(e) => setEmpresa({ ...empresa, cupom_rodape: e.target.value })}
                  placeholder={"Obrigado pela preferência!\nVolte sempre!"}
                  style={{ ...input, height: "auto", padding: "12px 16px", resize: "vertical", fontFamily: "monospace", fontSize: 14 }}
                />
              </Field>

              {/* Prévia */}
              <div style={{ marginTop: 20 }}>
                <div style={fieldLabelStyle}>Prévia do cupom</div>
                <div style={{
                  marginTop: 8,
                  background: "#fff",
                  border: "1px solid #dde3ea",
                  borderRadius: 14,
                  padding: 16,
                  display: "inline-block",
                  minWidth: (empresa.cupom_largura ?? 80) === 58 ? 200 : 280,
                  maxWidth: 320,
                  fontFamily: "monospace",
                  fontSize: 12,
                  lineHeight: 1.7,
                  whiteSpace: "pre-wrap",
                  color: "#111",
                }}>
                  {empresa.cupom_cabecalho
                    ? empresa.cupom_cabecalho.split("\n").map((l, i) => <div key={i} style={{ textAlign: "center" }}>{l}</div>)
                    : <div style={{ textAlign: "center", color: "#aaa" }}>[cabeçalho]</div>
                  }
                  <div style={{ borderTop: "1px dashed #aaa", margin: "6px 0" }} />
                  <div>Produto A            2 x 5,00 10,00</div>
                  <div>Produto B            1 x 3,50  3,50</div>
                  <div style={{ borderTop: "1px dashed #aaa", margin: "6px 0" }} />
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span>TOTAL</span><span><b>R$ 13,50</b></span></div>
                  <div style={{ borderTop: "1px dashed #aaa", margin: "6px 0" }} />
                  {empresa.cupom_rodape
                    ? empresa.cupom_rodape.split("\n").map((l, i) => <div key={i} style={{ textAlign: "center" }}>{l}</div>)
                    : <div style={{ textAlign: "center", color: "#aaa" }}>[rodapé]</div>
                  }
                </div>
              </div>

              <button type="submit" style={{ ...saveButton, marginTop: 20 }}>Salvar configuração do cupom</button>
            </form>
          </section>
        )}

        {aba === "operadores" && (
          <section style={card}>
            <div style={title}>Operadores</div>
            <div style={subtitle}>Cadastro de usuários e bloqueio/desbloqueio.</div>

            <div style={{ ...contentGrid, gridTemplateColumns: isMobile ? "1fr" : "clamp(280px, 40%, 420px) 1fr" }}>
              <form onSubmit={salvarOperador} style={cardSoft}>
                <div style={{ ...title, fontSize: 20 }}>
                  {editandoOpId ? "Editar operador" : "Novo operador"}
                </div>
                <Field label="Nome">
                  <input style={input} value={novoOperador.nome} onChange={(e) => setNovoOperador({ ...novoOperador, nome: e.target.value })} />
                </Field>
                <Field label="Usuário">
                  <input style={input} value={novoOperador.username} onChange={(e) => setNovoOperador({ ...novoOperador, username: e.target.value })} />
                </Field>
                <Field label={editandoOpId ? "Nova senha (deixe em branco para não alterar)" : "Senha"}>
                  <div style={{ position: "relative" }}>
                    <input style={{ ...input, paddingRight: 54 }} type={showSenha1 ? "text" : "password"} value={novoOperador.password} onChange={(e) => setNovoOperador({ ...novoOperador, password: e.target.value })} />
                    <button type="button" onClick={() => setShowSenha1(!showSenha1)} style={eyeBtn}>👁</button>
                  </div>
                </Field>
                <Field label="Confirmar senha">
                  <div style={{ position: "relative" }}>
                    <input style={{ ...input, paddingRight: 54 }} type={showSenha2 ? "text" : "password"} value={novoOperador.confirm} onChange={(e) => setNovoOperador({ ...novoOperador, confirm: e.target.value })} />
                    <button type="button" onClick={() => setShowSenha2(!showSenha2)} style={eyeBtn}>👁</button>
                  </div>
                </Field>

                {/* Permissões */}
                <div style={{ marginTop: 16, marginBottom: 4, fontWeight: 800, color: "#1d3049", fontSize: 15 }}>Permissões</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {([
                    ["perm_finalizar",      "Finalizar venda"],
                    ["perm_cancelar_item",  "Cancelar item"],
                    ["perm_cancelar_venda", "Cancelar cupom"],
                    ["perm_sangria",        "Sangria"],
                    ["perm_relatorios",     "Ver relatórios"],
                    ["perm_desconto",       "Dar desconto"],
                    ["perm_buscar_cupons",  "Buscar cupons"],
                  ] as [keyof typeof novoOperador, string][]).map(([key, label]) => (
                    <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "8px 10px", borderRadius: 10, border: "1px solid #e4eaf1", background: novoOperador[key] ? "#edfdf0" : "#fff" }}>
                      <input
                        type="checkbox"
                        checked={!!novoOperador[key]}
                        onChange={(e) => setNovoOperador({ ...novoOperador, [key]: e.target.checked })}
                        style={{ width: 16, height: 16, accentColor: "#1fb14e" }}
                      />
                      <span style={{ fontWeight: 700, fontSize: 13, color: novoOperador[key] ? "#14803b" : "#66758a" }}>{label}</span>
                    </label>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                  <button type="submit" style={saveButton}>
                    {editandoOpId ? "Salvar alterações" : "Cadastrar operador"}
                  </button>
                  {editandoOpId && (
                    <button type="button" onClick={cancelarEdicaoOp} style={{ ...saveButton, background: "#fff", color: "#374151", border: "1px solid #dde3ea" }}>
                      Cancelar
                    </button>
                  )}
                </div>
              </form>

              <div style={cardSoft}>
                <div style={{ ...title, fontSize: 20 }}>Operadores cadastrados</div>
                <div style={{ overflowX: "auto" }}>
                <div style={{ ...tableWrap, minWidth: 380 }}>
                  <div style={theadOps}>
                    <div>Nome</div>
                    <div>Usuário</div>
                    <div>Status</div>
                    <div>Ações</div>
                  </div>
                  {operadores.length === 0 ? (
                    <div style={{ padding: 16, color: "#66758a" }}>Nenhum operador cadastrado.</div>
                  ) : operadores.map((op) => (
                    <div key={op.id} style={trowOps}>
                      <div style={{ fontWeight: 800 }}>{op.nome || op.username}</div>
                      <div>{op.username}</div>
                      <div style={{ color: op.blocked ? "#b91c1c" : "#15803d", fontWeight: 700 }}>{op.blocked ? "Bloqueado" : "Ativo"}</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button onClick={() => { abrirEdicaoOp(op); setAba("operadores"); }} style={blueSmall}>
                          Editar
                        </button>
                        <button onClick={() => toggleOperador(op.id, op.blocked)} style={op.blocked ? greenSmall : orangeSmall}>
                          {op.blocked ? "Desbloquear" : "Bloquear"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {aba === "relatorios" && (
          <section style={card}>
            <div style={title}>Relatórios</div>
            <div style={subtitle}>Vendas filtradas por data e cancelamentos.</div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 8 }}>
              <div style={{ flex: 1, minWidth: 140 }}>
                <Field label="Data início">
                  <input type="date" style={input} value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
                </Field>
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <Field label="Data fim">
                  <input type="date" style={input} value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
                </Field>
              </div>
              <button onClick={carregarRelatorios} style={{ ...saveButton, height: 42, alignSelf: "flex-end" }}>
                🔍 Buscar
              </button>
            </div>

            <div style={{ ...title, fontSize: 20, marginTop: 18 }}>Relatório de vendas</div>
            <div style={{ overflowX: "auto" }}>
            <div style={{ ...tableWrap, minWidth: 520 }}>
              <div style={theadVendas}>
                <div>Número</div>
                <div>Data/Hora</div>
                <div>Pagamento</div>
                <div>Total</div>
              </div>
              {vendasFiltradas.length === 0 ? (
                <div style={{ padding: 16, color: "#66758a" }}>Nenhuma venda encontrada.</div>
              ) : vendasFiltradas.map((v) => (
                <div key={v.id} style={trowVendas}>
                  <div>{String(v.id).slice(0, 8)}</div>
                  <div>{new Date(v.created_at).toLocaleString("pt-BR")}</div>
                  <div>{v.tipo_pagamento || "-"}</div>
                  <div>{moeda(v.total)}</div>
                </div>
              ))}
            </div>
            </div>

            <div style={{ ...title, fontSize: 20, marginTop: 28 }}>Relatório de itens cancelados</div>
            <div style={{ overflowX: "auto" }}>
            <div style={{ ...tableWrap, minWidth: 480 }}>
              <div style={theadCancelados}>
                <div>Produto</div>
                <div>Motivo</div>
                <div>Operador</div>
                <div>Data/Hora</div>
              </div>
              {itensCancelados.length === 0 ? (
                <div style={{ padding: 16, color: "#66758a" }}>Nenhum item cancelado.</div>
              ) : itensCancelados.map((i) => (
                <div key={i.id} style={trowCancelados}>
                  <div>{i.produto_nome || "-"}</div>
                  <div>{i.motivo || "-"}</div>
                  <div>{i.operador || "-"}</div>
                  <div>{new Date(i.created_at).toLocaleString("pt-BR")}</div>
                </div>
              ))}
            </div>
            </div>

            <div style={{ ...title, fontSize: 20, marginTop: 28 }}>Relatório de cupom cancelado</div>
            <div style={{ overflowX: "auto" }}>
            <div style={{ ...tableWrap, minWidth: 480 }}>
              <div style={theadCancelados}>
                <div>Total</div>
                <div>Motivo</div>
                <div>Operador</div>
                <div>Data/Hora</div>
              </div>
              {cuponsCancelados.length === 0 ? (
                <div style={{ padding: 16, color: "#66758a" }}>Nenhum cupom cancelado.</div>
              ) : cuponsCancelados.map((c) => (
                <div key={c.id} style={trowCancelados}>
                  <div>{moeda(c.total)}</div>
                  <div>{c.motivo || "-"}</div>
                  <div>{c.operador || "-"}</div>
                  <div>{new Date(c.created_at).toLocaleString("pt-BR")}</div>
                </div>
              ))}
            </div>
            </div>
          </section>
        )}

        {aba === "etiquetas" && (
          <section style={card}>
            <div style={title}>Etiquetas</div>
            <div style={subtitle}>Busque o produto e imprima a etiqueta de preço.</div>

            {/* Controles superiores */}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 200px 160px", gap: 16, alignItems: "end", marginBottom: 4 }}>
              <Field label="Nome do produto">
                <input style={input} value={produtoBusca} onChange={(e) => setProdutoBusca(e.target.value)} placeholder="Digite o nome do produto" />
              </Field>
              <Field label="Quantidade de etiquetas">
                <input
                  style={input}
                  type="number"
                  min={1}
                  max={50}
                  value={qtdEtiquetas}
                  onChange={(e) => setQtdEtiquetas(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                />
              </Field>
              <div>
                <div style={fieldLabelStyle}>Largura do papel</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {[58, 80].map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => setLarguraEtiqueta(w as 58 | 80)}
                      style={{
                        flex: 1, height: 46, border: "2px solid",
                        borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: "pointer",
                        borderColor: larguraEtiqueta === w ? "#1fb14e" : "#dde3ea",
                        background:  larguraEtiqueta === w ? "#edfdf0" : "#fff",
                        color:       larguraEtiqueta === w ? "#14803b" : "#66758a",
                      }}
                    >
                      {w}mm
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {produtoEtiqueta && (() => {
              const mm      = larguraEtiqueta;
              const interno = mm - 6;
              const fNome   = mm === 58 ? 13 : 16;
              const fDin    = mm === 58 ? 20 : 26;
              const fCard   = mm === 58 ? 13 : 16;
              const fLabel  = mm === 58 ?  7 :  8;
              const fEmp    = mm === 58 ?  7 :  9;

              function imprimirEtiqueta() {
                const nome      = produtoEtiqueta!.nome;
                const precoDin  = moeda(produtoEtiqueta!.preco);
                const precoCard = produtoEtiqueta!.preco_cartao ? moeda(produtoEtiqueta!.preco_cartao) : null;
                const nomeEmp   = empresa.nome_fantasia || "";

                const etiqueta = `<div class="etiq">
  ${nomeEmp ? `<div class="emp">${nomeEmp}</div>` : ""}
  <div class="nome">${nome}</div>
  <div class="din-box">
    <div class="din-label">DINHEIRO / PIX</div>
    <div class="din-valor">${precoDin}</div>
  </div>
  ${precoCard ? `<div class="card-box"><div class="card-label">CARTÃO</div><div class="card-valor">${precoCard}</div></div>` : ""}
</div>`;

                const blocos = Array.from({ length: qtdEtiquetas }, (_, i) =>
                  i < qtdEtiquetas - 1
                    ? etiqueta + `<div style="page-break-after:always"></div>`
                    : etiqueta
                ).join("");

                const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
@page { size: ${mm}mm auto; margin: 3mm; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${interno}mm; font-family: Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.etiq { width: 100%; padding-bottom: 3mm; }
.emp { font-size: ${fEmp}pt; font-weight: 700; color: #555; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2pt; }
.nome { font-size: ${fNome}pt; font-weight: 900; color: #111; line-height: 1.15; margin-bottom: 5pt; word-break: break-word; }
.din-box { background: #1fb14e; border-radius: 4pt; padding: 5pt 7pt; margin-bottom: 3pt; }
.din-label { font-size: ${fLabel}pt; font-weight: 700; color: #fff; margin-bottom: 1pt; }
.din-valor { font-size: ${fDin}pt; font-weight: 900; color: #fff; line-height: 1; }
.card-box { background: #f3f4f6; border-radius: 3pt; padding: 4pt 7pt; }
.card-label { font-size: ${fLabel}pt; font-weight: 700; color: #666; margin-bottom: 1pt; }
.card-valor { font-size: ${fCard}pt; font-weight: 900; color: #333; }
</style>
</head><body>${blocos}</body></html>`;

                // Impressão via iframe oculto — abre o diálogo do sistema diretamente
                const iframe = document.createElement("iframe");
                iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none;";
                document.body.appendChild(iframe);
                const doc = iframe.contentDocument || iframe.contentWindow?.document;
                if (!doc) return;
                doc.open();
                doc.write(html);
                doc.close();
                setTimeout(() => {
                  iframe.contentWindow?.focus();
                  iframe.contentWindow?.print();
                  setTimeout(() => document.body.removeChild(iframe), 2000);
                }, 300);
              }

              return (
                <div style={{ marginTop: 20 }}>
                  <div style={{ marginBottom: 10, color: "#66758a", fontSize: 13 }}>
                    Prévia · {mm}mm · {qtdEtiquetas} etiqueta(s)
                  </div>

                  {/* Prévia visual */}
                  <div style={{ ...etiquetaBox, maxWidth: mm === 58 ? 200 : 260 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
                      {empresa.nome_fantasia || "ESTABELECIMENTO"}
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 900, color: "#111827", lineHeight: 1.1, marginBottom: 10 }}>
                      {produtoEtiqueta.nome}
                    </div>
                    <div style={{ background: "#1fb14e", borderRadius: 10, padding: "8px 12px", marginBottom: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#fff", opacity: 0.85, marginBottom: 2 }}>DINHEIRO / PIX</div>
                      <div style={{ fontSize: mm === 58 ? 24 : 28, fontWeight: 900, color: "#fff", lineHeight: 1 }}>{moeda(produtoEtiqueta.preco)}</div>
                    </div>
                    {produtoEtiqueta.preco_cartao ? (
                      <div style={{ background: "#f3f4f6", borderRadius: 8, padding: "6px 12px" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", marginBottom: 2 }}>CARTÃO</div>
                        <div style={{ fontSize: 18, fontWeight: 900, color: "#374151" }}>{moeda(produtoEtiqueta.preco_cartao)}</div>
                      </div>
                    ) : null}
                  </div>

                  <button style={{ ...saveButton, marginTop: 16 }} onClick={imprimirEtiqueta}>
                    🖨️ Imprimir {qtdEtiquetas > 1 ? `${qtdEtiquetas} etiquetas` : "etiqueta"}
                  </button>
                </div>
              );
            })()}

            {!produtoEtiqueta && produtoBusca.trim() && (
              <div style={{ marginTop: 18, color: "#ef4444", fontWeight: 700 }}>Nenhum produto encontrado para &quot;{produtoBusca}&quot;.</div>
            )}
            {!produtoBusca.trim() && (
              <div style={{ marginTop: 18, color: "#66758a" }}>Digite o nome do produto para ver a prévia da etiqueta.</div>
            )}
          </section>
        )}

        {aba === "senhas" && (
          <section style={card}>
            <div style={title}>Senhas operacionais</div>
            <div style={subtitle}>Centralize aqui todas as senhas do sistema.</div>

            <form onSubmit={salvarSenhas}>
              <div style={{ ...grid2, gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0,1fr))" }}>
                <Field label="Senha do ADM">
                  <input style={input} value={senhasOp.adm_password || ""} onChange={(e) => setSenhasOp({ ...senhasOp, adm_password: e.target.value })} />
                </Field>
                <Field label="Senha cancelar item">
                  <input style={input} value={senhasOp.senha_cancelar_item || ""} onChange={(e) => setSenhasOp({ ...senhasOp, senha_cancelar_item: e.target.value })} />
                </Field>
                <Field label="Senha cancelar venda">
                  <input style={input} value={senhasOp.senha_cancelar_venda || ""} onChange={(e) => setSenhasOp({ ...senhasOp, senha_cancelar_venda: e.target.value })} />
                </Field>
                <Field label="Senha sangria">
                  <input style={input} value={senhasOp.senha_sangria || ""} onChange={(e) => setSenhasOp({ ...senhasOp, senha_sangria: e.target.value })} />
                </Field>
                <Field label="Senha suprimento">
                  <input style={input} value={senhasOp.senha_suprimento || ""} onChange={(e) => setSenhasOp({ ...senhasOp, senha_suprimento: e.target.value })} />
                </Field>
                <Field label="Senha alterar preço">
                  <input style={input} value={senhasOp.senha_alterar_preco || ""} onChange={(e) => setSenhasOp({ ...senhasOp, senha_alterar_preco: e.target.value })} />
                </Field>
                <Field label="Senha reabrir caixa">
                  <input style={input} value={senhasOp.senha_reabrir_caixa || ""} onChange={(e) => setSenhasOp({ ...senhasOp, senha_reabrir_caixa: e.target.value })} />
                </Field>
              </div>
              <button type="submit" style={saveButton}>Salvar senhas</button>
            </form>
          </section>
        )}

        {aba === "licencas" && (
          <section style={card}>
            <div style={title}>🔑 Gerenciar Licenças</div>
            <div style={subtitle}>Gere chaves de acesso para seus clientes. A validade de 5 anos começa na primeira ativação.</div>

            {/* Formulário para gerar novas chaves */}
            <form onSubmit={gerarNovasChaves} style={{ marginBottom: 28 }}>
              <div style={{ ...grid2, gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0,1fr))", marginBottom: 12 }}>
                <Field label="Cliente (opcional)">
                  <input style={input} placeholder="Ex: Mercadinho do João" value={novaLicCliente} onChange={(e) => setNovaLicCliente(e.target.value)} />
                </Field>
                <Field label="Observações (opcional)">
                  <input style={input} placeholder="Qualquer nota interna" value={novaLicNotas} onChange={(e) => setNovaLicNotas(e.target.value)} />
                </Field>
                <Field label="Quantidade de chaves">
                  <input style={input} type="number" min={1} max={50} value={novaLicQtd} onChange={(e) => setNovaLicQtd(Number(e.target.value))} />
                </Field>
              </div>
              <button type="submit" style={saveButton}>Gerar chave(s)</button>
            </form>

            {/* Chaves recém geradas */}
            {licencasGeradas.length > 0 && (
              <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 14, padding: 16, marginBottom: 24 }}>
                <div style={{ fontWeight: 800, color: "#166534", marginBottom: 8 }}>✅ Chaves geradas — copie e envie ao cliente:</div>
                {licencasGeradas.map((c) => (
                  <div key={c} style={{ fontFamily: "monospace", fontSize: 17, letterSpacing: 1, color: "#166534", padding: "4px 0" }}>{c}</div>
                ))}
                <button
                  style={{ ...blueSmall, marginTop: 10, background: licCopied ? "#1fb14e" : undefined }}
                  onClick={() => {
                    navigator.clipboard.writeText(licencasGeradas.join("\n"));
                    setLicCopied(true);
                    setTimeout(() => setLicCopied(false), 2000);
                  }}
                >
                  {licCopied ? "✅ Copiado!" : "📋 Copiar todas"}
                </button>
                <button style={{ ...lightButton, marginTop: 10, marginLeft: 8 }} onClick={() => setLicencasGeradas([])}>Fechar</button>
              </div>
            )}

            {/* Lista de licenças */}
            <div style={{ fontWeight: 800, fontSize: 16, color: "#11243d", marginBottom: 10 }}>Todas as chaves ({licencas.length})</div>
            {licencas.length === 0 ? (
              <div style={{ color: "#66758a" }}>Nenhuma chave cadastrada ainda.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {licencas.map((lic) => {
                  const ativada = !!lic.ativado_em;
                  const validade = lic.validade ? new Date(lic.validade) : null;
                  const expirada = validade ? validade < new Date() : false;
                  const statusColor = !lic.ativo ? "#ef4444" : expirada ? "#f97316" : ativada ? "#1fb14e" : "#3b82f6";
                  const statusLabel = !lic.ativo ? "Revogada" : expirada ? "Expirada" : ativada ? "Ativa" : "Aguardando ativação";

                  return (
                    <div key={lic.id} style={{ ...cardSoft, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                      {/* Chave */}
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700, letterSpacing: 1, color: "#11243d" }}>{lic.chave}</div>
                        {lic.cliente && <div style={{ fontSize: 13, color: "#4b6275" }}>👤 {lic.cliente}</div>}
                        {lic.notas && <div style={{ fontSize: 12, color: "#66758a" }}>📝 {lic.notas}</div>}
                      </div>
                      {/* Datas */}
                      <div style={{ fontSize: 12, color: "#66758a", minWidth: 150 }}>
                        <div>Criada: {new Date(lic.criado_em).toLocaleDateString("pt-BR")}</div>
                        {ativada && <div>Ativada: {new Date(lic.ativado_em!).toLocaleDateString("pt-BR")}</div>}
                        {validade && <div>Expira: {validade.toLocaleDateString("pt-BR")}</div>}
                      </div>
                      {/* Status */}
                      <div style={{ background: statusColor + "22", color: statusColor, fontWeight: 700, fontSize: 12, borderRadius: 20, padding: "4px 12px" }}>
                        {statusLabel}
                      </div>
                      {/* Ações */}
                      <div style={{ display: "flex", gap: 6 }}>
                        {lic.ativo ? (
                          <button style={{ ...blueSmall, background: "#ef4444" }} onClick={() => revogarLicenca(lic.id)}>Revogar</button>
                        ) : (
                          <button style={{ ...blueSmall, background: "#1fb14e" }} onClick={() => reativarLicenca(lic.id)}>Reativar</button>
                        )}
                        <button style={{ ...blueSmall, background: "#6b7280" }} onClick={() => excluirLicenca(lic.id)}>Excluir</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>

      {/* Modal: PDV não instalado */}
      {modalDownloadPDV && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 36, maxWidth: 420, width: "90%", textAlign: "center", boxShadow: "0 8px 40px rgba(0,0,0,0.25)" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🖥️</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#1a2230", marginBottom: 8 }}>PDV não instalado</div>
            <div style={{ fontSize: 14, color: "#475569", marginBottom: 24, lineHeight: 1.6 }}>
              O aplicativo de caixa não foi encontrado neste computador.<br/>
              Baixe e instale o PDV para usar o caixa.
            </div>
            <a
              href={urlDownloadPDV}
              download
              style={{ display: "block", background: "#16a34a", color: "#fff", fontWeight: 700, fontSize: 15, padding: "12px 24px", borderRadius: 10, textDecoration: "none", marginBottom: 12 }}
            >
              ⬇️ Baixar e instalar PDV
            </a>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 20 }}>
              Após instalar, clique novamente em "Abrir Caixa (PDV)"
            </div>
            <button onClick={() => setModalDownloadPDV(false)} style={{ background: "none", border: "1px solid #dde3ea", borderRadius: 8, padding: "8px 20px", color: "#475569", cursor: "pointer", fontSize: 13 }}>
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* Rodapé com versão */}
      <div style={{ textAlign: "center", color: "#475569", fontSize: 12, paddingTop: 24, paddingBottom: 8, lineHeight: 1.7 }}>
        Horti Gestão · v{process.env.NEXT_PUBLIC_APP_VERSION || "—"}<br/>
        Desenvolvido por Jean Silva
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={fieldLabelStyle}>{label}</label>
      {children}
    </div>
  );
}

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #dde3ea",
  borderRadius: 28,
  padding: 22,
  boxShadow: "0 8px 24px rgba(15,23,42,.04)",
};

const cardSoft: React.CSSProperties = {
  background: "#fbfcfd",
  border: "1px solid #e4eaf1",
  borderRadius: 22,
  padding: 18,
};

const title: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 900,
  color: "#11243d",
  marginBottom: 4,
};

const subtitle: React.CSSProperties = {
  color: "#66758a",
  marginBottom: 18,
};

const fieldLabelStyle: React.CSSProperties = {
  display: "block",
  fontWeight: 800,
  color: "#1d3049",
  fontSize: 15,
  marginBottom: 8,
};

const grid2: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 16,
};

const contentGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "clamp(280px, 40%, 420px) 1fr",
  gap: 18,
};

const filterGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 16,
  marginBottom: 18,
};

const input: React.CSSProperties = {
  width: "100%",
  height: 48,
  borderRadius: 14,
  border: "1px solid #d5dde7",
  padding: "0 16px",
  fontSize: 16,
  color: "#243447",
  background: "#fff",
  outline: "none",
  boxSizing: "border-box",
};

const saveButton: React.CSSProperties = {
  marginTop: 20,
  border: "none",
  background: "#1fb14e",
  color: "#fff",
  height: 42,
  minWidth: 150,
  padding: "0 22px",
  borderRadius: 12,
  fontWeight: 900,
  fontSize: 16,
  cursor: "pointer",
};

const lightButton: React.CSSProperties = {
  border: "1px solid #d5dde7",
  background: "#fff",
  color: "#243447",
  height: 42,
  padding: "0 20px",
  borderRadius: 12,
  fontWeight: 800,
  fontSize: 16,
  cursor: "pointer",
};

const tabBtn: React.CSSProperties = {
  border: "1px solid #dbe2ea",
  borderRadius: 999,
  padding: "12px 18px",
  fontWeight: 800,
  fontSize: 15,
  cursor: "pointer",
};

const msgBox: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #dbe4ec",
  borderRadius: 18,
  padding: "12px 16px",
  color: "#1d4f2f",
  marginBottom: 14,
};

const errorBox: React.CSSProperties = {
  marginTop: 12,
  color: "#991b1b",
  background: "#fef2f2",
  border: "1px solid #fecaca",
  padding: "12px 14px",
  borderRadius: 14,
  fontWeight: 700,
};

const eyeBtn: React.CSSProperties = {
  position: "absolute",
  right: 10,
  top: 8,
  height: 32,
  width: 32,
  borderRadius: 10,
  border: "1px solid #dbe2ea",
  background: "#fff",
  cursor: "pointer",
};

const tableWrap: React.CSSProperties = {
  borderTop: "1px solid #edf1f5",
};

const theadOps: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.2fr 1fr .8fr 1.4fr",
  gap: 14,
  padding: "14px 12px",
  color: "#25354b",
  fontWeight: 800,
  fontSize: 15,
};

const trowOps: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.2fr 1fr .8fr 1.4fr",
  gap: 14,
  padding: "14px 12px",
  alignItems: "center",
  borderTop: "1px solid #edf1f5",
  color: "#1f2937",
  fontSize: 16,
};

const theadVendas: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1.6fr 1fr 1fr",
  gap: 14,
  padding: "14px 12px",
  color: "#25354b",
  fontWeight: 800,
  fontSize: 15,
};

const trowVendas: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1.6fr 1fr 1fr",
  gap: 14,
  padding: "14px 12px",
  alignItems: "center",
  borderTop: "1px solid #edf1f5",
  color: "#1f2937",
  fontSize: 16,
};

const theadCancelados: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1.5fr 1fr 1.4fr",
  gap: 14,
  padding: "14px 12px",
  color: "#25354b",
  fontWeight: 800,
  fontSize: 15,
};

const trowCancelados: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1.5fr 1fr 1.4fr",
  gap: 14,
  padding: "14px 12px",
  alignItems: "center",
  borderTop: "1px solid #edf1f5",
  color: "#1f2937",
  fontSize: 16,
};

const orangeSmall: React.CSSProperties = {
  border: "1px solid #f3b981",
  background: "#fff7ed",
  color: "#c65d07",
  borderRadius: 12,
  height: 40,
  fontWeight: 900,
  cursor: "pointer",
  minWidth: 120,
};

const blueSmall: React.CSSProperties = {
  border: "1px solid #93c5fd",
  background: "#eff6ff",
  color: "#1d4ed8",
  borderRadius: 12,
  height: 40,
  fontWeight: 900,
  cursor: "pointer",
  minWidth: 80,
  padding: "0 12px",
};

const greenSmall: React.CSSProperties = {
  border: "1px solid #b7edc5",
  background: "#edfdf0",
  color: "#1a7b39",
  borderRadius: 12,
  height: 40,
  fontWeight: 900,
  cursor: "pointer",
  minWidth: 120,
};

const etiquetaBox: React.CSSProperties = {
  border: "2px dashed #d1d5db",
  borderRadius: 18,
  padding: 20,
  background: "#fff",
  maxWidth: 320,
  boxShadow: "0 4px 14px rgba(0,0,0,.06)",
};
