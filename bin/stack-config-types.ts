import { StackProps } from 'aws-cdk-lib';

export interface IStackProps extends StackProps {
  role: {
    name: string;
    description: string;
    managedPolicy: string;
  };

  key: {
    description: string;
  };

  github: {
    tokenSecretName: string;
    owner: string;
    repo: string;
    branch: string;
  };

  codebuild: {
    templateProject: string;
    lambdaProject: string;
    targetStack: string;
    targetLambda: string;
  };

  codepipeline: {
    name: string;
  };

  bucket: {
    name: string;
  };

  sns: {
    name: string;
    subEmails: string[];
  };
}
