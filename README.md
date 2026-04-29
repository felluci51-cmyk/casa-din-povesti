# Casa din Povești — site cu calendar funcțional și bază de date

Site complet, gata de publicat. Calendarul citește disponibilitatea dintr-o
bază de date reală (SQLite), iar rezervările se salvează tot acolo. **Nu se
folosește localStorage** — totul trece prin server.

---

## 1. Ce conține

```
casa-din-povesti-app/
├── public/
│   └── index.html        # site-ul (frontend)
├── server.js             # backend Express + SQLite
├── package.json          # dependențe
├── .env.example          # config (copiază în .env)
└── README.md
```

**Backend (`server.js`)** expune:

| Metodă | Endpoint | Descriere |
|--------|----------|-----------|
| `GET`  | `/api/availability?from=YYYY-MM-DD&to=YYYY-MM-DD` | Returnează zilele ocupate în interval |
| `POST` | `/api/reservations` | Creează o rezervare nouă |
| `GET`  | `/api/reservations` *(admin)* | Lista tuturor rezervărilor |
| `POST` | `/api/reservations/:id/status` *(admin)* | Schimbă statusul (`pending` / `confirmed` / `cancelled`) |
| `POST` | `/api/blocked-dates` *(admin)* | Blochează manual un interval |
| `DELETE` | `/api/blocked-dates` *(admin)* | Deblochează un interval |
| `POST` | `/api/test-mail` *(admin)* | Trimite un email de test (verifică SMTP) |

Endpointurile *admin* cer header-ul `X-Admin-Key` egal cu `ADMIN_KEY` din `.env`.

---

## 2. Rulare locală

Ai nevoie de **Node.js 18+** instalat.

```bash
cd casa-din-povesti-app
cp .env.example .env        # editează ADMIN_KEY și PRICE_PER_NIGHT
npm install
npm start
```

Deschide `http://localhost:3000` în browser. La prima rulare se creează
fișierul `casa.db` (baza de date SQLite).

---

## 3. Cum funcționează calendarul

1. La încărcare, frontend-ul cere `GET /api/availability` pentru luna afișată.
2. Backend-ul calculează ce zile sunt ocupate (din rezervări **și** din zile
   blocate manual) și le returnează.
3. Utilizatorul clic-uiește două zile → se selectează intervalul (check-in /
   check-out). Zilele indisponibile nu pot fi selectate, iar dacă încerci să
   includi una într-un interval, primești un mesaj de eroare.
4. La click pe **Rezervă acum**, se deschide un formular cu nume / email /
   telefon. La submit, frontend-ul face `POST /api/reservations`.
5. Serverul revalidează datele și introducerea nu se face dacă intervalul
   nu mai e disponibil (protecție împotriva double-booking).

---

## 4. Comenzi admin utile

Listare rezervări:
```bash
curl -H "X-Admin-Key: cheia-ta" http://localhost:3000/api/reservations
```

Confirmare rezervare #5:
```bash
curl -X POST -H "X-Admin-Key: cheia-ta" -H "Content-Type: application/json" \
  -d '{"status":"confirmed"}' \
  http://localhost:3000/api/reservations/5/status
```

Blocare zile (de exemplu pentru reparații):
```bash
curl -X POST -H "X-Admin-Key: cheia-ta" -H "Content-Type: application/json" \
  -d '{"from":"2026-07-10","to":"2026-07-15","reason":"reparatii"}' \
  http://localhost:3000/api/blocked-dates
```

---

## 5. Notificări pe email

La fiecare rezervare nouă pleacă **două email-uri**:

1. **Către proprietar** (`NOTIFY_EMAIL`) — notificare cu toate detaliile rezervării și ale oaspetelui. `Reply-To` e setat pe email-ul oaspetelui, deci poți răspunde direct.
2. **Către oaspete** — confirmare profesională cu detaliile sejurului și informații de contact.

Dacă SMTP-ul nu e configurat, rezervarea se salvează totuși în DB — doar email-ul nu pleacă (vezi în consolă: `Email SMTP: neconfigurat`).

### Setare SMTP

Editează `.env` și pune credențialele unui provider:

#### Gmail (cel mai simplu pentru a începe)

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=adresa-ta@gmail.com
SMTP_PASS=parola-de-aplicatie-din-google
SMTP_FROM="Casa din Povești <adresa-ta@gmail.com>"
```

⚠️ **Important pentru Gmail:** nu folosi parola contului. Activează *2-Step Verification*, apoi generează o **App Password** la `myaccount.google.com/apppasswords` și pune-o ca `SMTP_PASS`.

#### Resend (recomandat pentru producție — 3.000 email-uri/lună gratis)

```env
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=resend
SMTP_PASS=re_xxxxxxxxxxxxxxxxxxxx
SMTP_FROM="Casa din Povești <noreply@casadinpovesti.md>"
```

(Necesită verificarea domeniului `casadinpovesti.md` în [resend.com](https://resend.com).)

#### Mailgun / SendGrid / SMTP propriu

Aceleași 5 variabile, valorile se schimbă conform documentației providerului.

### Test rapid

După ce ai pornit serverul, trimite un email de test:

```bash
curl -X POST -H "X-Admin-Key: cheia-ta" -H "Content-Type: application/json" \
  -d '{"to":"adresa-ta@gmail.com"}' \
  http://localhost:3000/api/test-mail
```

Dacă primești email-ul, e gata — și notificările de rezervare vor merge la fel.

---

## 6. Publicare (deployment)

### Opțiunea A — **Render.com** (cel mai simplu, gratuit pentru început)

1. Pune folderul într-un repo Git (GitHub).
2. Pe [render.com](https://render.com) → **New → Web Service** → conectează repo-ul.
3. Setări:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** adaugă `ADMIN_KEY`, `PRICE_PER_NIGHT`, etc. din `.env.example`.
4. **Important:** SQLite scrie pe disc. Render oferă **Persistent Disk** —
   adaugă unul mic (1 GB) și montează-l la `/var/data`, apoi setează
   `DB_PATH=/var/data/casa.db`. Fără disk persistent, baza de date se
   resetează la fiecare deploy.

### Opțiunea B — **Railway / Fly.io**

Aceeași logică: deploy Node.js + volum persistent pentru `casa.db`.

### Opțiunea C — Pentru trafic mai mare: **PostgreSQL**

SQLite e perfect până la sute de rezervări pe zi. Dacă vrei PostgreSQL
(Render, Supabase, Neon), înlocuiește în `server.js` driverul
`better-sqlite3` cu `pg` și ajustează interogările (sintaxa SQL e aproape
identică). Schema e deja standard SQL.

### Domeniu propriu

În Render / Railway, în setările serviciului, adaugă **Custom Domain**
și pune un CNAME în DNS-ul tău (ex. la registrar-ul unde ai
`casadinpovesti.md`).

---

## 7. Personalizare rapidă

| Vrei să schimbi... | Unde |
|--------------------|------|
| Prețul pe noapte | `.env` → `PRICE_PER_NIGHT` |
| Texte / imagini | `public/index.html` |
| Numărul de oaspeți acceptați | `server.js`, validarea `g < 1 || g > 12`; și în HTML butonul `+` (limita 8) |
| Email/telefon footer | `public/index.html` |
| Email-ul de notificare | `.env` → `NOTIFY_EMAIL` |
| Template-ul email-urilor | `mailer.js` — funcțiile `ownerHtml()` / `guestHtml()` |
| Dezactivează email către oaspete | `.env` → `SEND_GUEST_CONFIRMATION=false` |

---

## 8. De adăugat dacă mergi spre producție serioasă

- **Plăți online** (Stripe, sau gateway local moldovenesc).
- **Panou admin web** (acum admin-ul se face prin curl). E ușor de adăugat
  o pagină `/admin` simplă protejată cu același `ADMIN_KEY`.
- **Backup automat** al `casa.db` (cron care urcă fișierul pe S3).
- **HTTPS** — Render/Railway îl oferă automat.

Succes cu povestea! 🌿
