#!/usr/bin/env bash
# Demonstra tolerância a falhas: derruba um nó do cluster (RF=3) e mostra que
# leituras e escritas continuam funcionando com os 2 nós restantes.
set -euo pipefail
cd "$(dirname "$0")/.."

NO="${1:-yb3}"
API="${API:-http://localhost:3000}"

echo ">> Estado inicial do cluster"
curl -s "$API/api/cluster" | node -e 'const c=JSON.parse(require("fs").readFileSync(0));for(const n of c.nos)console.log(" ",n.no,n.online?"online":"OFFLINE")'

echo ">> Derrubando o nó $NO"
docker compose stop "$NO" >/dev/null
sleep 5

echo ">> Cluster após a falha"
curl -s "$API/api/cluster" | node -e 'const c=JSON.parse(require("fs").readFileSync(0));for(const n of c.nos)console.log(" ",n.no,n.online?"online":"OFFLINE")'

echo ">> Executando a disputa PESSIMISTA com um nó a menos"
curl -s -XPOST "$API/api/laboratorio/disputa" -H 'content-type: application/json' \
  -d '{"estrategia":"PESSIMISTA"}' | node -e '
const d=JSON.parse(require("fs").readFileSync(0));
for(const c of d.compras)console.log(" ",c.comprador,c.quantidade+"kg",c.ok?"ACEITO no nó "+c.no_banco:"RECUSADO: "+c.erro);
console.log("  estoque final",d.estado_final.quantidade_disponivel,"kg | consistente:",d.estado_final.consistente)'

echo ">> Religando o nó $NO"
docker compose start "$NO" >/dev/null
echo "Pronto. O nó volta a sincronizar automaticamente com o cluster."
