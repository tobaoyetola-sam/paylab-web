<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/aricxpoint-logo-white.png">
    <img alt="aricxpoint technologies" src=".github/aricxpoint-logo-black.png" width="320">
  </picture>
</p>

# paylab-web

Part of **PayLab** (aricxpoint DevOps class: "Payment Web App Deployment").

The payment **frontend**: plain HTML + CSS + JavaScript (no framework, no build step) served by
**nginx running as a non-root user** (`nginxinc/nginx-unprivileged:1.27.5-alpine`) on port **3000**.

What you can do on the page:
1. **Create my wallet** (name + handle, ₦10,000 demo credit) or **Open my wallet** by handle. The handle is remembered in `localStorage`.
2. See your balance and **send money** to another handle (picked from a list of wallets via `GET /api/wallets`), with an optional note.
   Each payment gets a unique reference. The result shows ✓ success or ✗ failed (e.g. insufficient funds).
3. See your **history** (`GET /api/payments?walletId=...`): sent items as −₦ and received items as +₦, with the other person's handle and the status.
4. Balance and history refresh **every 4 seconds**, so the payee sees the money arrive live.
   **Switch wallet** lets one browser play both sides (or open a second browser/incognito window).

The API stores money in **kobo**; the page converts (₦1 = 100 kobo).

| Path | |
|---|---|
| `/` | the app (`site/index.html`, `site/app.js`, `site/styles.css`) |
| `/config.js` | generated at container start: `window.PAYLAB_API_BASE = "...";` |
| `/health` | `200 ok`, used by the ALB target group `paylab-web-tg` |

## Configuration

| Variable | Default | |
|---|---|---|
| `API_BASE` | `""` | Where the page sends `/api/...` calls. Empty = **same origin**: on AWS the ALB routes `/api/*` to api-gateway. Locally use `http://localhost:8080`. |

How it works: the nginx image runs every script in `/docker-entrypoint.d/` before starting nginx.
`40-paylab-config.sh` writes `config.js` into the web root, which the Dockerfile `chown`s to the `nginx` user (uid 101),
so this works without root. Same image, different environments: no rebuild needed to change the API URL.

## Run it with Docker

```bash
docker build -t paylab/web .
docker run --rm --name web -p 3000:3000 -e API_BASE=http://localhost:8080 paylab/web
curl -s localhost:3000/health       # ok
curl -s localhost:3000/config.js    # window.PAYLAB_API_BASE = "http://localhost:8080";
```

Open http://localhost:3000. For the buttons to work, run the backend too (see the **paylab-api-gateway** README).
The gateway allows cross-origin calls (CORS) for exactly this local setup.

## Deployment (AWS)

This repo is deployed by its own **CodePipeline** `paylab-web-pipeline` on every push to `main`:

```
git push (main) -> CodePipeline Source -> CodeBuild (buildspec.yml) -> ECR paylab/web:<commit> -> ECS service "web" in cluster "paylab"
```

| File | Purpose |
|---|---|
| `buildspec.yml` | CodeBuild steps: log in to ECR, build, push `:<short-commit>` and `:latest`, write `imagedefinitions.json`. |
| `taskdef.json` | ECS task definition template (family `paylab-web`, container `web`, port 3000). Registered by `paylab-infra/terraform` (`ecs.tf`); the pipeline then registers a new revision on every deploy. |

The container name in `taskdef.json` and in `imagedefinitions.json` is `web`. They **must match**, or the deploy stage fails.
Live at **https://pay.lab.aricxpoint.co**: the ALB's HTTPS listener sends everything to `paylab-web-tg` (this service)
except `/api/*`, which goes to api-gateway, so `API_BASE` stays empty (same origin).
