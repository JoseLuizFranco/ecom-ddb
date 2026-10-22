/*
===============================================================================
PORTAL B2B - ESQUEMA PARA AMAZON AURORA DSQL

Mesmo modelo de db/yugabyte/01_schema.sql, adaptado às restrições do DSQL:
  - sem CREATE EXTENSION (gen_random_uuid() já é nativa);
  - sem FOREIGN KEY (a integridade referencial fica na aplicação);
  - índices secundários criados com CREATE INDEX ASYNC;
  - cada DDL roda em sua própria transação (psql em autocommit já faz isso).

Os scripts de carga 02_seed_laboratorio.sql e 03_seed_complementar.sql de
db/yugabyte funcionam sem alterações no DSQL.
===============================================================================
*/

CREATE TABLE IF NOT EXISTS perfil (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome      VARCHAR(50)  NOT NULL UNIQUE,
    descricao VARCHAR(255),
    ativo     BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS empresa (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    razao_social  VARCHAR(200) NOT NULL,
    nome_fantasia VARCHAR(200),
    cnpj          CHAR(14)     NOT NULL UNIQUE,
    email         VARCHAR(200) NOT NULL,
    telefone      VARCHAR(20),
    senha_hash    VARCHAR(255) NOT NULL,
    status        VARCHAR(20)  NOT NULL DEFAULT 'ATIVA'
                  CHECK (status IN ('ATIVA', 'INATIVA', 'PENDENTE', 'BLOQUEADA')),
    criado_em     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS empresa_perfil (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID    NOT NULL,
    perfil_id  UUID    NOT NULL,
    ativo      BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (empresa_id, perfil_id)
);

CREATE TABLE IF NOT EXISTS categoria_produto (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome      VARCHAR(100) NOT NULL UNIQUE,
    descricao VARCHAR(255),
    ativa     BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS produto (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    categoria_id               UUID         NOT NULL,
    nome                       VARCHAR(150) NOT NULL,
    descricao                  VARCHAR(255),
    unidade_medida             VARCHAR(10)  NOT NULL,
    tipo_transporte_necessario VARCHAR(20)  NOT NULL
                               CHECK (tipo_transporte_necessario IN
                                      ('RODOVIARIO', 'FERROVIARIO', 'MARITIMO', 'AEREO')),
    ativo                      BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS processo_negociacao (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    produto_id  UUID        NOT NULL,
    modo        VARCHAR(20) NOT NULL CHECK (modo IN ('VENDA', 'COMPRA', 'LEILAO')),
    status      VARCHAR(20) NOT NULL DEFAULT 'ABERTO'
                CHECK (status IN ('ABERTO', 'ENCERRADO', 'CANCELADO')),
    data_inicio TIMESTAMPTZ NOT NULL DEFAULT now(),
    data_fim    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS fornecimento (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    negociacao_id         UUID          NOT NULL,
    fornecedor_id         UUID          NOT NULL,
    produto_id            UUID          NOT NULL,
    preco_unitario        NUMERIC(12,2) NOT NULL CHECK (preco_unitario > 0),
    quantidade_disponivel NUMERIC(14,3) NOT NULL CHECK (quantidade_disponivel >= 0),
    ativo                 BOOLEAN       NOT NULL DEFAULT TRUE,
    versao                INTEGER       NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pedido (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fornecimento_id UUID          NOT NULL,
    comprador_id    UUID          NOT NULL,
    quantidade      NUMERIC(14,3) NOT NULL CHECK (quantidade > 0),
    preco_unitario  NUMERIC(12,2) NOT NULL,
    valor_total     NUMERIC(14,2) NOT NULL,
    estrategia      VARCHAR(20)   NOT NULL
                    CHECK (estrategia IN ('SEM_CONTROLE', 'PESSIMISTA', 'OTIMISTA')),
    no_banco        VARCHAR(64),
    criado_em       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX ASYNC IF NOT EXISTS ix_fornecimento_produto ON fornecimento (produto_id);
CREATE INDEX ASYNC IF NOT EXISTS ix_pedido_fornecimento  ON pedido (fornecimento_id);
