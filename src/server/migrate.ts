import { getDb, closeDb } from './database';
import fs from 'fs';
import path from 'path';

function runMigrations(dir: string, label: string) {
  if (!fs.existsSync(dir)) return;
  const db = getDb();
  for (const file of fs.readdirSync(dir).sort()) {
    if (file.endsWith('.sql')) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf-8');
      db.exec(sql);
      console.log(`[${label}] Applied migration: ${file}`);
    }
  }
}

runMigrations(path.resolve(process.cwd(), 'migrations/accounts'), 'accounts');
closeDb();
