'use strict';

// Testes de integração: exigem o cluster no ar (docker compose up -d).

const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const lab = require('../src/laboratorio');
const { comprar } = require('../src/compras');

after(() => db.close());
beforeEach(() => lab.reset());

test('o laboratório começa com 1.000 kg de Alumínio Reciclado a R$ 7,50', async () => {
  const e = await lab.estado();
  assert.equal(e.fornecedor, 'EcoMetais');
  assert.equal(e.preco_unitario, 7.5);
  assert.equal(e.quantidade_disponivel, 1000);
  assert.equal(e.pedidos, 0);
});

test('todos os nós do cluster respondem e enxergam os mesmos dados', async () => {
  const leituras = await Promise.all(db.nodes.map((_, i) => lab.estado(i)));
  assert.ok(db.nodes.length >= 1);
  for (const l of leituras) assert.equal(l.quantidade_disponivel, 1000);
});

test('escrita em um nó é lida imediatamente em outro nó (consistência forte)', async () => {
  const id = await lab.fornecimentoId();
  const r = await comprar({
    fornecimentoId: id, compradorCnpj: lab.CNPJ_COMPRADOR_A, quantidade: 120,
    estrategia: 'PESSIMISTA', no: 0,
  });
  assert.equal(r.saldo_gravado, 880);
  const ultimo = db.nodes.length - 1;
  const e = await lab.estado(ultimo);
  assert.equal(e.quantidade_disponivel, 880);
  assert.equal(e.lido_no_no, db.nodes[ultimo].nome);
});

test('SEM_CONTROLE: compras concorrentes geram lost update (vende 1.200 kg)', async () => {
  const d = await lab.disputa({ estrategia: 'SEM_CONTROLE', atrasoMs: 300 });
  assert.equal(d.compras.filter((c) => c.ok).length, 2);
  assert.equal(d.estado_final.quantidade_vendida, 1200);
  assert.equal(d.estado_final.consistente, false);
});

test('PESSIMISTA: apenas uma compra é aceita e o estoque fica consistente', async () => {
  const d = await lab.disputa({ estrategia: 'PESSIMISTA', atrasoMs: 300 });
  const aceitas = d.compras.filter((c) => c.ok);
  const recusada = d.compras.find((c) => !c.ok);
  assert.equal(aceitas.length, 1);
  assert.equal(recusada.erro, 'Quantidade indisponível');
  // A transação recusada ficou bloqueada esperando o lock da outra.
  assert.ok(recusada.espera_lock_ms >= 200, `esperou ${recusada.espera_lock_ms} ms`);
  assert.equal(d.estado_final.consistente, true);
  assert.equal(d.estado_final.quantidade_disponivel, 1000 - aceitas[0].quantidade);
});

test('OTIMISTA: conflito de versão é detectado e o estoque fica consistente', async () => {
  const d = await lab.disputa({ estrategia: 'OTIMISTA', atrasoMs: 300 });
  const aceitas = d.compras.filter((c) => c.ok);
  const recusada = d.compras.find((c) => !c.ok);
  assert.equal(aceitas.length, 1);
  assert.ok(recusada.conflitos.length >= 1, 'deveria registrar conflito de versão');
  assert.equal(d.estado_final.consistente, true);
  assert.equal(d.estado_final.versao, 2);
});

test('OTIMISTA: compras compatíveis são atendidas após conflito e nova tentativa', async () => {
  const id = await lab.fornecimentoId();
  const [a, b] = await Promise.all([
    comprar({ fornecimentoId: id, compradorCnpj: lab.CNPJ_COMPRADOR_A, quantidade: 400, estrategia: 'OTIMISTA', atrasoMs: 200, no: 0 }),
    comprar({ fornecimentoId: id, compradorCnpj: lab.CNPJ_COMPRADOR_B, quantidade: 300, estrategia: 'OTIMISTA', atrasoMs: 200, no: 1 % db.nodes.length }),
  ]);
  const conflitos = a.conflitos.length + b.conflitos.length;
  assert.ok(conflitos >= 1, 'uma das transações deveria ter repetido a operação');
  const e = await lab.estado();
  assert.equal(e.quantidade_disponivel, 300);
  assert.equal(e.consistente, true);
});

test('regras de negócio: quantidade maior que o estoque é recusada', async () => {
  const id = await lab.fornecimentoId();
  await assert.rejects(
    comprar({ fornecimentoId: id, compradorCnpj: lab.CNPJ_COMPRADOR_A, quantidade: 1500, estrategia: 'PESSIMISTA' }),
    { status: 409 },
  );
});
