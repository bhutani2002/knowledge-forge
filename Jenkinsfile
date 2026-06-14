pipeline {
    agent any

    environment {
        AWS_DEFAULT_REGION = 'us-east-1'
        ECR_REGISTRY       = 'your-aws-account-id.dkr.ecr.us-east-1.amazonaws.com'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Build & Test Java Services') {
            steps {
                sh 'mvn clean test -DskipTests=false'
            }
        }

        stage('Test Python AI Service') {
            steps {
                sh 'cd services/python-ai-service && pip install -r requirements.txt && pytest'
            }
        }

        stage('Dockerize & Package') {
            steps {
                script {
                    sh 'docker build -t ${ECR_REGISTRY}/kf-api-gateway:latest -f services/api-gateway/Dockerfile.java .'
                    sh 'docker build -t ${ECR_REGISTRY}/kf-auth-service:latest -f services/auth-service/Dockerfile.java .'
                    sh 'docker build -t ${ECR_REGISTRY}/kf-python-ai-service:latest -f services/python-ai-service/Dockerfile.python .'
                }
            }
        }

        stage('Deploy to Staging') {
            steps {
                echo 'Deploying containers to ECS Cluster...'
                // sh 'aws ecs update-service --cluster kf-cluster --service kf-api-gateway --force-new-deployment'
            }
        }
    }

    post {
        always {
            cleanWs()
        }
    }
}
