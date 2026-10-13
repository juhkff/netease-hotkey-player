Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$sessions = $mgr.GetSessions()
Write-Output ("SMTC 会话数: " + $sessions.Count)
foreach ($s in $sessions) {
  $pi = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $tl = $s.GetTimelineProperties()
  Write-Output ("  appId=" + $s.SourceAppUserModelId + " title=" + $pi.Title + " artist=" + $pi.Artist)
  Write-Output ("    pos=" + $tl.Position.TotalSeconds + " end=" + $tl.EndTime.TotalSeconds + " status=" + $s.GetPlaybackInfo().PlaybackStatus)
  Write-Output ("    canSeek=" + $s.GetPlaybackInfo().Controls.IsPlaybackPositionEnabled)
}
