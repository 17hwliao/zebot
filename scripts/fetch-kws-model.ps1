$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$name = "sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01"
$root = Join-Path $env:USERPROFILE ".codex-pet\voice"
$archive = Join-Path $root "$name.tar.bz2"
$target = Join-Path $root $name
$appKeywords = Join-Path (Split-Path $PSScriptRoot -Parent) "assets\keywords.txt"
$url = "https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/$name.tar.bz2"

New-Item -ItemType Directory -Force -Path $root | Out-Null

if (-not (Test-Path $target)) {
    if (-not (Test-Path $archive)) {
        Write-Host "Downloading $url"
        Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $archive
    }
    Write-Host "Extracting to $root"
    tar -xjf $archive -C $root
}

Write-Host ""
Write-Host "Model directory: $target"
Write-Host "App keywords file: $appKeywords"
Write-Host ""
Write-Host "Edit the app keywords file for your own wake word, then run npm run voice."
Write-Host "Keyword spelling is defined by the model tokens. Keep the sample file until detection works."

