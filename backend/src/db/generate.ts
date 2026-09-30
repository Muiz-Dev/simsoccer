import { execSync } from 'child_process';
import { verifySafeDatabase } from './guard';

function generateMigrations() {
  verifySafeDatabase('Generate Drizzle Schema Migrations');
  console.log('🛠️ Generating Drizzle versioned migration files...');
  execSync('npx drizzle-kit generate', { stdio: 'inherit' });
  console.log('✅ Versioned migration files generated successfully.');
}

generateMigrations();
