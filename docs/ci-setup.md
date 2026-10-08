# CI/CD Setup Guide

## Required GitHub Secrets

Go to: GitHub repo > Settings > Secrets and variables > Actions > New repository secret

| Secret | Description | Where to find it |
|---|---|---|
| JWT_ACCESS_SECRET | JWT signing secret for access tokens | Copy from your local .env file |
| JWT_REFRESH_SECRET | JWT signing secret for refresh tokens | Copy from your local .env file |
| API_KEY | API key for transaction ingestion | Copy from your local .env file |
| RAILWAY_TOKEN | Railway deployment token | Railway dashboard > Account Settings > Tokens > New Token |
| VERCEL_TOKEN | Vercel deployment token | Vercel dashboard > Settings > Tokens > Create |
| VERCEL_ORG_ID | Your Vercel team/org ID | Run `vercel link` in apps/web, then check .vercel/project.json |
| VERCEL_PROJECT_ID | Your Vercel project ID | Run `vercel link` in apps/web, then check .vercel/project.json |

## Notes

- DATABASE_URL, TEST_DATABASE_URL, REDIS_URL, CORS_ORIGIN, and PORT are 
  hardcoded in the workflow (not secrets) because they point to CI service 
  containers, not production databases.

- The deploy job only runs on direct pushes to main, not on pull requests.
  This means PRs run all tests but do not deploy.

- The test job uses real PostgreSQL and Redis containers (not mocks) via 
  the services block. This ensures tests run in the same environment as 
  local development.

## First-time setup

1. Add all secrets listed above to GitHub
2. For Railway: make sure the API service is already created in your Railway project
3. For Vercel: run `vercel link` inside `apps/web` locally first to generate 
   the .vercel/project.json with org and project IDs
4. Push to main or open a PR to trigger the first CI run
5. Check the Actions tab on GitHub to see the pipeline status
