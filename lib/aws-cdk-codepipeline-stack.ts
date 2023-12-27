import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
// import * as notifications from 'aws-cdk-lib/aws-codestarnotifications';
// import * as sns from 'aws-cdk-lib/aws-sns';
// import * as sns_sub from 'aws-cdk-lib/aws-sns-subscriptions';

import { IStackProps } from '../bin/stack-config-types';

export class AwsCdkCodepipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: IStackProps) {
    super(scope, id, props);

    const role = new iam.Role(this, 'role', {
      roleName: props.role.name,
      description: props.role.description,
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('cloudformation.amazonaws.com'),
        new iam.ServicePrincipal('codebuild.amazonaws.com'),
        new iam.ServicePrincipal('codepipeline.amazonaws.com')
      ),
    });

    role.addManagedPolicy(
      // AdministratorAccess
      iam.ManagedPolicy.fromAwsManagedPolicyName(props.role.managedPolicy)
    );

    const githubToken = secretsmanager.Secret.fromSecretNameV2(
      this,
      'githubSecret',
      props.github.tokenSecretName
    );

    githubToken.grantRead(role);

    /* KMS Key used for S3 bucket in Codepipeline*/
    const key = new kms.Key(this, 'key', {
      description: props.key.description,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    key.grantEncryptDecrypt(role);

    /* Function for creating the build templates (template and lambda) */
    const getBuildSpec = (
      name: string,
      commds: string[],
      dir: string,
      files: string[]
    ) => {
      return new codebuild.PipelineProject(this, name, {
        projectName: name,
        role,
        encryptionKey: key,
        environment: { buildImage: codebuild.LinuxBuildImage.STANDARD_6_0 },
        buildSpec: codebuild.BuildSpec.fromObject({
          version: '0.2',
          phases: {
            install: {
              commands: ['npm ci'],
            },
            build: {
              commands: ['npm run build'],
            },
            post_build: {
              commands: commds,
            },
          },
          artifacts: {
            'base-directory': dir,
            files: files,
          },
        }),
      });
    };

    /** Codepipeline Actions use the build templates 
     1) get the source code 
     2) build the template and lambda src code 
     3) deploy the template with the lambda src code to AWS
    */

    // 1. get code from Github and store it inside source artifact
    const source = new codepipeline.Artifact();

    const githubSourceAction = new codepipeline_actions.GitHubSourceAction({
      actionName: 'Checking_Out_Source_Code',
      owner: props.github.owner,
      repo: props.github.repo,
      branch: props.github.branch,
      oauthToken: githubToken.secretValueFromJson('secret'), // secret is key name
      trigger: codepipeline_actions.GitHubTrigger.WEBHOOK, // on "push"
      output: source, // artifact
      runOrder: 1,
    });

    const getBuildAction = ({
      actionName,
      build,
      artifact,
    }: {
      actionName: string;
      build: codebuild.IProject;
      artifact: codepipeline.Artifact;
    }) => {
      return new codepipeline_actions.CodeBuildAction({
        actionName,
        input: source,
        outputs: [artifact],
        role,
        project: build,
        runOrder: 2,
      });
    };

    // 2. build the template and store it inside templateOutput artifact
    const templateOutput = new codepipeline.Artifact('templateOutput');

    const buildTemplate = getBuildSpec(
      props.codebuild.templateProject,
      [`npx cdk synth ${props.codebuild.targetStack} -o dist`], // MyFirstCdkStack
      'dist',
      [`${props.codebuild.targetStack}.template.json`]
    );

    const buildTemplateAction = getBuildAction({
      actionName: 'Building_Template',
      build: buildTemplate,
      artifact: templateOutput,
    });

    // 2. build the lambda and store it inside lambdaOutput artifact
    const lambdaOutput = new codepipeline.Artifact('lambdaOutput');

    const buildLambda = getBuildSpec(
      props.codebuild.lambdaProject,
      ['npm run test'],
      'dist/src',
      [props.codebuild.targetLambda] // index.js
    );

    const buildLambdaAction = getBuildAction({
      actionName: 'Building_Lambda',
      build: buildLambda,
      artifact: lambdaOutput,
    });

    // 3. deploy
    const deployAction =
      new codepipeline_actions.CloudFormationCreateUpdateStackAction({
        actionName: 'Deploying_Stack',
        role,
        deploymentRole: role,
        adminPermissions: true,
        replaceOnFailure: true,
        stackName: props.codebuild.targetStack,
        // cloudformation template (without correct bucket name and bucket key name)
        templatePath: templateOutput.atPath(
          `${props.codebuild.targetStack}.template.json`
        ),
        // lambda artifact parameters that we use to overwrite inside parameterOverrides
        extraInputs: [lambdaOutput],
        cfnCapabilities: [
          cdk.CfnCapabilities.NAMED_IAM,
          cdk.CfnCapabilities.AUTO_EXPAND,
        ],
        // overwrite bucketName and bucketKey so the template has the right reference to the code
        parameterOverrides: {
          bucketName: lambdaOutput.bucketName,
          bucketKey: lambdaOutput.objectKey,
        },
        runOrder: 3,
      });

    /* Codepipeline */

    const artifactBucket = new s3.Bucket(this, 'bucket', {
      bucketName: props.bucket.name,
      encryptionKey: key,
      encryption: cdk.aws_s3.BucketEncryption.KMS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    artifactBucket.grantReadWrite(role);

    const pipeline = new codepipeline.Pipeline(this, 'codepipeline', {
      pipelineName: props.codepipeline.name,
      role,
      artifactBucket,
      stages: [
        {
          stageName: 'Source',
          actions: [githubSourceAction],
        },
        {
          stageName: 'Build',
          actions: [buildTemplateAction, buildLambdaAction],
        },
        {
          stageName: 'Deploy',
          actions: [deployAction],
        },
      ],
    });

    pipeline.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [role.roleArn],
      })
    );

    /* Notifications */

    // const topic = new sns.Topic(this, 'topic', {
    //   topicName: props.sns.name,
    // });
    // topic.grantPublish(role);
    // props.sns.subEmails.map((email) => {
    //   const subscription = new sns_sub.EmailSubscription(email);
    //   topic.addSubscription(subscription);
    // });

    // [
    //   { source: buildTemplate, name: 'template' },
    //   { source: buildLambda, name: 'lambda' },
    // ].forEach((build) => {
    //   return new notifications.NotificationRule(
    //     this,
    //     `${build.name}-notifications`,
    //     {
    //       notificationRuleName: `${build.name}-notifications`,
    //       source: build.source,
    //       events: [
    //         'codebuild-project-build-state-succeeded',
    //         'codebuild-project-build-state-failed',
    //       ],
    //       targets: [topic],
    //     }
    //   );
    // });
  }
}
