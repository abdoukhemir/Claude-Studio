// Opens a link in a new private (incognito) Chrome window, or Edge InPrivate if Chrome is missing.
// Studio points Claude's BROWSER at it for login tabs, so the sign-in page never reuses the
// claude.ai account the normal browser is signed in to.
using System;
using System.Diagnostics;
using System.IO;

class PrivateBrowser {
  static int Main(string[] args) {
    if (args.Length == 0) return 1;
    string url = args[0].Replace("\"", "%22");
    string chrome = @"C:\Program Files\Google\Chrome\Application\chrome.exe";
    string edge = @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe";
    if (File.Exists(chrome)) Process.Start(chrome, "--incognito --new-window \"" + url + "\"");
    else if (File.Exists(edge)) Process.Start(edge, "--inprivate --new-window \"" + url + "\"");
    else return 1;
    return 0;
  }
}
