// index.js

const express = require("express");
const cors = require("cors");
const apiRoutes = require("./src/routes");
// ==================================================================
// ALTERAÇÃO APLICADA AQUI: Importa as funções com os novos nomes.
// ==================================================================
const { getRuasComCache, getBairrosComCache } = require("./src/google-services");

const app = express();
const port = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.static("public"));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));


// Rota principal da API
app.use("/api", apiRoutes);

// Inicia o servidor
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);

  // ==================================================================
  // ALTERAÇÃO APLICADA AQUI: Chama as funções com os novos nomes.
  // ==================================================================
  getRuasComCache();
  getBairrosComCache();
});
