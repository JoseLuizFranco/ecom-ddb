-- Restaura o fornecimento do laboratório (1.000 kg a R$ 7,50/kg) e apaga
-- os pedidos realizados sobre ele. Execute antes de repetir uma demonstração.

DELETE FROM pedido
WHERE fornecimento_id IN (
    SELECT f.id
    FROM fornecimento f
    JOIN empresa e ON e.id = f.fornecedor_id
    JOIN produto p ON p.id = f.produto_id
    WHERE e.cnpj = '12345678000199' AND p.nome = 'Alumínio Reciclado'
);

UPDATE fornecimento
SET quantidade_disponivel = 1000,
    preco_unitario = 7.50,
    ativo = TRUE,
    versao = 1
WHERE id IN (
    SELECT f.id
    FROM fornecimento f
    JOIN empresa e ON e.id = f.fornecedor_id
    JOIN produto p ON p.id = f.produto_id
    WHERE e.cnpj = '12345678000199' AND p.nome = 'Alumínio Reciclado'
);

SELECT e.nome_fantasia AS fornecedor, p.nome AS produto,
       f.preco_unitario, f.quantidade_disponivel, f.versao, f.ativo
FROM fornecimento f
JOIN empresa e ON e.id = f.fornecedor_id
JOIN produto p ON p.id = f.produto_id
WHERE e.cnpj = '12345678000199' AND p.nome = 'Alumínio Reciclado';
