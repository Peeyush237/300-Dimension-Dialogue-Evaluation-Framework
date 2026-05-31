# Deploy Ahoum: Docker baseline + Vercel

This guide assumes you have never used Docker before. Follow the steps in order.

---

## What you are building

Ahoum has two parts:

| Part | Technology | What it does |
|------|------------|--------------|
| **Frontend** | React + Vite | The website UI |
| **Backend** | Python + FastAPI | Runs evaluation, talks to Groq API |

**Docker** packages both into one reproducible container you can run anywhere.

**Vercel** hosts the frontend globally (fast CDN). Vercel does **not** run your Docker container in the cloud — that is a common misconception. The project requirement is:

1. **Docker baseline** → containerized app (local + backend hosting)
2. **Vercel** → deploy the frontend UI

The backend (Docker image) is deployed to a container platform such as **Railway** or **Render**, then the Vercel frontend connects to it.

---

## Part 1 — Understand Docker in 2 minutes

Think of Docker like a **lunch box**:

- **Dockerfile** = recipe (how to build the lunch box)
- **Image** = the packed lunch box (built from the recipe)
- **Container** = the lunch box while you are eating (running app)
- **docker compose** = one command to start everything with the right settings

You do **not** need to learn Docker deeply. You mainly run two commands:

```bash
docker compose up --build
docker compose down
```

---

## Part 2 — Install prerequisites

### 1. Docker Desktop (Windows)

1. Download: https://www.docker.com/products/docker-desktop/
2. Install and restart your PC if asked
3. Open **Docker Desktop** and wait until it says **Engine running**
4. Verify in PowerShell:

```powershell
docker --version
docker compose version
```

### 2. Groq API key

1. Sign up at https://console.groq.com/
2. Create an API key
3. Copy it — you will put it in `.env`

### 3. Git + GitHub account

Needed to connect Vercel and Railway to your code.

### 4. Vercel account

Sign up at https://vercel.com/ (free tier is fine).

### 5. Railway account (recommended for backend)

Sign up at https://railway.app/ (free trial / hobby tier).

---

## Part 3 — Run locally with Docker

### Step 1: Create your `.env` file

In the project root (`Ahoum/`), copy the example:

```powershell
cd C:\Users\LENOVO\OneDrive\Desktop\Ahoum
copy .env.example .env
```

Open `.env` in a text editor and set:

```env
GROQ_API_KEY=gsk_your_real_key_here
```

Never commit `.env` to GitHub (it is already in `.gitignore`).

### Step 2: Build and start the container

From the project root:

```powershell
docker compose up --build
```

First run takes a few minutes (downloads Node, Python, installs packages).

When you see something like:

```text
Uvicorn running on http://0.0.0.0:8080
```

open in your browser:

**http://localhost:8080**

You should see the Ahoum UI. Click **Evaluate now** and run a test conversation.

### Step 3: Stop the app

Press `Ctrl + C` in the terminal, then:

```powershell
docker compose down
```

---

## Part 4 — Push code to GitHub

If the project is not on GitHub yet:

```powershell
cd C:\Users\LENOVO\OneDrive\Desktop\Ahoum
git init
git add .
git commit -m "Add Docker baseline and deployment config"
```

Create a new repository on https://github.com/new (empty, no README), then:

```powershell
git remote add origin https://github.com/YOUR_USERNAME/ahoum.git
git branch -M main
git push -u origin main
```

---

## Part 5 — Deploy backend (Docker) on Railway

Vercel cannot run this Python API for long evaluations (timeouts). Railway runs your **Dockerfile** directly.

### Step 1: New project

1. Go to https://railway.app/
2. **New Project** → **Deploy from GitHub repo**
3. Select your `Ahoum` repository

### Step 2: Configure service

1. Railway detects the `Dockerfile` automatically
2. Open the service → **Settings**
3. Set **Port** to `8080` (or add variable `PORT=8080` if Railway asks)

### Step 3: Environment variables

In Railway → **Variables**, add:

| Variable | Value |
|----------|-------|
| `GROQ_API_KEY` | your Groq key |
| `MODEL_NAME` | `llama-3.1-8b-instant` |
| `MAX_CONCURRENT_REQUESTS` | `2` |
| `CONVERSATION_LLM_GATE` | `true` |
| `ALLOWED_ORIGINS` | `https://your-app.vercel.app` (set after Vercel deploy) |

### Step 4: Get public URL

1. Railway → **Settings** → **Networking** → **Generate Domain**
2. Copy the URL, e.g. `https://ahoum-production.up.railway.app`
3. Test: open `https://YOUR-RAILWAY-URL/health` — should show `{"status":"ok"}`

---

## Part 6 — Deploy frontend on Vercel

### Step 1: Import project

1. Go to https://vercel.com/new
2. **Import** your GitHub repository
3. When asked for settings:

| Setting | Value |
|---------|-------|
| **Root Directory** | `frontend` |
| **Framework Preset** | Vite |
| **Build Command** | `npm run build` |
| **Output Directory** | `dist` |

### Step 2: Environment variable (connect to backend)

Before clicking Deploy, open **Environment Variables** and add:

| Name | Value |
|------|-------|
| `VITE_API_BASE_URL` | `https://YOUR-RAILWAY-URL` |

Example:

```text
VITE_API_BASE_URL=https://ahoum-production.up.railway.app
```

No trailing slash.

### Step 3: Deploy

Click **Deploy**. Wait ~1–2 minutes.

Vercel gives you a URL like `https://ahoum.vercel.app`.

### Step 4: Update Railway CORS

Go back to Railway variables and set:

```text
ALLOWED_ORIGINS=https://ahoum.vercel.app
```

Use your real Vercel URL. Redeploy Railway if needed.

### Step 5: Test end-to-end

1. Open your Vercel URL
2. Go to **Evaluate now**
3. Run an evaluation
4. If it fails with network/CORS errors, double-check `VITE_API_BASE_URL` and `ALLOWED_ORIGINS`

---

## Part 7 — What each file does

| File | Purpose |
|------|---------|
| `Dockerfile` | Builds frontend + backend into one image |
| `docker-compose.yml` | Runs the app locally with one command |
| `requirements.txt` | Python dependencies for the API |
| `.dockerignore` | Keeps junk out of the Docker build |
| `.env.example` | Template for secrets (copy to `.env`) |
| `frontend/vercel.json` | Tells Vercel how to build the React app |

---

## Part 8 — Common problems

### "Cannot connect to Docker daemon"

→ Open **Docker Desktop** and wait until it is running.

### "GROQ_API_KEY is required"

→ Add the key to `.env` locally or Railway variables in production.

### Evaluate button fails on Vercel but works locally

→ `VITE_API_BASE_URL` must point to your Railway URL and be set **before** the Vercel build. After changing it, redeploy on Vercel (**Deployments → Redeploy**).

### CORS error in browser console

→ Set `ALLOWED_ORIGINS` on Railway to your exact Vercel URL (including `https://`).

### Docker build is slow

→ Normal on first build. Later builds use cache and are faster.

### Port 8080 already in use

→ Change in `docker-compose.yml`:

```yaml
ports:
  - "8081:8080"
```

Then open http://localhost:8081

---

## Part 9 — Quick reference commands

```powershell
# Local Docker (from project root)
docker compose up --build      # start
docker compose down            # stop

# Check container logs
docker compose logs -f

# Rebuild from scratch
docker compose build --no-cache
docker compose up
```

---

## Architecture diagram

```text
User browser
    │
    ▼
Vercel (frontend)  ──API calls──►  Railway (Docker container)
  React static files                  FastAPI + Groq LLM
  VITE_API_BASE_URL ─────────────►  /evaluate, /health, ...
```

---

## Alternative: everything in one Docker URL (no Vercel split)

If your requirement allows a **single URL** instead of Vercel + Railway:

1. Deploy only to Railway using the same `Dockerfile`
2. Open the Railway URL — UI and API are both served from one container
3. Skip Vercel entirely

This is simpler but does not use Vercel for the frontend.

---

## Checklist before submission

- [ ] `docker compose up --build` works locally at http://localhost:8080
- [ ] `.env` has valid `GROQ_API_KEY` (not committed to Git)
- [ ] Code pushed to GitHub
- [ ] Railway backend live, `/health` returns ok
- [ ] Vercel frontend live with `VITE_API_BASE_URL` set
- [ ] Evaluation works from the Vercel URL
