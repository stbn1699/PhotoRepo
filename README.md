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
- Le **numéro** de l'image est le dernier nombre du nom, juste avant l'extension (`glam-street_carre_12.jpg` → 12). C'est lui qui relie l'originale, la carrée et la story.
- S'il n'y a pas de sous-dossier `original`, les photos posées directement dans le dossier du shooting sont prises comme originales.
- Noms de sous-dossiers acceptés, sans tenir compte des majuscules ni des accents : `original` / `originale`, `carre` / `carré` / `square`, `story` / `storyInsta`.
- Une carrée ou une story sans originale du même numéro est ignorée. Si deux fichiers ont le même numéro dans la même version, seul le premier est gardé : l'admin voit la liste des fichiers ignorés en haut de la galerie.
- Le site relit les dossiers au démarrage, toutes les 5 minutes, et à chaque arrivée sur l'accueil (au plus une fois toutes les 15 secondes). L'admin a aussi un bouton « Relire les dossiers ».
- Un nouveau dossier est **caché pour tout le monde** sauf l'admin, tant qu'on n'a pas donné l'accès.
- Le dossier Photographie est monté **en lecture seule** : le site ne modifie jamais les photos.

## RAW

- Les RAW sont lus dans `Raws/<même nom de dossier que le shooting>/` à la racine du lecteur (nom comparé sans tenir compte des majuscules). Formats : `.NEF` et `.DNG`. Les `.xmp`, `.jpg`, vidéos… sont ignorés.
- Le numéro est le dernier nombre du nom (`EBA_0012.NEF` → 12). Un RAW n'est affiché que si une originale porte le même numéro.
- Le site affiche l'aperçu JPEG que l'appareil intègre au fichier (le rendu de l'appareil, sans les retouches Lightroom), réduit à 1600 px et **filigrané avec la signature**.
- **Partage désactivé par défaut**, shooting par shooting : interrupteur « Partager les RAW » dans la galerie (admin) ou dans *Admin → Accès par shooting*. L'admin voit toujours les RAW.
- **Les RAW ne sont jamais téléchargeables**, même par l'admin : le serveur refuse, il n'y a pas de bouton, et clic droit / appui long / glisser sont bloqués. Les aperçus ne sont pas gardés en cache par le navigateur.

## Signature et icône

- La signature `copyright.png` à la racine du lecteur Photographie (la même que celle de Lightroom) remplace le nom du site, en haut à gauche et sur la page de connexion. Elle est recolorée aux couleurs du site, sans toucher au fichier. Si tu la changes sur le NAS, le site suit (dans l'heure, à cause du cache). Pour en utiliser une autre : variable `SIGNATURE_FILE`. Sans signature, c'est le nom du site (`SITE_NAME`) qui s'affiche.
- L'icône (un diaphragme) est dans `web/public/` : onglet du navigateur et « Ajouter à l'écran d'accueil » sur téléphone.

## Galerie et téléchargements

- La galerie affiche des miniatures (800 px) et la vue en grand un aperçu (2048 px). Les deux sont générés une fois puis gardés dans `data/cache`. Dès qu'un shooting apparaît, le serveur les prépare en arrière-plan.
- Les téléchargements donnent **toujours le fichier d'origine**.
- **Téléphone** : le site ouvre le menu « Partager » → « Enregistrer les images », et les photos vont directement dans la galerie du téléphone. Par paquets de 10 photos / 150 Mo maximum. Nécessite HTTPS.
- **Ordinateur** : enregistrement dans un dossier choisi (Chrome, Edge), ou une par une dans Téléchargements.

## Administration

Bouton **Admin** en haut du site (visible seulement par l'admin) :

- **Utilisateurs** → **Nouvel utilisateur** : pseudo, nom affiché, mot de passe généré automatiquement. Le site prépare le message à envoyer à la modèle (adresse, pseudo, mot de passe).
- **Fiche d'un utilisateur** : cocher les shootings qu'il peut voir (enregistré automatiquement), changer son nom ou son mot de passe (ça le déconnecte), désactiver ou supprimer le compte. L'historique est conservé.
- **Accès par shooting** : pour chaque shooting, cocher les personnes qui y ont accès. Le bouton **Gérer l'accès** de chaque galerie y mène directement.
- **Suivi** : qui a ouvert quelle galerie, regardé quelles photos en grand et téléchargé quoi.
  - Filtres par personne, shooting et période (tes propres actions sont masquées par défaut).
  - **Résumé** par personne et par shooting, avec un **détail photo par photo** : vue, téléchargée (dans quelle version) ou jamais ouverte.
  - **Journal** chronologique : les actions faites d'affilée sont regroupées (« a téléchargé 12 photos de… »), avec les connexions et les tentatives ratées.
  - Une photo compte comme « vue » quand elle reste affichée en grand au moins une seconde.

## Installation sur le Synology (Container Manager)

### 1. Préparer l'image sur le PC

```bash
docker compose build app
docker save photorepo-app:latest -o photorepo-app.tar
```

À refaire à chaque mise à jour du code.

### 2. Copier sur le NAS

Dans un dossier du NAS (par exemple `/volume1/docker/photorepo`), copie :

- `docker-compose.nas.yml`, **renommé en `docker-compose.yml`** (il utilise l'image du `.tar`, sans le code source) ;
- `.env`, copié depuis `.env.example` puis rempli : nom du site, compte admin, mot de passe de la base, `PHOTOS_PATH` (en général `/volume1/Photographie`) ;
- `photorepo-app.tar`.

### 3. Lancer

1. Container Manager → **Image** → **Ajouter** → **Ajouter à partir d'un fichier** → `photorepo-app.tar`.
2. Container Manager → **Projet** → **Créer** → choisis le dossier : il trouve `docker-compose.yml` et `.env`. L'image Postgres est téléchargée automatiquement.
3. Le site répond sur `http://IP-DU-NAS:3011`. Configure ton reverse proxy (HTTPS + nom de domaine) vers ce port.
4. La base est accessible depuis le réseau local sur le port **3012** (DBeaver : base `photorepo`, utilisateur `photorepo`, mot de passe `DB_PASSWORD`). **Ne redirige pas ce port sur ta box.**

Le compte admin est créé au premier démarrage. Pour changer son mot de passe ou recréer un admin :

```bash
docker exec -it photorepo-app node dist/cli/create-admin.js <pseudo> <nouveau-mot-de-passe>
```

Mise à jour : génère un nouveau `.tar`, importe-le dans Container Manager (**Image → Ajouter**), puis redémarre le projet. La base de données est conservée dans `data/postgres`.

## Développement

Prérequis : Node 22+ et Docker.

```bash
cp .env.example .env               # puis adapte les valeurs
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db   # la base, sur le port 5433
npm install
npm run dev                        # site sur http://localhost:5173, API sur :3000
```

En dev, `PHOTOS_ROOT` peut pointer directement sur le partage du NAS (`//192.168.1.89/Photographie`).

⚠️ Ne fais pas tourner en même temps le mode dev et le conteneur `photorepo-app` sur la même base : chacun relit ses propres dossiers et masque ceux de l'autre, ce qui fait apparaître et disparaître des shootings.

Ou tout en Docker, comme sur le NAS : `docker compose up -d --build` puis http://localhost:8080.

## Technique

- `server/` : Node + TypeScript (Fastify), PostgreSQL. Mots de passe hashés avec Argon2, sessions par cookie `httpOnly`, max 10 tentatives de connexion par 15 min et par IP.
- Miniatures avec `sharp`, 2 conversions en parallèle au maximum (`IMAGE_CONCURRENCY`), pour ne pas saturer le NAS.
- `web/` : React + TypeScript (Vite).
- Une seule image Docker sert l'API et le site.

## Avancement

- [x] Étape 1 : connexion, compte admin, lecture des dossiers, liste des shootings
- [x] Étape 2 : galerie (miniatures, vue en grand, versions originale / carrée / story, téléchargements)
- [x] Étape 3 : administration (utilisateurs, accès aux shootings)
- [x] Étape 4 : page de suivi (qui a vu / téléchargé quoi)
