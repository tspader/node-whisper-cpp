variable "npm_token" {
  type        = string
  sensitive   = true
  description = "npm granular access token with publish rights on @spader/node-whisper-cpp* and bypass 2FA (TF_VAR_npm_token)."
}
