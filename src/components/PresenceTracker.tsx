'use client';

/**
 * PresenceTracker — heartbeat a cada 60s no banco de dados.
 * Atualiza `ultimo_acesso` em clientes_licenciados enquanto o app estiver aberto.
 * O Painel Master lê esse campo para exibir online/offline.
 */
import { useEffect } from 'react';
import { supabase, getEmpresaId } from '@/lib/supabaseClient';

export default function PresenceTracker() {
  useEffect(() => {
    const empresaId = getEmpresaId();
    if (!empresaId) return;

    async function ping() {
      await supabase
        .from('clientes_licenciados')
        .update({ ultimo_acesso: new Date().toISOString() })
        .eq('empresa_id', empresaId);
    }

    // Primeiro ping imediato
    ping();

    // Repete a cada 60 segundos
    const timer = setInterval(ping, 60_000);

    return () => clearInterval(timer);
  }, []);

  return null;
}
