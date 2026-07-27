// apps/api/tests/helpers/globalTeardown.ts
// Global teardown executed after all Jest tests finish
// Disconnects singleton Redis clients and app database connection pool cleanly

import { redisClient, redisPublisher } from '../../src/config/redis';
import { db as appDb } from '../../src/config/database';

export default async function globalTeardown(): Promise<void> {
  try {
    await appDb.destroy();
  } catch (err) {
    // Ignore error if already destroyed
  }

  try {
    redisClient.disconnect();
    redisPublisher.disconnect();
  } catch (err) {
    // Ignore error if already disconnected
  }
}
