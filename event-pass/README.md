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

## Structure
```
main.py                 FastAPI app: API, sessions, static hosting (data/db.json is auto-created)
requirements.txt
public/
  css/    style.css, admin.css
  js/     app.js, icons.js, login.js, admin.js
  index.html  login.html  dashboard.html
```

## API
Public: `GET /api/event`, `POST /api/register`
Auth:   `POST /api/admin/login`, `POST /api/admin/logout`
Admin (cookie session): `GET /api/admin/{me,stats,participants,export.csv}`, `PUT /api/admin/event`,
`POST /api/admin/verify`, `POST /api/admin/participants/{EP-0001}/{attendance|revoke|restore}`, `DELETE /api/admin/participants/{EP-0001}`

## Notes
- QR holds only a random token. Interactive docs (/docs) are disabled on purpose.
- Camera scanning needs localhost or HTTPS. QR/PDF/scanner libraries load from cdnjs.
- Run a single worker (JSON file storage + in-memory sessions).
