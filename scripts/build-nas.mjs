// Construit l'image Docker pour le NAS et l'exporte dans nas-deploy/photorepo-app.tar.
// Usage : npm run nas
// Le numéro de version (affiché à l'admin) = nombre de commits, avec « + » s'il reste des
// modifications non commitées.
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

function git(args) {
  try {
    return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

const count = git('rev-list --count HEAD') || '0';
const version = `${count}${git('status --porcelain') ? '+' : ''}`;
console.log(`\n▶ Construction de la version v${version}\n`);

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: { ...process.env, APP_VERSION: version },
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    console.error(`\n✖ Échec : ${cmd} ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
}

run('docker', ['compose', 'build', 'app']);
fs.mkdirSync('nas-deploy', { recursive: true });
run('docker', ['save', 'photorepo-app:latest', '-o', 'nas-deploy/photorepo-app.tar']);

const size = (fs.statSync('nas-deploy/photorepo-app.tar').size / 1024 / 1024).toFixed(0);
console.log(`\n✔ nas-deploy/photorepo-app.tar prêt (${size} Mo) — version v${version}`);
console.log('  Importe-le dans Container Manager (Image → Ajouter → À partir d’un fichier), puis redémarre le projet.');
console.log(`  Une fois en ligne, le bas des pages (admin) doit afficher « v${version} ».\n`);
