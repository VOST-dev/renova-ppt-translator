# CDK Backend Infrastructure Design

**Date**: 2026-03-18
**Project**: translator-v2
**Status**: Draft

---

## Overview

AWS CDK infrastructure for the translator-v2 backend API. Rebuilds from scratch, replacing the previous stack that included API Gateway, CloudFront, and a frontend bucket. The new stack is minimal and focused on backend API development.

## Architecture

```
Client → Lambda Function URL → Lambda (Node.js 22.x)
                                    ├── SourceBucket (S3)
                                    └── OutputBucket (S3)
                                    └── AWS Translate (IAM)
```

## Resources

### S3: SourceBucket

- **Purpose**: Stores source documents uploaded by users
- **Bucket name**: `translator-v2-source-{account}-{region}`
- **Encryption**: SSE-S3 (S3_MANAGED)
- **Public access**: Blocked entirely
- **CORS**: Allows PUT and GET from all origins — restrict to specific domain in production
- **Lifecycle**: Objects under `uploads/` prefix expire after 7 days
- **Removal policy**: RETAIN

### S3: OutputBucket

- **Purpose**: Stores translated output documents written by Lambda
- **Bucket name**: `translator-v2-output-{account}-{region}`
- **Encryption**: SSE-S3 (S3_MANAGED)
- **Public access**: Blocked entirely
- **Lifecycle**: Objects under `translated/` prefix expire after 30 days
- **Removal policy**: RETAIN

### IAM: BackendLambdaRole

- **Trust**: `lambda.amazonaws.com`
- **Managed policies**: `AWSLambdaBasicExecutionRole`
- **Inline grants**:
  - `sourceBucket.grantReadWrite` — read/write on SourceBucket
  - `outputBucket.grantReadWrite` — read/write on OutputBucket (Lambda writes translation results here)
- **Inline policy — AWS Translate**:
  - `translate:TranslateDocument`
  - `translate:TranslateText`
  - `translate:StartTextTranslationJob`
  - `translate:DescribeTextTranslationJob`
  - `translate:ListTextTranslationJobs`
  - `translate:StopTextTranslationJob`
  - Resource: `*` (AWS Translate does not support resource-level restrictions)

### Lambda: BackendFunction

- **Runtime**: Node.js 22.x *(upgraded from Node.js 20.x in the previous stack)*
- **Handler**: `index.handler`
- **Memory**: 512 MB
- **Timeout**: 30 seconds
- **Initial code**: Inline placeholder — replaced by build artifact on deployment
- **Function URL**: Enabled, auth type NONE
  - CORS: allows all origins/methods/headers — restrict allowed origins in production
- **Environment variables**:
  - `SOURCE_BUCKET` — SourceBucket name
  - `OUTPUT_BUCKET` — OutputBucket name
  - `NODE_ENV` — `production`

## Stack Configuration

- **Stack name**: `TranslatorStack`
- **Region**: defaults to `ap-northeast-1` (Tokyo); overridable via `CDK_DEFAULT_REGION` environment variable
- **Account**: resolved from `CDK_DEFAULT_ACCOUNT`

## Stack Outputs

| Output key | Value |
|-----------|-------|
| `FunctionUrl` | Lambda Function URL (HTTPS endpoint) |
| `FunctionName` | Lambda function name (for CI/CD deployments) |
| `SourceBucketName` | SourceBucket name |
| `OutputBucketName` | OutputBucket name |

## What Is Removed (vs. Previous Stack)

The following resources from the previous stack are intentionally excluded:

- API Gateway (`LambdaRestApi`)
- CloudFront Distribution
- Frontend S3 Bucket (`FrontendBucket`)
- CloudFront Origin Access Identity (OAI)

## File Structure

```
infra/
├── bin/
│   └── infra.ts             # CDK App entry point
├── lib/
│   └── translator-stack.ts  # Stack definition (single flat stack)
├── cdk.json
├── package.json             # Dependencies: aws-cdk-lib, constructs
└── tsconfig.json
```

## Decisions

- **Lambda Function URL over API Gateway**: Simpler for backend API development; API Gateway can be added later if throttling/auth features are needed.
- **Single flat stack**: No nested constructs or multiple stacks — scope is small enough that separation adds complexity without benefit.
- **No CloudFront**: Not needed at this stage; add when frontend hosting is required.
- **Node.js 22.x**: Latest LTS runtime available in Lambda (previous stack used 20.x).
- **OutputBucket grantReadWrite**: Lambda writes translation results to OutputBucket, so write permission is required (previous stack used read-only, which was insufficient).
- **AWS Translate permissions included**: Core to the translation service's function; Lambda cannot invoke Translate without these.
