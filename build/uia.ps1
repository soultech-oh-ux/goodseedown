param([string]$Action = 'list', [string]$Pids = '', [string]$Button = '', [string]$TitleLike = '')
# 시험용: 지정한 프로세스 ID 들의 창(최상위 + 그 안에 붙은 대화상자)과 텍스트·버튼을 UI Automation 으로 읽거나 버튼을 누른다.
# 한글 인자는 인코딩이 깨지므로 환경변수 UIA_BUTTON / UIA_TITLE 로 받는다.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class Win { [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l); }' -ErrorAction SilentlyContinue
if (-not $Button -and $env:UIA_BUTTON) { $Button = $env:UIA_BUTTON }
if (-not $TitleLike -and $env:UIA_TITLE) { $TitleLike = $env:UIA_TITLE }
$ids = @($Pids -split ',' | Where-Object { $_ } | ForEach-Object { [int]$_ })
$AE = [System.Windows.Automation.AutomationElement]
$root = $AE::RootElement
$tops = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
$cands = @()
foreach ($w in $tops) {
  try {
    if ($ids.Count -gt 0 -and ($ids -notcontains $w.Current.ProcessId)) { continue }
    $cands += $w
    $nested = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)))
    foreach ($n in $nested) { $cands += $n }
  } catch { }
}
function IsBtn($e) { $t = $e.Current.ControlType.ProgrammaticName; return ($t -eq 'ControlType.Button' -or $e.Current.ClassName -eq 'CCPushButton') }
$out = @()
foreach ($c in $cands) {
  try {
    $title = $c.Current.Name
    if ($TitleLike -and ($title -notlike "*$TitleLike*")) { continue }
    $all = $c.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $texts = @(); $buttons = @(); $btnEls = @()
    foreach ($e in $all) {
      if (IsBtn $e) { $buttons += $e.Current.Name; $btnEls += $e }
      elseif ($e.Current.ControlType.ProgrammaticName -eq 'ControlType.Text' -and $e.Current.Name) { $texts += $e.Current.Name }
    }
    if ($Action -eq 'click' -and $Button) {
      foreach ($e in $btnEls) {
        if ($e.Current.Name -eq $Button) {
          $done = $false
          try { $p = $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern); $p.Invoke(); $done = $true } catch { }
          if (-not $done) { $h = $e.Current.NativeWindowHandle; if ($h -ne 0) { [void][Win]::SendMessage([IntPtr]$h, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero); $done = $true } }
          if ($done) { ConvertTo-Json -InputObject @([pscustomobject]@{ clicked = $Button; title = $title }) -Compress; exit 0 }
        }
      }
    }
    $out += [pscustomobject]@{ title = $title; cls = $c.Current.ClassName; pid = $c.Current.ProcessId; texts = $texts; buttons = $buttons }
  } catch { }
}
if ($Action -eq 'click') { Write-Output '[]'; exit 2 }
ConvertTo-Json -InputObject @($out) -Compress -Depth 5
