// Crée un compte admin, ou change son mot de passe s'il existe déjà.
// Usage (Docker) : docker exec -it photorepo-app node dist/cli/create-admin.js <pseudo> <mot-de-passe>
import { hashPassword } from '../auth.js';
import { migrate, pool } from '../db.js';

const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.error('Usage : create-admin <pseudo> <mot-de-passe>');
  process.exit(1);
}

await migrate();
const passwordHash = await hashPassword(password);
const updated = await pool.query(
  'UPDATE users SET password_hash = $2, is_admin = true, disabled = false WHERE lower(username) = lower($1)',
  [username, passwordHash],
);
if (updated.rowCount) {
  console.log(`Mot de passe de "${username}" mis à jour (compte admin).`);
} else {
  await pool.query('INSERT INTO users (username, password_hash, is_admin) VALUES ($1, $2, true)', [username, passwordHash]);
  console.log(`Compte admin "${username}" créé.`);
}
// Déconnecte les sessions existantes de ce compte.
await pool.query('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE lower(username) = lower($1))', [username]);
await pool.end();
