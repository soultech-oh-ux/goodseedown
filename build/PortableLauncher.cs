using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("goodseedown")]
[assembly: AssemblyDescription("goodseedown Portable Launcher")]
[assembly: AssemblyCompany("goodseed AI LAB")]
[assembly: AssemblyProduct("goodseedown")]
[assembly: AssemblyCopyright("Copyright (c) 2026 굿씨드AI연구소 오경근 박사")]
[assembly: AssemblyVersion("1.2.1.0")]
[assembly: AssemblyFileVersion("1.2.1.0")]

namespace PortableLauncher
{
    internal static class Program
    {
        private const string PackageId = "1.2.1-r1";

        [STAThread]
        private static int Main(string[] args)
        {
            try
            {
                bool prepareOnly = Array.IndexOf(args, "--prepare-only") >= 0;
                string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "goodseedown", "bin");
                string targetDir = Path.Combine(root, PackageId);
                string readyMarker = Path.Combine(targetDir, ".package-ready");
                string exe = Path.Combine(targetDir, "goodseedown.exe");
                bool createdNew;
                using (Mutex mutex = new Mutex(false, @"Local\goodseedown-Prepare-" + PackageId, out createdNew))
                {
                    mutex.WaitOne();
                    try
                    {
                        if (!File.Exists(readyMarker) || !File.Exists(exe))
                        {
                            Directory.CreateDirectory(root);
                            ExtractWithProgress(targetDir, readyMarker);
                        }
                    }
                    finally { mutex.ReleaseMutex(); }
                }
                if (prepareOnly) return 0;
                ProcessStartInfo psi = new ProcessStartInfo(exe, string.Join(" ", args));
                psi.WorkingDirectory = targetDir;
                psi.UseShellExecute = false;
                // 자동 업데이트가 교체할 대상(사용자가 실행한 포터블 exe 의 실제 경로)을 앱에 알려 준다.
                psi.EnvironmentVariables["GOODSEEDOWN_LAUNCHER_EXE"] = Application.ExecutablePath;
                Process.Start(psi);
                return 0;
            }
            catch (Exception ex)
            {
                MessageBox.Show("goodseedown 을(를) 시작하지 못했습니다.\n\n" + ex.Message, "goodseedown", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }

        private static void ExtractWithProgress(string targetDir, string readyMarker)
        {
            Form progressForm = new Form();
            progressForm.Text = "goodseedown 준비";
            progressForm.StartPosition = FormStartPosition.CenterScreen;
            progressForm.FormBorderStyle = FormBorderStyle.FixedDialog;
            progressForm.MaximizeBox = false;
            progressForm.MinimizeBox = false;
            progressForm.ControlBox = false;
            progressForm.ClientSize = new Size(420, 120);
            progressForm.Font = new Font("Malgun Gothic", 9f);
            Label label = new Label();
            label.Text = "처음 실행에 필요한 파일을 준비합니다.\n잠시만 기다려주세요.";
            label.SetBounds(20, 18, 380, 40);
            ProgressBar bar = new ProgressBar();
            bar.Style = ProgressBarStyle.Marquee;
            bar.SetBounds(20, 70, 380, 20);
            progressForm.Controls.Add(label);
            progressForm.Controls.Add(bar);

            Exception workerError = null;
            BackgroundWorker worker = new BackgroundWorker();
            worker.DoWork += delegate { try { ExtractBundle(targetDir, readyMarker); } catch (Exception ex) { workerError = ex; } };
            worker.RunWorkerCompleted += delegate { progressForm.Close(); };
            progressForm.Shown += delegate { worker.RunWorkerAsync(); };
            Application.EnableVisualStyles();
            Application.Run(progressForm);
            if (workerError != null) throw workerError;
            if (!File.Exists(readyMarker)) throw new InvalidOperationException("실행 패키지 준비가 완료되지 않았습니다.");
        }

        private static void ExtractBundle(string targetDir, string readyMarker)
        {
            string temp = targetDir + ".preparing-" + Guid.NewGuid().ToString("N");
            try
            {
                using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("goodseedown.Bundle"))
                {
                    if (s == null) throw new FileNotFoundException("내장 실행 패키지(goodseedown.Bundle)를 찾을 수 없습니다.");
                    Directory.CreateDirectory(temp);
                    using (ZipArchive zip = new ZipArchive(s, ZipArchiveMode.Read))
                    {
                        foreach (ZipArchiveEntry entry in zip.Entries)
                        {
                            string dest = Path.GetFullPath(Path.Combine(temp, entry.FullName.Replace('/', Path.DirectorySeparatorChar)));
                            if (!dest.StartsWith(Path.GetFullPath(temp) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("잘못된 경로 항목: " + entry.FullName);
                            if (entry.FullName.EndsWith("/")) { Directory.CreateDirectory(dest); continue; }
                            Directory.CreateDirectory(Path.GetDirectoryName(dest));
                            entry.ExtractToFile(dest, true);
                        }
                    }
                }
                File.WriteAllText(Path.Combine(temp, ".package-ready"), PackageId);
                if (Directory.Exists(targetDir)) Directory.Delete(targetDir, true);
                Directory.Move(temp, targetDir);
            }
            catch
            {
                try { if (Directory.Exists(temp)) Directory.Delete(temp, true); } catch { }
                throw;
            }
        }
    }
}
