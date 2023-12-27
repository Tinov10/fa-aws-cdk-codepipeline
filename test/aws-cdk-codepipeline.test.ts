/* eslint-disable max-lines */
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as AwsCdkCodepipeline from '../lib/aws-cdk-codepipeline-stack';
import environmentConfig from '../bin/stack-config';

const app = new cdk.App();

const stack = new AwsCdkCodepipeline.AwsCdkCodepipelineStack(
  app,
  'MyTestStack',
  environmentConfig
);
const template = Template.fromStack(stack);

test('Contains IAM Role', () => {
  template.hasResourceProperties('AWS::IAM::Role', {
    RoleName: environmentConfig.role.name,
    Description: environmentConfig.role.description,
    AssumeRolePolicyDocument: {
      Statement: [
        'cloudformation.amazonaws.com',
        'codebuild.amazonaws.com',
        'codepipeline.amazonaws.com',
      ].map((service) => {
        return {
          Action: 'sts:AssumeRole',
          Effect: 'Allow',
          Principal: {
            Service: service,
          },
        };
      }),
    },
    ManagedPolicyArns: [
      {
        'Fn::Join': [
          '',
          [
            'arn:',
            {
              Ref: 'AWS::Partition',
            },
            ':iam::aws:policy/AdministratorAccess',
          ],
        ],
      },
    ],
  });
});

test('Contains KMS Key', () => {
  template.hasResourceProperties('AWS::KMS::Key', {
    Description: environmentConfig.key.description,
  });
});

test('Contains CodeBuild TemplateProject', () => {
  const templateBuildSpec =
    '{\n  "version": "0.2",\n  "phases": {\n    "install":' +
    ' {\n      "commands": [\n        "npm ci"\n      ]\n    },\n    "build": {\n' +
    '      "commands": [\n        "npm run build"\n      ]\n    },\n    "post_build":' +
    ' {\n      "commands": [\n        "npx cdk synth MyFirstCdkStack' +
    ' -o dist"\n      ]\n    }\n  },\n  "artifacts": {\n    "base-directory":' +
    ` "dist",\n    "files": [\n      "${environmentConfig.codebuild.targetStack}.template.json"\n    ]\n  }\n}`;

  template.hasResourceProperties('AWS::CodeBuild::Project', {
    Name: environmentConfig.codebuild.templateProject,
    Source: {
      BuildSpec: templateBuildSpec,
    },
    Environment: {
      Image: 'aws/codebuild/standard:6.0',
      Type: 'LINUX_CONTAINER',
    },
  });
});

test('Contains CodeBuild LambdaProject', () => {
  const lambdaBuildSpec =
    '{\n  "version": "0.2",\n  "phases": {\n    "install": {\n      ' +
    '"commands": [\n        "npm ci"\n      ]\n    },\n    "build": {\n      "commands": [\n' +
    '        "npm run build"\n      ]\n    },\n    "post_build": {\n      "commands": [\n        "npm run test"\n      ]\n  ' +
    '  }\n  },\n  "artifacts": {\n    "base-directory": "dist/src",\n    "files": [\n      ' +
    `"${environmentConfig.codebuild.targetLambda}"\n    ]\n  }\n}`;

  template.hasResourceProperties('AWS::CodeBuild::Project', {
    Name: environmentConfig.codebuild.lambdaProject,
    Source: {
      BuildSpec: lambdaBuildSpec,
    },
    Environment: {
      Image: 'aws/codebuild/standard:6.0',
      Type: 'LINUX_CONTAINER',
    },
  });
});

test('Contains S3 Artifact Bucket', () => {
  template.hasResourceProperties('AWS::S3::Bucket', {
    BucketName: environmentConfig.bucket.name,
  });
});

test('Contains CodePipeline Pipeline', () => {
  template.hasResourceProperties('AWS::CodePipeline::Pipeline', {
    Name: environmentConfig.codepipeline.name,
    Stages: [
      {
        Name: 'Source',
        Actions: [
          {
            ActionTypeId: {
              Category: 'Source',
              Provider: 'GitHub',
            },
            Configuration: {
              Owner: environmentConfig.github.owner,
              Repo: environmentConfig.github.repo,
              Branch: environmentConfig.github.branch,
            },
            Name: 'Checking_Out_Source_Code',
            OutputArtifacts: [
              {
                Name: 'Artifact_Source_Checking_Out_Source_Code',
              },
            ],
            RunOrder: 1,
          },
        ],
      },
      {
        Name: 'Build',
        Actions: [
          {
            Name: 'Building_Template',
            ActionTypeId: {
              Category: 'Build',
              Provider: 'CodeBuild',
            },
            InputArtifacts: [
              {
                Name: 'Artifact_Source_Checking_Out_Source_Code',
              },
            ],
            OutputArtifacts: [
              {
                Name: 'templateOutput',
              },
            ],
            RunOrder: 2,
          },
          {
            Name: 'Building_Lambda',
            ActionTypeId: {
              Category: 'Build',
              Provider: 'CodeBuild',
            },
            InputArtifacts: [
              {
                Name: 'Artifact_Source_Checking_Out_Source_Code',
              },
            ],
            OutputArtifacts: [
              {
                Name: 'lambdaOutput',
              },
            ],
            RunOrder: 2,
          },
        ],
      },
      {
        Name: 'Deploy',
        Actions: [
          {
            Name: 'Deploying_Stack',
            ActionTypeId: {
              Category: 'Deploy',
              Provider: 'CloudFormation',
            },
            Configuration: {
              StackName: 'MyFirstCdkStack',
              Capabilities: 'CAPABILITY_NAMED_IAM,CAPABILITY_AUTO_EXPAND',
              ParameterOverrides:
                '{"bucketName":{"Fn::GetArtifactAtt":["lambdaOutput","BucketName"]},"bucketKey":{"Fn::GetArtifactAtt":["lambdaOutput","ObjectKey"]}}',
              ActionMode: 'REPLACE_ON_FAILURE',
              TemplatePath: `templateOutput::${environmentConfig.codebuild.targetStack}.template.json`,
            },
            InputArtifacts: [
              {
                Name: 'lambdaOutput',
              },
              {
                Name: 'templateOutput',
              },
            ],
            RunOrder: 3,
          },
        ],
      },
    ],
  });
});

// test('Contains SNS Topic', () => {
//   template.hasResourceProperties('AWS::SNS::Topic', {
//     TopicName: environmentConfig.sns.name,
//   });
// });

// test('Contains CodeStarNotifications NotificationRules', () => {
//   template.hasResourceProperties(
//     'AWS::CodeStarNotifications::NotificationRule',
//     {
//       Name: 'template-notifications',
//       EventTypeIds: [
//         'codebuild-project-build-state-succeeded',
//         'codebuild-project-build-state-failed',
//       ],
//       Targets: [
//         {
//           TargetType: 'SNS',
//         },
//       ],
//     }
//   );

//   template.hasResourceProperties(
//     'AWS::CodeStarNotifications::NotificationRule',
//     {
//       Name: 'lambda-notifications',
//       EventTypeIds: [
//         'codebuild-project-build-state-succeeded',
//         'codebuild-project-build-state-failed',
//       ],
//       Targets: [
//         {
//           TargetType: 'SNS',
//         },
//       ],
//     }
//   );
// });
