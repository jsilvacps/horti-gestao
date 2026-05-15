"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import {
  syncProdutosLocal, getProdutosLocal, debitarEstoqueLocal,
  savePendingVenda, countPendingVendas, syncPendingVendas,
} from "@/lib/syncService";
import {
  inicializarLicenca, validarLicencaOnline, salvarChave, salvarLicencaCache,
  getDiasTrialRestantes, gerarChave,
  type Plano, type RecursoPro, temRecurso,
} from "@/lib/licenca";

/* ── Tipos ── */
type Produto = {
  id: string;
  nome: string;
  codigo: string | null;
  ean: string | null;
  preco: number | null;
  preco_cartao: number | null;
  unidade: string | null;
};

type ItemCarrinho = {
  id: string;
  produto: Produto;
  quantidade: number;
  precoUnitario: number;
};

type Operador = {
  id?: string;
  nome?: string | null;
  username: string;
  perm_finalizar?:      boolean | null;
  perm_cancelar_item?:  boolean | null;
  perm_cancelar_venda?: boolean | null;
  perm_sangria?:        boolean | null;
  perm_relatorios?:     boolean | null;
  perm_desconto?:       boolean | null;
  perm_buscar_cupons?:  boolean | null;
};

/* ── Formatação ── */
function formatarCPF(valor: string) {
  const n = valor.replace(/\D/g, "").slice(0, 11);
  return n
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
}

function moedaBR(valor: number) {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function validarCPF(cpf: string): boolean {
  const n = cpf.replace(/\D/g, "");
  if (n.length !== 11 || /^(\d)\1{10}$/.test(n)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += parseInt(n[i]) * (10 - i);
  let r = (s * 10) % 11; if (r === 10 || r === 11) r = 0;
  if (r !== parseInt(n[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += parseInt(n[i]) * (11 - i);
  r = (s * 10) % 11; if (r === 10 || r === 11) r = 0;
  return r === parseInt(n[10]);
}

export default function PDVPage() {
  /* ── Licença ── */
  const [plano, setPlano]                     = useState<Plano>("trial");
  // Inicia com 15 (valor SSR-safe). O useEffect abaixo corrige com o valor real do localStorage.
  const [diasTrial, setDiasTrial]             = useState(15);
  const [clienteLicenca, setClienteLicenca]   = useState("");
  const [modalLicenca, setModalLicenca]       = useState(false);
  const [chaveInput, setChaveInput]           = useState("");
  const [ativandoLicenca, setAtivandoLicenca] = useState(false);
  const [erroLicenca, setErroLicenca]         = useState("");
  const refChaveInput                         = useRef<HTMLInputElement>(null);

  /* ── Online/offline ── */
  const isOnline = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [sincronizando, setSincronizando] = useState(false);

  /* ── Estado do operador e empresa ── */
  const [operador, setOperador] = useState<Operador | null>(null);
  const [logoSrc, setLogoSrc] = useState<string | null>(null);

  /* ── Estado do CPF ── */
  const [cpf, setCpf] = useState("");
  const [mostrarModalCPF, setMostrarModalCPF] = useState(true);
  const [clienteLabel, setClienteLabel] = useState("Sem cliente identificado");

  /* ── Estado do carrinho ── */
  const [codigoBusca, setCodigoBusca] = useState("");
  const [produtoSelecionado, setProdutoSelecionado] = useState<Produto | null>(null);
  const [quantidade, setQuantidade] = useState("1");
  const [precoUnitario, setPrecoUnitario] = useState("");
  const [carrinho, setCarrinho] = useState<ItemCarrinho[]>([]);
  const [mensagem, setMensagem] = useState("");

  /* ── Busca rápida (autocomplete) ── */
  const [todosProdutos, setTodosProdutos] = useState<Produto[]>([]);
  const [sugestoes, setSugestoes] = useState<Produto[]>([]);
  const [sugestaoIdx, setSugestaoIdx] = useState(-1);

  /* ── Senha ADM ── */
  const [senhaAdmConfig, setSenhaAdmConfig] = useState("1234");
  const [modalAdm, setModalAdm] = useState<{
    titulo: string;
    descricao: string;
    onConfirmar: () => Promise<void>;
  } | null>(null);
  const [senhaAdmInput, setSenhaAdmInput] = useState("");
  const [erroSenhaAdm, setErroSenhaAdm] = useState("");
  const [salvandoAdm, setSalvandoAdm] = useState(false);
  const refSenhaAdm = useRef<HTMLInputElement>(null);

  /* ── Finalizar venda ── */
  const [modalFinalizar, setModalFinalizar] = useState(false);
  const [tipoPagamento, setTipoPagamento]   = useState<"dinheiro" | "pix" | "cartao" | "fiado">("dinheiro");
  const [desconto, setDesconto]             = useState("");
  const [tipoDesconto, setTipoDesconto]     = useState<"R$" | "%">("R$");
  const [valorRecebido, setValorRecebido]   = useState("");
  const [finalizando, setFinalizando]       = useState(false);
  const refValorRecebido                    = useRef<HTMLInputElement>(null);

  /* ── Config do cupom ── */
  const [cupomCfg, setCupomCfg] = useState({
    largura: 80, cabecalho: "", rodape: "", nome: "", cnpj: "", endereco: "", telefone: ""
  });

  /* ── Sangria ── */
  const [modalSangria, setModalSangria] = useState(false);
  const [valorSangria, setValorSangria] = useState("");
  const [obsSangria, setObsSangria] = useState("");
  const [salvandoSangria, setSalvandoSangria] = useState(false);
  const [totalCaixa, setTotalCaixa] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    return Number(localStorage.getItem("pdv_total_caixa") || "0");
  });

  /* ── Relatórios PDV ── */
  const [modalRelatorios, setModalRelatorios] = useState(false);
  const [abaRelatorio, setAbaRelatorio] = useState<"cupons" | "itens" | "sangrias" | "operadores">("cupons");
  const [relCupons, setRelCupons]       = useState<any[]>([]);
  const [relItens, setRelItens]         = useState<any[]>([]);
  const [relSangrias, setRelSangrias]   = useState<any[]>([]);
  const [relOperadores, setRelOperadores] = useState<any[]>([]);
  const [carregandoRel, setCarregandoRel] = useState(false);
  const [erroRelatorio, setErroRelatorio] = useState<string | null>(null);

  /* ── Fechamento de caixa ── */
  const [modalFechamento, setModalFechamento]   = useState(false);
  const [fechamentoData, setFechamentoData]     = useState<{
    totalVendas: number; totalDinheiro: number; totalPix: number; totalCartao: number;
    totalSangrias: number; saldoFinal: number; qtdVendas: number;
  } | null>(null);
  const [carregandoFechamento, setCarregandoFechamento] = useState(false);
  const [fechandoCaixa, setFechandoCaixa]       = useState(false);
  const [etapaFechamento, setEtapaFechamento]   = useState<"gaveta" | "resumo">("gaveta");
  const [valorGaveta, setValorGaveta]           = useState("");
  const [obsFechamento, setObsFechamento]       = useState("");
  const refValorGaveta                          = useRef<HTMLInputElement>(null);

  /* ── Abertura de caixa ── */
  const [modalAbrirCaixa, setModalAbrirCaixa]   = useState(false);
  const [valorAbertura, setValorAbertura]         = useState("");
  const [valorAberturaNum, setValorAberturaNum]   = useState(0);
  const refValorAbertura                          = useRef<HTMLInputElement>(null);

  // valores derivados do fechamento (evita IIFE no JSX)
  const gavetaNum   = parseFloat(valorGaveta.replace(",", ".")) || 0;
  // esperadoGav inclui o fundo de abertura do caixa
  const esperadoGav = (fechamentoData?.totalDinheiro ?? 0) - (fechamentoData?.totalSangrias ?? 0) + valorAberturaNum;
  const difGav      = gavetaNum - esperadoGav;

  /* ── Fiado ── */
  const [clienteFiado, setClienteFiado]         = useState<{ id: string; nome: string; limite_credito: number; saldo_fiado: number } | null>(null);
  const [buscandoFiado, setBuscandoFiado]       = useState(false);
  const [erroFiado, setErroFiado]               = useState("");

  /* ── Buscar cupons ── */
  const [modalCupons, setModalCupons]           = useState(false);
  const [cupons, setCupons]                     = useState<any[]>([]);
  const [filtroData, setFiltroData]             = useState("");
  const [filtroCPF, setFiltroCPF]               = useState("");
  const [carregandoCupons, setCarregandoCupons] = useState(false);
  const refFiltroCPF                            = useRef<HTMLInputElement>(null);

  /* ── Refs de foco ── */
  const refCodigo    = useRef<HTMLInputElement>(null);
  const refQtd       = useRef<HTMLInputElement>(null);
  const refPrecoUnit = useRef<HTMLInputElement>(null);

  /* ── Verifica se o caixa está aberto (roda apenas no cliente) ── */
  useEffect(() => {
    const aberto = localStorage.getItem("pdv_caixa_aberto");
    const vAb    = Number(localStorage.getItem("pdv_valor_abertura") || "0");
    setValorAberturaNum(vAb);
    if (aberto !== "true") {
      setModalAbrirCaixa(true);
      setTimeout(() => refValorAbertura.current?.focus(), 350);
    }
  }, []);

  /* ── Carrega operador e logo na montagem ── */
  useEffect(() => {
    const raw = typeof window !== "undefined" ? window.sessionStorage.getItem("operador_logado") : null;
    if (raw) {
      try { setOperador(JSON.parse(raw)); } catch {}
    }
  }, []);

  /* ── Recarrega permissões do banco para garantir dados frescos ── */
  const carregarPermissoes = useCallback(async (username: string) => {
    const { data } = await supabase
      .from("operadores")
      .select("id, nome, username, perm_finalizar, perm_cancelar_item, perm_cancelar_venda, perm_sangria, perm_relatorios, perm_desconto, perm_buscar_cupons")
      .eq("username", username)
      .maybeSingle();
    if (data) setOperador((prev) => ({ ...prev, ...data } as Operador));
  }, []);

  useEffect(() => {
    if (operador?.username) carregarPermissoes(operador.username);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operador?.username]);

  const carregarLogo = useCallback(async () => {
    const { data } = await supabase
      .from("empresa")
      .select("logo_url, nome_fantasia, cnpj, telefone, endereco, cupom_largura, cupom_cabecalho, cupom_rodape")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.logo_url) setLogoSrc(data.logo_url as string);
    if (data) setCupomCfg({
      largura:   Number(data.cupom_largura)  || 80,
      cabecalho: String(data.cupom_cabecalho || ""),
      rodape:    String(data.cupom_rodape    || ""),
      nome:      String(data.nome_fantasia   || ""),
      cnpj:      String(data.cnpj            || ""),
      endereco:  String(data.endereco        || ""),
      telefone:  String(data.telefone        || ""),
    });
  }, []);

  useEffect(() => {
    carregarLogo();
  }, [carregarLogo]);

  /* ── Carrega senha ADM ── */
  const carregarSenhaAdm = useCallback(async () => {
    const { data } = await supabase
      .from("senhas_operacionais")
      .select("adm_password")
      .limit(1)
      .maybeSingle();
    if (data?.adm_password) setSenhaAdmConfig(data.adm_password as string);
  }, []);

  useEffect(() => { carregarSenhaAdm(); }, [carregarSenhaAdm]);

  /* ── Verifica permissão do operador (null/undefined = liberado por padrão) ── */
  function temPerm(perm: keyof Pick<Operador,
    "perm_finalizar"|"perm_cancelar_item"|"perm_cancelar_venda"|
    "perm_sangria"|"perm_relatorios"|"perm_desconto"|"perm_buscar_cupons">
  ): boolean {
    if (!operador) return false;
    const v = operador[perm];
    return v === null || v === undefined ? true : Boolean(v);
  }

  function semPermissao(acao: string) {
    setMensagem(`🚫 Sem permissão para: ${acao}. Solicite ao gerente.`);
    setTimeout(() => setMensagem(""), 4000);
  }

  /** Verifica se o plano tem acesso ao recurso. Se não, exibe aviso e retorna true (bloqueado). */
  function exigirPro(recurso: RecursoPro): boolean {
    if (temRecurso(plano, recurso)) return false;
    setMensagem("🔒 Recurso disponível apenas no Plano Pro. Pressione F12 para ativar.");
    setTimeout(() => setMensagem(""), 5000);
    return true; // bloqueado
  }

  /** Ativa uma licença digitada pelo usuário */
  async function ativarLicenca() {
    const chave = chaveInput.trim().toUpperCase();
    if (!chave) return;
    setAtivandoLicenca(true);
    setErroLicenca("");
    const status = await validarLicencaOnline(chave);
    setAtivandoLicenca(false);
    if (!status.valida) {
      setErroLicenca("Chave inválida ou expirada. Verifique e tente novamente.");
      return;
    }
    salvarChave(chave);
    salvarLicencaCache(status);
    setPlano(status.plano);
    if (status.cliente) setClienteLicenca(status.cliente);
    setModalLicenca(false);
    setChaveInput("");
    setErroLicenca("");
    setMensagem(`✅ Licença Pro ativada! Bem-vindo(a)${status.cliente ? ", " + status.cliente : ""}.`);
    setTimeout(() => setMensagem(""), 6000);
  }

  /* ── Abre modal de senha ADM ── */
  function pedirSenha(titulo: string, descricao: string, onConfirmar: () => Promise<void>) {
    setSenhaAdmInput("");
    setErroSenhaAdm("");
    setModalAdm({ titulo, descricao, onConfirmar });
    setTimeout(() => refSenhaAdm.current?.focus(), 80);
  }

  /* ── Verifica e executa ação protegida ── */
  async function confirmarSenhaAdm() {
    if (!modalAdm) return;
    if (senhaAdmInput !== senhaAdmConfig) {
      setErroSenhaAdm("Senha inválida. Tente novamente.");
      setSenhaAdmInput("");
      setTimeout(() => refSenhaAdm.current?.focus(), 30);
      return;
    }
    setSalvandoAdm(true);
    try {
      await modalAdm.onConfirmar();
      setModalAdm(null);
    } catch {
      setErroSenhaAdm("Erro ao executar a ação.");
    } finally {
      setSalvandoAdm(false);
    }
  }

  /* ── Carrega todos os produtos — offline-first ── */
  const carregarProdutos = useCallback(async () => {
    // 1. Carrega do IndexedDB primeiro (instantâneo, funciona offline)
    const local = await getProdutosLocal();
    if (local.length > 0) setTodosProdutos(local as Produto[]);

    // 2. Tenta sincronizar do Supabase em background
    const ok = await syncProdutosLocal();
    if (ok) {
      const atualizados = await getProdutosLocal();
      if (atualizados.length > 0) setTodosProdutos(atualizados as Produto[]);
    }
  }, []);

  /* ── Verificação de licença ── */
  useEffect(() => {
    inicializarLicenca().then((status) => {
      setPlano(status.plano);
      if (status.diasRestantes !== undefined) setDiasTrial(status.diasRestantes);
      if (status.cliente) setClienteLicenca(status.cliente);
      // Trial expirado sem chave → abre modal de ativação
      if (status.plano === "free" && !status.cliente) setModalLicenca(true);
    });
  }, []);

  useEffect(() => {
    carregarProdutos();
    // Conta pendentes ao montar
    countPendingVendas().then(setPendingCount);
  }, [carregarProdutos]);

  /* ── Auto-sync quando volta online ── */
  useEffect(() => {
    if (!isOnline) return;
    let ativo = true;
    (async () => {
      setSincronizando(true);
      try {
        const n = await syncPendingVendas();
        if (!ativo) return;
        if (n > 0) {
          setMensagem(`✅ ${n} venda(s) offline sincronizada(s) com sucesso!`);
          setTimeout(() => setMensagem(""), 5000);
        }
        const c = await countPendingVendas();
        if (!ativo) return;
        setPendingCount(c);
        // Resync produtos
        await carregarProdutos();
      } finally {
        if (ativo) setSincronizando(false);
      }
    })();
    return () => { ativo = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  /* ── Teclado global ── */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // F2 → foca busca de produto
      if (e.key === "F2") {
        e.preventDefault();
        refCodigo.current?.focus();
        refCodigo.current?.select();
        return;
      }
      // F4 → buscar cupons
      if (e.key === "F4") { e.preventDefault(); abrirBuscarCupons(); return; }
      // F9 → fechar caixa
      if (e.key === "F9") { e.preventDefault(); abrirFechamento(); return; }
      // F10 → identificar CPF
      if (e.key === "F10") { e.preventDefault(); setMostrarModalCPF(true); return; }
      // F12 → licença
      if (e.key === "F12") { e.preventDefault(); setModalLicenca(true); setTimeout(() => refChaveInput.current?.focus(), 80); return; }
      // Teclas do modal CPF (só quando modal CPF estiver aberto)
      if (mostrarModalCPF) {
        if (e.key === "Enter") { e.preventDefault(); confirmarCPF(); }
        if (e.key === "Escape") { e.preventDefault(); fecharModalCPF(); }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mostrarModalCPF, cpf]);

  /* ── Teclado do modal finalizar (1-4 = tipo pagamento, Esc = fechar) ── */
  useEffect(() => {
    if (!modalFinalizar) return;
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName?.toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA") return; // não intercepta campos de texto
      if (e.key === "1") { e.preventDefault(); selecionarPagamento("dinheiro"); }
      else if (e.key === "2") { e.preventDefault(); selecionarPagamento("pix"); }
      else if (e.key === "3") { e.preventDefault(); selecionarPagamento("cartao"); }
      else if (e.key === "4" && temRecurso(plano, "fiado")) { e.preventDefault(); selecionarPagamento("fiado"); }
      else if (e.key === "Escape") { e.preventDefault(); setModalFinalizar(false); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalFinalizar, plano]);

  /* ── CPF ── */
  function confirmarCPF() {
    const limpo = cpf.replace(/\D/g, "");
    if (limpo && !validarCPF(limpo)) {
      setMensagem("⚠️ CPF inválido. Verifique e tente novamente.");
      setTimeout(() => setMensagem(""), 4000);
      return;
    }
    setClienteLabel(limpo ? formatarCPF(limpo) : "Sem cliente identificado");
    setMostrarModalCPF(false);
    setTimeout(() => refCodigo.current?.focus(), 50);
  }

  function fecharModalCPF() {
    setCpf("");
    setClienteLabel("Sem cliente identificado");
    setMostrarModalCPF(false);
    setTimeout(() => refCodigo.current?.focus(), 50);
  }

  /* ── Autocomplete: filtra produtos ao digitar ── */
  function aoDigitarBusca(valor: string) {
    setCodigoBusca(valor);
    setProdutoSelecionado(null);   // usuário digitou de novo → limpa seleção anterior
    setSugestaoIdx(-1);

    const termo = valor.trim().toLowerCase();
    if (termo.length < 3) { setSugestoes([]); return; }

    const filtrado = todosProdutos.filter((p) =>
      p.nome.toLowerCase().includes(termo) ||
      (p.codigo && p.codigo.toLowerCase().includes(termo)) ||
      (p.ean   && p.ean.includes(termo))
    ).slice(0, 8);

    setSugestoes(filtrado);
  }

  /* ── Navegar no dropdown com ↑ ↓ Escape Enter ── */
  function onKeyDownBusca(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSugestaoIdx((i) => Math.min(i + 1, sugestoes.length - 1)); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); setSugestaoIdx((i) => Math.max(i - 1, -1)); return; }
    if (e.key === "Escape")    { setSugestoes([]); setSugestaoIdx(-1); return; }
    // Enter com dropdown aberto → seleciona produto e vai para quantidade
    if (e.key === "Enter" && sugestoes.length > 0) {
      e.preventDefault();
      const idx = sugestaoIdx >= 0 ? sugestaoIdx : 0;
      selecionarSugestao(sugestoes[idx]);
    }
  }

  /* ── Seleciona produto do dropdown (não lança ainda — vai para qty) ── */
  function selecionarSugestao(produto: Produto) {
    setMensagem("");
    setProdutoSelecionado(produto);
    setCodigoBusca(produto.nome);
    // Pré-preenche preço unitário com o valor cadastrado
    setPrecoUnitario(String((produto.preco ?? 0).toFixed(2)).replace(".", ","));
    setSugestoes([]);
    setSugestaoIdx(-1);
    // Foco vai para o campo de quantidade
    setTimeout(() => { refQtd.current?.focus(); refQtd.current?.select(); }, 30);
  }

  /* ── Enter na quantidade → vai para preço unitário ── */
  function onKeyDownQtd(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      refPrecoUnit.current?.focus();
      refPrecoUnit.current?.select();
    }
  }

  /* ── Preço total calculado em tempo real ── */
  const precoTotalLinha = useMemo(() => {
    const qtd  = parseFloat(quantidade.replace(",", ".")) || 0;
    const unit = parseFloat((precoUnitario || "0").replace(",", ".")) || 0;
    return qtd * unit;
  }, [quantidade, precoUnitario]);

  /* ── Confirma e lança no carrinho ── */
  function confirmarLancamento(produto: Produto) {
    const qtd   = parseFloat(quantidade.replace(",", ".")) || 1;
    const preco = parseFloat((precoUnitario || "0").replace(",", ".")) || (produto.preco ?? 0);

    setCarrinho((prev) => {
      const existente = prev.find((i) => i.produto.id === produto.id && i.precoUnitario === preco);
      if (existente) {
        return prev.map((i) => i.id === existente.id ? { ...i, quantidade: i.quantidade + qtd } : i);
      }
      return [...prev, { id: crypto.randomUUID(), produto, quantidade: qtd, precoUnitario: preco }];
    });

    setCodigoBusca("");
    setProdutoSelecionado(null);
    setQuantidade("1");
    setPrecoUnitario("");
    setSugestoes([]);
    setSugestaoIdx(-1);
    setTimeout(() => refCodigo.current?.focus(), 30);
  }

  /* ── Busca produto por código/EAN (leitor de barras) ── */
  async function buscarProdutoAPI(): Promise<Produto | null> {
    const termo = codigoBusca.trim();
    if (!termo) return null;
    const { data } = await supabase
      .from("produtos")
      .select("id, nome, codigo, ean, preco, preco_cartao, unidade")
      .or(`codigo.eq.${termo},ean.eq.${termo}`)
      .limit(1)
      .maybeSingle();
    return data as Produto | null;
  }

  /* ── Submit do formulário (Enter no preço unitário ou botão) ── */
  async function adicionarItem(e?: React.FormEvent) {
    e?.preventDefault();
    setMensagem("");

    // Produto já selecionado pelo dropdown
    if (produtoSelecionado) {
      confirmarLancamento(produtoSelecionado);
      return;
    }

    // Leitor de barras ou digitação direta: busca exata na API
    const produto = await buscarProdutoAPI();
    if (!produto) {
      setMensagem(`Produto "${codigoBusca}" não encontrado.`);
      return;
    }
    // Preenche preço se ainda não preenchido
    if (!precoUnitario) {
      setPrecoUnitario(String((produto.preco ?? 0).toFixed(2)).replace(".", ","));
    }
    confirmarLancamento(produto);
  }

  /* ── Remove item do carrinho (sem proteção — usado internamente) ── */
  function removerItemDireto(id: string) {
    setCarrinho((prev) => prev.filter((i) => i.id !== id));
  }

  /* ── Cancela item (verifica permissão, depois pede senha se necessário) ── */
  function pedirSenhaCancelarItem(itemId: string) {
    const item = carrinho.find((i) => i.id === itemId);
    if (!item) return;
    if (exigirPro("cancelar_item")) return;
    if (!temPerm("perm_cancelar_item")) { semPermissao("cancelar item"); return; }
    pedirSenha(
      "Cancelar item",
      `Cancelar "${item.produto.nome}" — ${item.quantidade} × ${moedaBR(item.precoUnitario)}?`,
      async () => {
        const { error: errIns } = await supabase.from("itens_cancelados").insert([{
          operador:     nomeOperador,
          produto_nome: item.produto.nome,
          quantidade:   item.quantidade,
          preco:        item.precoUnitario,
          motivo:       "Cancelado pelo operador no PDV",
        }]);
        if (errIns) {
          setMensagem(`⚠️ Erro ao registrar cancelamento: ${errIns.message}`);
          setTimeout(() => setMensagem(""), 6000);
        }
        removerItemDireto(itemId);
      }
    );
  }

  /* ── Cancela cupom inteiro (verifica permissão) ── */
  function pedirSenhaCancelarCupom() {
    if (carrinho.length === 0) return;
    if (exigirPro("cancelar_venda")) return;
    if (!temPerm("perm_cancelar_venda")) { semPermissao("cancelar cupom"); return; }
    pedirSenha(
      "Cancelar cupom",
      `Cancelar cupom com ${totalItens} itens — Total ${moedaBR(totalGeral)}?`,
      async () => {
        await supabase.from("cupons_cancelados").insert([{
          operador: nomeOperador,
          total:    totalGeral,
          motivo:   "Cancelado pelo operador no PDV",
        }]);
        setCarrinho([]);
        setClienteLabel("Sem cliente identificado");
        setCpf("");
        setMostrarModalCPF(true);
        setMensagem("");
      }
    );
  }

  /* ── Sangria ── */
  async function confirmarSangria() {
    const valor = parseFloat(valorSangria.replace(",", "."));
    if (!valor || valor <= 0) return;
    setSalvandoSangria(true);
    const { error: errSangria } = await supabase.from("sangrias").insert([{
      operador:    nomeOperador,
      valor,
      observacao:  obsSangria || null,
    }]);
    if (errSangria) {
      setMensagem(`⚠️ Erro ao registrar sangria: ${errSangria.message}`);
      setTimeout(() => setMensagem(""), 6000);
    }
    const novoTotal = Math.max(0, totalCaixa - valor);
    setTotalCaixa(novoTotal);
    localStorage.setItem("pdv_total_caixa", String(novoTotal));
    setModalSangria(false);
    setValorSangria("");
    setObsSangria("");
    setSalvandoSangria(false);
  }

  function abrirSangria() {
    if (exigirPro("sangria")) return;
    if (!temPerm("perm_sangria")) { semPermissao("realizar sangria"); return; }
    pedirSenha(
      "Autorizar sangria",
      totalCaixa >= 300
        ? `⚠️ Caixa com ${moedaBR(totalCaixa)} — acima do limite. Informe a senha para retirar.`
        : "Informe a senha ADM para registrar a sangria.",
      async () => { setModalSangria(true); }
    );
  }

  /* ── Carrega dados dos relatórios ── */
  async function abrirRelatorios() {
    if (exigirPro("relatorios")) return;
    if (!temPerm("perm_relatorios")) { semPermissao("ver relatórios"); return; }
    setModalRelatorios(true);
    setErroRelatorio(null);
    setCarregandoRel(true);
    try {
      const [rC, rIt, rS, rOp] = await Promise.all([
        supabase.from("cupons_cancelados").select("*").order("created_at", { ascending: false }).limit(100),
        supabase.from("itens_cancelados").select("*").order("created_at", { ascending: false }).limit(100),
        supabase.from("sangrias").select("*").order("created_at", { ascending: false }).limit(100),
        supabase.from("operadores").select("id, nome, username, blocked").order("username", { ascending: true }),
      ]);
      // Detecta qualquer erro vindo do Supabase
      const erros = [
        rC.error  && `cupons_cancelados: ${rC.error.message}`,
        rIt.error && `itens_cancelados: ${rIt.error.message}`,
        rS.error  && `sangrias: ${rS.error.message}`,
        rOp.error && `operadores: ${rOp.error.message}`,
      ].filter(Boolean);
      if (erros.length) setErroRelatorio(erros.join(" | "));
      setRelCupons(rC.data  || []);
      setRelItens(rIt.data  || []);
      setRelSangrias(rS.data || []);
      setRelOperadores(rOp.data || []);
    } catch (ex: any) {
      setErroRelatorio(ex?.message || "Erro inesperado ao carregar relatórios");
    }
    setCarregandoRel(false);
  }

  /* ── Fechamento de caixa ── */
  async function abrirFechamento() {
    if (exigirPro("fechamento_caixa")) return;
    if (!temPerm("perm_relatorios")) { semPermissao("fechar caixa"); return; }
    pedirSenha("Fechar Caixa", "Informe a senha ADM para conferir e fechar o caixa.", async () => {
      setModalFechamento(true);
      setCarregandoFechamento(true);
      setEtapaFechamento("gaveta");
      setValorGaveta("");
      setObsFechamento("");
      const hoje = new Date().toISOString().slice(0, 10);
      const { data: vendas } = await supabase
        .from("vendas")
        .select("total, tipo_pagamento")
        .gte("created_at", hoje + "T00:00:00")
        .lte("created_at", hoje + "T23:59:59");
      const { data: sangrias } = await supabase
        .from("sangrias")
        .select("valor")
        .gte("created_at", hoje + "T00:00:00")
        .lte("created_at", hoje + "T23:59:59");
      const vs = vendas || [];
      const totalVendas   = vs.reduce((s: number, v: any) => s + Number(v.total || 0), 0);
      const totalDinheiro = vs.filter((v: any) => (v.tipo_pagamento || "").toLowerCase() === "dinheiro").reduce((s: number, v: any) => s + Number(v.total || 0), 0);
      const totalPix      = vs.filter((v: any) => (v.tipo_pagamento || "").toLowerCase() === "pix").reduce((s: number, v: any) => s + Number(v.total || 0), 0);
      const totalCartao   = vs.filter((v: any) => ["cartão","cartao"].includes((v.tipo_pagamento || "").toLowerCase())).reduce((s: number, v: any) => s + Number(v.total || 0), 0);
      const totalSangrias = (sangrias || []).reduce((s: number, sg: any) => s + Number(sg.valor || 0), 0);
      setFechamentoData({
        totalVendas, totalDinheiro, totalPix, totalCartao,
        totalSangrias, saldoFinal: totalCaixa, qtdVendas: vs.length,
      });
      setCarregandoFechamento(false);
      // Foca o campo valor gaveta após carregar
      setTimeout(() => refValorGaveta.current?.focus(), 100);
    });
  }

  async function confirmarFechamento() {
    if (fechandoCaixa) return;
    setFechandoCaixa(true);
    await supabase.from("fechamentos_caixa").insert([{
      operador:        nomeOperador,
      total_vendas:    fechamentoData?.totalVendas   ?? 0,
      total_dinheiro:  fechamentoData?.totalDinheiro ?? 0,
      total_pix:       fechamentoData?.totalPix      ?? 0,
      total_cartao:    fechamentoData?.totalCartao   ?? 0,
      total_sangrias:  fechamentoData?.totalSangrias ?? 0,
      saldo_final:     fechamentoData?.saldoFinal    ?? 0,
      qtd_vendas:      fechamentoData?.qtdVendas     ?? 0,
      valor_gaveta:    gavetaNum,
      diferenca_gaveta: difGav,
      obs:             obsFechamento.trim() || null,
    }]);
    setTotalCaixa(0);
    setValorAberturaNum(0);
    localStorage.setItem("pdv_total_caixa",    "0");
    localStorage.removeItem("pdv_caixa_aberto");
    localStorage.removeItem("pdv_valor_abertura");
    setModalFechamento(false);
    setFechamentoData(null);
    setFechandoCaixa(false);
    setEtapaFechamento("gaveta");
    setValorGaveta("");
    setObsFechamento("");
    setMensagem("✅ Caixa fechado com sucesso!");
    setTimeout(() => setMensagem(""), 4000);
  }

  /* ── Buscar cupons ── */
  async function abrirBuscarCupons() {
    if (exigirPro("buscar_cupons")) return;
    if (!temPerm("perm_buscar_cupons")) { semPermissao("buscar cupons"); return; }
    setModalCupons(true);
    setFiltroData(new Date().toISOString().slice(0, 10)); // hoje por padrão
    setFiltroCPF("");
    await carregarCupons("", new Date().toISOString().slice(0, 10));
    setTimeout(() => refFiltroCPF.current?.focus(), 80);
  }

  async function reimprimirCupomDoBanco(venda: any) {
    // Busca itens da venda no banco
    const { data: itensDB } = await supabase
      .from("itens_venda")
      .select("produto_nome, quantidade, preco")
      .eq("venda_id", venda.id);

    const itens: { nome: string; quantidade: number; precoUnitario: number }[] =
      (itensDB || []).map((r: any) => ({
        nome:          r.produto_nome || "Produto",
        quantidade:    Number(r.quantidade),
        precoUnitario: Number(r.preco),
      }));

    // Reconstrói totais a partir dos itens (ou usa dados da venda se itens vazios)
    const totalGeral = itens.length > 0
      ? itens.reduce((s, i) => s + i.quantidade * i.precoUnitario, 0)
      : (venda.total || 0) + (venda.desconto || 0);

    const dtVenda = new Date(venda.created_at);
    const dataHora = dtVenda.toLocaleDateString("pt-BR") + "  " +
      dtVenda.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

    const cpfFormatado = venda.cliente_cpf
      ? String(venda.cliente_cpf).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4")
      : "";

    imprimirCupom({
      itens,
      totalGeral,
      descontoVal:     Number(venda.desconto || 0),
      totalFinal:      Number(venda.total || 0),
      tipoPagamento:   venda.tipo_pagamento || "—",
      valorRecebidoVal: Number(venda.valor_recebido || venda.total || 0),
      troco:           Number(venda.troco || 0),
      nomeOperador:    venda.operador || "—",
      clienteLabel:    cpfFormatado || "Sem cliente",
      cpf:             cpfFormatado,
      dataHora,
      reimpressao:     true,
    });
  }

  async function carregarCupons(cpf: string, data: string) {
    setCarregandoCupons(true);
    let q = supabase
      .from("vendas")
      .select("id, created_at, total, tipo_pagamento, operador, desconto, troco, valor_recebido, cliente_cpf")
      .order("created_at", { ascending: false })
      .limit(60);
    if (cpf.replace(/\D/g, "")) q = q.eq("cliente_cpf", cpf.replace(/\D/g, ""));
    if (data) {
      q = q.gte("created_at", data + "T00:00:00")
           .lte("created_at", data + "T23:59:59");
    }
    const { data: rows } = await q;
    setCupons(rows || []);
    setCarregandoCupons(false);
  }

  /* ── Totais ── */
  const totalItens = useMemo(
    () => carrinho.reduce((acc, i) => acc + i.quantidade, 0),
    [carrinho]
  );

  const totalGeral = useMemo(
    () => carrinho.reduce((acc, i) => acc + i.quantidade * i.precoUnitario, 0),
    [carrinho]
  );

  const nomeOperador = operador?.nome || operador?.username || "—";

  /* ── Computados do finalizar ── */
  const descontoVal = useMemo(() => {
    const n = parseFloat((desconto || "0").replace(",", ".")) || 0;
    if (tipoDesconto === "%") return Math.min(totalGeral, totalGeral * n / 100);
    return Math.min(totalGeral, n);
  }, [desconto, tipoDesconto, totalGeral]);

  const totalFinal = useMemo(
    () => Math.max(0, totalGeral - descontoVal),
    [totalGeral, descontoVal]
  );
  const valorRecebidoVal = useMemo(
    () => parseFloat((valorRecebido || "0").replace(",", ".")) || 0,
    [valorRecebido]
  );
  const troco = useMemo(
    () => Math.max(0, valorRecebidoVal - totalFinal),
    [valorRecebidoVal, totalFinal]
  );

  /* ── Gera e imprime o cupom numa janela popup ── */
  type ItensCupom = { nome: string; quantidade: number; precoUnitario: number };

  function imprimirCupom(dados: {
    itens: ItensCupom[]; totalGeral: number; descontoVal: number; totalFinal: number;
    tipoPagamento: string; valorRecebidoVal: number; troco: number;
    nomeOperador: string; clienteLabel: string; cpf: string;
    dataHora?: string; // opcional – se não passado usa "agora"
    reimpressao?: boolean;
  }) {
    const mm  = cupomCfg.largura;                    // 58 ou 80
    const pt  = mm === 58 ? "8pt" : "9pt";           // tamanho de fonte
    const ptG = mm === 58 ? "11pt" : "13pt";         // fonte do TOTAL
    // largura interna = papel − margens (4mm cada lado)
    const interno = `${mm - 8}mm`;

    const cab = (cupomCfg.cabecalho || cupomCfg.nome || "")
      .split("\n")
      .map((l) => `<div class="c">${l}</div>`)
      .join("");

    const rod = (cupomCfg.rodape || "")
      .split("\n")
      .map((l) => `<div class="c">${l}</div>`)
      .join("");

    const dtStr = dados.dataHora ?? (() => {
      const agora = new Date();
      return agora.toLocaleDateString("pt-BR") + "  " +
        agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    })();

    const semItens = dados.itens.length === 0;
    const itensHtml = semItens
      ? `<tr><td colspan="4" style="text-align:center;padding:4px;color:#888;font-style:italic">Itens não registrados</td></tr>`
      : dados.itens.map((item) => {
          const qtd = item.quantidade % 1 === 0
            ? String(item.quantidade)
            : item.quantidade.toFixed(3);
          return `<tr>
            <td class="nome">${item.nome}</td>
            <td class="r">${qtd}</td>
            <td class="r">${moedaBR(item.precoUnitario)}</td>
            <td class="r b">${moedaBR(item.quantidade * item.precoUnitario)}</td>
          </tr>`;
        }).join("");

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  @page {
    size: ${mm}mm auto;
    margin: 4mm;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: ${interno};
    font-family: 'Courier New', Courier, monospace;
    font-size: ${pt};
    color: #000;
    line-height: 1.6;
  }
  .c  { text-align: center; }
  .r  { text-align: right; }
  .b  { font-weight: bold; }
  hr  { border: none; border-top: 1px dashed #000; margin: 4px 0; }
  /* tabela de itens */
  table { width: 100%; border-collapse: collapse; }
  td    { padding: 1px 2px; vertical-align: top; }
  .nome { width: 45%; word-break: break-word; }
  .r    { white-space: nowrap; }
  /* linha de totais */
  .tot  { display: flex; justify-content: space-between; padding: 1px 0; }
  .tot-grande { font-size: ${ptG}; font-weight: bold; }
</style>
</head><body>

${cab}
<hr>
<div class="c b">CUPOM NÃO FISCAL</div>
${dados.reimpressao ? `<div class="c b" style="font-size:${ptG}">&gt;&gt; REIMPRESSÃO &lt;&lt;</div>` : ""}
<div class="c">${dtStr}</div>
<div>Operador: ${dados.nomeOperador}</div>
${dados.cpf ? `<div>CPF: ${dados.clienteLabel}</div>` : ""}
<hr>

<table>
  <thead>
    <tr>
      <td class="nome b">ITEM</td>
      <td class="r b">QTD</td>
      <td class="r b">UNIT</td>
      <td class="r b">TOTAL</td>
    </tr>
  </thead>
  <tbody>
    ${itensHtml}
  </tbody>
</table>
<hr>

${dados.descontoVal > 0 ? `
  <div class="tot"><span>Subtotal</span><span>${moedaBR(dados.totalGeral)}</span></div>
  <div class="tot"><span>Desconto</span><span>- ${moedaBR(dados.descontoVal)}</span></div>
` : ""}
<div class="tot tot-grande"><span>TOTAL</span><span>${moedaBR(dados.totalFinal)}</span></div>
<hr>

<div class="tot"><span>Pagamento</span><span>${dados.tipoPagamento}</span></div>
${dados.tipoPagamento === "Dinheiro" ? `
  <div class="tot"><span>Recebido</span><span>${moedaBR(dados.valorRecebidoVal)}</span></div>
  <div class="tot b"><span>Troco</span><span>${moedaBR(dados.troco)}</span></div>
` : ""}
<hr>

${rod}
<hr>
<div class="c" style="font-size:7pt">Sistema Horti Gestão</div>
<br>
</body></html>`;

    // Impressão via iframe oculto — abre o diálogo do sistema diretamente, sem popup
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
      setTimeout(() => { if (document.body.contains(iframe)) document.body.removeChild(iframe); }, 3000);
    }, 400);
  }

  /* ── Abre o caixa com fundo inicial ── */
  function abrirCaixa() {
    const valor = parseFloat(valorAbertura.replace(",", ".")) || 0;
    setTotalCaixa(valor);
    setValorAberturaNum(valor);
    localStorage.setItem("pdv_total_caixa",    String(valor));
    localStorage.setItem("pdv_caixa_aberto",   "true");
    localStorage.setItem("pdv_valor_abertura", String(valor));
    setModalAbrirCaixa(false);
    setValorAbertura("");
    if (valor > 0) {
      setMensagem(`✅ Caixa aberto — Fundo: ${moedaBR(valor)}`);
      setTimeout(() => setMensagem(""), 4000);
    }
    setTimeout(() => refCodigo.current?.focus(), 80);
  }

  /* ── Seleciona tipo de pagamento (botões e teclado) ── */
  function selecionarPagamento(tipo: "dinheiro" | "pix" | "cartao" | "fiado") {
    setTipoPagamento(tipo);
    setDesconto("");
    setClienteFiado(null);
    setErroFiado("");
    if (tipo === "fiado") {
      const cpfAtual = cpf.replace(/\D/g, "");
      if (cpfAtual.length === 11) buscarClienteFiado(cpfAtual);
    } else {
      setTimeout(() => refValorRecebido.current?.focus(), 30);
    }
  }

  /* ── Abre modal finalizar ── */
  function abrirFinalizar() {
    if (carrinho.length === 0) { setMensagem("Adicione itens antes de finalizar."); return; }
    if (!temPerm("perm_finalizar")) { semPermissao("finalizar venda"); return; }
    setDesconto("");
    setTipoDesconto("R$");
    setValorRecebido("");
    setTipoPagamento("dinheiro");
    setModalFinalizar(true);
    setTimeout(() => refValorRecebido.current?.focus(), 80);
  }

  /* ── Label amigável do tipo de pagamento ── */
  const labelPagamento =
    tipoPagamento === "dinheiro" ? "Dinheiro" :
    tipoPagamento === "pix"     ? "PIX"      :
    tipoPagamento === "fiado"   ? "Fiado"    : "Cartão";

  /* ── Busca cliente por CPF para fiado ── */
  async function buscarClienteFiado(cpfRaw: string) {
    const cpfLimpo = cpfRaw.replace(/\D/g, "");
    if (!cpfLimpo) { setErroFiado("Informe o CPF do cliente para fiado."); return; }
    setBuscandoFiado(true);
    setErroFiado("");
    setClienteFiado(null);
    const { data } = await supabase
      .from("clientes")
      .select("id, nome, limite_credito, saldo_fiado")
      .eq("cpf", cpfLimpo)
      .maybeSingle();
    setBuscandoFiado(false);
    if (!data) { setErroFiado("Cliente não encontrado. Cadastre-o antes de usar fiado."); return; }
    setClienteFiado(data as { id: string; nome: string; limite_credito: number; saldo_fiado: number });
  }

  /* ── Grava venda — online primeiro, offline como fallback ── */
  async function confirmarVenda() {
    if (finalizando) return;

    // Validação fiado
    if (tipoPagamento === "fiado") {
      if (!clienteFiado) { setErroFiado("Busque o cliente pelo CPF antes de confirmar."); return; }
      const disponivel = (clienteFiado.limite_credito || 0) - (clienteFiado.saldo_fiado || 0);
      if (totalFinal > disponivel) {
        setErroFiado(`Limite insuficiente. Disponível: ${moedaBR(disponivel)}`);
        return;
      }
    }

    setFinalizando(true);
    try {
      const ehDinheiro = tipoPagamento === "dinheiro";

      // Monta os payloads uma vez só
      const vendaPayload: Record<string, unknown> = {
        total:           totalFinal,
        tipo_pagamento:  labelPagamento,
        operador:        nomeOperador,
        desconto:        descontoVal,
        valor_recebido:  ehDinheiro ? valorRecebidoVal : totalFinal,
        troco:           ehDinheiro ? troco : 0,
        cliente_cpf:     cpf.replace(/\D/g, "") || null,
        cliente_id:      tipoPagamento === "fiado" ? (clienteFiado?.id ?? null) : null,
      };

      const itensSalvos = carrinho.map((item) => ({
        produto_id:   item.produto.id,
        produto_nome: item.produto.nome,
        quantidade:   item.quantidade,
        preco:        item.precoUnitario,
      }));

      const estoqueDeltas = carrinho.map((item) => ({
        id: item.produto.id, delta: item.quantidade,
      }));

      const fiadoUpdate = (tipoPagamento === "fiado" && clienteFiado)
        ? { clienteId: clienteFiado.id, delta: totalFinal }
        : null;

      // ── Tenta gravar online ──────────────────────────────────────────────
      let gravouOnline = false;
      try {
        const { data: vendaData, error } = await supabase
          .from("vendas").insert([vendaPayload]).select().single();

        if (!error && vendaData?.id) {
          // Itens
          await supabase.from("itens_venda").insert(
            itensSalvos.map((i) => ({ ...i, venda_id: vendaData.id }))
          );
          // Estoque
          for (const upd of estoqueDeltas) {
            const { data: prod } = await supabase
              .from("produtos").select("estoque").eq("id", upd.id).maybeSingle();
            const atual = Number((prod as { estoque?: number } | null)?.estoque ?? 0);
            await supabase.from("produtos")
              .update({ estoque: Math.max(0, atual - upd.delta) }).eq("id", upd.id);
          }
          // Fiado
          if (fiadoUpdate && clienteFiado) {
            await supabase.from("clientes")
              .update({ saldo_fiado: (clienteFiado.saldo_fiado || 0) + totalFinal })
              .eq("id", clienteFiado.id);
          }
          gravouOnline = true;
        }
      } catch {
        // Sem internet ou erro de rede → vai para fila offline
      }

      // ── Fallback offline ─────────────────────────────────────────────────
      if (!gravouOnline) {
        await savePendingVenda({
          localId:       crypto.randomUUID(),
          vendaPayload,
          itens:         itensSalvos,
          estoqueDeltas,
          fiadoUpdate,
          createdAt:     new Date().toISOString(),
        });
        // Debita estoque no IndexedDB para manter autocomplete correto offline
        for (const upd of estoqueDeltas) {
          await debitarEstoqueLocal(upd.id, upd.delta);
        }
        const c = await countPendingVendas();
        setPendingCount(c);
      }

      // ── Atualiza caixa (local — independe de online/offline) ─────────────
      if (ehDinheiro) {
        const novoTotal = totalCaixa + totalFinal;
        setTotalCaixa(novoTotal);
        localStorage.setItem("pdv_total_caixa", String(novoTotal));
      }

      // ── Imprime cupom ────────────────────────────────────────────────────
      imprimirCupom({
        itens: carrinho.map((i) => ({
          nome: i.produto.nome, quantidade: i.quantidade, precoUnitario: i.precoUnitario,
        })),
        totalGeral, descontoVal, totalFinal,
        tipoPagamento: labelPagamento,
        valorRecebidoVal: ehDinheiro ? valorRecebidoVal : totalFinal,
        troco: ehDinheiro ? troco : 0,
        nomeOperador, clienteLabel, cpf,
      });

      // ── Limpa cupom ──────────────────────────────────────────────────────
      setCarrinho([]);
      setClienteLabel("Sem cliente identificado");
      setCpf("");
      setClienteFiado(null);
      setErroFiado("");
      setModalFinalizar(false);
      setMostrarModalCPF(true);

      if (!gravouOnline) {
        setMensagem("📶 Venda salva localmente — será enviada quando conectar.");
        setTimeout(() => setMensagem(""), 6000);
      } else {
        setMensagem("");
      }
    } finally {
      setFinalizando(false);
    }
  }

  /* ─────────────────────────── RENDER ─────────────────────────── */
  return (
    <main
      style={{
        height: "100vh",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        background: "linear-gradient(180deg, #0c121a 0%, #101722 38%, #111827 100%)",
        color: "#e5e7eb",
        padding: "6px 10px 8px",
        fontFamily: "Segoe UI, Arial, sans-serif",
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: 1580, margin: "0 auto", width: "100%", flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "2px 0 6px", flexShrink: 0 }}>
          <div style={{ width: 180, display: "flex", alignItems: "center" }}>
            <button
              onClick={() => {
                const base = window.location.origin;
                window.open(`${base}/adm`, "_blank", "width=1280,height=800");
              }}
              title="Abrir painel ADM"
              style={{
                background: "rgba(255,255,255,0.07)",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 8,
                color: "rgba(255,255,255,0.70)",
                fontSize: 13,
                fontWeight: 700,
                padding: "5px 14px",
                cursor: "pointer",
                letterSpacing: 1,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              ⚙️ ADM
            </button>
          </div>
          <div style={{ textAlign: "center", fontSize: 26, letterSpacing: 10, color: "rgba(255,255,255,.38)", fontWeight: 300 }}>
            FRENTE DE CAIXA
          </div>
          <div style={{ width: 180, display: "flex", justifyContent: "flex-end" }}>
            <Relogio />
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(300px, 380px) minmax(480px, 1fr) 230px",
            gap: 10,
            alignItems: "stretch",
            flex: 1,
            minHeight: 0,
          }}
        >
          {/* ── Coluna esquerda: entrada ── */}
          <section style={colPanel}>
            <form onSubmit={adicionarItem} style={{ flexShrink: 0 }}>
              <Campo label="Código / EAN / produto  —  F2 para focar">
                <div style={{ position: "relative" }}>
                  <input
                    ref={refCodigo}
                    value={codigoBusca}
                    onChange={(e) => aoDigitarBusca(e.target.value)}
                    onKeyDown={onKeyDownBusca}
                    placeholder="Digite 3 letras ou bipe o código"
                    autoComplete="off"
                    style={inputGrande}
                  />
                  {sugestoes.length > 0 && (
                    <div style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      left: 0,
                      right: 0,
                      zIndex: 200,
                      background: "#0f172a",
                      border: "1px solid rgba(255,255,255,.14)",
                      borderRadius: 12,
                      overflow: "hidden",
                      boxShadow: "0 12px 32px rgba(0,0,0,.6)",
                    }}>
                      {sugestoes.map((p, i) => (
                        <div
                          key={p.id}
                          onMouseDown={(e) => { e.preventDefault(); selecionarSugestao(p); }}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "10px 14px",
                            cursor: "pointer",
                            background: i === sugestaoIdx ? "rgba(31,170,74,.22)" : "transparent",
                            borderBottom: "1px solid rgba(255,255,255,.05)",
                            transition: "background .1s",
                          }}
                          onMouseEnter={() => setSugestaoIdx(i)}
                        >
                          <div>
                            <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 15 }}>{p.nome}</div>
                            <div style={{ color: "#475569", fontSize: 12, marginTop: 1 }}>
                              {[p.codigo && `Cód: ${p.codigo}`, p.ean && `EAN: ${p.ean}`].filter(Boolean).join("  ·  ") || p.unidade}
                            </div>
                          </div>
                          <div style={{ color: "#1faa4a", fontWeight: 900, fontSize: 16, marginLeft: 12, whiteSpace: "nowrap" }}>
                            {moedaBR(p.preco ?? 0)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Campo>

              <Campo label="Quantidade pesada / unidades">
                <input
                  ref={refQtd}
                  style={{ ...inputGrande, textAlign: "right", fontSize: 22, fontWeight: 500 }}
                  value={quantidade}
                  onChange={(e) => setQuantidade(e.target.value)}
                  onKeyDown={onKeyDownQtd}
                  inputMode="decimal"
                  placeholder="1"
                />
              </Campo>

              <Campo label="Preço unitário">
                <input
                  ref={refPrecoUnit}
                  style={{ ...inputGrande, textAlign: "right", fontSize: 20, fontWeight: 800 }}
                  value={precoUnitario}
                  onChange={(e) => setPrecoUnitario(e.target.value)}
                  placeholder="0,00"
                  inputMode="decimal"
                />
              </Campo>

              <Campo label="Preço total">
                <div
                  style={{
                    ...inputGrande,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    fontSize: 26,
                    fontWeight: 900,
                    color: precoTotalLinha > 0 ? "#1faa4a" : "rgba(255,255,255,.25)",
                    letterSpacing: 0.5,
                    userSelect: "none",
                  }}
                >
                  {moedaBR(precoTotalLinha)}
                </div>
              </Campo>

              <button
                type="submit"
                style={{
                  width: "100%",
                  marginTop: 8,
                  height: 46,
                  border: "none",
                  borderRadius: 12,
                  background: produtoSelecionado ? "#1faa4a" : "#374151",
                  color: "#fff",
                  fontWeight: 900,
                  fontSize: 17,
                  cursor: "pointer",
                  transition: "background .2s",
                }}
              >
                {produtoSelecionado ? `✔ Lançar  ${produtoSelecionado.nome}` : "+ Adicionar item (Enter)"}
              </button>
            </form>

            {mensagem ? (
              <div style={{ marginTop: 12, background: "#7f1d1d", color: "#fca5a5", borderRadius: 10, padding: "10px 14px", fontSize: 14 }}>
                {mensagem}
              </div>
            ) : null}

            <div
              style={{
                marginTop: 12,
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,.08)",
                background: "rgba(255,255,255,.04)",
                flex: 1,
                minHeight: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                padding: 12,
              }}
            >
              {logoSrc ? (
                <img
                  src={logoSrc}
                  alt="Logo da empresa"
                  style={{ maxWidth: "100%", maxHeight: 240, objectFit: "contain", filter: "drop-shadow(0 4px 10px rgba(0,0,0,.35))" }}
                />
              ) : (
                <div style={{ color: "rgba(255,255,255,.2)", fontSize: 18, fontWeight: 700 }}>LOGO</div>
              )}
            </div>
          </section>

          {/* ── Coluna central: lista de itens ── */}
          <section
            style={{
              ...colPanel,
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Cabeçalho da tabela */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.6fr .6fr .8fr .9fr 32px",
                gap: 8,
                color: "#94a3b8",
                fontWeight: 700,
                fontSize: 14,
                padding: "0 4px 10px",
                borderBottom: "1px solid rgba(255,255,255,.08)",
              }}
            >
              <div>Item</div>
              <div style={{ textAlign: "right" }}>Qtd</div>
              <div style={{ textAlign: "right" }}>Unit.</div>
              <div style={{ textAlign: "right" }}>Total</div>
              <div />
            </div>

            {/* Lista de itens */}
            <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
              {carrinho.length === 0 ? (
                <div style={{ color: "#475569", fontSize: 16, padding: "18px 4px" }}>
                  Nenhum item lançado
                </div>
              ) : (
                carrinho.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.6fr .6fr .8fr .9fr 32px",
                      gap: 8,
                      alignItems: "center",
                      padding: "10px 4px",
                      borderBottom: "1px solid rgba(255,255,255,.05)",
                      color: "#e2e8f0",
                      fontSize: 15,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700 }}>{item.produto.nome}</div>
                      <div style={{ fontSize: 12, color: "#64748b" }}>{item.produto.unidade || "Un"}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      {item.quantidade % 1 === 0 ? item.quantidade : item.quantidade.toFixed(3)}
                    </div>
                    <div style={{ textAlign: "right" }}>{moedaBR(item.precoUnitario)}</div>
                    <div style={{ textAlign: "right", fontWeight: 700 }}>
                      {moedaBR(item.quantidade * item.precoUnitario)}
                    </div>
                    <button
                      type="button"
                      onClick={() => pedirSenhaCancelarItem(item.id)}
                      title="Cancelar item (senha ADM)"
                      style={{
                        width: 28,
                        height: 28,
                        border: "none",
                        borderRadius: 8,
                        background: "rgba(239,68,68,.2)",
                        color: "#f87171",
                        cursor: "pointer",
                        fontSize: 16,
                        display: "grid",
                        placeItems: "center",
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Modal CPF sobreposto */}
            {mostrarModalCPF ? (
              <div
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(0,0,0,.65)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 16,
                  zIndex: 999,
                }}
              >
                <div
                  style={{
                    width: 440,
                    background: "#ffffff",
                    borderRadius: 18,
                    boxShadow: "0 18px 45px rgba(0,0,0,.40)",
                    padding: 22,
                  }}
                >
                  <div style={{ color: "#0f172a", fontWeight: 800, fontSize: 19, marginBottom: 20 }}>
                    CPF na compra
                  </div>
                  <div style={{ color: "#1e293b", fontWeight: 700, fontSize: 14, marginBottom: 12 }}>
                    Digite o CPF ou pressione Enter para seguir sem CPF
                  </div>
                  <input
                    autoFocus
                    value={cpf}
                    onChange={(e) => setCpf(formatarCPF(e.target.value))}
                    placeholder="000.000.000-00"
                    style={{
                      width: "100%",
                      height: 42,
                      borderRadius: 10,
                      border: `1px solid ${cpf.replace(/\D/g,"").length === 11 && !validarCPF(cpf) ? "#ef4444" : "#d7dbe2"}`,
                      padding: "0 12px",
                      outline: "none",
                      fontSize: 16,
                      color: "#111827",
                      marginBottom: 4,
                    }}
                  />
                  {cpf.replace(/\D/g,"").length === 11 && !validarCPF(cpf) && (
                    <div style={{ color: "#ef4444", fontSize: 12, fontWeight: 700, marginBottom: 6 }}>CPF inválido</div>
                  )}
                  <div style={{ color: "#64748b", fontSize: 13, marginBottom: 14 }}>
                    ESC — sem CPF e fechar
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <button
                      type="button"
                      onClick={fecharModalCPF}
                      style={{ height: 38, border: "1px solid #d7dbe2", borderRadius: 8, background: "#f8fafc", color: "#374151", fontWeight: 700, fontSize: 14, cursor: "pointer" }}
                    >
                      Sem CPF
                    </button>
                    <button
                      type="button"
                      onClick={confirmarCPF}
                      style={{ height: 38, border: "none", borderRadius: 8, background: "#1faa4a", color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer" }}
                    >
                      Confirmar
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Rodapé: contagem e total */}
            <div style={{ marginTop: "auto", paddingTop: 10, borderTop: "1px solid rgba(255,255,255,.08)" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  color: "rgba(255,255,255,.55)",
                  fontWeight: 700,
                  fontSize: 16,
                  marginBottom: 8,
                }}
              >
                <div>Total geral</div>
                <div>{totalItens} {totalItens === 1 ? "item" : "itens"}</div>
              </div>

              <div
                style={{
                  background: "linear-gradient(180deg, rgba(64,72,89,.65), rgba(43,50,65,.8))",
                  borderRadius: 12,
                  minHeight: 80,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 48,
                  fontWeight: 900,
                  color: "#f0fdf4",
                  letterSpacing: 1,
                }}
              >
                {moedaBR(totalGeral)}
              </div>
            </div>
          </section>

          {/* ── Coluna direita: operador + atalhos ── */}
          <aside style={colPanel}>
            {/* Indicador online/offline */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginBottom: 6, padding: "5px 10px", borderRadius: 10,
              background: isOnline ? "rgba(31,170,74,.12)" : "rgba(239,68,68,.14)",
              border: `1px solid ${isOnline ? "rgba(31,170,74,.3)" : "rgba(239,68,68,.3)"}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ fontSize: 10 }}>{isOnline ? "🟢" : "🔴"}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: isOnline ? "#4ade80" : "#f87171" }}>
                  {sincronizando ? "Sincronizando..." : isOnline ? "Online" : "Offline"}
                </span>
              </div>
              {pendingCount > 0 && (
                <span style={{
                  background: "#ef4444", color: "#fff", borderRadius: 999,
                  padding: "1px 7px", fontSize: 10, fontWeight: 900,
                }}>
                  {pendingCount} pendente{pendingCount > 1 ? "s" : ""}
                </span>
              )}
            </div>

            {/* Badge de plano */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginBottom: 6, padding: "5px 10px", borderRadius: 10,
              background: plano === "pro"
                ? "rgba(21,128,61,.2)"
                : plano === "trial"
                ? "rgba(180,120,0,.2)"
                : "rgba(185,28,28,.2)",
              border: `1px solid ${plano === "pro" ? "rgba(21,128,61,.4)" : plano === "trial" ? "rgba(180,120,0,.4)" : "rgba(185,28,28,.4)"}`,
              cursor: "pointer",
            }} onClick={() => { setModalLicenca(true); setTimeout(() => refChaveInput.current?.focus(), 80); }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: plano === "pro" ? "#4ade80" : plano === "trial" ? "#fbbf24" : "#f87171" }}>
                {plano === "pro"
                  ? `✅ PRO${clienteLicenca ? " · " + clienteLicenca : ""}`
                  : plano === "trial"
                  ? `⏳ TRIAL — ${diasTrial} dia${diasTrial !== 1 ? "s" : ""}`
                  : "🔴 FREE — Clique para ativar"}
              </span>
            </div>

            <div style={{ color: "rgba(255,255,255,.35)", fontSize: 11, letterSpacing: 0.4, marginBottom: 1 }}>
              OPERADOR
            </div>
            <div style={{ color: "#8bb8ff", fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
              {nomeOperador}
            </div>

            <div
              style={{
                borderRadius: 10,
                background: "#1e293b",
                color: "#e2e8f0",
                padding: "7px 12px",
                marginBottom: 8,
                border: "1px solid rgba(255,255,255,.08)",
              }}
            >
              <div style={{ color: "#64748b", fontSize: 10, letterSpacing: 0.4 }}>CPF NA COMPRA</div>
              <div style={{ fontWeight: 800, fontSize: 13, marginTop: 2 }}>{clienteLabel}</div>
            </div>

            <div style={{ display: "grid", gap: 5, flex: 1, minHeight: 0, overflowY: "hidden" }}>
              <BotaoAtalho tecla="F2"    texto="Buscar produto"  onClick={() => { refCodigo.current?.focus(); refCodigo.current?.select(); }} />
              <BotaoAtalho tecla="F3"    texto="Finalizar venda" cor="#14532d" onClick={abrirFinalizar} />
              <BotaoAtalho tecla="F4"    texto="Buscar cupons"   cor="#1e3a5f" onClick={abrirBuscarCupons} />
              <BotaoAtalho tecla="F6"    texto="Cancelar cupom"  cor="#7f1d1d" onClick={pedirSenhaCancelarCupom} />
              <BotaoAtalho tecla="F7"    texto="Sangria"         cor={totalCaixa >= 300 ? "#7c3500" : "#0f3d4a"}
                onClick={abrirSangria}
                badge={totalCaixa >= 300 ? moedaBR(totalCaixa) : undefined}
              />
              <BotaoAtalho tecla="F8"    texto="Relatórios"      cor="#1e3a5f"
                onClick={() => pedirSenha("Relatórios do Caixa", "Informe a senha ADM para acessar os relatórios.", async () => { abrirRelatorios(); })} />
              <BotaoAtalho tecla="F9"    texto="Fechar Caixa"   cor="#4c1d95" onClick={abrirFechamento} />
              <BotaoAtalho tecla="F10"   texto="Identificar CPF" onClick={() => setMostrarModalCPF(true)} />
              <BotaoAtalho tecla="F12"   texto="Licença / Ativar"
                cor={plano === "free" ? "#7f1d1d" : plano === "trial" ? "#78350f" : "#14532d"}
                onClick={() => { setModalLicenca(true); setTimeout(() => refChaveInput.current?.focus(), 80); }}
              />
              <BotaoAtalho tecla="ESC"   texto="Fechar janela"   onClick={() => window.close()} />
            </div>

            {/* Versão */}
            <div style={{ textAlign: "center", marginTop: 6, color: "rgba(255,255,255,.22)", fontSize: 10, letterSpacing: 0.5 }}>
              Horti Gestão PDV · v{process.env.NEXT_PUBLIC_APP_VERSION || "—"}
            </div>
          </aside>
        </div>
      </div>

      {/* ══════════ MODAL LICENÇA ══════════ */}
      {modalLicenca && (
        <div style={overlay}>
          <div style={{ ...modalBox, width: "min(96vw, 480px)" }}>
            {/* Cabeçalho */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 20, color: "#0f172a" }}>
                  🔑 Ativar Licença Pro
                </div>
                <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>
                  {plano === "trial"
                    ? `Período de avaliação: ${diasTrial} dia${diasTrial !== 1 ? "s" : ""} restante${diasTrial !== 1 ? "s" : ""}`
                    : plano === "pro"
                    ? `Licença ativa${clienteLicenca ? " · " + clienteLicenca : ""}`
                    : "Período de avaliação encerrado"}
                </div>
              </div>
              {plano !== "free" && (
                <button type="button" onClick={() => setModalLicenca(false)}
                  style={{ border: "none", background: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8" }}>×</button>
              )}
            </div>

            {/* Status do plano atual */}
            <div style={{
              padding: "12px 14px", borderRadius: 12, marginBottom: 18,
              background: plano === "pro" ? "#f0fdf4" : plano === "trial" ? "#fffbeb" : "#fef2f2",
              border: `1px solid ${plano === "pro" ? "#bbf7d0" : plano === "trial" ? "#fde68a" : "#fecaca"}`,
            }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: plano === "pro" ? "#15803d" : plano === "trial" ? "#92400e" : "#991b1b" }}>
                {plano === "pro" ? "✅ Plano Pro ativo" : plano === "trial" ? "⏳ Avaliação gratuita" : "🔴 Plano Free (limitado)"}
              </div>
              <div style={{ fontSize: 13, color: "#475569", marginTop: 6, lineHeight: 1.7 }}>
                {plano === "pro"
                  ? "Todos os recursos desbloqueados. Obrigado por usar o Horti Gestão!"
                  : plano === "trial"
                  ? `Você tem ${diasTrial} dia${diasTrial !== 1 ? "s" : ""} de avaliação completa. Ative antes do prazo para não perder os recursos avançados.`
                  : "Somente venda básica disponível. Ative o Pro para desbloquear fiado, sangria, fechamento, relatórios e mais."}
              </div>
            </div>

            {/* Comparativo free vs pro */}
            {plano !== "pro" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 18, fontSize: 12 }}>
                <div style={{ background: "#f8fafc", borderRadius: 10, padding: "10px 12px", border: "1px solid #e2e8f0" }}>
                  <div style={{ fontWeight: 800, color: "#64748b", marginBottom: 8 }}>FREE</div>
                  {["✅ Vender (caixa/pix/cartão)", "✅ Imprimir cupom", "❌ Fiado", "❌ Sangria / Fechamento", "❌ Relatórios", "❌ Cancelar itens", "❌ Desconto"].map(f => (
                    <div key={f} style={{ color: f.startsWith("❌") ? "#94a3b8" : "#374151", marginBottom: 3 }}>{f}</div>
                  ))}
                </div>
                <div style={{ background: "#f0fdf4", borderRadius: 10, padding: "10px 12px", border: "1px solid #bbf7d0" }}>
                  <div style={{ fontWeight: 800, color: "#15803d", marginBottom: 8 }}>PRO ✨</div>
                  {["✅ Tudo do Free", "✅ Fiado com limite", "✅ Sangria / Fechamento", "✅ Relatórios completos", "✅ Cancelar com log", "✅ Desconto R$ / %", "✅ Offline automático"].map(f => (
                    <div key={f} style={{ color: "#166534", marginBottom: 3 }}>{f}</div>
                  ))}
                </div>
              </div>
            )}

            {/* Input da chave */}
            {plano !== "pro" && (
              <>
                <label style={labelModal}>Chave de licença</label>
                <input
                  ref={refChaveInput}
                  type="text"
                  value={chaveInput}
                  onChange={(e) => setChaveInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => { if (e.key === "Enter") ativarLicenca(); if (e.key === "Escape") { if (plano !== "free") setModalLicenca(false); } }}
                  placeholder="HORTI-XXXXX-XXXXX-XXXXX"
                  style={{ ...inputModal, fontSize: 16, fontWeight: 700, letterSpacing: 2, textAlign: "center", marginBottom: erroLicenca ? 6 : 14 }}
                />
                {erroLicenca && (
                  <div style={{ color: "#dc2626", fontSize: 13, fontWeight: 700, marginBottom: 14 }}>{erroLicenca}</div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: plano === "free" ? "1fr" : "1fr 1fr", gap: 10 }}>
                  {plano !== "free" && (
                    <button type="button" onClick={() => setModalLicenca(false)} style={btnCancelarModal}>
                      Continuar no Trial
                    </button>
                  )}
                  <button type="button" onClick={ativarLicenca} disabled={ativandoLicenca || !chaveInput.trim()}
                    style={{ ...btnConfirmarModal, background: "#15803d", opacity: !chaveInput.trim() ? 0.5 : 1 }}>
                    {ativandoLicenca ? "Verificando..." : "🔑 Ativar Licença"}
                  </button>
                </div>
                <div style={{ textAlign: "center", marginTop: 12, fontSize: 12, color: "#94a3b8" }}>
                  Não tem uma chave? Entre em contato para adquirir o Plano Pro.
                </div>
              </>
            )}

            {plano === "pro" && (
              <button type="button" onClick={() => setModalLicenca(false)} style={{ ...btnConfirmarModal, background: "#15803d" }}>
                Fechar
              </button>
            )}
          </div>
        </div>
      )}

      {/* ══════════ MODAL BUSCAR CUPONS ══════════ */}
      {modalCupons && (
        <div style={{ ...overlay, alignItems: "flex-start", paddingTop: 30 }}>
          <div style={{ ...modalBox, width: "min(96vw, 720px)", maxHeight: "88vh", display: "flex", flexDirection: "column" }}>

            {/* Cabeçalho */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 900, fontSize: 18, color: "#0f172a" }}>🔍 Buscar Cupons</div>
              <button type="button" onClick={() => setModalCupons(false)}
                style={{ border: "none", background: "none", fontSize: 22, cursor: "pointer", color: "#475569" }}>×</button>
            </div>

            {/* Filtros */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, marginBottom: 14 }}>
              <div>
                <label style={labelModal}>CPF do cliente</label>
                <input
                  ref={refFiltroCPF}
                  type="text"
                  value={filtroCPF}
                  onChange={(e) => setFiltroCPF(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") carregarCupons(filtroCPF, filtroData); }}
                  placeholder="000.000.000-00"
                  style={inputModal}
                />
              </div>
              <div>
                <label style={labelModal}>Data</label>
                <input
                  type="date"
                  value={filtroData}
                  onChange={(e) => setFiltroData(e.target.value)}
                  style={inputModal}
                />
              </div>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <button type="button"
                  onClick={() => carregarCupons(filtroCPF, filtroData)}
                  style={{ ...btnConfirmarModal, height: 44, padding: "0 18px", whiteSpace: "nowrap" }}>
                  🔍 Buscar
                </button>
              </div>
            </div>

            {/* Resultado */}
            <div style={{ flex: 1, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 10 }}>
              {carregandoCupons ? (
                <div style={{ padding: 20, color: "#64748b" }}>Buscando...</div>
              ) : cupons.length === 0 ? (
                <div style={{ padding: 20, color: "#64748b" }}>Nenhum cupom encontrado.</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", position: "sticky", top: 0 }}>
                      {["Data/Hora", "Operador", "CPF", "Pagamento", "Desconto", "Total", ""].map((h) => (
                        <th key={h} style={{ padding: "9px 10px", textAlign: "left", fontWeight: 700, color: "#374151", borderBottom: "2px solid #e2e8f0", whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cupons.map((v, i) => {
                      const d = new Date(v.created_at);
                      const dt = d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                      return (
                        <tr key={v.id} style={{ background: i % 2 === 0 ? "#fff" : "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "8px 10px", color: "#1e293b", whiteSpace: "nowrap" }}>{dt}</td>
                          <td style={{ padding: "8px 10px", color: "#1e293b" }}>{v.operador || "—"}</td>
                          <td style={{ padding: "8px 10px", color: "#64748b" }}>
                            {v.cliente_cpf
                              ? String(v.cliente_cpf).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4")
                              : "—"}
                          </td>
                          <td style={{ padding: "8px 10px" }}>
                            <span style={{
                              borderRadius: 999, padding: "2px 9px", fontSize: 12, fontWeight: 700,
                              background: v.tipo_pagamento === "Dinheiro" ? "#dcfce7" : "#dbeafe",
                              color:      v.tipo_pagamento === "Dinheiro" ? "#15803d"  : "#1d4ed8",
                            }}>{v.tipo_pagamento || "—"}</span>
                          </td>
                          <td style={{ padding: "8px 10px", color: "#dc2626", textAlign: "right" }}>
                            {v.desconto > 0 ? `- ${moedaBR(v.desconto)}` : "—"}
                          </td>
                          <td style={{ padding: "8px 10px", fontWeight: 800, color: "#15803d", textAlign: "right" }}>
                            {moedaBR(v.total || 0)}
                          </td>
                          <td style={{ padding: "6px 8px" }}>
                            <button
                              type="button"
                              onClick={() => reimprimirCupomDoBanco(v)}
                              style={{
                                border: "1px solid #93c5fd",
                                background: "#eff6ff",
                                color: "#1d4ed8",
                                borderRadius: 8,
                                padding: "4px 10px",
                                fontWeight: 800,
                                fontSize: 12,
                                cursor: "pointer",
                                whiteSpace: "nowrap",
                              }}
                            >
                              🖨️ Reimprimir
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: "#f0fdf4", borderTop: "2px solid #bbf7d0" }}>
                      <td colSpan={5} style={{ padding: "8px 10px", fontWeight: 700, color: "#166534" }}>
                        {cupons.length} cupom(ns) · Total do período
                      </td>
                      <td style={{ padding: "8px 10px", fontWeight: 900, color: "#15803d", textAlign: "right" }}>
                        {moedaBR(cupons.reduce((s, v) => s + (v.total || 0), 0))}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>

            <div style={{ marginTop: 12, textAlign: "right" }}>
              <button type="button" onClick={() => setModalCupons(false)} style={btnCancelarModal}>
                Fechar (ESC)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ MODAL FINALIZAR VENDA ══════════ */}
      {modalFinalizar && (
        <div style={overlay}>
          <div style={{ ...modalBox, width: "min(96vw, 480px)" }}>
            <div style={{ fontWeight: 900, fontSize: 20, color: "#0f172a", marginBottom: 18 }}>
              ✅ Finalizar Venda
            </div>

            {/* Tipo de pagamento */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 20 }}>
              {([
                { tipo: "dinheiro", label: "💵 Dinheiro", cor: "#15803d", bg: "#f0fdf4", tecla: "1" },
                { tipo: "pix",      label: "📱 PIX",      cor: "#0369a1", bg: "#f0f9ff", tecla: "2" },
                { tipo: "cartao",   label: "💳 Cartão",   cor: "#1d4ed8", bg: "#eff6ff", tecla: "3" },
                ...(temRecurso(plano, "fiado") ? [{ tipo: "fiado" as const, label: "📒 Fiado", cor: "#92400e", bg: "#fffbeb", tecla: "4" }] : []),
              ] as const).map(({ tipo, label, cor, bg, tecla }) => (
                <button key={tipo} type="button"
                  onClick={() => selecionarPagamento(tipo)}
                  style={{
                    height: 60, border: "2px solid", borderRadius: 12, fontWeight: 800, fontSize: 13, cursor: "pointer",
                    borderColor: tipoPagamento === tipo ? cor : "#e2e8f0",
                    background:  tipoPagamento === tipo ? bg  : "#f9fafb",
                    color:       tipoPagamento === tipo ? cor : "#64748b",
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
                  }}>
                  <span>{label}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, opacity: 0.6,
                    background: tipoPagamento === tipo ? cor : "#cbd5e1",
                    color: "#fff", borderRadius: 4, padding: "1px 5px",
                  }}>tecla {tecla}</span>
                </button>
              ))}
            </div>

            {/* Fiado: bloco de busca por CPF */}
            {tipoPagamento === "fiado" && (
              <div style={{ marginBottom: 16, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#92400e", marginBottom: 8 }}>
                  📒 Fiado — cliente identificado pelo CPF
                </div>
                {buscandoFiado ? (
                  <div style={{ color: "#92400e", fontSize: 13 }}>Buscando cliente...</div>
                ) : clienteFiado ? (
                  <div>
                    <div style={{ fontWeight: 800, color: "#1e293b", fontSize: 15 }}>{clienteFiado.nome}</div>
                    <div style={{ display: "flex", gap: 16, marginTop: 6, fontSize: 13 }}>
                      <span style={{ color: "#475569" }}>Limite: <b>{moedaBR(clienteFiado.limite_credito || 0)}</b></span>
                      <span style={{ color: "#dc2626" }}>Em aberto: <b>{moedaBR(clienteFiado.saldo_fiado || 0)}</b></span>
                      <span style={{ color: "#15803d" }}>Disponível: <b>{moedaBR((clienteFiado.limite_credito || 0) - (clienteFiado.saldo_fiado || 0))}</b></span>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: "#92400e" }}>
                    {cpf.replace(/\D/g, "").length === 11
                      ? "Buscando... ou CPF não encontrado na base de clientes."
                      : "Identifique o cliente pelo CPF na tela principal (F10) e volte aqui."}
                  </div>
                )}
                {erroFiado && (
                  <div style={{ color: "#dc2626", fontSize: 13, fontWeight: 700, marginTop: 6 }}>{erroFiado}</div>
                )}
              </div>
            )}

            {/* Subtotal */}
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, fontSize: 15, color: "#475569" }}>
              <span>Subtotal ({totalItens} {totalItens === 1 ? "item" : "itens"})</span>
              <span style={{ fontWeight: 700 }}>{moedaBR(totalGeral)}</span>
            </div>

            {/* Desconto — dinheiro e PIX, apenas se tiver permissão e plano pro */}
            {tipoPagamento !== "cartao" && temRecurso(plano, "desconto") && temPerm("perm_desconto") && (
              <div style={{ marginBottom: 14 }}>
                <label style={labelModal}>Desconto</label>
                <div style={{ display: "flex", gap: 8 }}>
                  {/* Toggle R$ / % */}
                  <div style={{ display: "flex", border: "1px solid #d1d5db", borderRadius: 10, overflow: "hidden", flexShrink: 0 }}>
                    {(["R$", "%"] as const).map((t) => (
                      <button key={t} type="button"
                        onClick={() => { setTipoDesconto(t); setDesconto(""); }}
                        style={{
                          width: 44, height: 44, border: "none", cursor: "pointer", fontWeight: 800, fontSize: 14,
                          background: tipoDesconto === t ? "#1e3a5f" : "#f9fafb",
                          color:      tipoDesconto === t ? "#fff"    : "#374151",
                        }}>{t}</button>
                    ))}
                  </div>
                  <input
                    type="text" inputMode="decimal"
                    value={desconto}
                    onChange={(e) => setDesconto(e.target.value)}
                    placeholder={tipoDesconto === "%" ? "0,00" : "0,00"}
                    style={{ ...inputModal, fontSize: 18, textAlign: "right", flex: 1 }}
                  />
                </div>
                {descontoVal > 0 && (
                  <div style={{ color: "#15803d", fontSize: 13, marginTop: 4, textAlign: "right" }}>
                    Desconto: − {moedaBR(descontoVal)}
                  </div>
                )}
              </div>
            )}

            {/* Total final */}
            <div style={{
              background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12,
              padding: "12px 16px", display: "flex", justifyContent: "space-between",
              alignItems: "center", marginBottom: 16,
            }}>
              <span style={{ fontWeight: 700, fontSize: 16, color: "#166534" }}>Total a cobrar</span>
              <span style={{ fontWeight: 900, fontSize: 28, color: "#15803d" }}>{moedaBR(totalFinal)}</span>
            </div>

            {/* Valor recebido + troco — só dinheiro (PIX e Cartão não precisam) */}
            {tipoPagamento === "dinheiro" && (
              <>
                <div style={{ marginBottom: 10 }}>
                  <label style={labelModal}>Valor recebido (R$)</label>
                  <input
                    ref={refValorRecebido}
                    type="text" inputMode="decimal"
                    value={valorRecebido}
                    onChange={(e) => setValorRecebido(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") confirmarVenda(); }}
                    placeholder="0,00"
                    style={{ ...inputModal, fontSize: 22, fontWeight: 800, textAlign: "right" }}
                  />
                </div>
                {valorRecebidoVal > 0 && (
                  <div style={{
                    background: troco >= 0 ? "#fefce8" : "#fef2f2",
                    border: `1px solid ${troco >= 0 ? "#fde68a" : "#fecaca"}`,
                    borderRadius: 10, padding: "10px 16px",
                    display: "flex", justifyContent: "space-between", marginBottom: 14,
                  }}>
                    <span style={{ fontWeight: 700, color: troco >= 0 ? "#854d0e" : "#991b1b" }}>
                      {troco >= 0 ? "Troco" : "⚠️ Valor insuficiente"}
                    </span>
                    <span style={{ fontWeight: 900, fontSize: 20, color: troco >= 0 ? "#854d0e" : "#991b1b" }}>
                      {moedaBR(troco)}
                    </span>
                  </div>
                )}
              </>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <button type="button" onClick={() => setModalFinalizar(false)} style={btnCancelarModal}>Voltar (ESC)</button>
              <button type="button" onClick={confirmarVenda}
                disabled={finalizando || (tipoPagamento === "fiado" && !clienteFiado)}
                style={{ ...btnConfirmarModal, background: "#15803d", fontSize: 15,
                  opacity: (tipoPagamento === "fiado" && !clienteFiado) ? 0.5 : 1 }}>
                {finalizando ? "Gravando..." : "✔ Confirmar venda"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ MODAL SENHA ADM ══════════ */}
      {modalAdm && (
        <div style={overlay}>
          <div style={modalBox}>
            <div style={{ fontWeight: 900, fontSize: 18, color: "#0f172a", marginBottom: 6 }}>
              🔒 {modalAdm.titulo}
            </div>
            <div style={{ color: "#475569", fontSize: 14, marginBottom: 16 }}>{modalAdm.descricao}</div>
            <input
              ref={refSenhaAdm}
              type="password"
              value={senhaAdmInput}
              onChange={(e) => setSenhaAdmInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirmarSenhaAdm(); if (e.key === "Escape") setModalAdm(null); }}
              placeholder="Senha ADM"
              style={inputModal}
            />
            {erroSenhaAdm && <div style={{ color: "#dc2626", fontSize: 13, marginTop: 6 }}>{erroSenhaAdm}</div>}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
              <button type="button" onClick={() => setModalAdm(null)} style={btnCancelarModal}>Cancelar (ESC)</button>
              <button type="button" onClick={confirmarSenhaAdm} disabled={salvandoAdm} style={btnConfirmarModal}>
                {salvandoAdm ? "Verificando..." : "Confirmar (Enter)"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ MODAL SANGRIA ══════════ */}
      {modalSangria && (
        <div style={overlay}>
          <div style={modalBox}>
            <div style={{ fontWeight: 900, fontSize: 18, color: "#0f172a", marginBottom: 6 }}>💵 Registrar Sangria</div>
            <div style={{ color: "#475569", fontSize: 14, marginBottom: 16 }}>
              Informe o valor retirado do caixa.
            </div>
            <label style={labelModal}>Valor retirado (R$)</label>
            <input
              autoFocus
              type="text"
              inputMode="decimal"
              value={valorSangria}
              onChange={(e) => setValorSangria(e.target.value)}
              placeholder="0,00"
              style={{ ...inputModal, fontSize: 22, fontWeight: 800, textAlign: "right" }}
            />
            <label style={{ ...labelModal, marginTop: 12 }}>Observação (opcional)</label>
            <input
              type="text"
              value={obsSangria}
              onChange={(e) => setObsSangria(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirmarSangria(); }}
              placeholder="Ex: Enviado para cofre"
              style={inputModal}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
              <button type="button" onClick={() => setModalSangria(false)} style={btnCancelarModal}>Cancelar</button>
              <button type="button" onClick={confirmarSangria} disabled={salvandoSangria} style={btnConfirmarModal}>
                {salvandoSangria ? "Salvando..." : "✔ Registrar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ MODAL FECHAMENTO DE CAIXA ══════════ */}
      {modalFechamento && (
        <div style={overlay}>
          <div style={{ ...modalBox, width: "min(96vw, 500px)" }}>
            <div style={{ fontWeight: 900, fontSize: 20, color: "#0f172a", marginBottom: 20 }}>
              🏦 Fechamento de Caixa
            </div>

            {carregandoFechamento ? (
              <div style={{ color: "#64748b", padding: "24px 0", textAlign: "center" }}>Carregando dados do dia...</div>

            ) : fechamentoData && etapaFechamento === "gaveta" ? (
              /* ── ETAPA 1: quanto tem na gaveta? ── */
              <>
                <div style={{
                  background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12,
                  padding: "18px 20px", marginBottom: 22, textAlign: "center",
                }}>
                  <div style={{ fontSize: 15, color: "#166534", fontWeight: 700, marginBottom: 8 }}>
                    💰 Quanto de dinheiro tem na gaveta agora?
                  </div>
                  <div style={{ fontSize: 13, color: "#4b7a5e", marginBottom: 16 }}>
                    Conte o dinheiro físico e informe o valor abaixo.
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
                    <span style={{ fontWeight: 700, fontSize: 20, color: "#166534" }}>R$</span>
                    <input
                      ref={refValorGaveta}
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0,00"
                      value={valorGaveta}
                      onChange={e => setValorGaveta(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && valorGaveta) setEtapaFechamento("resumo"); }}
                      style={{
                        width: 180, height: 52, fontSize: 26, fontWeight: 900,
                        textAlign: "center", border: "2px solid #86efac", borderRadius: 10,
                        outline: "none", padding: "0 10px", color: "#15803d",
                        background: "#fff",
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <button type="button" onClick={() => setModalFechamento(false)} style={btnCancelarModal}>
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={!valorGaveta}
                    onClick={() => setEtapaFechamento("resumo")}
                    style={{ ...btnConfirmarModal, background: "#15803d", opacity: valorGaveta ? 1 : 0.45 }}
                  >
                    Continuar →
                  </button>
                </div>
              </>

            ) : fechamentoData && etapaFechamento === "resumo" ? (
              /* ── ETAPA 2: resumo + obs + confirmar ── */
              <>
                {/* Cards de resumo do sistema */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                  {[
                    { label: "Vendas realizadas", value: `${fechamentoData.qtdVendas} cupom(ns)`, color: "#1e293b" },
                    { label: "Total de vendas",   value: moedaBR(fechamentoData.totalVendas), color: "#15803d", destaque: true },
                    { label: "💵 Dinheiro",        value: moedaBR(fechamentoData.totalDinheiro), color: "#15803d" },
                    { label: "📱 PIX",             value: moedaBR(fechamentoData.totalPix),      color: "#0369a1" },
                    { label: "💳 Cartão",          value: moedaBR(fechamentoData.totalCartao),   color: "#1d4ed8" },
                    { label: "↓ Sangrias",         value: `− ${moedaBR(fechamentoData.totalSangrias)}`, color: "#dc2626" },
                  ].map(({ label, value, color, destaque }) => (
                    <div key={label} style={{
                      border: `1px solid ${destaque ? "#bbf7d0" : "#e2e8f0"}`,
                      borderRadius: 10, padding: "8px 12px",
                      background: destaque ? "#f0fdf4" : "#f8fafc",
                    }}>
                      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{label}</div>
                      <div style={{ fontWeight: 900, fontSize: 15, color }}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* Gaveta informada × esperado × diferença */}
                <div style={{
                  background: "#fefce8", border: "1px solid #fde68a", borderRadius: 12,
                  padding: "12px 16px", marginBottom: 10,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: "#854d0e" }}>💰 Esperado na gaveta</span>
                    <span style={{ fontWeight: 900, fontSize: 18, color: "#854d0e" }}>{moedaBR(esperadoGav)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: "#166534" }}>🗄️ Informado pelo operador</span>
                    <span style={{ fontWeight: 900, fontSize: 18, color: "#166534" }}>{moedaBR(gavetaNum)}</span>
                  </div>
                  <div style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    borderTop: "1px solid #fde68a", paddingTop: 8,
                  }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: difGav < 0 ? "#dc2626" : difGav > 0 ? "#1d4ed8" : "#15803d" }}>
                      {difGav < 0 ? "⚠️ Faltando" : difGav > 0 ? "➕ Sobra" : "✅ Diferença"}
                    </span>
                    <span style={{ fontWeight: 900, fontSize: 18, color: difGav < 0 ? "#dc2626" : difGav > 0 ? "#1d4ed8" : "#15803d" }}>
                      {difGav === 0 ? "R$ 0,00" : (difGav < 0 ? "− " : "+ ") + moedaBR(Math.abs(difGav))}
                    </span>
                  </div>
                </div>

                {/* Observação */}
                <textarea
                  placeholder="Observação (opcional)..."
                  value={obsFechamento}
                  onChange={e => setObsFechamento(e.target.value)}
                  rows={3}
                  style={{
                    width: "100%", borderRadius: 8, border: "1px solid #cbd5e1",
                    padding: "8px 12px", fontSize: 13, resize: "vertical",
                    fontFamily: "inherit", marginBottom: 14, boxSizing: "border-box",
                    outline: "none",
                  }}
                />

                <div style={{ color: "#64748b", fontSize: 12, marginBottom: 14 }}>
                  Ao confirmar, o saldo do caixa será zerado e o fechamento registrado.
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <button type="button" onClick={() => setEtapaFechamento("gaveta")} style={btnCancelarModal}>
                    ← Voltar
                  </button>
                  <button type="button" onClick={confirmarFechamento} disabled={fechandoCaixa}
                    style={{ ...btnConfirmarModal, background: "#4c1d95" }}>
                    {fechandoCaixa ? "Fechando..." : "✔ Confirmar Fechamento"}
                  </button>
                </div>
              </>

            ) : null}
          </div>
        </div>
      )}

      {/* ══════════ MODAL RELATÓRIOS ══════════ */}
      {modalRelatorios && (
        <div style={{ ...overlay, alignItems: "flex-start", paddingTop: 30 }}>
          <div style={{ ...modalBox, width: "min(96vw, 820px)", maxHeight: "88vh", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontWeight: 900, fontSize: 18, color: "#0f172a" }}>📊 Relatórios do Caixa</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button type="button" onClick={abrirRelatorios}
                  style={{ border: "1px solid #d1d5db", background: "#f9fafb", borderRadius: 8, padding: "4px 12px", fontSize: 13, cursor: "pointer", color: "#374151", fontWeight: 600 }}>
                  🔄 Recarregar
                </button>
                <button type="button" onClick={() => setModalRelatorios(false)} style={{ border: "none", background: "none", fontSize: 22, cursor: "pointer", color: "#475569" }}>×</button>
              </div>
            </div>

            {erroRelatorio && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: "#dc2626", fontFamily: "monospace" }}>
                ⚠️ Erro ao buscar dados: {erroRelatorio}
              </div>
            )}

            {/* Abas */}
            <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
              {(["cupons", "itens", "sangrias", "operadores"] as const).map((aba) => (
                <button key={aba} type="button" onClick={() => setAbaRelatorio(aba)}
                  style={{ height: 34, padding: "0 14px", borderRadius: 8, border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer",
                    background: abaRelatorio === aba ? "#1e3a5f" : "#f1f5f9",
                    color: abaRelatorio === aba ? "#fff" : "#374151",
                  }}>
                  { aba === "cupons" ? "Cupons Cancelados"
                  : aba === "itens" ? "Itens Cancelados"
                  : aba === "sangrias" ? "Sangrias"
                  : "Operadores" }
                </button>
              ))}
            </div>

            <div style={{ flex: 1, overflowY: "auto" }}>
              {carregandoRel ? (
                <div style={{ color: "#64748b", padding: 20 }}>Carregando...</div>
              ) : abaRelatorio === "cupons" ? (
                <TabelaRelatorio
                  dados={relCupons}
                  colunas={["Data/Hora", "Operador", "Total", "Motivo"]}
                  renderLinha={(r) => [fmtHora(r.created_at), r.operador || "—", moedaBR(r.total || 0), r.motivo || "—"]}
                  vazio="Nenhum cupom cancelado."
                />
              ) : abaRelatorio === "itens" ? (
                <TabelaRelatorio
                  dados={relItens}
                  colunas={["Data/Hora", "Operador", "Produto", "Qtd", "Preço unit."]}
                  renderLinha={(r) => [fmtHora(r.created_at), r.operador || "—", r.produto_nome || "—", String(r.quantidade ?? "—"), r.preco != null ? moedaBR(r.preco) : "—"]}
                  vazio="Nenhum item cancelado."
                />
              ) : abaRelatorio === "sangrias" ? (
                <TabelaRelatorio
                  dados={relSangrias}
                  colunas={["Data/Hora", "Operador", "Valor", "Observação"]}
                  renderLinha={(r) => [fmtHora(r.created_at), r.operador || "—", moedaBR(r.valor || 0), r.observacao || "—"]}
                  vazio="Nenhuma sangria registrada."
                />
              ) : (
                <TabelaRelatorio
                  dados={relOperadores}
                  colunas={["Usuário", "Nome", "Situação"]}
                  renderLinha={(r) => [r.username, r.nome || "—", r.blocked ? "🔴 Bloqueado" : "🟢 Ativo"]}
                  vazio="Nenhum operador cadastrado."
                />
              )}
            </div>
          </div>
        </div>
      )}
      {/* ══════════ MODAL ABERTURA DE CAIXA ══════════ */}
      {modalAbrirCaixa && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
        }}>
          <div style={{
            background: "#fff", borderRadius: 20, padding: 36,
            width: "min(94vw, 420px)", boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
            textAlign: "center",
          }}>
            <div style={{ fontSize: 48, marginBottom: 10 }}>🏪</div>
            <div style={{ fontWeight: 900, fontSize: 22, color: "#0f172a", marginBottom: 8 }}>
              Caixa fechado
            </div>
            <div style={{ color: "#475569", fontSize: 15, marginBottom: 24 }}>
              Deseja abrir o caixa agora?
            </div>

            <div style={{ marginBottom: 20, textAlign: "left" }}>
              <label style={{ fontWeight: 700, fontSize: 13, color: "#374151", display: "block", marginBottom: 6 }}>
                💰 Valor em dinheiro na gaveta (fundo de caixa)
              </label>
              <input
                ref={refValorAbertura}
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                value={valorAbertura}
                onChange={e => setValorAbertura(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") abrirCaixa();
                }}
                style={{
                  width: "100%", padding: "12px 14px", fontSize: 18, fontWeight: 700,
                  border: "2px solid #d1d5db", borderRadius: 10, outline: "none",
                  boxSizing: "border-box", textAlign: "right",
                }}
              />
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                Deixe em branco (ou zero) se não houver troco na gaveta
              </div>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={abrirCaixa}
                style={{
                  flex: 1, padding: "14px 0", background: "#15803d", color: "#fff",
                  border: "none", borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: "pointer",
                }}>
                ✅ Abrir caixa
              </button>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}

/* ── Subcomponentes ── */

function Relogio() {
  // null no primeiro render (SSR) para evitar hydration mismatch com new Date()
  const [agora, setAgora] = useState<Date | null>(null);
  useEffect(() => {
    setAgora(new Date());
    const t = setInterval(() => setAgora(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!agora) return <div style={{ width: 120, height: 42 }} />;
  const hora = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const data = agora.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
  return (
    <div style={{ textAlign: "right", fontFamily: "monospace" }}>
      <div style={{ fontSize: 28, fontWeight: 900, color: "#1faa4a", letterSpacing: 2, lineHeight: 1 }}>
        {hora}
      </div>
      <div style={{ fontSize: 12, color: "rgba(255,255,255,.45)", marginTop: 3, letterSpacing: 1 }}>
        {data.toUpperCase()}
      </div>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 7 }}>
      <div style={{ color: "rgba(255,255,255,.45)", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function BotaoAtalho({ tecla, texto, onClick, cor, badge }: {
  tecla: string; texto: string; onClick?: () => void;
  cor?: string; badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 40,
        border: "none",
        borderRadius: 10,
        background: cor || "#0f7686",
        color: "#e0f2fe",
        fontWeight: 800,
        fontSize: 14,
        display: "grid",
        gridTemplateColumns: tecla === "ESC" || tecla === "Enter" ? "60px 1fr auto" : "42px 1fr auto",
        alignItems: "center",
        gap: 6,
        padding: "0 10px",
        cursor: "pointer",
        position: "relative",
      }}
    >
      <span style={{ height: 28, borderRadius: 7, background: "rgba(255,255,255,.25)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 900, color: "#e0f2fe", fontSize: 12 }}>
        {tecla}
      </span>
      <span style={{ textAlign: "left", fontSize: 13 }}>{texto}</span>
      {badge && (
        <span style={{ background: "#ef4444", color: "#fff", borderRadius: 999, padding: "2px 7px", fontSize: 11, fontWeight: 900, whiteSpace: "nowrap" }}>
          {badge}
        </span>
      )}
    </button>
  );
}

function TabelaRelatorio({ dados, colunas, renderLinha, vazio }: {
  dados: any[]; colunas: string[];
  renderLinha: (r: any) => string[];
  vazio: string;
}) {
  if (dados.length === 0) return <div style={{ color: "#64748b", padding: 16 }}>{vazio}</div>;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ background: "#f1f5f9" }}>
          {colunas.map((c) => (
            <th key={c} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, color: "#374151", borderBottom: "1px solid #e2e8f0" }}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {dados.map((r, i) => (
          <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#f8fafc" }}>
            {renderLinha(r).map((cell, j) => (
              <td key={j} style={{ padding: "7px 10px", borderBottom: "1px solid #f1f5f9", color: "#1e293b" }}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function fmtHora(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/* ── Estilos ── */

const colPanel: React.CSSProperties = {
  background: "rgba(10,15,22,.60)",
  border: "1px solid rgba(255,255,255,.07)",
  borderRadius: 14,
  padding: 14,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,.03)",
  position: "relative",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const inputGrande: React.CSSProperties = {
  width: "100%",
  height: 44,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,.12)",
  background: "#1e293b",
  color: "#f1f5f9",
  padding: "0 14px",
  fontSize: 17,
  outline: "none",
};

/* ── Modais ── */
const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,.65)",
  zIndex: 1000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};

const modalBox: React.CSSProperties = {
  background: "#fff",
  borderRadius: 18,
  boxShadow: "0 20px 50px rgba(0,0,0,.45)",
  padding: 24,
  width: "min(96vw, 420px)",
};

const inputModal: React.CSSProperties = {
  width: "100%",
  height: 44,
  borderRadius: 10,
  border: "1px solid #d1d5db",
  padding: "0 14px",
  fontSize: 16,
  color: "#111827",
  outline: "none",
};

const labelModal: React.CSSProperties = {
  display: "block",
  fontWeight: 700,
  fontSize: 13,
  color: "#374151",
  marginBottom: 6,
};

const btnCancelarModal: React.CSSProperties = {
  height: 40,
  border: "1px solid #d1d5db",
  borderRadius: 10,
  background: "#f9fafb",
  color: "#374151",
  fontWeight: 700,
  fontSize: 14,
  cursor: "pointer",
};

const btnConfirmarModal: React.CSSProperties = {
  height: 40,
  border: "none",
  borderRadius: 10,
  background: "#1e3a5f",
  color: "#fff",
  fontWeight: 800,
  fontSize: 14,
  cursor: "pointer",
};
