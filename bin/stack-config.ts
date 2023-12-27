import { IStackProps } from './stack-config-types';

const environmentConfig: IStackProps = {
  tags: {
    Developer: 'Martijn Versteeg',
    Application: 'AwsCdkCodepipeline',
  },
  role: {
    name: 'codepipeline-role',
    description: 'IAM role for Codepipeline',
    managedPolicy: 'AdministratorAccess',
  },
  key: {
    description: 'KMS key used by Codepipeline',
  },
  github: {
    tokenSecretName: 'demo-github-token',
    owner: 'Tinov10',
    repo: 'my-first-cdk',
    branch: 'codepipeline',
  },
  codebuild: {
    templateProject: 'BuildTemplate',
    lambdaProject: 'BuildLambda',
    targetStack: 'MyFirstCdkStack',
    targetLambda: 'index.js',
  },
  codepipeline: {
    name: 'LambdaDeploymentPipeline',
  },
  bucket: {
    name: 'coding-with-martijn-tinov10-codepipeline-bucket',
  },
  sns: {
    name: 'codepipeline-topic',
    subEmails: [],
  },
};

export default environmentConfig;
