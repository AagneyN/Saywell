# Generates a spoken test clip with the built-in Windows speech synthesizer (used by the self-test).
param([string]$Out = "$PSScriptRoot\..\tests\fixtures\dictation.wav")
Add-Type -AssemblyName System.Speech
$dir = Split-Path -Parent $Out
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.Rate = 0
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile($Out, $fmt)
$s.Speak("Hello, this is a test of the dictation app. I would like a pineapple smoothie, and um, a coffee please. Thank you so much.")
$s.Dispose()
Write-Output "wrote $Out"
