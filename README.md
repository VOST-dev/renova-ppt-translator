# Translator V2

A document translation service built with React, Hono, and AWS.

## Architecture

- **frontend**: React + Vite + TypeScript + shadcn/ui + Tailwind CSS v4 + TanStack Query
- **backend**: Hono + Node.js + TypeScript, deployed on AWS Lambda
- **infra**: AWS CDK (TypeScript) — S3, Lambda, API Gateway, CloudFront

## Getting Started

### Prerequisites

- Node.js >= 20
- pnpm >= 9

### Install dependencies

```bash
pnpm install
```

### Development

```bash
# Start frontend dev server
pnpm dev:frontend

# Start backend dev server
pnpm dev:backend

# Start both
pnpm dev
```

### Build

```bash
pnpm build:frontend
pnpm build:backend
pnpm build:infra
```

### Deploy

```bash
cd infra
pnpm cdk deploy
```

## Project Structure

```
translator-v2/
├── docs/          # Architecture Decision Records and documentation
├── frontend/      # React SPA
├── backend/       # Hono API server (Node.js / Lambda)
├── infra/         # AWS CDK infrastructure
├── package.json   # pnpm workspace root
└── pnpm-workspace.yaml
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/languages | List supported language pairs |
| GET | /api/upload-url | Get presigned S3 URL for file upload |
| POST | /api/jobs | Create a new translation job |
| GET | /api/jobs | List translation jobs |
| GET | /api/jobs/:job_id | Get job status |
| GET | /api/jobs/:job_id/download-url | Get presigned URL for translated file |
