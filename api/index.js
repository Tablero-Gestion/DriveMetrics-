// Vercel serverless entrypoint (usa la app adaptada a Postgres)
const app = require('../server.vercel');

module.exports = (req, res) => {
  return app(req, res);
};


