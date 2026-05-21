'use client';

/**
 * PresenceTracker — heartbeat via API route a cada 60s.
 * Atualiza `ultimo_acesso` em clientes_licenciados enquanto o app estiver aberto.
 */
import { useEffect } from 'react';
import { getEmpresaId } from '@/lib/supabaseClient';

export default function PresenceTracker() {
  useEffect(() => {
    const empresaId = getEmpresaId();
    if (!empresaId) return;

    async function ping() {
      try {
        await fetch('/api/ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ empresa_id: empresaId }),
        });
      } catch {
        // silencia erros de rede
      }
    }

    // Ping imediato ao abrir qualquer página
    ping();

    // Repete a cada 60 segundos
    const timer = setInterval(ping, 60_000);

    return () => clearInterval(timer);
  }, []);

  return null;
}
