param(
  [Parameter(Mandatory)] [string] $Action,
  [int] $ProcessId = 0,
  [string] $Text = ''
)

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class BoardWin {
  delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  public static IntPtr Find(uint processId) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid != processId) return true;
      var sb = new StringBuilder(256); GetWindowText(h, sb, 256);
      if (sb.ToString() == "Appunto") { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  const uint UP = 0x0002;
  public static void Hotkey() {
    keybd_event(0x11, 0, 0, UIntPtr.Zero); // Ctrl
    keybd_event(0x12, 0, 0, UIntPtr.Zero); // Alt
    keybd_event(0x20, 0, 0, UIntPtr.Zero); // Space
    keybd_event(0x20, 0, UP, UIntPtr.Zero);
    keybd_event(0x12, 0, UP, UIntPtr.Zero);
    keybd_event(0x11, 0, UP, UIntPtr.Zero);
  }
  public static void Key(byte vk) {
    keybd_event(vk, 0, 0, UIntPtr.Zero);
    keybd_event(vk, 0, UP, UIntPtr.Zero);
  }
}
'@

$hwnd = [BoardWin]::Find([uint32]$ProcessId)
switch ($Action) {
  'state' {
    $rect = New-Object BoardWin+RECT
    [void][BoardWin]::GetWindowRect($hwnd, [ref]$rect)
    [pscustomobject]@{
      found = ($hwnd -ne [IntPtr]::Zero)
      visible = [BoardWin]::IsWindowVisible($hwnd)
      foreground = ([BoardWin]::GetForegroundWindow() -eq $hwnd)
      rect = "$($rect.Left),$($rect.Top),$($rect.Right),$($rect.Bottom)"
    } | ConvertTo-Json -Compress
  }
  'hotkey' { [BoardWin]::Hotkey(); 'sent' }
  'type' {
    # Types letters only when the board is the foreground window, never elsewhere.
    if ([BoardWin]::GetForegroundWindow() -ne $hwnd) { 'skipped: board not in front'; break }
    foreach ($ch in $Text.ToUpper().ToCharArray()) { [BoardWin]::Key([byte][char]$ch) }
    'typed'
  }
  'escape' {
    if ([BoardWin]::GetForegroundWindow() -ne $hwnd) { 'skipped: board not in front'; break }
    [BoardWin]::Key(0x1B); 'sent'
  }
}
