#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { TranslatorStack } from "../lib/translator-stack";

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "ap-northeast-1",
};

new TranslatorStack(app, "TranslatorStack", {
  env,
  description: "Translator V2 - Document translation service",
});
