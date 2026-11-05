# PhotoRepo

Galerie privée hébergée sur le NAS : chaque modèle se connecte avec un pseudo et un mot de passe et ne voit que les shootings que l'admin lui a ouverts.

## Organisation des photos attendue

```
Photographie/
├── 26-11-04 Shooting Glam'Street/     ← "AA-MM-JJ Nom" (ou "AA-MM Nom" pour les vacances)
│   ├── original/   glam-street_1.jpg, glam-street_2.jpg…  (obligatoire)
│   ├── carre/      glam-street_carre_1.jpg…               (facultatif)
│   └── story/      glam-street_story_1.jpg…               (facultatif)
├── RAW/                                ← ignoré
└── copyright.png                       ← ignoré
```

- Seuls les dossiers qui commencent par une date sont pris en compte.
- Le **numéro** de l'image est le nombre après le dernier `_` : c'est lui qui relie l'originale, la carrée et la story.
- Les noms de sous-dossiers ne tiennent pas compte des majuscules (`Original` marche aussi).
- Le site relit les dossiers au démarrage puis toutes les 5 minutes (bouton « Relire les dossiers » pour l'admin).
- Un nouveau dossier est **caché pour tout le monde** sauf l'admin, tant qu'on n'a pas donné l'accès.
- Le dossier Photographie est monté **en lecture seule** : le site ne modifie jamais les photos.

## Installation sur le Synology (Container Manager)

1. Copie le projet sur le NAS (par exemple `/volume1/docker/photorepo`), avec `git clone` ou File Station.
2. Copie `.env.example` en `.env` et remplis-le : nom du site, compte admin, mot de passe de la base, `PHOTOS_PATH` (en général `/volume1/Photographie`) et `APP_PORT`.
3. Container Manager → **Projet** → **Créer** → choisis le dossier du projet : il trouve `docker-compose.yml`. Lance la construction.
4. Le site répond sur `http://IP-DU-NAS:APP_PORT`. Configure ton reverse proxy (HTTPS + nom de domaine) vers ce port.

Le compte admin est créé au premier démarrage. Pour changer son mot de passe ou recréer un admin :

```bash
docker exec -it photorepo-app node dist/cli/create-admin.js <pseudo> <nouveau-mot-de-passe>
```

Mise à jour : récupère la nouvelle version du code puis, dans Container Manager, **Projet → Action → Construire** (la base de données est conservée dans `data/postgres`).

## Développement

Prérequis : Node 22+ et Docker.

```bash
cp .env.example .env               # puis adapte les valeurs
docker compose up -d db            # seulement la base (ajoute "ports: [5432:5432]" au service db si besoin)
npm install
npm run dev                        # site sur http://localhost:5173, API sur :3000
```

Ou tout en Docker, comme sur le NAS : `docker compose up -d --build` puis http://localhost:8080.

## Technique

- `server/` : Node + TypeScript (Fastify), PostgreSQL. Mots de passe hashés avec Argon2, sessions par cookie `httpOnly`, max 10 tentatives de connexion par 15 min et par IP.
- `web/` : React + TypeScript (Vite).
- Une seule image Docker sert l'API et le site.

## Avancement

- [x] Étape 1 : connexion, compte admin, lecture des dossiers, liste des shootings
- [ ] Étape 2 : galerie (miniatures, vue en grand, versions originale / carrée / story, téléchargements)
- [ ] Étape 3 : administration (utilisateurs, accès aux shootings)
- [ ] Étape 4 : page de suivi (qui a vu / téléchargé quoi). Les événements sont déjà enregistrés en base.
