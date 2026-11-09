# Health-check local/private Judge0.
# Usage: .\scripts\judge0-health.ps1 [-BaseUrl http://127.0.0.1:2358]
param(
  [string]$BaseUrl = "http://127.0.0.1:2358"
)

$ErrorActionPreference = "Stop"
$BaseUrl = $BaseUrl.TrimEnd("/")
$headers = @{ "Content-Type" = "application/json" }
if ($env:JUDGE0_AUTH_TOKEN) {
  $headers["X-Auth-Token"] = $env:JUDGE0_AUTH_TOKEN
}

Write-Host "Checking Judge0 at $BaseUrl ..."
$about = Invoke-RestMethod -Uri "$BaseUrl/about" -Headers $headers -TimeoutSec 8
Write-Host ("about: " + ($about | ConvertTo-Json -Compress))

$body = '{"source_code":"print(42)","language_id":71}'
$result = Invoke-RestMethod -Method Post `
  -Uri "$BaseUrl/submissions?base64_encoded=false&wait=true" `
  -Headers $headers `
  -Body $body `
  -TimeoutSec 60

Write-Host ("submission: " + ($result | ConvertTo-Json -Compress))
if ($result.status.description -ne "Accepted") {
  throw "ERROR: expected Accepted status, got $($result.status.description)"
}
Write-Host "OK — Judge0 is healthy"
