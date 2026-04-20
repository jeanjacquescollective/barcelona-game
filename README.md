# 🏙️ Barcelona Stadsspel _

Live multiplayer stadsspel voor studenten. Teams maken opdrachten, uploaden foto's, en zien elkaars scores live.

## Features
- **Team aanmaken** — elke groep maakt een eigen team
- **Live klassement** — scores updaten realtime via WebSockets
- **Foto/video upload** — bewijs uploaden per opdracht
- **Live feed** — alle uploads van alle teams zichtbaar

---

## Gratis deployen op Railway (aanbevolen, 5 min)

1. Maak een account op [railway.app](https://railway.app)
2. Klik op **"New Project"** → **"Deploy from GitHub repo"**
3. Push deze map naar een GitHub repo, of kies **"Deploy from local"**
4. Railway detecteert automatisch Node.js en start de server
5. Ga naar **Settings → Networking → Generate Domain** voor een publieke URL

### Of via Railway CLI:
```bash
npm install -g @railway/cli
railway login
railway init
railway up
railway domain
```

---

## Gratis deployen op Render

1. Maak een account op [render.com](https://render.com)
2. **New → Web Service → Connect GitHub repo**
3. Settings:
   - **Build command:** `npm install`
   - **Start command:** `node server.js`
   - **Environment:** Node
4. Klik **Create Web Service**
5. Na ~2 min krijg je een `.onrender.com` URL

---

## Lokaal draaien (testen)

```bash
npm install
node server.js
```

Open dan [http://localhost:3000](http://localhost:3000)

Deel de URL met je groep zodat iedereen op hetzelfde spel zit.

---

## Notities

- Foto's en data worden opgeslagen in het geheugen/op de server. Bij een herstart van de gratis tier gaan uploads verloren (opgeslagen in `/public/uploads`).
- Voor een permanente oplossing: koppel een cloudopslag zoals Cloudinary (gratis tier) voor de foto's.
- Max uploadgrootte: 20MB per bestand.
- De server ondersteunt tot ~50 gelijktijdige verbindingen probleemloos.

## Supabase persistentie + realtime (aanbevolen voor Barcelona live gebruik)

De server ondersteunt nu een Supabase-first modus:
- teams en uploads worden persistent opgeslagen in Supabase
- bij opstart wordt alle data opnieuw geladen
- wijzigingen worden via Supabase Realtime gesynchroniseerd (ook tussen meerdere server-instanties)

### 1. Environment variabelen instellen

Zet in je hosting environment:

```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_KEY=<service-role-key>
ADMIN_PASSWORD=<sterk-wachtwoord>
APP_PASSWORD=<wachtwoord-voor-hele-app>
```

### 2. Tabellen aanmaken in Supabase SQL editor

```sql
create table if not exists public.teams (
   id uuid primary key,
   payload jsonb not null,
   updated_at timestamptz not null default now()
);

create table if not exists public.uploads (
   id uuid primary key,
   payload jsonb not null,
   created_at timestamptz not null default now()
);

create index if not exists uploads_created_at_idx on public.uploads (created_at desc);
```

### 3. Realtime activeren

In Supabase dashboard:
1. Ga naar Database → Replication
2. Voeg tables `public.teams` en `public.uploads` toe aan publication `supabase_realtime`

### 4. Deployment check

Open admin pagina en controleer de statusregel:
- "Supabase actief met Realtime-sync" = correct
- "Supabase actief, maar Realtime ..." = fallback actief; check replication/publication settings

---

## Admin reset

Stuur een POST request naar `/api/reset` om alles te wissen:
```bash
curl -X POST https://jouw-url.railway.app/api/reset
```
