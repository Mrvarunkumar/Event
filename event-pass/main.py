"""
EVENT PASS - FastAPI backend.

Run:   uvicorn main:app --reload        (or: python main.py)
Admin: ADMIN_USER / ADMIN_PASS env vars (defaults: Event / Head1)
"""
import copy
import csv
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Path as PathParam, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict
from starlette.exceptions import HTTPException as StarletteHTTPException

BASE = Path(__file__).resolve().parent
PUBLIC = BASE / "public"
DATA_DIR = BASE / "data"
DB_FILE = DATA_DIR / "db.json"

ADMIN_USER = os.getenv("ADMIN_USER", "Event")
ADMIN_PASS = os.getenv("ADMIN_PASS", "Head1")
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "0") == "1"   # set to 1 when served over HTTPS
SESSION_SECONDS = 8 * 3600
COOKIE = "ep_admin"

BRANCHES = ["CSE", "ISE", "AI & ML", "Data Science", "ECE", "EEE", "Mechanical", "Civil", "MBA", "MCA", "Other"]

# --------------------------------------------------------------------------- credentials
# Only salted scrypt hashes are kept in memory; comparisons are constant-time.
_SALT = secrets.token_bytes(16)


def _h(value: str) -> bytes:
    return hashlib.scrypt(str(value).encode(), salt=_SALT, n=2**14, r=8, p=1, dklen=32)


USER_HASH, PASS_HASH = _h(ADMIN_USER), _h(ADMIN_PASS)

# --------------------------------------------------------------------------- tiny JSON database
DEFAULT_DB = {
    "event": {
        "name": "TechNova 2026",
        "tagline": "Innovate. Build. Celebrate.",
        "description": "The annual inter-department tech fest: hackathon, robotics arena, paper presentations "
                       "and a live cultural night. Register now and get your digital entry pass.",
        "date": "2026-12-18", "time": "09:30",
        "venue": "Main Auditorium, College Campus", "organizer": "Student Council",
    },
    "registrations": [], "counter": 0, "invalidScans": 0,
}
db_lock = threading.RLock()


def save_db() -> None:
    tmp = DB_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(DB, indent=2), encoding="utf-8")
    os.replace(tmp, DB_FILE)


def load_db() -> dict:
    DATA_DIR.mkdir(exist_ok=True)
    try:
        return json.loads(DB_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        data = copy.deepcopy(DEFAULT_DB)
        DB_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
        return data


DB = load_db()

# --------------------------------------------------------------------------- sessions / throttling
SESSIONS: dict = {}   # token -> expiry (epoch seconds)
FAILS: dict = {}      # ip -> {"n": int, "until": epoch}


def is_admin(request: Request) -> bool:
    token = request.cookies.get(COOKIE)
    exp = SESSIONS.get(token) if token else None
    if not exp:
        return False
    if exp < time.time():
        SESSIONS.pop(token, None)
        return False
    return True


def require_admin(request: Request) -> None:
    if not is_admin(request):
        raise HTTPException(status_code=401, detail="Not authenticated")


# --------------------------------------------------------------------------- helpers & schemas
def clean(value, max_len: int) -> str:
    return re.sub(r"[\x00-\x1f<>]", "", str(value if value is not None else "")).strip()[:max_len]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def public_reg(r: dict) -> dict:
    """Registration without its secret QR token."""
    return {k: r.get(k) for k in ("id", "name", "usn", "branch", "phone", "email", "status", "registeredAt")} | {
        "verifiedAt": r.get("verifiedAt")}


class RegisterIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: Optional[str] = ""
    usn: Optional[str] = ""
    branch: Optional[str] = ""
    phone: Optional[str] = ""
    email: Optional[str] = ""


class LoginIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    username: Optional[str] = ""
    password: Optional[str] = ""


class EventIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: Optional[str] = ""
    tagline: Optional[str] = ""
    description: Optional[str] = ""
    date: Optional[str] = ""
    time: Optional[str] = ""
    venue: Optional[str] = ""
    organizer: Optional[str] = ""


class TokenIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    token: Optional[str] = ""


class AttendanceIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    present: bool = True


def validate_registration(b: RegisterIn):
    v = {
        "name": clean(b.name, 80), "usn": clean(b.usn, 20).upper(), "branch": clean(b.branch, 40),
        "email": clean(b.email, 120).lower(), "phone": re.sub(r"[\s-]", "", clean(b.phone, 20)),
    }
    e = {}
    if not re.fullmatch(r"[A-Za-z][A-Za-z .'-]{1,79}", v["name"]):
        e["name"] = "Enter your full name (letters only)."
    if v["usn"] and not re.fullmatch(r"[A-Z0-9]{5,20}", v["usn"]):
        e["usn"] = "USN should be 5-20 letters/digits."
    if v["branch"] not in BRANCHES:
        e["branch"] = "Select your department."
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[A-Za-z]{2,}", v["email"]):
        e["email"] = "Enter a valid email address."
    if not re.fullmatch(r"(?:\+91|91|0)?[6-9]\d{9}", v["phone"]):
        e["phone"] = "Enter a valid 10-digit Indian mobile number."
    else:
        v["phone"] = v["phone"][-10:]
    return e, v


def find_reg(reg_id: str) -> dict:
    for r in DB["registrations"]:
        if r["id"] == reg_id:
            return r
    raise HTTPException(status_code=404, detail="Participant not found")


def csv_cell(value) -> str:
    s = str(value if value is not None else "")
    return "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r") else s   # block CSV formula injection


# --------------------------------------------------------------------------- app
app = FastAPI(title="EVENT PASS", docs_url=None, redoc_url=None, openapi_url=None)

CSP = ("default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; "
       "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; "
       "img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    if int(request.headers.get("content-length") or 0) > 50_000:
        return JSONResponse({"error": "Request too large"}, status_code=413)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    else:
        response.headers["Cache-Control"] = "no-cache"
        response.headers["Content-Security-Policy"] = CSP
    return response


@app.exception_handler(StarletteHTTPException)
async def http_error(request: Request, exc: StarletteHTTPException):
    detail = exc.detail if isinstance(exc.detail, str) else "Error"
    return JSONResponse({"error": detail}, status_code=exc.status_code, headers=getattr(exc, "headers", None))


@app.exception_handler(RequestValidationError)
async def bad_request(request: Request, exc: RequestValidationError):
    return JSONResponse({"error": "Invalid request data."}, status_code=422)


# --------------------------------------------------------------------------- public API
@app.get("/api/event")
def get_event():
    return {"event": DB["event"], "branches": BRANCHES}


@app.post("/api/register")
def register(body: RegisterIn):
    errors, v = validate_registration(body)
    with db_lock:
        regs = DB["registrations"]
        if "email" not in errors and any(r["email"] == v["email"] for r in regs):
            errors["email"] = "This email is already registered."
        if "phone" not in errors and any(r["phone"] == v["phone"] for r in regs):
            errors["phone"] = "This phone number is already registered."
        if errors:
            dup = any("already" in m for m in errors.values())
            return JSONResponse({"errors": errors}, status_code=409 if dup else 422)
        DB["counter"] += 1
        reg = {
            "id": f"EP-{DB['counter']:04d}",
            "token": secrets.token_urlsafe(18),          # the only thing the QR code contains
            **v, "status": "pending", "registeredAt": now_iso(), "verifiedAt": None,
        }
        regs.append(reg)
        save_db()
    return JSONResponse({"registration": {**public_reg(reg), "token": reg["token"]}}, status_code=201)


# --------------------------------------------------------------------------- admin auth
@app.post("/api/admin/login")
def login(body: LoginIn, request: Request):
    ip = request.client.host if request.client else "unknown"
    f = FAILS.get(ip)
    if f and f["until"] > time.time():
        raise HTTPException(status_code=429, detail="Too many attempts. Try again in a few minutes.")
    ok = hmac.compare_digest(_h(body.username or ""), USER_HASH) & hmac.compare_digest(_h(body.password or ""), PASS_HASH)
    if not ok:
        n = (f["n"] if f else 0) + 1
        FAILS[ip] = {"n": n, "until": time.time() + 300 if n >= 5 else 0}
        raise HTTPException(status_code=401, detail="Invalid username or password.")
    FAILS.pop(ip, None)
    token = secrets.token_hex(32)
    SESSIONS[token] = time.time() + SESSION_SECONDS
    resp = JSONResponse({"ok": True})
    resp.set_cookie(COOKIE, token, max_age=SESSION_SECONDS, httponly=True, samesite="strict", secure=COOKIE_SECURE, path="/")
    return resp


@app.post("/api/admin/logout")
def logout(request: Request):
    SESSIONS.pop(request.cookies.get(COOKIE, ""), None)
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(COOKIE, path="/")
    return resp


# --------------------------------------------------------------------------- admin API (session required)
admin = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])


@admin.get("/me")
def me():
    return {"user": ADMIN_USER}


@admin.get("/stats")
def stats():
    regs = DB["registrations"]
    count = lambda s: sum(1 for r in regs if r["status"] == s)
    return {"total": len(regs), "verified": count("verified"), "pending": count("pending"),
            "rejected": count("revoked") + DB["invalidScans"]}


@admin.get("/participants")
def participants():
    return {"participants": [public_reg(r) for r in reversed(DB["registrations"])], "branches": BRANCHES}


@admin.put("/event")
def update_event(body: EventIn):
    ev = {"name": clean(body.name, 100), "tagline": clean(body.tagline, 140), "description": clean(body.description, 600),
          "date": clean(body.date, 10), "time": clean(body.time, 5), "venue": clean(body.venue, 140),
          "organizer": clean(body.organizer, 100)}
    errors = {}
    if not ev["name"]:
        errors["name"] = "Required"
    if not ev["venue"]:
        errors["venue"] = "Required"
    for key, fmt, msg in (("date", "%Y-%m-%d", "Pick a date"), ("time", "%H:%M", "Pick a time")):
        try:
            datetime.strptime(ev[key], fmt)
        except ValueError:
            errors[key] = msg
    if errors:
        return JSONResponse({"errors": errors}, status_code=422)
    with db_lock:
        DB["event"] = ev
        save_db()
    return {"event": ev}


@admin.post("/verify")
def verify(body: TokenIn):
    token = clean(body.token, 64)
    with db_lock:
        reg = next((r for r in DB["registrations"] if len(token) >= 16 and hmac.compare_digest(r["token"].encode(), token.encode())), None)
        if reg is None:
            DB["invalidScans"] += 1
            save_db()
            return {"result": "invalid", "message": "QR code not recognised. Do not allow entry."}
        if reg["status"] == "revoked":
            DB["invalidScans"] += 1
            save_db()
            return {"result": "revoked", "message": "This pass has been revoked.", "participant": public_reg(reg)}
        if reg["status"] == "verified":
            return {"result": "duplicate", "message": "Already checked in.", "participant": public_reg(reg)}
        reg["status"], reg["verifiedAt"] = "verified", now_iso()
        save_db()
        return {"result": "valid", "message": "Entry allowed.", "participant": public_reg(reg)}


@admin.get("/export.csv")
def export_csv():
    buf = io.StringIO()
    w = csv.writer(buf, quoting=csv.QUOTE_ALL)
    w.writerow(["Registration ID", "Name", "USN", "Branch", "Phone", "Email", "Registered At", "Status", "Verified At"])
    for r in DB["registrations"]:
        w.writerow([csv_cell(x) for x in (r["id"], r["name"], r["usn"], r["branch"], r["phone"], r["email"],
                                          r["registeredAt"], r["status"], r.get("verifiedAt") or "")])
    return Response("\ufeff" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="participants.csv"'})


RegId = PathParam(pattern=r"^EP-\d+$")


@admin.post("/participants/{reg_id}/attendance")
def attendance(body: AttendanceIn = AttendanceIn(), reg_id: str = RegId):
    with db_lock:
        r = find_reg(reg_id)
        if r["status"] == "revoked":
            raise HTTPException(status_code=409, detail="Restore this registration first.")
        r["status"] = "verified" if body.present else "pending"
        r["verifiedAt"] = now_iso() if body.present else None
        save_db()
        return {"participant": public_reg(r)}


@admin.post("/participants/{reg_id}/revoke")
def revoke(reg_id: str = RegId):
    with db_lock:
        r = find_reg(reg_id)
        r["status"] = "revoked"
        save_db()
        return {"participant": public_reg(r)}


@admin.post("/participants/{reg_id}/restore")
def restore(reg_id: str = RegId):
    with db_lock:
        r = find_reg(reg_id)
        if r["status"] == "revoked":
            r["status"], r["verifiedAt"] = "pending", None
            save_db()
        return {"participant": public_reg(r)}


@admin.delete("/participants/{reg_id}")
def delete_participant(reg_id: str = RegId):
    """Permanently remove a registration and its QR token. IDs are not reused (counter stays)."""
    with db_lock:
        r = find_reg(reg_id)
        DB["registrations"].remove(r)
        save_db()
        return {"ok": True, "id": r["id"]}


app.include_router(admin)


# --------------------------------------------------------------------------- pages
@app.get("/admin", include_in_schema=False)
@app.get("/admin/", include_in_schema=False)
def admin_redirect():
    return RedirectResponse("/login.html", status_code=302)


@app.get("/dashboard.html", include_in_schema=False)
def dashboard(request: Request):
    if not is_admin(request):
        return RedirectResponse("/login.html", status_code=302)
    return FileResponse(PUBLIC / "dashboard.html")


# Static site (index.html, login.html, css/, js/). Mounted last so /api routes win.
app.mount("/", StaticFiles(directory=PUBLIC, html=True), name="site")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", "3000")), reload=False)
