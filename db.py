"""Supabase connection + ready-to-use queries for EVENT PASS.

Setup:
  1. pip install -r requirements.txt
  2. Copy .env.example -> .env and fill in SUPABASE_URL / SUPABASE_KEY
  3. Run supabase/schema.sql once in the Supabase SQL Editor

Security: SUPABASE_KEY must be the service_role key. It bypasses RLS, so it
belongs on the backend only - never ship it to the browser.
"""
from __future__ import annotations

import os
import secrets
from datetime import datetime, timezone
from typing import Any

from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv()

URL = os.getenv("SUPABASE_URL")
KEY = os.getenv("SUPABASE_KEY")

EVENTS = "events"
REGISTRATIONS = "registrations"


def get_client() -> Client:
    """Create a Supabase client from environment variables."""
    if not URL or not KEY:
        raise RuntimeError("Missing SUPABASE_URL / SUPABASE_KEY. Copy .env.example to .env.")
    return create_client(URL, KEY)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


# -------------------------------------------------------------- public queries
def get_event() -> dict[str, Any] | None:
    """SELECT the event details shown on the public page."""
    res = (get_client().table(EVENTS)
           .select("name,tagline,description,event_date,start_time,venue,organizer")
           .limit(1).execute())
    return res.data[0] if res.data else None


def register(name: str, usn: str, branch: str, phone: str, email: str) -> dict[str, Any]:
    """INSERT a registration and return it with the QR token (strip token before
    sending the response to the browser)."""
    row = {
        "token": secrets.token_urlsafe(18),
        "name": name, "usn": usn, "branch": branch,
        "phone": phone, "email": email,
    }
    res = get_client().table(REGISTRATIONS).insert(row).execute()
    return res.data[0]


def is_duplicate(email: str, phone: str) -> bool:
    """SELECT 1 - check email/phone before inserting."""
    db = get_client()
    if db.table(REGISTRATIONS).select("id").eq("email", email).limit(1).execute().data:
        return True
    return bool(db.table(REGISTRATIONS).select("id").eq("phone", phone).limit(1).execute().data)


# --------------------------------------------------------------- admin queries
def find_by_token(token: str) -> dict[str, Any] | None:
    """SELECT a pass by its QR token (never return the token itself)."""
    res = (get_client().table(REGISTRATIONS)
           .select("id,name,usn,branch,status,verified_at")
           .eq("token", token).limit(1).execute())
    return res.data[0] if res.data else None


def check_in(token: str) -> dict[str, Any] | None:
    """Atomic UPDATE: verify only a 'pending' pass. Returns [] if not eligible."""
    res = (get_client().table(REGISTRATIONS)
           .update({"status": "verified", "verified_at": now_iso()})
           .eq("token", token).eq("status", "pending").execute())
    return res.data[0] if res.data else None


def set_status(reg_id: str, status: str) -> dict[str, Any] | None:
    """UPDATE status: 'pending' | 'verified' | 'revoked'."""
    if status not in ("pending", "verified", "revoked"):
        raise ValueError("status must be pending, verified or revoked")
    payload = {"status": status, "verified_at": now_iso() if status == "verified" else None}
    res = (get_client().table(REGISTRATIONS).update(payload)
           .eq("id", reg_id).execute())
    return res.data[0] if res.data else None


def list_participants() -> list[dict[str, Any]]:
    """SELECT all participants without their secret tokens."""
    res = (get_client().table(REGISTRATIONS)
           .select("id,name,usn,branch,phone,email,status,registered_at,verified_at")
           .order("registered_at", desc=True).execute())
    return res.data


def stats() -> dict[str, int]:
    """SELECT counts per status."""
    rows = get_client().table(REGISTRATIONS).select("status").execute().data
    return {
        "total": len(rows),
        "verified": sum(r["status"] == "verified" for r in rows),
        "pending": sum(r["status"] == "pending" for r in rows),
        "revoked": sum(r["status"] == "revoked" for r in rows),
    }


def delete_participant(reg_id: str) -> bool:
    """DELETE a registration permanently."""
    res = get_client().table(REGISTRATIONS).delete().eq("id", reg_id).execute()
    return bool(res.data)


if __name__ == "__main__":
    print("Event:", get_event())
    print("Stats:", stats())
