import app from './app.js';
import { env, validateEnv } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';

const startServer = async () => {
  try {
    validateEnv();

    // Test database connection on startup
    const prisma = connectDatabase();
    await prisma.$connect();
    console.log('Successfully connected to the database.');

    const server = app.listen(env.port, () => {
      console.log(`Server is running on port ${env.port}`);
    });

    // Graceful shutdown
    const shutdown = async () => {
      console.log('Shutting down server...');
      server.close(async () => {
        console.log('HTTP server closed.');
        await disconnectDatabase();
        console.log('Database connection closed.');
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
