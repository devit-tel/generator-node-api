"use strict";
const Generator = require("yeoman-generator");
const yaml = require("yaml");
const uuid = require("uuid/v4");
const fs = require("fs");
const changeCase = require("change-case");
const git = require("nodegit");
const path = require("path");

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

  cloneBoilerplate() {
    this.log("Cloning: https://github.com/devit-tel/node-api-boilerplate.git");
    return git.Clone.clone(
      "https://github.com/devit-tel/node-api-boilerplate.git",
      this.props.projectName
    );
  }

  createDeployments() {
    if (this.props.enabledGitlabCI) {
      for (const env of ["development", "staging", "production"]) {
        const deploy = generateDeployment(env, this.props);
        this.fs.write(
          `${this.props.projectName}/deployment/values-${env}.yaml`,
          yaml.stringify(deploy)
        );
      }
    }
  }

  writing() {
    const packagePath = `${this.props.projectName}/package.json`;
    const entryPath = `${this.props.projectName}/src/index.js`;

    const packageJson = this.fs.readJSON(packagePath);
    const entryFile = this.fs.read(entryPath);

    this.fs.copy(
      `${this.props.projectName}/.env.example`,
      `${this.props.projectName}/.env`
    );

    if (!this.props.enabledConductor) {
      delete packageJson.dependencies["conductor-client"];
      fs.unlinkSync(`${this.props.projectName}/src/libraries/conductor`);
      entryFile.replace("import './libraries/conductor'", "");
    }

    if (!this.props.enabledElasticsearch) {
      delete packageJson.dependencies.elasticsearch;
      fs.unlinkSync(`${this.props.projectName}/src/libraries/elasticsearch`);
    }

    if (!this.props.enabledMongoose) {
      delete packageJson.dependencies.mongoose;
      delete packageJson.dependencies["sendit-mongoose-repository"];
      fs.unlinkSync(`${this.props.projectName}/src/libraries/mongoose`);
      entryFile.replace("import './libraries/mongoose'", "");
    }

    if (!this.props.enabledRascal) {
      delete packageJson.dependencies.rascal;
      fs.unlinkSync(`${this.props.projectName}/src/libraries/rascal`);
      fs.unlinkSync(`${this.props.projectName}/src/constants/rascal`);
      entryFile.replace("import './libraries/rascal'", "");
    }

    if (!this.props.enabledRedis) {
      delete packageJson.dependencies.redis;
      delete packageJson.dependencies.bluebird;
      fs.unlinkSync(`${this.props.projectName}/src/libraries/redis`);
      entryFile.replace("import './libraries/redis'", "");
    }

    fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));
  }

  install() {
    this.log("Installing dependencies");
    this.npmInstall(undefined, undefined, {
      cwd: path.join(process.cwd(), this.props.projectName)
    });
  }
};
