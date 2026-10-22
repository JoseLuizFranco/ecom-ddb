/*
===============================================================================
PORTAL B2B - DADOS COMPLEMENTARES
Compradores do laboratório e mais alguns itens de catálogo.
===============================================================================
*/

INSERT INTO perfil (nome, descricao)
SELECT 'COMPRADOR', 'Empresa que compra produtos'
WHERE NOT EXISTS (SELECT 1 FROM perfil WHERE nome = 'COMPRADOR');

INSERT INTO empresa (razao_social, nome_fantasia, cnpj, email, telefone, senha_hash)
SELECT v.razao_social, v.nome_fantasia, v.cnpj, v.email, v.telefone, 'hash_senha_exemplo'
FROM (VALUES
    ('Fundição Alfa Indústria Ltda.',  'Comprador A',     '11111111000111', 'compras@fundicaoalfa.com.br', '62988880001'),
    ('Beta Laminados S.A.',            'Comprador B',     '22222222000122', 'compras@betalaminados.com.br', '62988880002'),
    ('Verde Plásticos Recicláveis ME', 'Verde Plásticos', '33333333000133', 'contato@verdeplasticos.com.br', '62988880003')
) AS v (razao_social, nome_fantasia, cnpj, email, telefone)
WHERE NOT EXISTS (SELECT 1 FROM empresa e WHERE e.cnpj = v.cnpj);

INSERT INTO empresa_perfil (empresa_id, perfil_id)
SELECT e.id, p.id
FROM empresa e
JOIN perfil p ON p.nome = CASE WHEN e.cnpj = '33333333000133' THEN 'FORNECEDOR' ELSE 'COMPRADOR' END
WHERE e.cnpj IN ('11111111000111', '22222222000122', '33333333000133')
  AND NOT EXISTS (
      SELECT 1 FROM empresa_perfil ep WHERE ep.empresa_id = e.id AND ep.perfil_id = p.id
  );

INSERT INTO categoria_produto (nome, descricao)
SELECT 'Plásticos Recicláveis', 'Resinas e plásticos pós-consumo'
WHERE NOT EXISTS (SELECT 1 FROM categoria_produto WHERE nome = 'Plásticos Recicláveis');

INSERT INTO produto (categoria_id, nome, descricao, unidade_medida, tipo_transporte_necessario)
SELECT cp.id, v.nome, v.descricao, 'kg', 'RODOVIARIO'
FROM (VALUES
    ('Metais Recicláveis',    'Cobre Reciclado', 'Sucata de cobre classificada'),
    ('Plásticos Recicláveis', 'PET Moído',       'Flakes de PET pós-consumo')
) AS v (categoria, nome, descricao)
JOIN categoria_produto cp ON cp.nome = v.categoria
WHERE NOT EXISTS (SELECT 1 FROM produto p WHERE p.nome = v.nome);

INSERT INTO processo_negociacao (produto_id, modo, status)
SELECT p.id, 'VENDA', 'ABERTO'
FROM produto p
WHERE p.nome IN ('Cobre Reciclado', 'PET Moído')
  AND NOT EXISTS (
      SELECT 1 FROM processo_negociacao pn
      WHERE pn.produto_id = p.id AND pn.modo = 'VENDA' AND pn.status = 'ABERTO'
  );

INSERT INTO fornecimento (negociacao_id, fornecedor_id, produto_id, preco_unitario, quantidade_disponivel)
SELECT pn.id, e.id, p.id, v.preco, v.qtd
FROM (VALUES
    ('Cobre Reciclado', '12345678000199', 38.90, 400),
    ('PET Moído',       '33333333000133',  3.20, 5000)
) AS v (produto, cnpj, preco, qtd)
JOIN produto p             ON p.nome = v.produto
JOIN processo_negociacao pn ON pn.produto_id = p.id AND pn.modo = 'VENDA' AND pn.status = 'ABERTO'
JOIN empresa e             ON e.cnpj = v.cnpj
WHERE NOT EXISTS (
    SELECT 1 FROM fornecimento f
    WHERE f.fornecedor_id = e.id AND f.produto_id = p.id AND f.negociacao_id = pn.id
);
