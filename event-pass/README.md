# EVENT PASS – Smart QR Registration & Entry Management (FastAPI)

## Run
```
pip install -r requirements.txt
uvicorn main:app --reload --port 3000      # or: python main.py
```
- Public site: http://localhost:3000
- Admin login: http://localhost:3000/login.html  (or /admin)

Admin credentials are kept on the server only (scrypt hashes in memory). Defaults: `Event` / `Head1`.
```
ADMIN_USER=myuser ADMIN_PASS=strongpass PORT=8080 python main.py
COOKIE_SECURE=1   # set when serving over HTTPS
```

## Supabase database (2 tables)
1. Create a project at https://supabase.com.
2. Open **SQL Editor → New query**, paste `supabase/schema.sql`, click **Run**.
   This creates `events` and `registrations` (plus indexes, RLS policies and one seed event).
3. Go to **Project Settings → API** and copy the **Project URL** and **service_role** key.
4. Copy `.env.example` to `.env` and fill in `SUPABASE_URL` and `SUPABASE_KEY`.
5. `pip install -r requirements.txt`
6. Check the connection: `python db.py` (prints the event row and stats).

`supabase/queries.sql` contains ready-to-run SELECT / INSERT / UPDATE / DELETE queries.
`db.py` contains the same operations using the Supabase Python client.

> Keep the `service_role` key on the backend only — never put it in browser JavaScript.
> The public `anon` key may read `events` and insert into `registrations` only.

When `.env` is present, `main.py` reads and writes both tables instead of `data/db.json`.
Restart the server after creating `.env`. On startup the console prints:
`[EVENT PASS] Supabase connected: N registrations loaded`. If the connection fails it prints
the error and falls back to `db.json` — check that the key is the **service_role** key and that
`schema.sql` was run in the same Supabase project.

## Deploy to Render
The repo root contains `render.yaml` (Render Blueprint), so deployment needs no manual commands.

1. Push this repo to GitHub/GitLab.
2. Render Dashboard → **New + → Blueprint** → connect the repo → **Apply**.
3. In the new service's **Environment** tab, add:
   - `SUPABASE_URL` = your Supabase Project URL
   - `SUPABASE_KEY` = the **service_role** key
   - `ADMIN_USER` / `ADMIN_PASS` = your admin credentials
   - `COOKIE_SECURE` is already set to `1` (Render serves HTTPS, so the admin cookie is secure).
4. Click **Deploy**. Health check is `/api/event`; open the service URL for the public site and `/login.html` for admin.

Manual setup instead of a blueprint: **Root Directory** = `event-pass`,
**Build Command** = `pip install -r requirements.txt`,
**Start Command** = `uvicorn main:app --host 0.0.0.0 --port $PORT`, same env vars as above.

> `.env` is ignored by Git and not used on Render — set the values in the Render dashboard.
> Keep one instance/worker: admin sessions and the Supabase sync state live in process memory.
> On the free plan the service sleeps after inactivity, so the first request can take a few seconds.

## Structure
```
main.py                 FastAPI app: API, sessions, static hosting (data/db.json is auto-created)
db.py                   Supabase client + ready-to-use queries
supabase/schema.sql     Run once to create the 2 tables
supabase/queries.sql    Example queries
.env.example            Connection settings template
requirements.txt
public/
  css/    style.css, admin.css
  js/     app.js, icons.js, login.js, admin.js
  index.html  login.html  dashboard.html
```

## API
Public: `GET /api/event`, `POST /api/register`
Auth:   `POST /api/admin/login`, `POST /api/admin/logout`
Admin (cookie session): `GET /api/admin/{me,stats,participants,export.csv}`, `POST /api/admin/reset`, `PUT /api/admin/event`,
`POST /api/admin/verify`, `POST /api/admin/participants/{EP-0001}/{attendance|revoke|restore}`, `DELETE /api/admin/participants/{EP-0001}`

## Notes
- QR holds only a random token. Interactive docs (/docs) are disabled on purpose.
- Camera scanning needs localhost or HTTPS. QR/PDF/scanner libraries load from cdnjs.
- Run a single worker (in-memory sync state + sessions).
