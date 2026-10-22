'use strict';

const db = require('./db');
const { comprar } = require('./compras');

const CNPJ_FORNECEDOR = '12345678000199';
const PRODUTO = 'Alumínio Reciclado';
const CNPJ_COMPRADOR_A = '11111111000111';
const CNPJ_COMPRADOR_B = '22222222000122';

const FILTRO = `
  FROM fornecimento f
  JOIN empresa e ON e.id = f.fornecedor_id
  JOIN produto p ON p.id = f.produto_id
 WHERE e.cnpj = '${CNPJ_FORNECEDOR}' AND p.nome = '${PRODUTO}'`;

async function fornecimentoId() {
  const r = await db.query(`SELECT f.id ${FILTRO} LIMIT 1`);
  if (r.rowCount === 0) throw new Error('Fornecimento do laboratório não encontrado. O banco foi populado?');
  return r.rows[0].id;
}

async function estado(no) {
  const r = await db.query(
    `SELECT f.id, e.nome_fantasia AS fornecedor, p.nome AS produto, p.unidade_medida,
            f.preco_unitario::float AS preco_unitario,
            f.quantidade_disponivel::float AS quantidade_disponivel,
            f.versao, f.ativo,
            (SELECT COALESCE(SUM(pe.quantidade), 0)::float FROM pedido pe WHERE pe.fornecimento_id = f.id)
              AS quantidade_vendida,
            (SELECT COUNT(*)::int FROM pedido pe WHERE pe.fornecimento_id = f.id) AS pedidos
     ${FILTRO}`,
    [], no,
  );
  const f = r.rows[0];
  return {
    ...f,
    lido_no_no: r.no,
    // Invariante: vendido + disponível deve sempre somar 1.000 kg.
    consistente: f.quantidade_vendida + f.quantidade_disponivel === 1000,
  };
}

async function reset() {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM pedido WHERE fornecimento_id IN (SELECT f.id ${FILTRO})`,
    );
    await client.query(
      `UPDATE fornecimento SET quantidade_disponivel = 1000, preco_unitario = 7.50,
              ativo = TRUE, versao = 1
        WHERE id IN (SELECT f.id ${FILTRO})`,
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return estado();
}

/**
 * Executa a disputa do laboratório: Comprador A (700 kg) e Comprador B (500 kg)
 * compram ao mesmo tempo, cada um conectado a um nó diferente do cluster.
 */
async function disputa({ estrategia, atrasoMs = 300, resetar = true }) {
  if (resetar) await reset();
  const id = await fornecimentoId();
  const nos = db.nodes.length;

  const compras = [
    { compradorCnpj: CNPJ_COMPRADOR_A, quantidade: 700, no: 0 },
    { compradorCnpj: CNPJ_COMPRADOR_B, quantidade: 500, no: 1 % nos },
  ];

  const resultados = await Promise.allSettled(
    compras.map((c) => comprar({ ...c, fornecimentoId: id, estrategia, atrasoMs })),
  );

  return {
    estrategia: String(estrategia).toUpperCase(),
    compras: resultados.map((r, i) => (r.status === 'fulfilled'
      ? { ok: true, ...r.value }
      : {
        ok: false,
        comprador: i === 0 ? 'Comprador A' : 'Comprador B',
        quantidade: compras[i].quantidade,
        erro: r.reason.message,
        ...(r.reason.conflitos ? { conflitos: r.reason.conflitos } : {}),
        ...(r.reason.espera_lock_ms !== undefined ? { espera_lock_ms: r.reason.espera_lock_ms } : {}),
        ...(r.reason.disponivel !== undefined ? { disponivel: r.reason.disponivel } : {}),
      })),
    // Lê o resultado final por outro nó para mostrar que a escrita foi replicada.
    estado_final: await estado(2 % nos),
  };
}

module.exports = {
  CNPJ_COMPRADOR_A, CNPJ_COMPRADOR_B, fornecimentoId, estado, reset, disputa,
};
