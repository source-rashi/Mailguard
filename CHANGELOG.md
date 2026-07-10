# Changelog

## 2026-07-10

- `f813025` `fix(backend): resolve server startup failure preventing API from binding to port 5000`
- `02ea6c2` `fix(email-controller): include userId in Classification upsert to prevent orphaned records`
- `eee6641` `fix(frontend-auth): replace unreliable window.Clerk polling with proper Clerk React SDK token retrieval`
- `c07971f` `fix(admin-controller): make python executable configurable via PYTHON_BIN env var, default to python3`
- `1b2539e` `security(encryption): fail fast on missing ENCRYPTION_KEY instead of silently using an insecure default`
- `b519111` `security(backend): replace deprecated csurf with maintained CSRF protection`
- `ebb196a` `test(backend): provide deterministic encryption key for Jest`

Notes:

- Backend startup now stays online in non-production even if MongoDB is unreachable, so the API can bind to port 5000 during local development.
- The backend test suite now has a deterministic test-only encryption key so security-sensitive modules can load under Jest.