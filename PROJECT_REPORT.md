# PROJECT AUDIT & SECURITY REPORT: MAILGUARD

---

## 1. PROJECT OVERVIEW

### Project Description
Mailguard is an AI-powered email security and phishing detection platform. It operates by integrating with Gmail via Google OAuth2, fetching user emails, and using a Python-based machine learning service to classify emails as "safe" or "phishing" with associated confidence scores. It includes prediction explainability (highlighting risk signal tokens), an analytics dashboard with charts and threat intelligence, and a closed-loop retraining pipeline that utilizes user feedback to update and improve the Random Forest classification model.

### Technology Stack
*   **Frontend**: React 19, Vite (configured with custom manual chunking), TailwindCSS + PostCSS 4, Lucide React, Recharts (for analytics visualization), Sonner (for toast notifications), Clerk React SDK (for user authentication).
*   **Backend**: Node.js, Express, MongoDB (via Mongoose ODM), Clerk Node SDK (for session token validation), Google APIs (`googleapis` for Gmail OAuth2, fetching, trashing/deleting), Node-cron (for scheduled jobs), Node-cache (for local caching), Zod (for request payload validation).
*   **ML Service**: Python 3.11+, FastAPI (REST API), scikit-learn (Random Forest and Naive Bayes classifiers, TF-IDF vectorization), pandas, numpy, joblib (for serialization), pymongo (for training data construction).
*   **Deployment & Infrastructure**: Docker, Docker Compose (orchestrating Nginx-served frontend, Node backend API, FastAPI ML service, and MongoDB).

### Project Type and Directory Structure
The project is organized as a monorepo workspace (leveraging Turborepo and pnpm workspaces).
```
Mailguard/                       # Main Repository Root
├── docker-compose.yml           # Multi-container Docker orchestration
├── .env                         # Local environment variables
├── .env.docker.example          # Template for Docker environment variables
├── vectorizer.pkl               # Legacy vectorizer in root (should be in ml-service/models)
├── backend/                     # Node.js Express API Server
│   ├── server.js                # Backend entry point
│   ├── controllers/             # Request handlers (analytics, email, gmail, feedback, migration)
│   ├── models/                  # Mongoose models (User, Email, Classification, Feedback, etc.)
│   ├── routes/                  # Express route definitions
│   ├── services/                # Google/Gmail and ML service API wrappers
│   ├── middleware/              # Auth, caching, rate-limiting, and validation middlewares
│   ├── jobs/                    # Nightly scan and auto-retraining cron jobs
│   └── tests/                   # Jest unit and integration tests
├── frontend/                    # React 19 Frontend Web Application
│   ├── src/                     # React application source code
│   │   ├── main.jsx             # React entry point with ClerkProvider
│   │   ├── App.jsx              # Main App shell and routes
│   │   ├── components/          # Reusable UI, chart, and table components
│   │   ├── pages/               # Page components (Dashboard, Analytics, Login, Register)
│   │   ├── services/            # Axios API wrapper functions
│   │   └── hooks/               # Custom state/API hooks (useAnalytics, useEmails)
│   ├── nginx.conf               # Nginx configuration for production container
│   └── Dockerfile               # Multi-stage Docker build for frontend
├── ml-service/                  # Python FastAPI Machine Learning Microservice
│   ├── app.py                   # FastAPI entry point and endpoint routing
│   ├── predictor.py             # Inference, caching, and model reloading logic
│   ├── retrain.py               # ML training pipeline (loads data, fits Random Forest, evaluates)
│   ├── dataset_builder.py       # Queries MongoDB, processes and merges emails/feedback into CSV
│   └── requirements.txt         # Python dependencies
└── Mailguard/                   # Nested Monorepo Root Workspace Directory
    ├── package.json             # Monorepo setup (Turborepo config)
    ├── apps/                    # Monorepo apps subdirectory
    └── packages/                # Shared utilities and configurations
```

---

## 2. ARCHITECTURE MAP

### Component Connections
```
                     +---------------------------------------+
                     |         Frontend (React 19)           |
                     |  - Renders UI / Charts / Email Table   |
                     |  - Connects to Clerk Auth Client      |
                     +-------------------+-------------------+
                                         |
                            HTTP requests with JWT
                                         |
                                         v
                     +-------------------+-------------------+
                     |         Backend (Express API)         |
                     |  - Validates tokens via Clerk SDK     |
                     |  - Interacts with database            |
                     |  - Invokes ML service / Gmail API     |
                     +-------+---------------+-------+-------+
                             |               |       |
                 Mongoose    |    HTTP JSON  |       | Google OAuth / APIs
                 Queries     |    Payload    |       | (Gmail read/delete)
                             v               v       v
+-----------------------------+   +----------+---+   +-----------------------+
|      MongoDB Database       |   | ML Service   |   | Google OAuth / Gmail  |
| - Collections: users,       |   | (FastAPI)    |   | - Authorizes OAuth    |
|   emails, classifications,  |   | - TF-IDF     |   | - Delivers emails     |
|   feedbacks, auditlogs      |   | - RF Predict |   | - Trashes threats     |
+-----------------------------+   +--------------+   +-----------------------+
```

### Entry Points
*   **Frontend**: [index.html](file:///c:/Users/rashi/OneDrive/Desktop/Mailguard/Mailguard/frontend/index.html) bootstrap file, importing [main.jsx](file:///c:/Users/rashi/OneDrive/Desktop/Mailguard/Mailguard/frontend/src/main.jsx) which mounts React.
*   **Backend**: [server.js](file:///c:/Users/rashi/OneDrive/Desktop/Mailguard/Mailguard/backend/server.js) initializes the Express server on port 5000, connects to MongoDB, starts the cron schedulers, and registers routes.
*   **ML Service**: [app.py](file:///c:/Users/rashi/OneDrive/Desktop/Mailguard/Mailguard/ml-service/app.py) starts FastAPI, initializes the global ML predictor, and runs on port 8000.

### Core Feature Data Flow
1.  **Gmail Fetch & Scan**:
    *   Frontend initiates request via POST `/api/gmail/fetch`.
    *   Backend loads the user's decrypted OAuth2 tokens, requests emails from Google, parses subject/body/HTML, and saves new entries to `Email` collection.
    *   Backend retrieves unclassified emails, constructs subjects + bodies, and sends them in batch to Python ML service `/predict/batch`.
    *   ML service vectorizes the text, outputs prediction labels ("safe"/"phishing") and top signal tokens, and returns them to the backend.
    *   Backend saves the classifications in the `Classification` collection and returns statistics to the user.
2.  **Reinforcement Learning Feedback Loop**:
    *   User disagrees with a prediction in the UI and clicks "Wrong".
    *   Frontend POSTs to `/api/feedback` with the correct label.
    *   Backend stores/updates the correction in the `Feedback` collection.
    *   Scheduled cron (`retrainJob.js`) runs `dataset_builder.py` which aggregates email contents, merges them with feedback (giving feedback priority over machine predictions), and creates `training.csv`.
    *   The cron then runs `retrain.py` to fit a new model and writes `phishing_model.pkl` and `vectorizer.pkl`.
    *   Backend calls ML Service `/reload` to load the new weights instantly and clear the cache.

---

## 3. DEPENDENCIES & ENVIRONMENT

### Dependency Analysis

#### Backend (`backend/package.json`)
| Dependency | Version | Type | Status / Security Notes |
| :--- | :--- | :--- | :--- |
| `@clerk/clerk-sdk-node` | `^4.13.23` | Production | Critical for auth. Note: Clerk has since deprecated older Express middleware models in v5+ SDKs. |
| `csurf` | `^1.11.0` | Production | **DEPRECATED & ARCHIVED**. CSRF protection should be handled using modern double-submit cookie schemes or framework-provided tools. |
| `mongoose` | `^8.0.0` | Production | Stable. |
| `connect-timeout` | `^1.9.1` | Production | Stable. |
| `nodemon` | `^3.0.1` | Development | Stable. |
| `jest` | `^29.7.0` | Development | Stable. |

#### Frontend (`frontend/package.json`)
| Dependency | Version | Type | Status / Security Notes |
| :--- | :--- | :--- | :--- |
| `react` | `^19.2.0` | Production | React 19 is fully supported but requires special attention for component library compatibility. |
| `react-dom` | `^19.2.0` | Production | Same as above. |
| `@clerk/clerk-react` | `^5.60.0` | Production | Clerk React SDK. |
| `recharts` | `^3.7.0` | Production | Stable. |
| `rolldown-vite` | `7.2.5` | Override | Overridden as package alias for `vite` via `"vite": "npm:rolldown-vite@7.2.5"`. Non-standard setup. |

#### ML Service (`ml-service/requirements.txt`)
| Library | Version | Type | Compatibility Notes |
| :--- | :--- | :--- | :--- |
| `fastapi` | `>=0.109.0` | Production | Compatible. |
| `scikit-learn` | `>=1.4.0` | Production | Compatible. |
| `pandas` | `>=2.1.0` | Production | Compatible. |
| `pymongo` | `>=4.6.0` | Production | Compatible. |

### Environment Variables (.env)
The application requires the following environment variables. The values in `.env` contain active testing keys and should be rotated immediately in staging/production:

| Variable Name | Present | Source/Type | Description | Security Risk |
| :--- | :--- | :--- | :--- | :--- |
| `MONGO_ROOT_USERNAME` | Yes | Database | Admin username for Mongo. | Low (Standard development default) |
| `MONGO_ROOT_PASSWORD` | Yes | Database | Password for Mongo database. | Medium (Pre-filled value in local env) |
| `MONGO_URI` | Yes | Database | DB connection string containing credentials. | High (Contains plaintext credentials) |
| `CLERK_SECRET_KEY` | Yes | Clerk Auth | Secret API key for Clerk. | **CRITICAL** (Active secret in file) |
| `VITE_CLERK_PUBLISHABLE_KEY` | Yes | Clerk Auth | Public key for Clerk JS Client. | Low (Intended to be public) |
| `GOOGLE_CLIENT_ID` | Yes | Google APIs | Client ID for Gmail OAuth. | Low (Intended to be public) |
| `GOOGLE_CLIENT_SECRET` | Yes | Google APIs | Client Secret for Gmail API. | **HIGH** (Static credentials) |
| `GOOGLE_REDIRECT_URI` | Yes | Google APIs | Authorized OAuth redirect callback. | Low |
| `ENCRYPTION_KEY` | Yes | Application | 32-byte hex key for Gmail tokens. | **HIGH** (Plaintext AES key in file) |

---

## 4. ERRORS & ISSUES

This section details all errors, bugs, and configuration failures found in the codebase.

| # | File Path | Line Number(s) | Description of Issue | Why it's a Problem | Severity |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | [backend/services/mlService.js](file:///c:/Users/rashi/OneDrive/Desktop/Mailguard/Mailguard/backend/services/mlService.js) | 211, 312 | **Double `module.exports` Re-assignment**. The second export statement at line 312 overwrites the entire export object from line 211. | Only `classifyEmail` and `metrics` are exported. Critical helper functions like `checkHealth`, `predictEmail`, `classifyEmails`, and `getServiceInfo` are lost, causing imports in other files to resolve to `undefined`. | **Critical** |
| 2 | [backend/services/mlService.js](file:///c:/Users/rashi/OneDrive/Desktop/Mailguard/Mailguard/backend/services/mlService.js) | 309 | **Undefined Reference `originalMLClassifyFn`**. The exported `classifyEmail` calls `callMLWithRetry(originalMLClassifyFn, emailData)`. However, `originalMLClassifyFn` is never defined. | Calling `classifyEmail` results in a `ReferenceError: originalMLClassifyFn is not defined` crash at runtime. | **Critical** |
| 3 | [backend/controllers/emailController.js](file:///c:/Users/rashi/OneDrive/Desktop/Mailguard/Mailguard/backend/controllers/emailController.js) | 87-101 | **Missing `userId` in Classification Upsert**. The `Classification.findOneAndUpdate` call does not pass `userId` in the update fields. | When a new classification is inserted via upsert, the `userId` field (defined as `required: true` in the Mongoose schema) will be created as `undefined` or null, breaking queries that rely on user-level filtering. | **High** |
| 4 | [backend/routes/gmailRoutes.js](file:///c:/Users/rashi/OneDrive/Desktop/Mailguard/Mailguard/backend/routes/gmailRoutes.js) / [frontend/src/services/api.js](file:///c:/Users/rashi/OneDrive/Desktop/Mailguard/Mailguard/frontend/src/services/api.js) | 34 (routes) / 323 (services) | **OAuth Initiate Endpoint Mismatch**. The route is defined as `GET /auth` on the backend and called as `GET /gmail/auth` on the frontend, but the codebase comments, README, and action logs explicitly refer to and direct clients to use `POST /api/gmail/auth/initiate`. | If a developer or third-party client tries to invoke the documented `POST /api/gmail/auth/initiate`, the backend returns a 404. | **High** |
| 5 | [frontend/src/services/api.js](file:///c:/Users/rashi/OneDrive/Desktop/Mailguard/Mailguard/frontend/src/services/api.js) | 83 | **Unreliable Global `window.Clerk` Dependency**. The API service waits for Clerk to load on `window.Clerk` in a `while` loop (up to 5 seconds). | If Clerk fails to load or does not attach itself to `window` (as is common with React contexts), all subsequent API calls will execute without authentication tokens, triggering a 401 redirect loop. | **Medium** |
| 6 | [backend/server.js](file:///c:/Users/rashi/OneDrive/Desktop/Mailguard/Mailguard/backend/server.js) | 200, 203 | **Schedulers Commented Out**. The `startScheduler()` and `startScanJob()` functions are commented out inside the backend server initialization block. | Nightly email scanning, automatic cleanup of spam, and automated model retraining are completely inactive unless manually triggered. | **Medium** |
| 7 | [backend/controllers/adminController.js](file:///c:/Users/rashi/OneDrive/Desktop/Mailguard/Mailguard/backend/controllers/adminController.js) | 166, 211 | **Hardcoded Python Command**. Spawning processes uses the hardcoded command `'python'`. | On Unix/Linux hosts, python often refers to python 2 or is missing, meaning the dataset builder and retraining processes will fail with command-not-found errors (should use `python3` or allow configuration). | **Medium** |

---

## 5. CODE QUALITY OBSERVATIONS

### Duplicate Code / Files
*   **Duplicate Root Directory**: The repository contains a duplicate nested project structure at `Mailguard/Mailguard/`. This contains redundant configurations (`package.json`, eslint, tsconfig) that create structural confusion.
*   **Double Global Handlers**: The global process uncaught exception and rejection handlers were previously duplicated between `server.js` and `errorHandler.js`. While comments indicate cleanup, checking both is crucial.

### Inconsistent Naming Conventions
*   **Model Properties**: The `Email` model uses camelCase for properties (e.g., `gmailId`, `receivedAt`, `confidenceScore`) while the ML service outputs snake_case keys (e.g., `model_version`, `top_signals`, `model_mtime`). This requires manual mapping across the Express adapter.
*   **Endpoint Labels**: The UI components use the term "Safe" (e.g., in `EmailTable.jsx` badges) but backend feedback schemas use `legitimate`. This creates confusion during label synchronization.

### Hardcoded Values
*   **Default Dev Key Fallback**: [encryption.js](file:///c:/Users/rashi/OneDrive/Desktop/Mailguard/Mailguard/backend/utils/encryption.js) falls back to `'dev-only-mailguard-key'` if `ENCRYPTION_KEY` is not set. If a container is deployed in production without setting this variable (or if `NODE_ENV` is bypassed), it compromises the security of all stored Gmail access and refresh tokens.

### Security Concerns
*   **Active Auth Keys Committed**: The `.env` file contains plaintext secret keys for Clerk (`CLERK_SECRET_KEY`) and placeholder strings for Google client secrets. These keys must be revoked and loaded from container environments instead of config files.
*   **Deprecated CSRF Library**: Using `csurf` is a security risk because it does not support modern cookie attributes and is no longer maintained.

### Missing Tests
*   While there are basic Jest configurations in `backend`, there are no integration tests validating the Python microservice communication or test suites covering frontend state changes.

---

## 6. INCOMPLETE OR TODO WORK

*   **Incomplete Auto-Delete**: The User model defines `autoDeletePreferences` (lines 77-88) and the scheduled scan job is written to utilize it. However, the user settings page to toggle this option and adjust `retentionDays` is missing from the frontend dashboard.
*   **Missing Disconnect Action**: The backend provides `DELETE /api/gmail/disconnect` to sever the link with Google. However, the frontend dashboard lacks a corresponding "Disconnect Account" button, meaning users can connect Gmail but have no way to disconnect it without manual database intervention.

---

## 7. PRIORITIZED FIX LIST

1.  **Fix double `module.exports` and `originalMLClassifyFn` reference in `backend/services/mlService.js`**.
    *   *Reason*: Crucial first step. The backend is completely broken and crashes on any email classification attempt.
2.  **Add `userId` field to `Classification.findOneAndUpdate` in `emailController.js`**.
    *   *Reason*: Essential for database integrity. Prevents orphan classifications lacking an owner from polluting the database.
3.  **Align Gmail OAuth route definitions on backend and frontend**.
    *   *Reason*: Users will experience 404 errors when attempting to connect Gmail if the actual request does not match the implemented routes.
4.  **Migrate away from deprecated `csurf` library**.
    *   *Reason*: Resolves security vulnerabilities and prevents session failures under modern Node versions.
5.  **Configure local Python path or command for ML sub-processes in `adminController.js`**.
    *   *Reason*: Guarantees that retraining jobs do not crash on machines where Python 3 is bound to `python3` instead of `python`.
6.  **Add the "Disconnect Gmail" button in the frontend settings**.
    *   *Reason*: Resolves incomplete UI feature implementation and gives users control over their data permissions.
7.  **Uncomment and verify scheduled scan and retraining jobs in `server.js`**.
    *   *Reason*: Activates core security scanning and automated ML updates.

---

## 8. SUMMARY

Mailguard has a robust feature set combining security dashboards, Gmail fetching, and a retraining loop for ML models. However, the codebase is currently **unstable** and inoperable in its default state due to a few critical Node.js backend bugs. Chief among these is a duplicate export in the ML service adapter that completely blocks access to classification utilities, coupled with an undefined function reference that triggers a crash on inference. If the backend adapter is refactored, the endpoints aligned, and the database upsert corrected to populate the required user references, the project will achieve stability. The biggest immediate risk is the exposure of active Clerk API keys in the `.env` file, which should be rotated immediately.
