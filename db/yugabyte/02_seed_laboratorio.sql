/*
===============================================================================
PORTAL B2B - PREPARAÇÃO DO LABORATÓRIO DE CONTROLE DE CONCORRÊNCIA

Cenário:
- Fornecedor: EcoMetais
- Categoria: Metais Recicláveis
- Produto: Alumínio Reciclado
- Preço unitário: R$ 7,50/kg
- Quantidade disponível: 1.000 kg

Todos os comandos são idempotentes (podem ser executados mais de uma vez).
===============================================================================
*/

-- 1. PERFIL "FORNECEDOR"
INSERT INTO perfil (id, nome, descricao, ativo)
SELECT gen_random_uuid(), 'FORNECEDOR', 'Empresa que fornece produtos', TRUE
WHERE NOT EXISTS (SELECT 1 FROM perfil WHERE nome = 'FORNECEDOR');

-- 2. EMPRESA FORNECEDORA (CNPJ fictício, apenas para fins didáticos)
INSERT INTO empresa (id, razao_social, nome_fantasia, cnpj, email, telefone, senha_hash, status)
SELECT gen_random_uuid(), 'EcoMetais Reciclagem Ltda.', 'EcoMetais', '12345678000199',
       'contato@ecometais.com.br', '62999990000', 'hash_senha_exemplo', 'ATIVA'
WHERE NOT EXISTS (SELECT 1 FROM empresa WHERE cnpj = '12345678000199');

-- 3. ASSOCIAÇÃO DA EMPRESA AO PERFIL FORNECEDOR
INSERT INTO empresa_perfil (id, empresa_id, perfil_id, ativo)
SELECT gen_random_uuid(), e.id, p.id, TRUE
FROM empresa e
CROSS JOIN perfil p
WHERE e.cnpj = '12345678000199'
  AND p.nome = 'FORNECEDOR'
  AND NOT EXISTS (
      SELECT 1 FROM empresa_perfil ep
      WHERE ep.empresa_id = e.id AND ep.perfil_id = p.id
  );

-- 4. CATEGORIA DO PRODUTO
INSERT INTO categoria_produto (id, nome, descricao, ativa)
SELECT gen_random_uuid(), 'Metais Recicláveis',
       'Materiais metálicos recicláveis comercializados no Portal B2B', TRUE
WHERE NOT EXISTS (SELECT 1 FROM categoria_produto WHERE nome = 'Metais Recicláveis');

-- 5. PRODUTO (preço e quantidade ficam no fornecimento)
INSERT INTO produto (id, categoria_id, nome, descricao, unidade_medida, tipo_transporte_necessario, ativo)
SELECT gen_random_uuid(), cp.id, 'Alumínio Reciclado',
       'Alumínio reciclado destinado à comercialização B2B', 'kg', 'RODOVIARIO', TRUE
FROM categoria_produto cp
WHERE cp.nome = 'Metais Recicláveis'
  AND NOT EXISTS (SELECT 1 FROM produto p WHERE p.nome = 'Alumínio Reciclado');

-- 6. PROCESSO DE NEGOCIAÇÃO (data_inicio usa DEFAULT now())
INSERT INTO processo_negociacao (id, produto_id, modo, status)
SELECT gen_random_uuid(), p.id, 'VENDA', 'ABERTO'
FROM produto p
WHERE p.nome = 'Alumínio Reciclado'
  AND NOT EXISTS (
      SELECT 1 FROM processo_negociacao pn
      WHERE pn.produto_id = p.id AND pn.modo = 'VENDA' AND pn.status = 'ABERTO'
  );

-- 7. FORNECIMENTO (registro disputado: 1.000 kg a R$ 7,50/kg)
--    Comprador A tentará adquirir 700 kg e Comprador B 500 kg.
--    700 + 500 = 1.200 kg > 1.000 kg: as duas não podem ser atendidas.
INSERT INTO fornecimento (id, negociacao_id, fornecedor_id, produto_id,
                          preco_unitario, quantidade_disponivel, ativo)
SELECT gen_random_uuid(), pn.id, e.id, p.id, 7.50, 1000, TRUE
FROM empresa e
JOIN empresa_perfil ep ON ep.empresa_id = e.id
JOIN perfil pf         ON pf.id = ep.perfil_id
CROSS JOIN produto p
JOIN processo_negociacao pn ON pn.produto_id = p.id
WHERE e.cnpj = '12345678000199'
  AND pf.nome = 'FORNECEDOR'
  AND ep.ativo = TRUE
  AND p.nome = 'Alumínio Reciclado'
  AND pn.modo = 'VENDA'
  AND pn.status = 'ABERTO'
  AND NOT EXISTS (
      SELECT 1 FROM fornecimento f
      WHERE f.fornecedor_id = e.id AND f.produto_id = p.id AND f.negociacao_id = pn.id
  );
