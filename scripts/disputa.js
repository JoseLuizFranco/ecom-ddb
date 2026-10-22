'use strict';

// Executa a disputa do laboratório pela linha de comando.
//   node scripts/disputa.js PESSIMISTA [atraso_ms]

const db = require('../src/db');
const lab = require('../src/laboratorio');

(async () => {
  const estrategias = process.argv[2] ? [process.argv[2]] : ['SEM_CONTROLE', 'PESSIMISTA', 'OTIMISTA'];
  const atrasoMs = Number(process.argv[3] || 300);

  for (const estrategia of estrategias) {
    const d = await lab.disputa({ estrategia, atrasoMs });
    console.log(`\n=== ${d.estrategia} ===`);
    for (const c of d.compras) {
      const detalhe = c.ok
        ? `ACEITO   no nó ${c.no_banco} (saldo lido ${c.saldo_lido}, gravado ${c.saldo_gravado})`
        : `RECUSADO ${c.erro}${c.espera_lock_ms !== undefined ? ` (esperou ${c.espera_lock_ms} ms pelo lock)` : ''}`
          + `${c.conflitos && c.conflitos.length ? ` (${c.conflitos.length} conflito(s) de versão)` : ''}`;
      console.log(`${c.comprador.padEnd(12)} ${String(c.quantidade).padStart(4)} kg  ${detalhe}`);
    }
    const e = d.estado_final;
    console.log(`Estoque final ${e.quantidade_disponivel} kg | vendido ${e.quantidade_vendida} kg | `
      + `${e.consistente ? 'CONSISTENTE' : 'INCONSISTENTE (lost update)'} | lido no nó ${e.lido_no_no}`);
  }
  await lab.reset();
  await db.close();
})().catch(async (err) => {
  console.error(err);
  await db.close();
  process.exit(1);
});
