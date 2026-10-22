'use strict';

/**
 * Regras de compra sobre um fornecimento, com três estratégias:
 *
 *  SEM_CONTROLE  lê o saldo, calcula o novo valor na aplicação e grava o valor
 *                absoluto. Sob concorrência ocorre "lost update": as duas
 *                compras são aceitas e o estoque fica errado.
 *
 *  PESSIMISTA    SELECT ... FOR UPDATE bloqueia a linha do fornecimento até o
 *                fim da transação. A segunda transação espera e, ao continuar,
 *                enxerga o saldo já reduzido.
 *
 *  OTIMISTA      não bloqueia na leitura. Na gravação usa
 *                UPDATE ... WHERE versao = <versao lida>. Se outra transação
 *                alterou a linha antes, nenhuma linha é afetada: há conflito e
 *                a operação é repetida com dados novos.
 */

const db = require('./db');

const ESTRATEGIAS = ['SEM_CONTROLE', 'PESSIMISTA', 'OTIMISTA'];
const MAX_TENTATIVAS_OTIMISTA = 3;
const MAX_TENTATIVAS_SERIALIZACAO = 5;

class ErroNegocio extends Error {
  constructor(status, mensagem, extra = {}) {
    super(mensagem);
    this.status = status;
    Object.assign(this, extra);
  }
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Em YugabyteDB o PostgreSQL usa READ COMMITTED (habilitado no cluster).
// Aurora DSQL suporta apenas REPEATABLE READ (isolamento de snapshot).
const BEGIN = db.MODE === 'dsql' ? 'BEGIN' : 'BEGIN ISOLATION LEVEL READ COMMITTED';

// 40001 = serialization_failure, 40P01 = deadlock. Bancos distribuídos podem
// abortar transações conflitantes e esperam que o cliente tente novamente.
const ehErroRetentavel = (err) => err && (err.code === '40001' || err.code === '40P01');

async function emTransacao(no, fn) {
  for (let tentativa = 1; ; tentativa++) {
    const client = await db.connect(no);
    try {
      await client.query(BEGIN);
      const resultado = await fn(client);
      await client.query('COMMIT');
      return { ...resultado, no_banco: client.no, retentativas_banco: tentativa - 1 };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (ehErroRetentavel(err) && tentativa < MAX_TENTATIVAS_SERIALIZACAO) {
        await esperar(20 * tentativa);
        continue;
      }
      throw err;
    } finally {
      client.release();
    }
  }
}

async function buscarComprador(client, cnpj) {
  const r = await client.query(
    `SELECT e.id, e.nome_fantasia
       FROM empresa e
       JOIN empresa_perfil ep ON ep.empresa_id = e.id AND ep.ativo
       JOIN perfil p          ON p.id = ep.perfil_id AND p.nome = 'COMPRADOR'
      WHERE e.cnpj = $1 AND e.status = 'ATIVA'`,
    [cnpj],
  );
  if (r.rowCount === 0) throw new ErroNegocio(404, `Comprador ${cnpj} não encontrado`);
  return r.rows[0];
}

async function registrarPedido(client, { fornecimento, comprador, quantidade, estrategia, no }) {
  const r = await client.query(
    `INSERT INTO pedido (fornecimento_id, comprador_id, quantidade, preco_unitario,
                         valor_total, estrategia, no_banco)
     VALUES ($1, $2, $3, $4, $3::numeric * $4::numeric, $5, $6)
     RETURNING id, quantidade, preco_unitario, valor_total`,
    [fornecimento.id, comprador.id, quantidade, fornecimento.preco_unitario, estrategia, no],
  );
  return r.rows[0];
}

function validarSaldo(fornecimento, quantidade) {
  if (!fornecimento) throw new ErroNegocio(404, 'Fornecimento não encontrado');
  if (!fornecimento.ativo) throw new ErroNegocio(409, 'Fornecimento inativo');
  if (Number(fornecimento.quantidade_disponivel) < quantidade) {
    throw new ErroNegocio(409, 'Quantidade indisponível', {
      disponivel: Number(fornecimento.quantidade_disponivel),
    });
  }
}

async function semControle(client, { fornecimentoId, comprador, quantidade, atrasoMs }) {
  const { rows } = await client.query(
    `SELECT id, preco_unitario, quantidade_disponivel, ativo
       FROM fornecimento WHERE id = $1`,
    [fornecimentoId],
  );
  const f = rows[0];
  validarSaldo(f, quantidade);
  await esperar(atrasoMs);

  const novoSaldo = Number(f.quantidade_disponivel) - quantidade;
  await client.query(
    'UPDATE fornecimento SET quantidade_disponivel = $2 WHERE id = $1',
    [fornecimentoId, novoSaldo],
  );
  const pedido = await registrarPedido(client, {
    fornecimento: f, comprador, quantidade, estrategia: 'SEM_CONTROLE', no: client.no,
  });
  return { pedido, saldo_lido: Number(f.quantidade_disponivel), saldo_gravado: novoSaldo };
}

async function pessimista(client, { fornecimentoId, comprador, quantidade, atrasoMs }) {
  const inicio = Date.now();
  const { rows } = await client.query(
    `SELECT id, preco_unitario, quantidade_disponivel, ativo
       FROM fornecimento WHERE id = $1
        FOR UPDATE`,
    [fornecimentoId],
  );
  const esperaLockMs = Date.now() - inicio;
  const f = rows[0];
  try {
    validarSaldo(f, quantidade);
  } catch (err) {
    err.espera_lock_ms = esperaLockMs;
    throw err;
  }
  await esperar(atrasoMs);

  const upd = await client.query(
    `UPDATE fornecimento
        SET quantidade_disponivel = quantidade_disponivel - $2,
            versao = versao + 1
      WHERE id = $1
      RETURNING quantidade_disponivel`,
    [fornecimentoId, quantidade],
  );
  const pedido = await registrarPedido(client, {
    fornecimento: f, comprador, quantidade, estrategia: 'PESSIMISTA', no: client.no,
  });
  return {
    pedido,
    saldo_lido: Number(f.quantidade_disponivel),
    saldo_gravado: Number(upd.rows[0].quantidade_disponivel),
    espera_lock_ms: esperaLockMs,
  };
}

async function otimista(client, { fornecimentoId, comprador, quantidade, atrasoMs }) {
  const conflitos = [];
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_OTIMISTA; tentativa++) {
    const { rows } = await client.query(
      `SELECT id, preco_unitario, quantidade_disponivel, ativo, versao
         FROM fornecimento WHERE id = $1`,
      [fornecimentoId],
    );
    const f = rows[0];
    try {
      validarSaldo(f, quantidade);
    } catch (err) {
      err.conflitos = conflitos;
      throw err;
    }
    await esperar(atrasoMs);

    const upd = await client.query(
      `UPDATE fornecimento
          SET quantidade_disponivel = quantidade_disponivel - $2,
              versao = versao + 1
        WHERE id = $1 AND versao = $3 AND quantidade_disponivel >= $2
        RETURNING quantidade_disponivel, versao`,
      [fornecimentoId, quantidade, f.versao],
    );

    if (upd.rowCount === 1) {
      const pedido = await registrarPedido(client, {
        fornecimento: f, comprador, quantidade, estrategia: 'OTIMISTA', no: client.no,
      });
      return {
        pedido,
        saldo_lido: Number(f.quantidade_disponivel),
        saldo_gravado: Number(upd.rows[0].quantidade_disponivel),
        versao_lida: f.versao,
        versao_gravada: upd.rows[0].versao,
        conflitos,
      };
    }
    conflitos.push({ tentativa, versao_lida: f.versao });
  }
  throw new ErroNegocio(409, 'Conflito de versão: limite de tentativas atingido', { conflitos });
}

const IMPLEMENTACOES = { SEM_CONTROLE: semControle, PESSIMISTA: pessimista, OTIMISTA: otimista };

/**
 * Realiza uma compra.
 * @param {object} p
 * @param {string} p.fornecimentoId
 * @param {string} p.compradorCnpj
 * @param {number} p.quantidade
 * @param {string} p.estrategia  SEM_CONTROLE | PESSIMISTA | OTIMISTA
 * @param {number} [p.atrasoMs]  pausa entre a leitura e a gravação (simula processamento)
 * @param {number} [p.no]        índice do nó preferencial do cluster
 */
async function comprar({ fornecimentoId, compradorCnpj, quantidade, estrategia, atrasoMs = 0, no }) {
  estrategia = String(estrategia || '').toUpperCase();
  if (!ESTRATEGIAS.includes(estrategia)) {
    throw new ErroNegocio(400, `Estratégia inválida. Use: ${ESTRATEGIAS.join(', ')}`);
  }
  quantidade = Number(quantidade);
  if (!(quantidade > 0)) throw new ErroNegocio(400, 'Quantidade deve ser maior que zero');

  const impl = IMPLEMENTACOES[estrategia];
  return emTransacao(no, async (client) => {
    const comprador = await buscarComprador(client, compradorCnpj);
    const r = await impl(client, { fornecimentoId, comprador, quantidade, atrasoMs: Number(atrasoMs) || 0 });
    return { estrategia, comprador: comprador.nome_fantasia, quantidade, ...r };
  });
}

module.exports = { comprar, ESTRATEGIAS, ErroNegocio };
