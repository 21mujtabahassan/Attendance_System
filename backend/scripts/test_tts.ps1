Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
foreach ($v in $synth.GetInstalledVoices()) {
    Write-Output $v.VoiceInfo.Name
}
$synth.SetOutputToWaveFile("backend/scripts/test.wav")
$synth.SelectVoice("Microsoft Zira Desktop")
$synth.Rate = 0
$synth.Speak("Welcome to Unique Scholars Academy School Management Portal demo.")
$synth.Dispose()
Write-Output "AUDIO GENERATED SUCCESSFULLY"
