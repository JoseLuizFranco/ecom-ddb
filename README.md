# Portal B2B — Banco de Dados Distribuído

Prova de conceito de um e-commerce B2B rodando sobre um **banco de dados distribuído (BDD)**, com um laboratório de **controle de concorrência** (pessimista × otimista) sobre o mesmo registro de estoque acessado a partir de **nós diferentes** do cluster.

- **Local / testes:** cluster [YugabyteDB](https://www.yugabyte.com/) com **3 nós** e fator de replicação 3 (Docker Compose).
- **Nuvem:** [Amazon Aurora DSQL](https://aws.amazon.com/rds/aurora/dsql/) (esquema adaptado em `db/dsql/` e conexão por token IAM).

Os dois são compatíveis com PostgreSQL, então o mesmo código e praticamente o mesmo SQL rodam em ambos.

## Por que YugabyteDB localmente e Aurora DSQL na nuvem

| | YugabyteDB (local) | Aurora DSQL (AWS) |
|---|---|---|
| Distribuição | Tabelas fragmentadas em *tablets* e replicadas por Raft entre os nós | Serverless, ativo-ativo, multi-AZ / multi-região |
| Rodar sem conta na nuvem | Sim, `docker compose up` | Não, exige conta AWS |
| Controle de concorrência | Locks reais (`FOR UPDATE` bloqueia) + MVCC | Somente otimista (OCC): conflitos são detectados no `COMMIT` |
| Chaves estrangeiras | Sim | Não (integridade fica na aplicação) |

Para *provar o conceito* e rodar testes automatizados, o YugabyteDB é o mais adequado: sobe em qualquer máquina, permite derrubar um nó e observar o cluster continuar funcionando, e suporta tanto concorrência pessimista quanto otimista. O Aurora DSQL é o alvo gerenciado na AWS.

## Arquitetura

```
              ┌──────────────────────────────┐
  navegador → │  API Node.js (Express)       │
              │  1 pool de conexões por nó   │
              │  round-robin + failover      │
              └──────┬─────────┬─────────┬───┘
                     │         │         │
                ┌────▼──┐ ┌────▼──┐ ┌────▼──┐
                │  yb1  │ │  yb2  │ │  yb3  │   YugabyteDB, RF = 3
                │zona-a │◄►zona-b │◄►zona-c │   (replicação Raft)
                └───────┘ └───────┘ └───────┘
```

Na disputa do laboratório, o **Comprador A** se conecta ao nó `yb1`, o **Comprador B** ao nó `yb2`, e o resultado final é lido no nó `yb3`: a coordenação acontece entre nós distintos do cluster.

## Modelo de dados

`perfil`, `empresa`, `empresa_perfil`, `categoria_produto`, `produto`, `processo_negociacao`, `fornecimento` (registro disputado, com a coluna `versao` usada na estratégia otimista) e `pedido`.

| Arquivo | Conteúdo |
|---|---|
| `db/yugabyte/01_schema.sql` | Criação das tabelas |
| `db/yugabyte/02_seed_laboratorio.sql` | Cenário do laboratório: EcoMetais, Alumínio Reciclado, 1.000 kg a R$ 7,50/kg |
| `db/yugabyte/03_seed_complementar.sql` | Compradores A e B, outro fornecedor e mais produtos |
| `db/yugabyte/99_reset_laboratorio.sql` | Restaura o estoque para 1.000 kg |
| `db/dsql/01_schema.sql` | Esquema adaptado ao Aurora DSQL |

## Como rodar (local)

Requisitos: Docker com Compose e Node.js 20+.

```bash
docker compose up -d --build
```

Isso sobe os 3 nós, cria o esquema, popula o banco e inicia a aplicação.

- Aplicação: http://localhost:3000
- Painel do cluster YugabyteDB: http://localhost:15433
- Nós via `psql`: `localhost:5433`, `localhost:5434`, `localhost:5435` (usuário `yugabyte`, sem senha)

Para rodar a aplicação fora do Docker (apenas o banco no Compose):

```bash
docker compose up -d yb1 yb2 yb3 db-init
npm install
npm start          # usa localhost:5433,5434,5435
```

## Laboratório de concorrência

Fornecimento: **1.000 kg** de Alumínio Reciclado. Comprador A pede **700 kg** e Comprador B pede **500 kg** ao mesmo tempo (700 + 500 = 1.200 kg > 1.000 kg).

```bash
npm run disputa                 # executa as três estratégias
npm run disputa -- PESSIMISTA   # só uma
```

Saída esperada:

```
=== SEM_CONTROLE ===
Comprador A   700 kg  ACEITO   no nó localhost:5433 (saldo lido 1000, gravado 300)
Comprador B   500 kg  ACEITO   no nó localhost:5434 (saldo lido 1000, gravado 500)
Estoque final 500 kg | vendido 1200 kg | INCONSISTENTE (lost update) | lido no nó localhost:5435

=== PESSIMISTA ===
Comprador A   700 kg  ACEITO   no nó localhost:5433 (saldo lido 1000, gravado 300)
Comprador B   500 kg  RECUSADO Quantidade indisponível (esperou 324 ms pelo lock)
Estoque final 300 kg | vendido 700 kg | CONSISTENTE | lido no nó localhost:5435

=== OTIMISTA ===
Comprador A   700 kg  ACEITO   no nó localhost:5433 (saldo lido 1000, gravado 300)
Comprador B   500 kg  RECUSADO Quantidade indisponível (1 conflito(s) de versão)
Estoque final 300 kg | vendido 700 kg | CONSISTENTE | lido no nó localhost:5435
```

| Estratégia | Como funciona (`src/compras.js`) |
|---|---|
| `SEM_CONTROLE` | Lê o saldo, calcula na aplicação e grava o valor absoluto. As duas compras são aceitas: **lost update**. |
| `PESSIMISTA` | `SELECT ... FOR UPDATE` bloqueia a linha. A segunda transação **espera** o lock (vindo de outro nó) e, ao continuar, vê só 300 kg. |
| `OTIMISTA` | Leitura sem lock; gravação com `UPDATE ... WHERE versao = :versao_lida`. Se nenhuma linha for afetada houve **conflito**: relê e tenta de novo (até 3 vezes). |

O parâmetro `atraso_ms` (padrão 300) simula o tempo de processamento entre a leitura e a gravação, para forçar a sobreposição das transações.

O cluster é iniciado com `yb_enable_read_committed_isolation=true`, para que o nível READ COMMITTED se comporte como no PostgreSQL e o *lost update* da estratégia sem controle possa ser observado.

## Tolerância a falhas

Com a aplicação no ar:

```bash
npm run falha            # derruba o yb3, executa a disputa e religa o nó
```

Com um dos três nós fora, o cluster continua aceitando leituras e escritas (maioria Raft de 2/3), e a aplicação redireciona as conexões para os nós vivos.

## Testes

Testes de integração contra o cluster real (`test/concorrencia.test.js`):

```bash
docker compose up -d yb1 yb2 yb3 db-init
npm install
npm test
```

Cobrem: carga inicial, replicação entre nós (escreve em um, lê em outro), *lost update* sem controle, bloqueio pessimista entre nós, detecção de conflito otimista, nova tentativa otimista bem-sucedida e regra de estoque. Os mesmos testes rodam no GitHub Actions a cada push.

## API

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/cluster` | Status de cada nó e topologia (`yb_servers()`) |
| GET | `/api/fornecimentos` | Catálogo (produto, fornecedor, preço, estoque, versão) |
| GET | `/api/compradores` | Empresas com perfil COMPRADOR |
| GET | `/api/pedidos` | Últimos pedidos (com o nó que os gravou) |
| POST | `/api/pedidos` | `{ fornecimento_id, comprador_cnpj, quantidade, estrategia, atraso_ms?, no? }` |
| GET | `/api/laboratorio` | Estado do fornecimento do laboratório |
| POST | `/api/laboratorio/reset` | Restaura 1.000 kg a R$ 7,50 |
| POST | `/api/laboratorio/disputa` | `{ estrategia, atraso_ms? }` — executa A × B em nós diferentes |

Exemplo:

```bash
curl -X POST localhost:3000/api/laboratorio/disputa \
  -H 'content-type: application/json' -d '{"estrategia":"OTIMISTA"}'
```

## Aurora DSQL (AWS)

1. Crie o cluster (região única; para multirregião, crie clusters pareados em duas regiões com uma região testemunha, conforme a [documentação do DSQL](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/what-is-aurora-dsql.html)):

   ```bash
   aws dsql create-cluster --region us-east-1 --no-deletion-protection-enabled
   ```

2. Crie o esquema e carregue os dados (o token IAM substitui a senha):

   ```bash
   export ENDPOINT=<id-do-cluster>.dsql.us-east-1.on.aws
   export PGPASSWORD=$(aws dsql generate-db-connect-admin-auth-token --hostname $ENDPOINT --region us-east-1)
   export PGSSLMODE=require
   psql -h $ENDPOINT -U admin -d postgres -f db/dsql/01_schema.sql
   psql -h $ENDPOINT -U admin -d postgres -f db/yugabyte/02_seed_laboratorio.sql
   psql -h $ENDPOINT -U admin -d postgres -f db/yugabyte/03_seed_complementar.sql
   ```

3. Inicie a aplicação apontando para o DSQL (as credenciais AWS vêm do ambiente/perfil padrão):

   ```bash
   DB_MODE=dsql DSQL_ENDPOINTS=$ENDPOINT npm start
   # multirregião: DSQL_ENDPOINTS=<id1>.dsql.us-east-1.on.aws,<id2>.dsql.us-east-2.on.aws
   ```

Diferenças de comportamento no DSQL:

- O DSQL usa apenas controle **otimista** (OCC) com isolamento *repeatable read*. `SELECT ... FOR UPDATE` não bloqueia: ele inclui a linha na verificação de conflito, e a transação que faz `COMMIT` por último é abortada (SQLSTATE `40001`).
- A aplicação repete automaticamente transações abortadas com `40001`, então nas três estratégias o resultado final fica consistente: no DSQL nem a estratégia "sem controle" produz *lost update*, porque o próprio banco rejeita a gravação conflitante.
- Sem chaves estrangeiras e sem extensões; índices secundários com `CREATE INDEX ASYNC`.

## Configuração

| Variável | Padrão | Uso |
|---|---|---|
| `DB_MODE` | `yugabyte` | `yugabyte` ou `dsql` |
| `DB_HOSTS` | `localhost:5433,localhost:5434,localhost:5435` | Nós do YugabyteDB |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | `yugabyte` / — / `yugabyte` | Credenciais (no DSQL: `admin` / token IAM / `postgres`) |
| `DSQL_ENDPOINTS` | — | Endpoints do Aurora DSQL, separados por vírgula |
| `PORT` | `3000` | Porta HTTP |

## Estrutura

```
├── docker-compose.yml       cluster de 3 nós + carga do banco + aplicação
├── db/
│   ├── yugabyte/            esquema, carga e reset
│   └── dsql/                esquema para Aurora DSQL
├── src/
│   ├── db.js                pools por nó, round-robin e failover
│   ├── compras.js           estratégias de concorrência
│   ├── laboratorio.js       cenário A × B, estado e reset
│   ├── app.js / server.js   API HTTP
│   └── public/index.html    interface web
├── scripts/                 disputa pela linha de comando e demo de falha de nó
└── test/                    testes de integração
```

## Licença

MIT
