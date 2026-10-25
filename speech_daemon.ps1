$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Speech

# Persistent Speech Synthesizer (loaded once in memory - zero startup lag!)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer

# Persistent Speech Recognizer (loaded once in memory - zero startup lag!)
$rec = $null
try {
  $rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine
  $rec.SetInputToDefaultAudioDevice()
  $grammar = New-Object System.Speech.Recognition.DictationGrammar
  $rec.LoadGrammar($grammar)
  # Fast end-of-speech detection: respond immediately once user stops talking!
  $rec.InitialSilenceTimeout = [TimeSpan]::FromSeconds(2.5)
  $rec.BabbleTimeout = [TimeSpan]::FromSeconds(2.0)
  $rec.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(400)
  $rec.EndSilenceTimeoutAmbiguous = [TimeSpan]::FromMilliseconds(500)
} catch {
  $rec = $null
}

$script:maxLevel = 0
if ($rec) {
  $rec.add_AudioLevelUpdated({
    param($s, $e)
    if ($e.AudioLevel -gt $script:maxLevel) {
      $script:maxLevel = $e.AudioLevel
    }
  })
}

Write-Output '{"type":"ready"}'

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $line = $line.Trim()
  if (-not $line) { continue }

  try {
    $cmd = $line | ConvertFrom-Json
    $id = $cmd.id

    if ($cmd.action -eq 'tts') {
      $vol = [Math]::Max(0, [Math]::Min(100, [int]$cmd.volume))
      $rate = [Math]::Max(-5, [Math]::Min(5, [int]$cmd.rate))
      $synth.Volume = $vol
      $synth.Rate = $rate

      if ($cmd.voiceName) {
        $vMatch = $synth.GetInstalledVoices() | Where-Object {
          $_.VoiceInfo.Name -like "*$($cmd.voiceName)*" -or $cmd.voiceName -like "*$($_.VoiceInfo.Name)*"
        } | Select-Object -First 1
        if ($vMatch) {
          $synth.SelectVoice($vMatch.VoiceInfo.Name)
        }
      }

      $ms = New-Object System.IO.MemoryStream
      $synth.SetOutputToWaveStream($ms)
      $synth.Speak([string]$cmd.text)
      $synth.SetOutputToNull()
      $b64 = [Convert]::ToBase64String($ms.ToArray())
      $ms.Dispose()

      $out = @{
        id = $id
        ok = $true
        audioDataUrl = "data:audio/wav;base64,$b64"
      } | ConvertTo-Json -Compress
      Write-Output $out
    }
    elseif ($cmd.action -eq 'listen') {
      if ($null -eq $rec) {
        $out = @{ id = $id; ok = $false; error = "No microphone recognition device available" } | ConvertTo-Json -Compress
        Write-Output $out
        continue
      }
      $script:maxLevel = 0
      # Recognize returns IMMEDIATELY (~0.4s) after the user stops talking, or after 3s of silence
      $result = $rec.Recognize([TimeSpan]::FromSeconds(3.0))
      $text = if ($result -and $result.Text) { $result.Text } else { "" }
      $conf = if ($result) { [Math]::Round($result.Confidence, 2) } else { 0 }

      $out = @{
        id = $id
        ok = $true
        transcript = $text
        confidence = $conf
        audioLevel = $script:maxLevel
      } | ConvertTo-Json -Compress
      Write-Output $out
    }
  } catch {
    $errOut = @{
      id = $cmd.id
      ok = $false
      error = $_.Exception.Message
    } | ConvertTo-Json -Compress
    Write-Output $errOut
  }
}
