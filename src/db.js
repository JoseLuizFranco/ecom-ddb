'use strict';

/**
 * Camada de acesso ao banco distribuído.
 *
 * Mantém um pool de conexões para CADA nó do cluster. As requisições são
 * distribuídas em round-robin entre os nós e, se um nó estiver fora do ar,
 * a próxima tentativa vai automaticamente para outro nó (failover).
 *
 * Modos:
 *   DB_MODE=yugabyte (padrão)  DB_HOSTS=yb1:5433,yb2:5433,yb3:5433
 *   DB_MODE=dsql               DSQL_ENDPOINTS=<id>.dsql.us-east-1.on.aws,<id>.dsql.us-east-2.on.aws
 */

const { Pool } = require('pg');

const MODE = (process.env.DB_MODE || 'yugabyte').toLowerCase();

function regionFromDsqlEndpoint(hostname) {
  const m = hostname.match(/\.dsql\.([a-z0-9-]+)\.on\.aws$/);
  return m ? m[1] : process.env.AWS_REGION;
}

function buildNodes() {
  if (MODE === 'dsql') {
    const { DsqlSigner } = require('@aws-sdk/dsql-signer');
    const endpoints = (process.env.DSQL_ENDPOINTS || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (endpoints.length === 0) throw new Error('DSQL_ENDPOINTS não informado');
    const user = process.env.DB_USER || 'admin';
    return endpoints.map((hostname) => {
      const signer = new DsqlSigner({ hostname, region: regionFromDsqlEndpoint(hostname) });
      return {
        nome: hostname.split('.')[0] + '@' + regionFromDsqlEndpoint(hostname),
        pool: new Pool({
          host: hostname,
          port: 5432,
          user,
          database: process.env.DB_NAME || 'postgres',
          // O token IAM expira; o pg chama esta função a cada nova conexão.
          password: () => (user === 'admin'
            ? signer.getDbConnectAdminAuthToken()
            : signer.getDbConnectAuthToken()),
          ssl: { rejectUnauthorized: true },
          max: 10,
          connectionTimeoutMillis: 5000,
        }),
      };
    });
  }

  const hosts = (process.env.DB_HOSTS || 'localhost:5433,localhost:5434,localhost:5435')
    .split(',').map((s) => s.trim()).filter(Boolean);
  return hosts.map((hp) => {
    const [host, port] = hp.split(':');
    return {
      nome: hp,
      pool: new Pool({
        host,
        port: Number(port || 5433),
        user: process.env.DB_USER || 'yugabyte',
        password: process.env.DB_PASSWORD || undefined,
        database: process.env.DB_NAME || 'yugabyte',
        max: 10,
        connectionTimeoutMillis: 3000,
      }),
    };
  });
}

const nodes = buildNodes();
for (const n of nodes) n.pool.on('error', () => { /* conexão ociosa perdida: o failover trata */ });

let cursor = 0;

/**
 * Obtém uma conexão. Se `no` for informado (índice), começa por aquele nó;
 * caso contrário escolhe em round-robin. Nós indisponíveis são pulados.
 */
async function connect(no) {
  const inicio = Number.isInteger(no) && nodes[no] ? no : cursor++ % nodes.length;
  const ordem = [];
  for (let i = 0; i < nodes.length; i++) ordem.push(nodes[(inicio + i) % nodes.length]);

  let ultimoErro;
  for (const node of ordem) {
    try {
      const client = await node.pool.connect();
      client.no = node.nome;
      return client;
    } catch (err) {
      ultimoErro = err;
    }
  }
  throw ultimoErro;
}

async function query(sql, params, no) {
  const client = await connect(no);
  try {
    const r = await client.query(sql, params);
    r.no = client.no;
    return r;
  } finally {
    client.release();
  }
}

async function close() {
  await Promise.all(nodes.map((n) => n.pool.end()));
}

module.exports = { MODE, nodes, connect, query, close };
