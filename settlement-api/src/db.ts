import postgres from 'postgres';
import { config } from './config';

export const db = postgres(config.SETTLEMENT_DATABASE_URL, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
  ssl: config.SETTLEMENT_DATABASE_URL.includes('sslmode=require') ? 'require' : false,
});

export const leadershipConnection = postgres(config.SETTLEMENT_DATABASE_URL, {
  max: 1,
  idle_timeout: 0,
  connect_timeout: 10,
  keep_alive: 60,
  ssl: config.SETTLEMENT_DATABASE_URL.includes('sslmode=require') ? 'require' : false,
});
