# GCC Lookup — Server

## Deploy to Railway

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/dsoleimani1/gcc-lookup.git
git push -u origin main
```

### 2. Railway Environment Variables
Set these in Railway → Variables:
- `DATABASE_URL` — auto-set when you add PostgreSQL
- `SESSION_SECRET` — any long random string (e.g. generate at passwordsgenerator.net)
- `ADMIN_EMAIL` — your email address
- `ADMIN_PASSWORD` — your password for the app
- `NODE_ENV` — `production`

### 3. Create Admin User
After first deploy, run in Railway shell:
```bash
node bootstrap.js
```

### 4. Done
Your app will be live at your Railway URL.
