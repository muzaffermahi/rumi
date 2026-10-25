# Shows Windows' standard "Select folder" dialog (the Explorer-style one) on top of other windows
# and prints the chosen path. Prints nothing when cancelled. Run with: powershell -NoProfile -STA -File pick-folder.ps1
param([string]$Title = 'Choose a folder', [string]$Start = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RumiFolderPicker {
  [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialog {}
  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItem {
    void BindToHandler(); void GetParent();
    void GetDisplayName(uint sigdn, [MarshalAs(UnmanagedType.LPWStr)] out string name);
    void GetAttributes(); void Compare();
  }
  [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFileOpenDialog {
    [PreserveSig] int Show(IntPtr owner);
    void SetFileTypes(); void SetFileTypeIndex(); void GetFileTypeIndex(); void Advise(); void Unadvise();
    void SetOptions(uint fos); void GetOptions(out uint fos);
    void SetDefaultFolder(IShellItem item); void SetFolder(IShellItem item);
    void GetFolder(); void GetCurrentSelection(); void SetFileName(); void GetFileName();
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void SetFileNameLabel();
    void GetResult(out IShellItem item);
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName(string path, IntPtr ctx, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, out IShellItem item);

  public static string Pick(IntPtr owner, string title, string start) {
    var dialog = (IFileOpenDialog)new FileOpenDialog();
    dialog.SetOptions(0x20 | 0x40 | 0x800); // pick folders, file system only, path must exist
    dialog.SetTitle(title);
    dialog.SetOkButtonLabel("Use this folder");
    if (!string.IsNullOrEmpty(start)) {
      try { IShellItem folder; SHCreateItemFromParsingName(start, IntPtr.Zero, typeof(IShellItem).GUID, out folder); dialog.SetFolder(folder); } catch {}
    }
    if (dialog.Show(owner) != 0) return null; // cancelled
    IShellItem result; dialog.GetResult(out result);
    string path; result.GetDisplayName(0x80058000, out path); // SIGDN_FILESYSPATH
    return path;
  }
}
'@
# An invisible topmost owner so the dialog appears in front of the browser.
# It covers the screen so the dialog centres on it.
$owner = New-Object System.Windows.Forms.Form -Property @{TopMost = $true; ShowInTaskbar = $false; Opacity = 0; FormBorderStyle = 'None'; StartPosition = 'Manual'; Bounds = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea}
$owner.Show(); $owner.Activate()
try { $path = [RumiFolderPicker]::Pick($owner.Handle, $Title, $Start) } finally { $owner.Close() }
if ($path) { [Console]::Out.Write($path) }
