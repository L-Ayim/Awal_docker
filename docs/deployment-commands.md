# Deployment Commands

## Local prerequisites

- Fly CLI installed locally as `fly`
- authenticated Fly account
- Neon database already provisioned

## Required secrets

Set these in Fly:

```powershell
fly secrets set DATABASE_URL="postgresql://..." DIRECT_URL="postgresql://..." APP_NAME="Awal" APP_URL="https://<your-app>.fly.dev"
```

## First deploy

From the Awal project root:

```powershell
fly launch --no-deploy
fly deploy
```

If you already have the app configured:

```powershell
fly deploy
```

## Useful follow-up commands

```powershell
fly status
fly logs
fly secrets list
```

## Health check

After deploy:

- `https://<your-app>.fly.dev/`
- `https://<your-app>.fly.dev/api/health`
