# Creates the self-signed HTTPS certificate used when visitors on other
# computers open the app and talk to Buckley through their own microphone.
#
# Browsers only hand out microphone access on secure origins (https:// or
# localhost), so a plain http://192.168.x.x page cannot record audio. This
# script makes a certificate that covers this PC's names and LAN addresses.
#
# Run by server.js automatically the first time; safe to re-run any time
# (for example after the router hands out a new IP address).

param(
  [Parameter(Mandatory = $true)][string]$OutDir
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# ---- Names the certificate should be valid for -----------------------------
$dnsNames = @('localhost', $env:COMPUTERNAME, "$($env:COMPUTERNAME).local")

$ipAddresses = @('127.0.0.1')
try {
  Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    ForEach-Object { $ipAddresses += $_.IPAddress }
} catch {
  # Get-NetIPAddress is missing on very old builds; localhost still works.
}
$ipAddresses = $ipAddresses | Select-Object -Unique

$sanEntries = @()
foreach ($name in $dnsNames) { $sanEntries += "DNS=$name" }
foreach ($ip in $ipAddresses) { $sanEntries += "IPAddress=$ip" }
$sanExtension = "2.5.29.17={text}" + ($sanEntries -join '&')

Write-Output ("Certificate names: " + ($sanEntries -join ', '))

# ---- Create + export --------------------------------------------------------
$cert = New-SelfSignedCertificate `
  -Subject 'CN=Tweed Deerhead (local)' `
  -TextExtension @($sanExtension) `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -NotAfter (Get-Date).AddYears(5) `
  -FriendlyName 'Tweed Deerhead Local HTTPS' `
  -KeyExportPolicy Exportable `
  -KeyUsage DigitalSignature, KeyEncipherment `
  -KeyAlgorithm RSA `
  -KeyLength 2048

$alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
$passwordPlain = -join (1..28 | ForEach-Object { $alphabet[(Get-Random -Maximum $alphabet.Length)] })
$password = ConvertTo-SecureString -String $passwordPlain -AsPlainText -Force

$pfxPath = Join-Path $OutDir 'tweed-deerhead.pfx'
$cerPath = Join-Path $OutDir 'tweed-deerhead.cer'

Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $password | Out-Null
[System.IO.File]::WriteAllText((Join-Path $OutDir 'cert-password.txt'), $passwordPlain)

# Public half only: double-click this to trust the certificate on a visitor's PC.
Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null

# Drop the private key back out of the user's personal store.
Remove-Item -Path $cert.PSPath -Force

Write-Output "Wrote $pfxPath"
Write-Output "Wrote $cerPath"
Write-Output 'OK'
