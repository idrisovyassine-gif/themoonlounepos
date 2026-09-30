const { createApp } = require("./src/app");
const config = require("./src/config");

const app = createApp();
const server = app.listen(config.port, () => console.log(`Servio POS prêt sur le port ${config.port}`));

const shutdown = () => server.close(() => {
  app.locals.db.close();
  process.exit(0);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
