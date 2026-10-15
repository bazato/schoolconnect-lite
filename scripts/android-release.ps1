[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Initialize', 'Build')][string]$Action,
    [string]$SigningDirectory = (Join-Path $env:USERPROFILE '.nexqon-signing'),
    [string]$BuildDirectory,
    [string]$JavaDirectory = 'C:\Program Files\Android\Android Studio\jbr',
    [string]$SdkDirectory = 'C:\AndroidSDKInstall',
    [string]$ApiUrl = 'https://schoolconnect-demo-api.onrender.com/api/v1'
)
$ErrorActionPreference = 'Stop'
$signingPath = [IO.Path]::GetFullPath($SigningDirectory)
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ($signingPath.StartsWith($repository, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Signing material must be outside the repository.'
}
$keyPath = Join-Path $signingPath 'nexqon-android-release.p12'
$credentialPath = Join-Path $signingPath 'nexqon-android.credentials.clixml'
$keytool = Join-Path $JavaDirectory 'bin\keytool.exe'
$environmentNames = @('NEXQON_ANDROID_STORE_FILE', 'NEXQON_ANDROID_STORE_PASSWORD', 'NEXQON_ANDROID_KEY_ALIAS', 'NEXQON_ANDROID_KEY_PASSWORD', 'JAVA_HOME', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'NODE_ENV', 'EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_DEMO_MODE')
$previous = @{}
foreach ($name in $environmentNames) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    if ($Action -eq 'Initialize') {
        if (Test-Path -LiteralPath $signingPath) { throw 'Signing directory already exists. Refusing to overwrite permanent signing material.' }
        New-Item -ItemType Directory -Path $signingPath | Out-Null
        $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
        $acl = New-Object Security.AccessControl.DirectorySecurity
        $acl.SetOwner($sid)
        $acl.SetAccessRuleProtection($true, $false)
        $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
        $propagate = [Security.AccessControl.PropagationFlags]::None
        $allow = [Security.AccessControl.AccessControlType]::Allow
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', $inherit, $propagate, $allow)))
        $systemSid = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($systemSid, 'FullControl', $inherit, $propagate, $allow)))
        Set-Acl -LiteralPath $signingPath -AclObject $acl
        $randomBytes = New-Object byte[] 48
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($randomBytes) } finally { $rng.Dispose() }
        $password = [Convert]::ToBase64String($randomBytes)
        $secure = ConvertTo-SecureString $password -AsPlainText -Force
        $credential = New-Object Management.Automation.PSCredential('nexqon-release', $secure)
        # Windows DPAPI: decryptable only by this Windows account on this machine.
        $credential | Export-Clixml -LiteralPath $credentialPath
        $env:NEXQON_ANDROID_STORE_PASSWORD = $password
        & $keytool -genkeypair -keystore $keyPath -storetype PKCS12 -alias nexqon-release -keyalg RSA -keysize 3072 -sigalg SHA256withRSA -validity 10000 -dname 'CN=Nexqon School App, O=Nexqon' -storepass:env NEXQON_ANDROID_STORE_PASSWORD -keypass:env NEXQON_ANDROID_STORE_PASSWORD -noprompt
        if ($LASTEXITCODE -ne 0) { throw 'Key generation failed; preserve this folder and investigate without overwriting it.' }
        & $keytool -exportcert -rfc -keystore $keyPath -alias nexqon-release -storepass:env NEXQON_ANDROID_STORE_PASSWORD -file (Join-Path $signingPath 'nexqon-release-public.pem')
        if ($LASTEXITCODE -ne 0) { throw 'Public certificate export failed.' }
        Write-Output "Permanent key created outside Git: $keyPath"
        Write-Output 'Password is DPAPI-protected locally. A portable offline backup of the key AND password is still required; do not send either in chat.'
    } else {
        if (!(Test-Path -LiteralPath $keyPath) -or !(Test-Path -LiteralPath $credentialPath)) { throw 'Permanent signing material is missing.' }
        if (!$BuildDirectory) { throw 'BuildDirectory is required.' }
        $buildPath = (Resolve-Path -LiteralPath $BuildDirectory).Path
        $gradle = Join-Path $buildPath 'apps\mobile\android\gradlew.bat'
        if (!(Test-Path -LiteralPath $gradle)) { throw 'Run Expo prebuild in the isolated build checkout first.' }
        $appGradle = Join-Path $buildPath 'apps\mobile\android\app\build.gradle'
        if ((Get-Content -LiteralPath $appGradle -Raw) -notmatch 'nexqon-release-signing:start') {
            throw 'Native project lacks permanent signing configuration. Regenerate it with Expo prebuild; historical debug-signed native trees are not accepted.'
        }
        $credential = Import-Clixml -LiteralPath $credentialPath
        $env:NEXQON_ANDROID_STORE_FILE = $keyPath
        $env:NEXQON_ANDROID_STORE_PASSWORD = $credential.GetNetworkCredential().Password
        $env:NEXQON_ANDROID_KEY_ALIAS = $credential.UserName
        $env:NEXQON_ANDROID_KEY_PASSWORD = $env:NEXQON_ANDROID_STORE_PASSWORD
        $env:JAVA_HOME = $JavaDirectory
        $env:ANDROID_HOME = $SdkDirectory
        $env:ANDROID_SDK_ROOT = $SdkDirectory
        $env:NODE_ENV = 'production'
        $env:EXPO_PUBLIC_API_URL = $ApiUrl
        $env:EXPO_PUBLIC_DEMO_MODE = 'false'
        Push-Location (Split-Path -Parent $gradle)
        try {
            & $gradle app:assembleRelease --no-daemon --max-workers=2 --console=plain '-PreactNativeArchitectures=arm64-v8a,armeabi-v7a' '-Pkotlin.compiler.execution.strategy=in-process'
            if ($LASTEXITCODE -ne 0) { throw 'Android release build failed.' }
            $apk = Join-Path $buildPath 'apps\mobile\android\app\build\outputs\apk\release\app-release.apk'
            $certificate = & $keytool '-J-Duser.language=en' -printcert -file (Join-Path $signingPath 'nexqon-release-public.pem')
            if ($LASTEXITCODE -ne 0) { throw 'Cannot read permanent public certificate.' }
            $fingerprintMatch = [regex]::Match(($certificate -join "`n"), 'SHA256:\s*([A-Fa-f0-9:]+)')
            if (!$fingerprintMatch.Success) { throw 'Permanent public certificate fingerprint missing.' }
            $fingerprint = $fingerprintMatch.Groups[1].Value.Replace(':', '').ToLowerInvariant()
            $verified = & (Join-Path $SdkDirectory 'build-tools\36.0.0\apksigner.bat') verify --verbose --print-certs $apk
            if ($LASTEXITCODE -ne 0 -or ($verified -join "`n") -notmatch [regex]::Escape($fingerprint) -or ($verified -join "`n") -match 'Android Debug') {
                throw 'APK does not verify against the permanent release certificate.'
            }
            Write-Output "APK permanent certificate verified: $fingerprint"
        } finally { Pop-Location }
    }
} finally {
    foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
    $password = $null
    $credential = $null
}
