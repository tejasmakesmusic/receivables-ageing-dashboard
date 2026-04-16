# Milestone 1 — Foundations + Deploy Skeleton

**Status:** Approved (brainstorming)
**Date:** 2026-04-16
**Spec reference:** `02_HANDOFF_SPEC.md` §14 (M1 scope), §2 D1–D23 (locked decisions), §11 (deployment), §13 (consequences)
**ADRs:** `docs/adr/0002-use-neon-for-postgres.md`
**Build strategy:** Approach 3 — monolithic migration, auth-first vertical slice, deploy skeleton on day 1

---

## 1. Scope

Land the four foundational tables (`entities`, `users`, `fx_rates`, `audit_log`), a working Google SSO flow with domain lock, the four-role RBAC layer, a PENDING-by-default user lifecycle with admin approval, and a deployed `/health` endpoint on Railway.

**Explicitly in scope:**
- Alembic migrations (two files)
- Google SSO via authlib, pluggable with a stub provider for tests and local dev
- Signed-cookie sessions (itsdangerous), 12h idle timeout
- RBAC dependency (`require_role(...)`) enforced on every protected endpoint
- Admin endpoints: `GET /admin/users`, `PATCH /admin/users/{id}`
- `audit_log` writes on every role change, wrapped in the same transaction
- Railway deploy of `/health` on day 1
- IT ping for SPF + DKIM DNS records on `emb.global` (prep for M6 email activation)

**Explicitly out of scope (deferred):**
- Parsers (M2)
- Ageing calculation (M3)
- FX upload flow (M3)
- Email activation, rate limiting, Sentry, CSRF tokens (M6 / M7)
- Load testing
- Cross-browser cookie testing
- Real Google OAuth end-to-end tests (stub provider is the test boundary)

---

## 2. Architecture

### Runtime topology

```
┌──────────────────────────────────────────────────────────────┐
│  Railway (app host)                                          │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ FastAPI app (uvicorn, workers=1)                       │  │
│  │                                                        │  │
│  │  /health              (day 1)                          │  │
│  │  /auth/google/login   (day 2)                          │  │
│  │  /auth/google/callback                                 │  │
│  │  /auth/logout                                          │  │
│  │  /auth/me                                              │  │
│  │  /admin/users         GET + PATCH role (day 3)         │  │
│  │                                                        │  │
│  │  Middleware: SessionMiddleware (itsdangerous cookie)   │  │
│  │  Dependency: get_current_user → require_role(...)      │  │
│  └────────────────────────────────────────────────────────┘  │
│                            │                                 │
│                            │ asyncpg/psycopg (SQLAlchemy 2)  │
│                            ▼                                 │
└────────────────────────────┼─────────────────────────────────┘
                             │
                             │ TLS (sslmode=require)
                             ▼
                   ┌─────────────────────┐
                   │ Neon Postgres       │
                   │  - pooled DSN (app) │
                   │  - direct DSN       │
                   │    (alembic only)   │
                   │                     │
                   │ Tables (M1):        │
                   │  - entities         │
                   │  - users            │
                   │  - fx_rates         │
                   │  - audit_log        │
                   └─────────────────────┘
```

### Four moving parts

1. **FastAPI app** — single process, uvicorn workers=1. Spec §11 forbids multi-replica because M3's scheduler is APScheduler in-process.
2. **Neon Postgres** — pooled DSN (`DATABASE_URL`) for runtime, direct DSN (`DATABASE_URL_DIRECT`) for Alembic. pgbouncer strips session-level statements that Alembic needs; direct DSN bypasses the pooler. Per ADR-0002.
3. **SSO layer** — authlib OAuth2 client to Google Workspace, domain-locked to `@emb.global`. Pluggable via `settings.auth_provider ∈ {google, stub}`. Stub is for local dev + tests only; a startup guard raises if `app_env == production and auth_provider == stub`.
4. **Session layer** — Starlette `SessionMiddleware` with signed cookies (itsdangerous). 12h idle timeout per spec §11. Cookie payload: `{user_id, last_seen}`. No Redis, no server-side store. DB lookup on every authenticated request.

### Build slicing (3 days)

- **Day 1:** Migrations + `/health` deployed to Railway. Confirms DB connectivity from Railway → Neon, env var handling, Docker build, port binding. No auth yet.
- **Day 2:** SSO end-to-end on a Railway preview deploy. Domain lock, PENDING default, session cookie, `/auth/me` returns current user.
- **Day 3:** RBAC dependency, admin endpoints, audit_log writes, bootstrap admin seed verified, IT ping sent for DNS.

---

## 3. Components

### 3.1 `backend/alembic/versions/0001_initial.py`

One atomic migration for all four M1 tables.

| Table | Columns |
|---|---|
| `entities` | `id` (uuid pk), `code` (unique, e.g. `EMB_IN`, `MANTARAV_UAE`), `name`, `country` (IN / AE), `base_currency` (INR / AED), `default_credit_days` (int, nullable — admin sets per spec D8), `created_at`, `updated_at` |
| `users` | `id` (uuid pk), `email` (unique, citext), `google_sub` (unique, nullable until first login), `name`, `role` (enum: `ANALYST`/`CFO`/`ADMIN`/`PENDING`, default `PENDING`), `entity_id_scope` (uuid fk→entities, nullable — NULL means all-entities for CFO/ADMIN), `is_active` (bool, default true), `created_at`, `updated_at`, `last_login_at` (nullable) |
| `fx_rates` | `id` (uuid pk), `from_ccy`, `to_ccy`, `rate` (numeric(18,8)), `effective_from` (date), `effective_to` (date, nullable), `source` (enum: `MANUAL`/`API`), `created_at`, `created_by` (fk→users). No UPDATE trigger — immutability enforced at the app layer via a SQLAlchemy event hook (D15). Unique constraint on `(from_ccy, to_ccy, effective_from)`. |
| `audit_log` | `id` (uuid pk), `actor_user_id` (fk→users, nullable for system actions), `action` (text), `entity_type` (text), `entity_id` (uuid, nullable), `before` (jsonb, nullable), `after` (jsonb, nullable), `created_at` (indexed) |

Migration must be reversible. `downgrade()` drops in reverse order: `audit_log`, `fx_rates`, `users`, `entities`.

### 3.2 `backend/alembic/versions/0002_seed_bootstrap_admin.py`

Seeds:
- Two entities: `EMB_IN` (IN, INR) and `MANTARAV_UAE` (AE, AED). `default_credit_days` left NULL — admin sets in M3.
- One user: `tejaswa.sharma@emb.global`, role=`ADMIN`, `is_active=true`, `entity_id_scope=NULL`.
- One `audit_log` row: `actor_user_id=NULL`, `action='bootstrap_admin_seeded'`, `entity_type='user'`, `entity_id=<tejaswa's uuid>`, `after={email, role, is_active}`.

`downgrade()` deletes by code/email.

### 3.3 `backend/src/app/core/auth.py`

```python
class AuthProvider(Protocol):
    async def login_redirect(self, request: Request) -> Response: ...
    async def callback(self, request: Request) -> GoogleUserInfo: ...

class GoogleAuthProvider:  # authlib-backed real OAuth2
    ...

class StubAuthProvider:    # reads email from X-Stub-Email header
    ...

def get_auth_provider() -> AuthProvider:
    settings = get_settings()
    if settings.app_env == "production" and settings.auth_provider == "stub":
        raise RuntimeError("stub auth provider forbidden in production")
    return GoogleAuthProvider() if settings.auth_provider == "google" else StubAuthProvider()
```

`GoogleUserInfo` is a pydantic model with `email`, `sub`, `name`.

### 3.4 `backend/src/app/core/rbac.py`

Already scaffolded with the `Role` StrEnum. Add:

```python
def require_role(*allowed: Role) -> Callable:
    def _dep(user: User = Depends(get_current_user)) -> User:
        if user.role == Role.PENDING or user.role not in allowed:
            raise HTTPException(403, "insufficient_role")
        return user
    return _dep
```

### 3.5 `backend/src/app/api/deps.py`

Adds `get_current_user`:
- Reads `request.session['user_id']` and `request.session['last_seen']`
- Raises 401 if either missing
- Raises 401 if `now - last_seen > 12h`
- SELECTs user row by id
- Raises 401 if row missing or `is_active == False`
- Refreshes `session['last_seen'] = now` (sliding window)
- Returns User model instance

### 3.6 `backend/src/app/api/routers/auth.py`

Four endpoints:

| Route | Method | Behavior |
|---|---|---|
| `/auth/google/login` | GET | Delegates to `provider.login_redirect(request)` — 302 to Google (or stub echoes back) |
| `/auth/google/callback` | GET | Calls `provider.callback(request)`, enforces `email.endswith('@emb.global')` (403 otherwise), upserts user row (role=PENDING on insert, `google_sub` + `name` + `last_login_at` on update), writes `audit_log` for insert case, sets session cookie, 302 to `/` |
| `/auth/logout` | POST | Clears session cookie, 200 |
| `/auth/me` | GET | Depends on `get_current_user`, returns `{id, email, name, role, entity_id_scope, is_active}` |

### 3.7 `backend/src/app/api/routers/admin.py`

Two endpoints, both `require_role(Role.ADMIN)`:

| Route | Method | Behavior |
|---|---|---|
| `/admin/users` | GET | Query params: `status` (filter by role or is_active). Returns paginated list of UserOut. |
| `/admin/users/{user_id}` | PATCH | Body: `UserUpdateIn{role?, entity_id_scope?, is_active?}`. Validates (see §5). SELECT before, UPDATE, INSERT audit_log — all in one transaction. Returns updated UserOut. |

### 3.8 Supporting changes

- `backend/src/app/db/models/` — SQLAlchemy 2.x declarative models for all four tables
- `backend/src/app/schemas/` — pydantic v2 request/response models (`UserOut`, `UserUpdateIn`, `MeOut`, `EntityOut`)
- `backend/src/app/main.py` — mount `SessionMiddleware`, include auth + admin routers, startup guards (§5)
- `pyproject.toml` — add `authlib`, `itsdangerous` as explicit deps
- `Dockerfile` / Railway config — ensure `PORT` env var is read, `uvicorn` binds to `0.0.0.0:$PORT`
- SQLAlchemy event hook on `fx_rates` that raises on UPDATE (immutability, D15)

---

## 4. Data Flow

### 4.1 First-time sign-in (new user → PENDING)

1. Browser hits `GET /auth/google/login` → 302 to `accounts.google.com`.
2. User consents → Google redirects to `GET /auth/google/callback?code=...`.
3. App exchanges code for id_token via authlib.
4. App enforces `email.endswith('@emb.global')` — 403 if not.
5. `SELECT * FROM users WHERE email = $1` — miss.
6. `INSERT users (role=PENDING, google_sub, email, name, last_login_at)`.
7. `INSERT audit_log (actor_user_id=NULL, action='user_created', entity_id=<new_user.id>, after={...})`.
8. Set `session['user_id']`, `session['last_seen']`.
9. 302 to `/`.

All DB writes in one transaction. Subsequent request to any protected endpoint → 403 because user is PENDING.

### 4.2 Admin approves PENDING user

1. Admin browser: `GET /admin/users?status=PENDING` → ADMIN passes `require_role`, returns list.
2. Admin browser: `PATCH /admin/users/{uuid}` with `{role: 'ANALYST', entity_id_scope: 'EMB_IN_UUID'}`.
3. `require_role(ADMIN)` passes.
4. Validation: reject self-demotion, reject ANALYST with NULL `entity_id_scope`, reject non-existent entity_id.
5. `SELECT * FROM users WHERE id = $1` → `before_row`.
6. `UPDATE users SET role=..., entity_id_scope=...`.
7. `INSERT audit_log (actor_user_id=admin.id, action='user_role_changed', entity_id=target.id, before=before_row_json, after=after_row_json)`.
8. Steps 5–7 in one transaction. If audit_log insert fails, the role change rolls back — no silent drift.
9. Return updated UserOut.

### 4.3 Returning user hits a protected endpoint

1. Browser sends request with cookie.
2. `SessionMiddleware` verifies cookie signature.
3. `get_current_user`: check `last_seen` (401 if > 12h), SELECT user (401 if missing or `!is_active`), refresh `last_seen`.
4. `require_role(...)`: check role (403 if PENDING or not in allowed).
5. Handler runs.

One DB roundtrip per authenticated request. Acceptable for M1 volumes (<50 users). If latency becomes an issue, cache user in the signed cookie with a short TTL — not needed now.

### 4.4 Explicitly not in M1 flows

- No email to user on PENDING creation (Q4 decision — admin polls the list).
- No email to admin on new PENDING appearing (M6).
- No self-service role-request UI (M6).
- No refresh tokens — id_token used once at callback, not stored.
- No session revocation list. `is_active=false` in DB is the hard-kill path; takes effect on next request.

---

## 5. Error Handling

### 5.1 Auth errors

| Failure | HTTP | User sees | Log | Notes |
|---|---|---|---|---|
| Google rejects OAuth | 302 → `/login?error=oauth_failed` | "Sign-in failed" | ERROR | Log `error_description` from Google, never the `code` |
| Email domain ≠ `@emb.global` | 403 | "Restricted to EMB Global accounts" | WARN | Log hashed email + domain only |
| id_token signature invalid | 401 | Generic sign-in failed | ERROR | authlib raises |
| Session cookie tampered / expired | 401 | Redirect to `/login` | INFO | Treat as logged-out |
| Session > 12h idle | 401 | Redirect to `/login` | INFO | Clear cookie |
| User `is_active=false` | 401 | "Account deactivated" | WARN | Clear cookie |
| User PENDING hitting protected endpoint | 403 | "Awaiting approval" | DEBUG | Expected state |
| Role not in allowed set | 403 | "Insufficient permissions" | WARN | Log user_id + role + path |

### 5.2 DB errors

| Failure | HTTP | Handling |
|---|---|---|
| Neon pooler drops mid-request | 503 | SQLAlchemy pool recycles; retry once at session boundary, then surface. Log connection host. |
| Unique constraint on `users.email` (race) | 409 → internal retry | `INSERT ... ON CONFLICT (email) DO NOTHING RETURNING *`; re-SELECT if empty. |
| FK violation on `entity_id_scope` | 422 | `{"detail": "invalid entity_id_scope"}` |
| audit_log insert fails after user update | rollback → 500 | Single transaction. Log both payloads at ERROR. |
| Neon down | 503 | `/health` returns 503 `{"status":"degraded","db":"down"}`. Railway health check fails → stops routing traffic. |

### 5.3 Startup guards (fail-fast in `app/main.py`)

- `DATABASE_URL` empty → raise
- `DATABASE_URL_DIRECT` empty → raise
- `SESSION_SECRET_KEY` missing or < 32 bytes → raise
- `app_env == 'production' and auth_provider == 'stub'` → raise
- `app_env == 'production' and not google_client_id` → raise
- `alembic current != alembic heads` → log WARN, keep running (never auto-migrate in prod)

### 5.4 Admin endpoint edge cases

| Case | Behavior |
|---|---|
| ADMIN demotes self | 400 `cannot_demote_self` |
| ADMIN deactivates self | 400 `cannot_deactivate_self` |
| PATCH with `role=PENDING` | Allowed (parking lot) |
| PATCH non-existent user | 404 |
| `entity_id_scope` on CFO/ADMIN | Allowed but ignored at read time. Log WARN. |
| `entity_id_scope=NULL` on ANALYST | 400 — ANALYSTs must be scoped per spec §2 D5 |

### 5.5 Not in M1

- No slowapi rate limiting on `/auth/*` (M6)
- No CSRF tokens — same-origin cookie auth + `SameSite=Lax` is the M1 line. M6 adds tokens when file upload mutations land.
- No structured error envelope — FastAPI default `{"detail":"..."}` is sufficient. M3 formalizes.
- No Sentry — structlog JSON to Railway logs only. M7 adds Sentry.

---

## 6. Testing

### 6.1 Discipline

Every endpoint and every model lands **test-first**:
1. Write failing test hitting the endpoint / calling the model
2. Run → red
3. Implement minimum to pass
4. Run → green
5. Refactor. Run → still green

No post-hoc happy-path tests.

### 6.2 Test DB strategy

Neon branching: each test session creates a Neon branch off `main`, runs `alembic upgrade head`, yields a `TestClient` bound to the branch. Branch deleted after session. CI uses the same approach keyed on commit SHA.

`backend/tests/conftest.py` owns branch lifecycle, engine setup, and test-scoped transactions.

### 6.3 Pyramid

```
                      ┌──────────────────┐
                      │  Deploy smoke    │   1 test, post-deploy
                      │  (against Railway)│
                      └──────────────────┘
                  ┌────────────────────────────┐
                  │   Integration (HTTP)       │   ~15 tests
                  │   FastAPI TestClient       │
                  │   + Neon branch            │
                  └────────────────────────────┘
              ┌────────────────────────────────────┐
              │   Unit                             │   ~10 tests
              │   pydantic, RBAC dep, session,     │
              │   auth provider factory            │
              └────────────────────────────────────┘
```

### 6.4 Unit — `backend/tests/unit/`

- `test_rbac.py` — `require_role(ADMIN)` lets ADMIN, rejects ANALYST/CFO/PENDING with 403. One case per role × decorator shape.
- `test_auth_provider.py` — factory returns correct class per setting. Startup guard raises on `production + stub`.
- `test_schemas.py` — `UserUpdateIn` validation (ANALYST + NULL scope rejected, email format).
- `test_session.py` — 12h idle timeout triggers at 12h01m, not 11h59m. Sliding window refresh.

### 6.5 Integration — `backend/tests/integration/`

- `test_health.py` — `/health` returns 200 with DB check; returns 503 when DB unreachable (mocked connection failure).
- `test_auth_flow.py` (uses `StubAuthProvider`):
  - New email → user created as PENDING, audit_log row present
  - Same email again → existing row updated, `last_login_at` refreshed, no duplicate
  - Email outside `@emb.global` → 403, no user row created
  - `/auth/me` → 200 with user when signed in; 401 otherwise
  - `/auth/logout` → clears cookie, subsequent `/auth/me` is 401
- `test_admin_users.py`:
  - `GET /admin/users?status=PENDING` as ADMIN → list
  - Same as ANALYST → 403
  - Same as PENDING → 403
  - Same unauthenticated → 401
  - `PATCH /admin/users/{id}` as ADMIN role change → audit_log with before/after, user row updated
  - PATCH as ANALYST → 403
  - PATCH `role=ANALYST, entity_id_scope=NULL` → 422
  - PATCH self demote → 400 `cannot_demote_self`
  - PATCH self deactivate → 400 `cannot_deactivate_self`
  - PATCH non-existent user → 404
- `test_migrations.py`:
  - `alembic upgrade head` on empty DB succeeds
  - `alembic downgrade base` reverses cleanly
  - Bootstrap seed creates ADMIN row + 2 entities
  - `fx_rates` unique constraint rejects duplicate `(from_ccy, to_ccy, effective_from)`
  - `fx_rates` UPDATE at app layer raises (immutability guard, D15)

### 6.6 Deploy smoke — `scripts/smoke_prod.sh`

After every Railway deploy: `curl -f https://<url>/health` must return 200 and `{"status":"ok","db":"up"}`. Run as a post-deploy step in CI.

### 6.7 Coverage targets

- Auth callback branches: 100% (new user, existing user, wrong domain, Google error)
- RBAC × endpoint combinations for admin endpoints: 100%
- Migrations: upgrade + downgrade both green
- `app/core/` + `app/api/routers/` line coverage: ≥ 90%

### 6.8 Not tested in M1

- Load tests
- Real Google OAuth end-to-end (mocked at authlib boundary; stub provider covers everything post-authlib)
- Cross-browser session cookie tests
- Migration-on-populated-DB (M2, when there's realistic data)

---

## 7. Deliverables at M1 merge

- [ ] `0001_initial.py` + `0002_seed_bootstrap_admin.py` migrations, tested up + down
- [ ] SQLAlchemy models for all four tables
- [ ] pydantic v2 schemas for auth + admin payloads
- [ ] `GoogleAuthProvider` + `StubAuthProvider` + factory
- [ ] `get_current_user` + `require_role` dependencies
- [ ] Auth router (4 endpoints)
- [ ] Admin router (2 endpoints)
- [ ] Session middleware wired with signed cookies
- [ ] Startup guards for all required config
- [ ] `fx_rates` immutability hook
- [ ] `/health` deployed and green on Railway (day 1)
- [ ] SSO end-to-end on a Railway preview (day 2)
- [ ] Full M1 stack deployed (day 3)
- [ ] SPF + DKIM records requested from IT for `emb.global` (day 3)
- [ ] ~25 tests (unit + integration) + 1 smoke test, all green
- [ ] ≥ 90% coverage on `app/core/` + `app/api/routers/`
- [ ] README updated with M1 completion checklist ticked
