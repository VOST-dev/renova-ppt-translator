# CDK Backend Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the CDK stack from scratch with SourceBucket, OutputBucket, Lambda (Node.js 22.x + Function URL), and IAM role with S3 + Translate permissions.

**Architecture:** Single flat `TranslatorStack` in `infra/lib/translator-stack.ts`. Lambda is exposed via Function URL (no API Gateway). Two S3 buckets — source (user uploads) and output (translation results). IAM role grants Lambda access to both buckets and AWS Translate.

**Tech Stack:** AWS CDK v2 (2.242.0), TypeScript 5.x, Node.js 22.x Lambda runtime, `aws-cdk-lib`, `constructs`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `infra/bin/infra.ts` | Overwrite | CDK App entry point — instantiates `TranslatorStack` with region/account env |
| `infra/lib/translator-stack.ts` | Overwrite | Stack definition — all resources (S3, IAM, Lambda, Function URL, outputs) |
| `infra/package.json` | Verify | Confirm `source-map-support` is absent (not installed, not needed) |

> `cdk.json` and `tsconfig.json` require no changes.

---

## Task 1: Rewrite `bin/infra.ts`

**Files:**
- Modify: `infra/bin/infra.ts`

- [ ] **Step 1: Overwrite `bin/infra.ts`**

Replace the entire file with the following. The `source-map-support` import is removed — it is not installed and not required for CDK 2.x operation.

```typescript
#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { TranslatorStack } from "../lib/translator-stack";

const app = new cdk.App();

new TranslatorStack(app, "TranslatorStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "ap-northeast-1",
  },
  description: "Translator V2 - Document translation service",
});
```

- [ ] **Step 2: Run typecheck to verify no errors**

```bash
cd infra && npx tsc --noEmit
```

Expected: no output (zero errors). If errors appear, fix before continuing.

- [ ] **Step 3: Commit**

```bash
git add infra/bin/infra.ts
git commit -m "chore(infra): rewrite bin/infra.ts — remove source-map-support"
```

---

## Task 2: Rewrite `translator-stack.ts` — S3 Buckets

**Files:**
- Modify: `infra/lib/translator-stack.ts`

- [ ] **Step 1: Overwrite `translator-stack.ts` with S3-only skeleton**

Replace the entire file. This step defines only the two S3 buckets; Lambda and IAM are added in Task 3.

```typescript
import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

export class TranslatorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ─── S3 Buckets ───────────────────────────────────────────────────────────

    const sourceBucket = new s3.Bucket(this, "SourceBucket", {
      bucketName: `translator-v2-source-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: ["*"], // Restrict to specific domain in production
          allowedHeaders: ["*"],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(7),
          prefix: "uploads/",
        },
      ],
    });

    const outputBucket = new s3.Bucket(this, "OutputBucket", {
      bucketName: `translator-v2-output-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(30),
          prefix: "translated/",
        },
      ],
    });

    // Suppress unused variable warnings until Lambda is added in next task
    void sourceBucket;
    void outputBucket;
  }
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd infra && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run `cdk synth` and verify two S3 buckets are in the template**

```bash
cd infra && npx cdk synth
grep "AWS::S3::Bucket" infra/cdk.out/TranslatorStack.template.json
```

Expected: exactly two matches. No API Gateway, CloudFront, or frontend bucket should appear:

```bash
grep -E "ApiGateway|CloudFront|FrontendBucket" infra/cdk.out/TranslatorStack.template.json
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add infra/lib/translator-stack.ts
git commit -m "feat(infra): add SourceBucket and OutputBucket"
```

---

## Task 3: Add IAM Role and Lambda Function

**Files:**
- Modify: `infra/lib/translator-stack.ts`

- [ ] **Step 1: Replace `translator-stack.ts` with IAM + Lambda added**

Replace the entire file content:

```typescript
import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

export class TranslatorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ─── S3 Buckets ───────────────────────────────────────────────────────────

    const sourceBucket = new s3.Bucket(this, "SourceBucket", {
      bucketName: `translator-v2-source-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: ["*"], // Restrict to specific domain in production
          allowedHeaders: ["*"],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(7),
          prefix: "uploads/",
        },
      ],
    });

    const outputBucket = new s3.Bucket(this, "OutputBucket", {
      bucketName: `translator-v2-output-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(30),
          prefix: "translated/",
        },
      ],
    });

    // ─── IAM Role ─────────────────────────────────────────────────────────────

    const backendRole = new iam.Role(this, "BackendLambdaRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole",
        ),
      ],
    });

    sourceBucket.grantReadWrite(backendRole);
    outputBucket.grantReadWrite(backendRole);

    backendRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "translate:TranslateDocument",
          "translate:TranslateText",
          "translate:StartTextTranslationJob",
          "translate:DescribeTextTranslationJob",
          "translate:ListTextTranslationJobs",
          "translate:StopTextTranslationJob",
        ],
        resources: ["*"],
      }),
    );

    // ─── Lambda Function ──────────────────────────────────────────────────────

    const backendFunction = new lambda.Function(this, "BackendFunction", {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromInline(
        `exports.handler = async () => ({ statusCode: 200, body: '{"message":"placeholder"}' });`,
      ),
      role: backendRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        SOURCE_BUCKET: sourceBucket.bucketName,
        OUTPUT_BUCKET: outputBucket.bucketName,
        NODE_ENV: "production",
      },
    });

    // ─── Function URL ─────────────────────────────────────────────────────────

    const functionUrl = backendFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ["*"], // Restrict to specific domain in production
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ["*"],
      },
    });

    // ─── Stack Outputs ────────────────────────────────────────────────────────

    new cdk.CfnOutput(this, "FunctionUrl", {
      value: functionUrl.url,
      description: "Lambda Function URL",
    });

    new cdk.CfnOutput(this, "FunctionName", {
      value: backendFunction.functionName,
      description: "Lambda function name (for CI/CD deployments)",
    });

    new cdk.CfnOutput(this, "SourceBucketName", {
      value: sourceBucket.bucketName,
      description: "S3 bucket for source documents",
    });

    new cdk.CfnOutput(this, "OutputBucketName", {
      value: outputBucket.bucketName,
      description: "S3 bucket for translated documents",
    });
  }
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd infra && npx tsc --noEmit
```

Expected: no errors. `lambda.Runtime.NODEJS_22_X` is confirmed available in `aws-cdk-lib@2.242.0` (the installed version).

- [ ] **Step 3: Run `cdk synth` and verify resource types**

```bash
cd infra && npx cdk synth
grep -E "AWS::S3::Bucket|AWS::IAM::Role|AWS::IAM::Policy|AWS::Lambda::Function|AWS::Lambda::Url" \
  infra/cdk.out/TranslatorStack.template.json
```

Expected: lines matching each of the five resource types above.

Resources that must NOT appear:
```bash
grep -E "ApiGateway|CloudFront|FrontendBucket|OriginAccessIdentity" \
  infra/cdk.out/TranslatorStack.template.json
```

Expected: no output (zero matches).

- [ ] **Step 4: Verify stack outputs**

```bash
grep -E '"FunctionUrl"|"FunctionName"|"SourceBucketName"|"OutputBucketName"' \
  infra/cdk.out/TranslatorStack.template.json
```

Expected: exactly four matching lines.

- [ ] **Step 5: Commit**

```bash
git add infra/lib/translator-stack.ts
git commit -m "feat(infra): add IAM role, Lambda Node.js 22.x, Function URL, stack outputs"
```

---

## Task 4: Final Verification

- [ ] **Step 1: Clean `cdk.out` and re-synth from clean state**

```bash
cd infra && rm -rf cdk.out && npx cdk synth
```

Expected: synth completes without errors. `cdk.out/` directory is recreated.

- [ ] **Step 2: Verify no removed resources exist in template**

```bash
grep -E "ApiGateway|CloudFront|FrontendBucket|OriginAccessIdentity" infra/cdk.out/TranslatorStack.template.json
```

Expected: no output (zero matches).

- [ ] **Step 3: Verify Lambda runtime**

```bash
grep "nodejs22" infra/cdk.out/TranslatorStack.template.json
```

Expected: `"nodejs22.x"` appears.

- [ ] **Step 4: Verify Function URL resource**

```bash
grep "AWS::Lambda::Url" infra/cdk.out/TranslatorStack.template.json
```

Expected: `"AWS::Lambda::Url"` appears.

Verification complete. `cdk.out/` is gitignored and does not need to be committed.
