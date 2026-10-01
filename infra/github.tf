locals {
  repo = "node-whisper-cpp"
}

resource "github_repository_environment" "production" {
  repository  = local.repo
  environment = "production"
}

resource "github_actions_environment_secret" "npm_token" {
  repository  = local.repo
  environment = github_repository_environment.production.environment
  secret_name = "NPM_TOKEN"
  value       = var.npm_token
}

resource "tls_private_key" "release" {
  algorithm = "ED25519"
}

resource "github_repository_deploy_key" "release" {
  repository = local.repo
  title      = "release"
  key        = tls_private_key.release.public_key_openssh
  read_only  = false
}

resource "github_actions_secret" "deploy_key" {
  repository  = local.repo
  secret_name = "DEPLOY_KEY"
  value       = tls_private_key.release.private_key_openssh
}
