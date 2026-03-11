import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

export class TranslatorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ─── S3 Buckets ───────────────────────────────────────────────────────────

    // Bucket for source documents uploaded by users
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
          // Clean up uploaded source files after 7 days
          expiration: cdk.Duration.days(7),
          prefix: "uploads/",
        },
      ],
    });

    // Bucket for translated output documents
    const outputBucket = new s3.Bucket(this, "OutputBucket", {
      bucketName: `translator-v2-output-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          // Clean up translated files after 30 days
          expiration: cdk.Duration.days(30),
          prefix: "translated/",
        },
      ],
    });

    // Bucket for hosting the React SPA frontend
    const frontendBucket = new s3.Bucket(this, "FrontendBucket", {
      bucketName: `translator-v2-frontend-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // ─── Lambda Function ──────────────────────────────────────────────────────

    const backendRole = new iam.Role(this, "BackendLambdaRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
      ],
    });

    // Grant Lambda access to S3 buckets
    sourceBucket.grantReadWrite(backendRole);
    outputBucket.grantRead(backendRole);

    // Grant Lambda access to AWS Translate
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

    const backendFunction = new lambda.Function(this, "BackendFunction", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      // Code will be populated from the build artifact during deployment
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

    // ─── API Gateway ──────────────────────────────────────────────────────────

    const api = new apigateway.LambdaRestApi(this, "TranslatorApi", {
      handler: backendFunction,
      proxy: true,
      deployOptions: {
        stageName: "v1",
        throttlingBurstLimit: 100,
        throttlingRateLimit: 50,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          "Content-Type",
          "Authorization",
          "X-Amz-Date",
          "X-Api-Key",
          "X-Amz-Security-Token",
        ],
      },
    });

    // ─── CloudFront Distribution ───────────────────────────────────────────────

    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, "FrontendOAI", {
      comment: "OAI for Translator V2 frontend",
    });

    frontendBucket.grantRead(originAccessIdentity);

    const distribution = new cloudfront.Distribution(this, "TranslatorDistribution", {
      defaultBehavior: {
        origin: new origins.S3Origin(frontendBucket, {
          originAccessIdentity,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        "/api/*": {
          origin: new origins.RestApiOrigin(api),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      defaultRootObject: "index.html",
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
        },
      ],
    });

    // ─── Stack Outputs ────────────────────────────────────────────────────────

    new cdk.CfnOutput(this, "DistributionUrl", {
      value: `https://${distribution.distributionDomainName}`,
      description: "CloudFront distribution URL",
    });

    new cdk.CfnOutput(this, "ApiUrl", {
      value: api.url,
      description: "API Gateway URL",
    });

    new cdk.CfnOutput(this, "SourceBucketName", {
      value: sourceBucket.bucketName,
      description: "S3 bucket for source documents",
    });

    new cdk.CfnOutput(this, "OutputBucketName", {
      value: outputBucket.bucketName,
      description: "S3 bucket for translated documents",
    });

    new cdk.CfnOutput(this, "FrontendBucketName", {
      value: frontendBucket.bucketName,
      description: "S3 bucket for frontend assets",
    });

    new cdk.CfnOutput(this, "DistributionId", {
      value: distribution.distributionId,
      description: "CloudFront distribution ID (for cache invalidation)",
    });
  }
}
