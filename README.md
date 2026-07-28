
# MedLookup

A drug label reference tool built on the [openFDA Drug Label API](https://open.fda.gov/apis/drug/label/). Search any medicine to see its official FDA label — purpose, active ingredient, dosage, warnings, and side effects — with sorting and filtering across results, and a dark/light theme toggle.

> *Disclaimer:* This application provides medicine information for educational purposes only and is not a substitute for professional medical advice.

**Live deployment (load-balanced):** http://3.86.235.151
**Repository:** https://github.com/benithaAnny/medicine-finder
**Demo video:** https://youtu.be/UVYCbR8h0XU

## Features

- Search by brand or generic name against the openFDA Drug Label API
- Client-side filtering and A–Z / Z–A sorting of results, with pagination ("Show more")
- A detail view styled as a prescription label, pulling Purpose, Active Ingredient, Dosage, Warnings, and Side Effects from whichever label fields are present (OTC and prescription labels use different field names for the same information — the app checks both)
- Dark/light theme toggle, saved in the browser (`localStorage`) — no account needed
- Graceful error handling for no-results, rate limits, and network failures

## Running locally

No build step, no dependencies, no API key required (openFDA is keyless at this request volume).

**Option A — open directly:**
Open `index.html` in a browser.

**Option B — local server (closer to how it's actually served):**
```bash
python3 -m http.server 8000
```
Then visit `http://localhost:8000`.

## Running with Docker

The whole app is packaged as a small nginx image with security headers baked in.

```bash
docker build -t medlookup .
docker run -p 3000:3000 medlookup
```

Visit `http://localhost:3000`.

What's in the image: `nginx:1.27-alpine` serving `index.html`, `style.css`, `script.js`, and `theme.js`, with a custom `nginx.conf` that adds a Content-Security-Policy, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy` to every response. See `nginx.conf` for the full header list and reasoning.

## Deployment: Web01, Web02, and Lb01

The app is deployed identically to both web servers and load-balanced through Lb01.

**Servers used:**
| Role | IP |
|---|---|
| Web01 | 54.85.44.66 |
| Web02 | 44.201.231.167 |
| Lb01 | 3.86.235.151 |

### 1. Deploy to each web server

On **Web01** and **Web02**:
```bash
git clone https://github.com/benithaAnny/medicine-finder.git
cd medicine-finder
docker build -t medlookup .
docker run -d -p 3000:3000 --restart unless-stopped --name medlookup medlookup
curl -I http://localhost:3000    # confirm it's serving locally before moving on
```

### 2. Configure Lb01 (HAProxy)

```bash
sudo apt update && sudo apt install haproxy -y
sudo nano /etc/haproxy/haproxy.cfg
```

Add:

```
frontend medlookup_front
    bind *:80
    default_backend medlookup_back

backend medlookup_back
    balance roundrobin
    server web01 54.85.44.66:3000 check
    server web02 44.201.231.167:3000 check
```

Apply it:
```bash
sudo haproxy -c -f /etc/haproxy/haproxy.cfg   # validate config first
sudo systemctl restart haproxy
```

### 3. Verify load balancing

```bash
for i in {1..6}; do curl -s -o /dev/null -w "%{http_code}\n" http://3.86.235.151; done
```
All six requests should return `200`. To confirm both servers are actually receiving traffic (not just one), temporarily edit each server's page to include its own name, then request through Lb01 repeatedly and confirm both names appear in the responses.

## CI/CD

`.github/workflows/ci.yml` runs on every push and pull request to `main`:

1. **Lint** — checks JavaScript syntax and validates the HTML.
2. **Build & test** — builds the Docker image and runs it, then confirms the container actually serves the page (not just that the image builds).
3. **Deploy** — on a push to `main`, copies the app files to Web01 and Web02 over SSH.

The deploy job is off by default. To enable it:
1. In the repo, go to **Settings → Secrets and variables → Actions**.
2. Add secrets: `WEB01_HOST`, `WEB01_USER`, `WEB01_SSH_KEY`, `WEB02_HOST`, `WEB02_USER`, `WEB02_SSH_KEY`.
3. Add a repository **variable** named `DEPLOY_ENABLED` set to `true`.

Until that's set up, pushes still run lint + build/test, so broken code is caught before it ever reaches the servers — deploy is just the last, optional step.

## Security

- **No secrets in the repo.** openFDA needs no API key at this volume, so there's nothing to leak; `.dockerignore` and `.gitignore` still exclude `.env` files as a habit for anything added later.
- **Input handling.** Search terms are capped at 100 characters and Lucene special characters (`( ) " * : \` etc.) are escaped before being placed into the openFDA query string, so a typed search term can't restructure the query itself.
- **Output escaping (XSS defense).** Every piece of text from the API — drug names, warnings, dosage text — is passed through `escapeHtml()` before being inserted into the page, so nothing in an FDA label response can execute as HTML/JS.
- **Security headers.** The nginx config sends a Content-Security-Policy, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and `Permissions-Policy` on every response (see `nginx.conf`). A matching `<meta>` CSP tag in `index.html` covers the case where the app is opened directly rather than served through nginx.
- **Error handling.** Fetch failures show a generic, user-facing message; the actual error detail is only logged to the browser console, never displayed or sent anywhere.
- **HTTPS.** Not configured in this repo (it depends on your load balancer setup) — terminate TLS at Lb01 (e.g. via Let's Encrypt/certbot) so traffic between users and Lb01 is encrypted. Traffic from Lb01 to Web01/Web02 stays on the internal network.

## Challenges encountered

- **Docker group permissions.** After installing Docker and adding the user to the `docker` group, `docker ps` still failed with a permission error in the same shell session — group membership only applies to new sessions. Fixed by running `newgrp docker` (or reconnecting via SSH).
- **Load balancer unreachable from outside.** After configuring HAProxy, `curl` from inside Lb01 worked, but a browser on an external network got `ERR_CONNECTION_REFUSED`. Root cause: the AWS security group for Lb01 didn't have an inbound rule allowing port 80 from the public internet. Fixed by adding an inbound rule for TCP port 80 from `0.0.0.0/0`.
- **Confirming both servers actually receive traffic.** HAProxy's default logging wasn't wired up to the systemd journal, so there was no log to grep. Instead of chasing logging configuration, temporarily added a distinguishing label to each server's page and requested through Lb01 repeatedly — seeing both labels appear in the responses was direct proof the load balancer was alternating between both real backends.
- **A captive Wi-Fi portal produced misleading test results.** Early `curl` tests against the load balancer's IP returned an HTTP redirect to a network login page rather than a real error — caused by the testing machine's own Wi-Fi network requiring a browser login before allowing general internet traffic, unrelated to the server setup itself.

## API credit

Data is sourced from the [openFDA Drug Label API](https://open.fda.gov/apis/drug/label/), a public database maintained by the U.S. Food and Drug Administration. openFDA is a research/informational tool and, per its own terms, is **not** intended to guide clinical decisions — which is also why this app carries its own educational-use disclaimer.

## Known limitations

 openFDA label data isn't always complete for every drug — not every entry has every field (Purpose, Dosage, Warnings, etc.), so the detail view only shows the fields actually present.
 No accounts, favorites, or search history — by design, kept as a stateless, backend-free static app.