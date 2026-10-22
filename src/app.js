'use strict';

const path = require('path');
const express = require('express');
const db = require('./db');
const { comprar, ErroNegocio } = require('./compras');
const lab = require('./laboratorio');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const rota = (fn) => (req, res, next) => fn(req, res).catch(next);

// Situação de cada nó do cluster, vista pela aplicação.
app.get('/api/cluster', rota(async (req, res) => {
  const nos = await Promise.all(db.nodes.map(async (n, i) => {
    const inicio = Date.now();
    try {
      await n.pool.query('SELECT 1');
      return { indice: i, no: n.nome, online: true, latencia_ms: Date.now() - inicio };
    } catch (err) {
      return { indice: i, no: n.nome, online: false, erro: err.message };
    }
  }));

  let topologia = null;
  if (db.MODE === 'yugabyte') {
    const r = await db.query(
      'SELECT host, cloud, region, zone, node_type FROM yb_servers() ORDER BY host',
    ).catch(() => null);
    topologia = r && r.rows;
  }
  res.json({ modo: db.MODE, nos, topologia });
}));

app.get('/api/fornecimentos', rota(async (req, res) => {
  const r = await db.query(
    `SELECT f.id, e.nome_fantasia AS fornecedor, p.nome AS produto, c.nome AS categoria,
            p.unidade_medida, f.preco_unitario::float AS preco_unitario,
            f.quantidade_disponivel::float AS quantidade_disponivel, f.versao, f.ativo
       FROM fornecimento f
       JOIN empresa e           ON e.id = f.fornecedor_id
       JOIN produto p           ON p.id = f.produto_id
       JOIN categoria_produto c ON c.id = p.categoria_id
      WHERE f.ativo
      ORDER BY p.nome`,
  );
  res.json({ no_banco: r.no, itens: r.rows });
}));

app.get('/api/compradores', rota(async (req, res) => {
  const r = await db.query(
    `SELECT e.cnpj, e.nome_fantasia, e.razao_social
       FROM empresa e
       JOIN empresa_perfil ep ON ep.empresa_id = e.id AND ep.ativo
       JOIN perfil p          ON p.id = ep.perfil_id AND p.nome = 'COMPRADOR'
      ORDER BY e.nome_fantasia`,
  );
  res.json(r.rows);
}));

app.get('/api/pedidos', rota(async (req, res) => {
  const r = await db.query(
    `SELECT pe.id, e.nome_fantasia AS comprador, p.nome AS produto,
            pe.quantidade::float AS quantidade, pe.preco_unitario::float AS preco_unitario,
            pe.valor_total::float AS valor_total, pe.estrategia, pe.no_banco, pe.criado_em
       FROM pedido pe
       JOIN empresa e      ON e.id = pe.comprador_id
       JOIN fornecimento f ON f.id = pe.fornecimento_id
       JOIN produto p      ON p.id = f.produto_id
      ORDER BY pe.criado_em DESC
      LIMIT 50`,
  );
  res.json(r.rows);
}));

// Body: { fornecimento_id, comprador_cnpj, quantidade, estrategia, atraso_ms?, no? }
app.post('/api/pedidos', rota(async (req, res) => {
  const b = req.body || {};
  const r = await comprar({
    fornecimentoId: b.fornecimento_id,
    compradorCnpj: b.comprador_cnpj,
    quantidade: b.quantidade,
    estrategia: b.estrategia,
    atrasoMs: b.atraso_ms,
    no: b.no === undefined ? undefined : Number(b.no),
  });
  res.status(201).json(r);
}));

app.get('/api/laboratorio', rota(async (req, res) => res.json(await lab.estado())));
app.post('/api/laboratorio/reset', rota(async (req, res) => res.json(await lab.reset())));

// Body: { estrategia, atraso_ms? }
app.post('/api/laboratorio/disputa', rota(async (req, res) => {
  const b = req.body || {};
  res.json(await lab.disputa({ estrategia: b.estrategia, atrasoMs: b.atraso_ms ?? 300 }));
}));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof ErroNegocio) {
    const { status, message, ...extra } = err;
    return res.status(status).json({ erro: message, ...extra });
  }
  if (err.code === '22P02') return res.status(400).json({ erro: 'Identificador inválido' });
  console.error(err);
  return res.status(500).json({ erro: err.message, codigo: err.code });
});

module.exports = app;
