"use strict";
const Generator = require("yeoman-generator");
const yaml = require("yaml");
const uuid = require("uuid/v4");
const fs = require("fs");
const changeCase = require("change-case");
const git = require("nodegit");
const path = require("path");
const rimraf = require("rimraf");

const compact = arr => arr.filter(f => f);

const ENVS = {
  DEVELOPMENT: "development",
  STAGING: "staging",
  PRODUCTION: "production"
};

const getK8Context = env => {
  switch (env) {
    case ENVS.DEVELOPMENT:
      return "admin-sendit-dev-staging.k8s.local";
    case ENVS.STAGING:
      return "admin-sendit-dev-staging.k8s.local";
    case ENVS.PRODUCTION:
      return "sendit-prod.k8s.local";

    default:
      return "admin-sendit-dev-staging.k8s.local";
  }
};

const generateDeployment = (env, props) => ({
  kind: "Deployment",
  replicaCount: env === ENVS.PRODUCTION ? 3 : 1,
  nameOverride: `${env}-${props.projectName}`,
  image: {
    repository: `registry.dev.true-e-logistics.com/sendit/${props.projectName}`,
    pullPolicy: "Always"
  },
  imagePullSecrets: {
    name: "telregistry"
  },
  terminationGracePeriodSeconds: 60,
  containerPorts: [
    {
      containerPort: 80,
      protocol: "TCP"
    }
  ],
  env: compact([
    {
      name: "APP_NAME",
      value: props.projectName
    },
    {
      name: "NODE_ENV",
      value: env
    },
    {
      name: "KOA_PORT",
      value: "80"
    },
    {
      name: "KOA_NAMESPACE",
      value: uuid()
    },
    props.enabledMongoose
      ? {
          name: "MONGODB_ENABLED",
          value: "true"
        }
      : null,
    props.enabledMongoose
      ? {
          name: "MONGODB_URL",
          valueFrom: {
            secretKeyRef: {
              name: "node-api",
              key: "MONGODB_URL"
            }
          }
        }
      : null,
    props.enabledConductor
      ? {
          name: "CONDUCTOR_ENABLED",
          value: "true"
        }
      : null,
    props.enabledConductor
      ? {
          name: "CONDUCTOR_BASEURL",
          valueFrom: {
            secretKeyRef: {
              name: "node-api",
              key: "CONDUCTOR_BASEURL"
            }
          }
        }
      : null,
    props.enabledRascal
      ? {
          name: "RASCAL_ENABLED",
          value: "true"
        }
      : null,
    props.enabledRascal
      ? {
          name: "AMQP_URLS",
          valueFrom: {
            secretKeyRef: {
              name: "node-api",
              key: "AMQP_URLS"
            }
          }
        }
      : null,
    props.enabledRedis
      ? {
          name: "REDIS_ENABLED",
          value: "true"
        }
      : null,
    props.enabledRedis
      ? {
          name: "REDIS_HOST",
          valueFrom: {
            secretKeyRef: {
              name: "node-api",
              key: "REDIS_HOST"
            }
          }
        }
      : null,
    props.enabledElasticsearch
      ? {
          name: "ELASTICSEARCH_HOST",
          valueFrom: {
            secretKeyRef: {
              name: "node-api",
              key: "ELASTICSEARCH_HOST"
            }
          }
        }
      : null
  ]),
  workingDir: "/var/source",
  healthCheck: {
    enabled: true,
    readinessProbe: {
      httpGet: {
        path: "/system/health",
        port: 80,
        initialDelaySeconds: 5,
        timeoutSeconds: 1,
        periodSeconds: 30,
        successThreshold: 1,
        failureThreshold: 3
      }
    },
    livenessProbe: {
      httpGet: {
        path: "/system/health",
        port: 80
      },
      initialDelaySeconds: 300,
      timeoutSeconds: 10,
      periodSeconds: 60,
      successThreshold: 1,
      failureThreshold: 3
    }
  },
  services: [
    {
      type: "ClusterIP",
      ports: [
        {
          name: `${env}-${props.projectName}`,
          protocol: "TCP",
          port: 80,
          targetPort: 80
        }
      ]
    }
  ],
  serviceHostNetwork: {
    enabled: false
  },
  nodeSelectorOverride: true
});

const getOnly = (env, projectName) => {
  switch (env) {
    case ENVS.DEVELOPMENT:
      return [ENVS.DEVELOPMENT];
    case ENVS.STAGING:
      return ["master"];
    case ENVS.PRODUCTION:
      return [`tags@sendit-th/${projectName}`];
    default:
      return [env];
  }
};

const generateGitlabCI = props => ({
  image: "docker:latest",
  services: ["docker:dind"],
  stages: ["build", "deploy"],
  cache: {
    untracked: true
  },
  variables: {
    CONTAINER_RELEASE_IMAGE: `registry.dev.true-e-logistics.com/sendit/${
      props.projectName
    }`,
    DOCKER_DRIVER: "overlay"
  },
  before_script: [
    "export DOCKER_API_VERSION=1.23 && docker login -u $DOCKER_USER -p $DOCKER_PASSWORD registry.dev.true-e-logistics.com",
    "apk update && apk add ca-certificates wget && update-ca-certificates"
  ],
  ...gitlabRunner(ENVS.DEVELOPMENT, props),
  ...gitlabRunner(ENVS.STAGING, props),
  ...gitlabRunner(ENVS.PRODUCTION, props)
});

const gitlabRunner = (env, props) => {
  const imageTag =
    env === ENVS.PRODUCTION ? "${CI_BUILD_TAG}" : `${env}-\${CI_COMMIT_SHA}`;
  const imageName = `$CONTAINER_RELEASE_IMAGE:${imageTag}`;
  const only = getOnly(env, props.projectName);
  return {
    [`${env}-push`]: {
      stage: "build",
      environment: env,
      script: [
        "docker pull $CONTAINER_RELEASE_IMAGE:stable || true",
        `docker build --cache-from $CONTAINER_RELEASE_IMAGE:stable -t ${imageName} -f Dockerfile .`,
        `docker push ${imageName}`
      ],
      tags: ["docker"],
      only
    },
    [`${env}-deploy`]: {
      image: "registry.gitlab.com/sendit-th/docker-base:kube",
      stage: "deploy",
      environment: env,
      before_script: [
        "mkdir ~/.kube",
        'echo -n "${KUBE_CONFIG}" | base64 -d > ~/.kube/config',
        `kubectl config use-context ${getK8Context(env)}`,
        "helm init --client-only"
      ],
      script: [
        "git clone https://$SENDIT_GITLAB_USERNAME:$SENDIT_GITLAB_PASSWORD@gitlab.com/sendit-th/sendit-infra-cluster.git /sendit-infra-cluster",
        `helm upgrade -i ${env}-${
          props.projectName
        } /sendit-infra-cluster/helm-generic-deployment -f deployment/values-${env}.yaml --namespace=${env} --set image.tag=${imageTag}`
      ],
      tags: ["docker"],
      only
    }
  };
};

module.exports = class extends Generator {
  prompting() {
    const prompts = [
      {
        type: "input",
        name: "projectName",
        message: "What's your project name?",
        default: "node-api-boilerplate",
        filter(words) {
          return changeCase.paramCase(words);
        }
      },
      {
        type: "confirm",
        name: "enabledGitlabCI",
        message: "Would you like to enable the GitlabCI?",
        default: true
      },
      {
        type: "confirm",
        name: "enabledConductor",
        message: "Would you like to enable the Conductor?",
        default: true
      },
      {
        type: "confirm",
        name: "enabledElasticsearch",
        message: "Would you like to enable the Elasticsearch?",
        default: true
      },
      {
        type: "confirm",
        name: "enabledMongoose",
        message: "Would you like to enable the Mongoose?",
        default: true
      },
      {
        type: "confirm",
        name: "enabledRascal",
        message: "Would you like to enable the Rascal (AMQP)?",
        default: true
      },
      {
        type: "confirm",
        name: "enabledRedis",
        message: "Would you like to enable the Redis?",
        default: true
      }
    ];

    return this.prompt(prompts).then(props => {
      this.props = props;
    });
  }

  async cloneBoilerplate() {
    this.log("Cloning: https://github.com/devit-tel/node-api-boilerplate.git");
    const repository = await git.Clone.clone(
      "https://github.com/devit-tel/node-api-boilerplate.git",
      this.props.projectName
    );

    return git.Remote.setUrl(
      repository,
      "origin",
      `https://gitlab.com/sendit-th/${this.props.projectName}.git`
    );
  }

  createDeployments() {
    if (this.props.enabledGitlabCI) {
      for (const env of [ENVS.DEVELOPMENT, ENVS.STAGING, ENVS.PRODUCTION]) {
        const deploy = generateDeployment(env, this.props);
        this.fs.write(
          `${this.props.projectName}/deployment/values-${env}.yaml`,
          yaml.stringify(deploy)
        );
      }
      this.fs.write(
        `${this.props.projectName}/.gitlab-ci.yml`,
        yaml.stringify(generateGitlabCI(this.props))
      );
    }
  }

  writing() {
    const packagePath = `${this.props.projectName}/package.json`;
    const entryPath = `${this.props.projectName}/src/index.js`;

    const packageJson = this.fs.readJSON(packagePath);
    let entryFile = this.fs.read(entryPath, { encode: "UTF-8" });
    this.fs.copy(
      `${this.props.projectName}/.env.example`,
      `${this.props.projectName}/.env`
    );

    if (!this.props.enabledConductor) {
      delete packageJson.dependencies["conductor-client"];
      rimraf.sync(`${this.props.projectName}/src/libraries/conductor`);
      entryFile = entryFile.replace("import './libraries/conductor'", "");
    }

    if (!this.props.enabledElasticsearch) {
      delete packageJson.dependencies.elasticsearch;
      rimraf.sync(`${this.props.projectName}/src/libraries/elasticsearch`);
    }

    if (!this.props.enabledMongoose) {
      delete packageJson.dependencies.mongoose;
      delete packageJson.dependencies["sendit-mongoose-repository"];
      rimraf.sync(`${this.props.projectName}/src/libraries/mongoose`);
      rimraf.sync(`${this.props.projectName}/src/models/example`);
      rimraf.sync(`${this.props.projectName}/src/domains/example`);
      rimraf.sync(`${this.props.projectName}/src/controllers/v1/example`);
      entryFile = entryFile.replace("import './libraries/mongoose'", "");
    }

    if (!this.props.enabledRascal) {
      delete packageJson.dependencies.rascal;
      rimraf.sync(`${this.props.projectName}/src/libraries/rascal`);
      rimraf.sync(`${this.props.projectName}/src/constants/rascal`);
      entryFile = entryFile.replace("import './libraries/rascal'", "");
    }

    if (!this.props.enabledRedis) {
      delete packageJson.dependencies.redis;
      delete packageJson.dependencies.bluebird;
      rimraf.sync(`${this.props.projectName}/src/libraries/redis`);
      entryFile = entryFile.replace("import './libraries/redis'", "");
    }

    fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));
    fs.writeFileSync(entryPath, entryFile);
  }

  install() {
    this.log("Installing dependencies");
    this.npmInstall(undefined, undefined, {
      cwd: path.join(process.cwd(), this.props.projectName)
    });
  }
};
