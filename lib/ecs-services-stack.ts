import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ecr from 'aws-cdk-lib/aws-ecr';

export interface EcsServicesStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
}

export class EcsServicesStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly taskDefinition: ecs.FargateTaskDefinition;
  public readonly mainApiService: ecs_patterns.ApplicationLoadBalancedFargateService;
  public readonly subtitleApiService: ecs.FargateService;
  public readonly mainApiRepository: ecr.Repository;

  constructor(scope: Construct, id: string, props: EcsServicesStackProps) {
    super(scope, id, props);

    // Define ECS Cluster in the provided VPC
    this.cluster = new ecs.Cluster(this, 'ReelQuotesCluster', {
      vpc: props.vpc,
      clusterName: 'ReelQuotesCluster',
    });

    // Define Fargate Task Definition for NestJS MVP
    this.taskDefinition = new ecs.FargateTaskDefinition(this, 'NestJsTaskDef', {
      cpu: 256,
      memoryLimitMiB: 512,
    });

    // Add container with placeholder image and CloudWatch logging
    this.taskDefinition.addContainer('NestJsContainer', {
      image: ecs.ContainerImage.fromRegistry('hello-world'),
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: 'NestJsApp',
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
    });

    // Main API: ApplicationLoadBalancedFargateService
    this.mainApiService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'MainApiService', {
      cluster: this.cluster,
      taskDefinition: this.taskDefinition,
      publicLoadBalancer: true,
      listenerPort: 443,
      assignPublicIp: true,
      healthCheckGracePeriod: cdk.Duration.seconds(60),
      desiredCount: 1,
      redirectHTTP: true,
    });
    const tg = this.mainApiService.targetGroup;
    if (tg) {
      tg.configureHealthCheck({
        path: '/api/v1/health',
        healthyHttpCodes: '200',
      });
    }

    // Output the ALB DNS name
    new cdk.CfnOutput(this, 'MainApiALBDns', {
      value: this.mainApiService.loadBalancer.loadBalancerDnsName,
      description: 'Public DNS name of the Application Load Balancer for the main API',
    });

    // Subtitle API: Internal FargateService (no public LB)
    this.subtitleApiService = new ecs.FargateService(this, 'SubtitleApiService', {
      cluster: this.cluster,
      taskDefinition: this.taskDefinition,
      desiredCount: 1,
      assignPublicIp: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    // ECR Repository for reelquotes-main-api
    this.mainApiRepository = new ecr.Repository(this, 'MainApiRepository', {
      repositoryName: 'reelquotes-main-api',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      imageScanOnPush: true,
    });

    new cdk.CfnOutput(this, 'MainApiEcrRepoUri', {
      value: this.mainApiRepository.repositoryUri,
      description: 'ECR repository URI for reelquotes-main-api',
    });

    // Trigger deployment: ECR repository for reelquotes-main-api is defined below.
  }
}
