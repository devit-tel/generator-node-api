"use strict";
const Generator = require("yeoman-generator");
const fs = require("fs");

const compact = arr => arr.filter(f => f);

const generateDeployment = (env, props) => ({
  nodejs: {
    replicaCount: env === "production" ? 3 : 1,
    nameOverride: props.projectName,
    imagePullSecrets: {
      name: "senditregistry"
    },
    image: {
      repository: `registry.dev.sendit.asia/sendit/${props.projectName}`,
      pullPolicy: "Always"
    },
    containerPorts: [80],
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
      httpGet: {
        path: "/system/health",
        port: 80
      }
    },
    type: "ClusterIP",
    default: {
      ports: [
        {
          name: `${env}-${props.projectName}`,
          externalPort: 80,
          internalPort: 80,
          protocol: "TCP"
        }
      ]
    }
  }
});

module.exports = class extends Generator {
  prompting() {
    const prompts = [
      {
        type: "input",
        name: "projectName",
        message: "What's your project name?",
        default: "node-api-boilerplate"
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

  createDeployments() {
    if (this.props.enabledGitlabCI) {
      for (const env of ["development", "staging", "production"]) {
        const deploy = generateDeployment(env, this.props);
      }
    }
  }

  writing() {
    this.fs.copy(
      this.templatePath("dummyfile.txt"),
      this.destinationPath("dummyfile.txt")
    );
  }

  install() {
    // This.installDependencies();
  }
};
