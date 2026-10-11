import { loadConfig } from './config.js';
import { connectDatabase } from './db.js';
import { createApp } from './app.js';

const config = loadConfig();
const { client, database } = await connectDatabase(config);
const server = createApp({ database, config }).listen(config.PORT, () => {
  console.info(`Finance Tracker API listening on port ${config.PORT}`);
});

async function shutdown(signal) {
  console.info(`Received ${signal}; closing API and database connection.`);
  server.close(async () => {
    await client.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));