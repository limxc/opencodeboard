param(
    [string]$ImageName = "opencodeboard",
    [string]$Tag = "latest"
)

$ErrorActionPreference = "Stop"

$tagInput = Read-Host "请输入标签 (默认: latest)"
$Tag = if ([string]::IsNullOrWhiteSpace($tagInput)) { "latest" } else { $tagInput }

$defaultRegistry = "docker.io"
$registryInput = Read-Host "请输入镜像仓库地址 (默认: ${defaultRegistry})"
if ([string]::IsNullOrWhiteSpace($registryInput)) { $registryInput = $defaultRegistry }

$Registry = $registryInput.TrimEnd('/') -replace '^https?://', ''

$usernameInput = Read-Host "请输入 Docker Hub 用户名 (私有仓库可留空)"
$prefix = if ([string]::IsNullOrWhiteSpace($usernameInput)) { "" } else { "${usernameInput}/" }

$Image = "${Registry}/${prefix}${ImageName}:${Tag}"

$domainParts = $Registry -replace ':\d+$', '' -split '\.'
$composeName = if ($domainParts.Count -ge 2) { $domainParts[$domainParts.Count - 2] } else { $domainParts[0] }
$composeImage = if ($Registry -eq "docker.io") { "${prefix}${ImageName}:${Tag}" } else { "${Registry}/${prefix}${ImageName}:${Tag}" }
$composeFile = "docker-compose.${composeName}.yml"
$composePort = if ($env:PORT) { $env:PORT } else { "3000" }

Write-Host ""
Write-Host "正在构建镜像: ${Image}" -ForegroundColor Cyan
docker build --no-cache -t $Image .
if ($LASTEXITCODE -ne 0) {
    Write-Host "构建失败" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "正在推送: ${Image}" -ForegroundColor Cyan
docker push $Image
if ($LASTEXITCODE -ne 0) {
    Write-Host "可能需要登录" -ForegroundColor Yellow
    $username = Read-Host "请输入用户名"
    if ([string]::IsNullOrWhiteSpace($username)) {
        Write-Host "用户名不能为空" -ForegroundColor Red
        exit 1
    }
    $password = Read-Host "请输入密码" -AsSecureString
    $plainPass = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($password))
    Write-Host "执行: docker login $Registry" -ForegroundColor Cyan
    $plainPass | docker login $Registry --username "$username" --password-stdin
    if ($LASTEXITCODE -ne 0) {
        Write-Host "登录失败" -ForegroundColor Red
        exit 1
    }
    Write-Host "登录成功，重新推送" -ForegroundColor Green
    docker push $Image
    if ($LASTEXITCODE -ne 0) {
        Write-Host "推送失败" -ForegroundColor Red
        exit 1
    }
}
Write-Host "推送成功: ${Image}" -ForegroundColor Green

Write-Host ""
Write-Host "正在生成 ${composeFile}" -ForegroundColor Cyan
@"
services:
  app:
    container_name: opencodeboard
    image: ${composeImage}
    ports:
      - "${composePort}:3000"
    environment:
      - PASSWD=123456 #修改为强密码
      - PORT=3000
    volumes:
      - ./data/sqlite:/app/data
    restart: unless-stopped
"@ | Out-File -FilePath $composeFile -Encoding UTF8

Write-Host "生成完毕: ${composeFile}" -ForegroundColor Green
exit 0
