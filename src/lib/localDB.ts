/**
 * localDB.ts
 * IndexedDB local usando Dexie — armazenamento offline do PDV.
 * Produtos são cacheados aqui para funcionar sem internet.
 * Vendas que não chegaram ao Supabase ficam na fila pendingVendas.
 */

// Dexie só funciona no browser — importação dinâmica protege o SSR do Next.js
let Dexie: (new (name: string) => import("dexie").Dexie) | null = null;
if (typeof window !== "undefined") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("dexie");
    Dexie = mod.default ?? mod;
  } catch { Dexie = null; }
}
type DexieType = import("dexie").Dexie;
type TableType<T> = import("dexie").Table<T>;

export interface LocalProduto {
  id: string;
  nome: string;
  codigo: string | null;
  ean: string | null;
  preco: number | null;
  preco_cartao: number | null;
  unidade: string | null;
  estoque: number | null;
}

export interface PendingVenda {
  localId: string;
  vendaPayload: Record<string, unknown>;
  itens: Array<{
    produto_id: string;
    produto_nome: string;
    quantidade: number;
    preco: number;
  }>;
  estoqueDeltas: Array<{ id: string; delta: number }>;
  fiadoUpdate: { clienteId: string; delta: number } | null;
  createdAt: string;
  synced: number; // 0 = pendente, 1 = sincronizado
}

class HortiDB extends (Dexie as unknown as new (name: string) => DexieType) {
  produtos!: TableType<LocalProduto>;
  pendingVendas!: TableType<PendingVenda>;

  constructor() {
    super("HortiGestao");
    (this as unknown as DexieType).version(1).stores({
      produtos:      "id, nome, codigo, ean",
      pendingVendas: "localId, synced, createdAt",
    });
  }
}

function criarLocalDB(): HortiDB | null {
  if (typeof window === "undefined" || !Dexie) return null;
  try { return new HortiDB(); } catch { return null; }
}

export const localDB: HortiDB | null = criarLocalDB();
