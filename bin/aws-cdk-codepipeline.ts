#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AwsCdkCodepipelineStack } from '../lib/aws-cdk-codepipeline-stack';
import environmentConfig from './stack-config';

const app = new cdk.App();
new AwsCdkCodepipelineStack(app, 'AwsCdkCodepipelineStack', environmentConfig);
