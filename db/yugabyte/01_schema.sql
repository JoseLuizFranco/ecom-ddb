/*
===============================================================================
PORTAL B2B - ESQUEMA (YugabyteDB / PostgreSQL distribuído)

As tabelas são distribuídas automaticamente pelo YugabyteDB em tablets
(fragmentos) replicados entre os nós do cluster (fator de replicação 3).
As chaves primárias UUID usam particionamento por HASH, o que espalha os
registros uniformemente entre os nós.
===============================================================================
*/

CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
    empresa_id UUID    NOT NULL REFERENCES empresa (id),
    perfil_id  UUID    NOT NULL REFERENCES perfil (id),
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
    categoria_id               UUID         NOT NULL REFERENCES categoria_produto (id),
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
    produto_id  UUID        NOT NULL REFERENCES produto (id),
    modo        VARCHAR(20) NOT NULL CHECK (modo IN ('VENDA', 'COMPRA', 'LEILAO')),
    status      VARCHAR(20) NOT NULL DEFAULT 'ABERTO'
                CHECK (status IN ('ABERTO', 'ENCERRADO', 'CANCELADO')),
    data_inicio TIMESTAMPTZ NOT NULL DEFAULT now(),
    data_fim    TIMESTAMPTZ
);

-- Registro disputado pelas transações concorrentes.
-- "versao" é utilizada pela estratégia de concorrência otimista.
CREATE TABLE IF NOT EXISTS fornecimento (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    negociacao_id         UUID          NOT NULL REFERENCES processo_negociacao (id),
    fornecedor_id         UUID          NOT NULL REFERENCES empresa (id),
    produto_id            UUID          NOT NULL REFERENCES produto (id),
    preco_unitario        NUMERIC(12,2) NOT NULL CHECK (preco_unitario > 0),
    quantidade_disponivel NUMERIC(14,3) NOT NULL CHECK (quantidade_disponivel >= 0),
    ativo                 BOOLEAN       NOT NULL DEFAULT TRUE,
    versao                INTEGER       NOT NULL DEFAULT 1
);

-- Pedido de compra realizado por uma empresa compradora.
CREATE TABLE IF NOT EXISTS pedido (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fornecimento_id UUID          NOT NULL REFERENCES fornecimento (id),
    comprador_id    UUID          NOT NULL REFERENCES empresa (id),
    quantidade      NUMERIC(14,3) NOT NULL CHECK (quantidade > 0),
    preco_unitario  NUMERIC(12,2) NOT NULL,
    valor_total     NUMERIC(14,2) NOT NULL,
    estrategia      VARCHAR(20)   NOT NULL
                    CHECK (estrategia IN ('SEM_CONTROLE', 'PESSIMISTA', 'OTIMISTA')),
    no_banco        VARCHAR(64),
    criado_em       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_fornecimento_produto ON fornecimento (produto_id);
CREATE INDEX IF NOT EXISTS ix_pedido_fornecimento  ON pedido (fornecimento_id);
