-- ============================================================
-- FIX: desativa RLS em clientes_licenciados
-- e reativa o código MASTER2025 se estiver inativo
--
-- Execute no Supabase SQL Editor
-- ============================================================

-- 1. Desativa RLS (segurança é feita pela senha do /master)
ALTER TABLE clientes_licenciados DISABLE ROW LEVEL SECURITY;

-- 2. Garante que MASTER2025 existe e está ativo
INSERT INTO clientes_licenciados (codigo, nome_cliente, empresa_id, ativo)
VALUES ('MASTER2025', 'Jean Silva', 1, true)
ON CONFLICT (codigo) DO UPDATE SET ativo = true;

-- 3. Mostra todos os clientes cadastrados
SELECT id, codigo, nome_cliente, empresa_id, ativo, created_at
FROM clientes_licenciados
ORDER BY empresa_id;
