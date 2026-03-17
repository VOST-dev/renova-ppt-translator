#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { TranslatorStack } from "../lib/translator-stack";

const app = new cdk.App();

new TranslatorStack(app, "TranslatorStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "ap-northeast-1",
  },
  description: "Translator V2 - Document translation service",
});
