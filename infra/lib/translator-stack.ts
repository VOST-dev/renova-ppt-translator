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
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
      ],
    });

    backendRole.assumeRolePolicy?.addStatements(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        principals: [new iam.ServicePrincipal("translate.amazonaws.com")],
      }),
    );

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
          "translate:ListLanguages",
        ],
        resources: ["*"],
      }),
    );

    backendRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/ppt-translator/*`],
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
        TRANSLATE_ROLE_ARN: backendRole.roleArn,
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

    new cdk.CfnOutput(this, "TranslateRoleArn", {
      value: backendRole.roleArn,
      description: "IAM role ARN used as DataAccessRoleArn for Amazon Translate jobs",
    });
  }
}
