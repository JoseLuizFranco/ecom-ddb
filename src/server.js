'use strict';

const app = require('./app');
const db = require('./db');

const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
  console.log(`Portal B2B em http://localhost:${port} (modo ${db.MODE}, ${db.nodes.length} nós: ${db.nodes.map((n) => n.nome).join(', ')})`);
});
