import { loadConfig } from './config.js';
import { connectDatabase } from './db.js';
import { createApp } from './app.js';

const config = loadConfig();
let connection;
try {
  connection = await connectDatabase(config);
} catch (error) {
  if (error?.name === 'MongoServerSelectionError') {
    console.error('MongoDB is not reachable as a writable replica set. Check Atlas cluster status/elections, Network Access IP allowlist, outbound firewall access, and MONGODB_URI.');
    console.error(`Connection detail: ${error.message}`);
  } else {
    console.error('Finance Tracker API startup failed while connecting to MongoDB or creating indexes.');
    console.error(`Startup detail: ${error?.message ?? 'Unknown error'}`);
  }
  process.exitCode = 1;
}

const { client, database } = connection ?? {};
const server = connection && createApp({ database, config }).listen(config.PORT, () => {
  console.info(`Finance Tracker API listening on port ${config.PORT}`);
});

async function shutdown(signal) {
  console.info(`Received ${signal}; closing API and database connection.`);
  if (!server) return;
  server.close(async () => {
    await client.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));