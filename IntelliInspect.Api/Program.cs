using System.Collections.Concurrent;
using System.Globalization;
using System.Text;
using Microsoft.AspNetCore.Http.Features;
using System.Diagnostics;
using System.Text.Json;
using IntelliInspect.Api.Models;

var builder = WebApplication.CreateBuilder(args);

// Allow big uploads
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = long.MaxValue);

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", policy =>
        policy.AllowAnyOrigin()
              .AllowAnyMethod()
              .AllowAnyHeader());
});

// Multipart limits
builder.Services.Configure<FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = long.MaxValue;
});

var cfg = builder.Configuration;

string TrainingScriptPath(string name) =>
    Path.IsPathRooted(name) ? name : Path.Combine(AppContext.BaseDirectory, name);

// default to ML/training.py (recommended)
var trainingScriptRel = cfg["Python:TrainingScript"] ?? Path.Combine("ML", "training.py");
var trainingScript = Path.Combine(AppContext.BaseDirectory, "ML", "training.py");
var simulateScript = Path.Combine(AppContext.BaseDirectory, "ML", "simulate.py");

// choose python exe
var pyExe = OperatingSystem.IsWindows()
    ? cfg["Python:ExeWin"] ?? "python"
    : cfg["Python:Exe"] ?? "python3";

Console.WriteLine($"[Startup] trainingScript: {trainingScript}");
Console.WriteLine($"[Startup] exists: {System.IO.File.Exists(trainingScript)}");
Console.WriteLine($"[Startup] simulateScript: {simulateScript} (exists={System.IO.File.Exists(simulateScript)})");

var app = builder.Build();

app.UseCors("AllowAll");

// In-memory index of uploaded augmented files for the current app lifetime
var fileIndex = new ConcurrentDictionary<string, string>();
var tempRoot = Path.Combine(Path.GetTempPath(), "miniml_uploads");
Directory.CreateDirectory(tempRoot);

app.MapPost("/upload-dataset", async (HttpRequest request) =>
{
    var form = await request.ReadFormAsync();
    var file = form.Files.GetFile("file");
    if (file is null || file.Length == 0)
        return Results.BadRequest(new { message = "No file uploaded." });

    var fileName = file.FileName ?? "dataset.csv";
    var isCsv = fileName.EndsWith(".csv", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(file.ContentType, "text/csv", StringComparison.OrdinalIgnoreCase);
    if (!isCsv)
        return Results.BadRequest(new { message = "Only .csv files are supported." });

    // Save original to temp
    var key = Guid.NewGuid().ToString("N");
    var originalPath = Path.Combine(tempRoot, $"{key}_orig.csv");
    await using (var fs = new FileStream(originalPath, FileMode.CreateNew))
    {
        await file.CopyToAsync(fs);
    }

    // Parse header & rows (streaming)
    string[] headers;
    int columns;
    int tsIdx = -1;
    int responseIdx = -1;
    long records = 0;
    long passCount = 0;
    bool hasTimestamp = false;

    DateTime? minTs = null;
    DateTime? maxTs = null;

    // First pass: read and compute stats; also detect timestamp/response columns
    using (var sr = new StreamReader(originalPath, Encoding.UTF8, true, 1024 * 64))
    {
        var headerLine = await sr.ReadLineAsync();
        if (headerLine == null)
            return Results.BadRequest(new { message = "CSV appears to be empty." });

        headers = SplitCsv(headerLine);
        columns = headers.Length;

        // locate columns (case-insensitive)
        tsIdx = Array.FindIndex(headers, h => string.Equals(h?.Trim(), "timestamp", StringComparison.OrdinalIgnoreCase));
        responseIdx = Array.FindIndex(headers, h => string.Equals(h?.Trim(), "response", StringComparison.OrdinalIgnoreCase));
        hasTimestamp = tsIdx >= 0;

        string? line;
        while ((line = await sr.ReadLineAsync()) != null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            var fields = SplitCsv(line);

            records++;

            // pass rate (Response == "1")
            if (responseIdx >= 0 && responseIdx < fields.Length)
            {
                var resp = fields[responseIdx].Trim();
                if (resp == "1") passCount++;
            }

            // track date range (if timestamp exists)
            if (tsIdx >= 0 && tsIdx < fields.Length)
            {
                if (DateTime.TryParse(fields[tsIdx], CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var dt))
                {
                    if (!minTs.HasValue || dt < minTs.Value) minTs = dt;
                    if (!maxTs.HasValue || dt > maxTs.Value) maxTs = dt;
                }
            }
        }
    }

    // If timestamp missing, create an augmented file with synthetic timestamps
    var finalPath = originalPath;
    if (!hasTimestamp)
    {
        var augmentedPath = Path.Combine(tempRoot, $"{key}.csv");
        var start = DateTime.UtcNow; // synthetic start
        minTs = start;

        long rowIndex = 0;
        using var sr = new StreamReader(originalPath, Encoding.UTF8, true, 1024 * 64);
        using var sw = new StreamWriter(augmentedPath, false, new UTF8Encoding(false));

        var headerLine = await sr.ReadLineAsync();
        await sw.WriteLineAsync($"{headerLine},Timestamp");

        string? line;
        while ((line = await sr.ReadLineAsync()) != null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            var ts = start.AddSeconds(rowIndex++);
            await sw.WriteLineAsync($"{line},{ts:yyyy-MM-dd HH:mm:ss}");
        }

        maxTs = start.AddSeconds(Math.Max(rowIndex - 1, 0));
        finalPath = augmentedPath;
        columns += 1; 
        hasTimestamp = true;
    }

    var passRate = records > 0 ? (double)passCount * 100.0 / records : 0.0;

    fileIndex[key] = finalPath;

    var result = new
    {
        fileKey = key,
        fileName,
        records,
        columns,
        passRate = Math.Round(passRate, 1),
        startDate = (minTs ?? DateTime.UtcNow).ToString("yyyy-MM-dd HH:mm:ss"),
        endDate = (maxTs ?? DateTime.UtcNow).ToString("yyyy-MM-dd HH:mm:ss"),
        hasTimestamp
    };

    return Results.Ok(result);
});

// Train endpoint
app.MapPost("/train-model", async (HttpContext ctx, TrainRequest req) =>
{
    if (string.IsNullOrWhiteSpace(req.fileKey))
        return Results.BadRequest(new { message = "fileKey is required." });

    if (!fileIndex.TryGetValue(req.fileKey, out var csvPath) || !System.IO.File.Exists(csvPath))
        return Results.BadRequest(new { message = "Unknown or expired fileKey." });

    // Basic pre-validation to avoid cryptic Python errors
    static bool LooksLikeDate(string? s) => !string.IsNullOrWhiteSpace(s) && s!.Length >= 19 && s[4] == '-' && s[7] == '-' && s[10] == ' ';
    if (!LooksLikeDate(req.trainStart) || !LooksLikeDate(req.trainEnd) ||
        !LooksLikeDate(req.testStart)  || !LooksLikeDate(req.testEnd))
        return Results.BadRequest(new { message = "Dates must be 'yyyy-MM-dd HH:mm:ss'." });

    var scriptFull = Path.GetFullPath(trainingScript); 
    if (!System.IO.File.Exists(scriptFull))
        return Results.Problem($"training.py not found at {scriptFull}", statusCode: 500);

    var psi = new ProcessStartInfo
    {
        FileName = pyExe,                      
        UseShellExecute = false,
        RedirectStandardOutput = true,
        RedirectStandardError  = true,
        CreateNoWindow = true,
        WorkingDirectory = Path.GetDirectoryName(scriptFull)!,
    };
    psi.Environment["PYTHONUNBUFFERED"] = "1";

    psi.ArgumentList.Add(scriptFull);
    psi.ArgumentList.Add("--csv");         psi.ArgumentList.Add(csvPath);
    psi.ArgumentList.Add("--train-start"); psi.ArgumentList.Add(req.trainStart);
    psi.ArgumentList.Add("--train-end");   psi.ArgumentList.Add(req.trainEnd);
    psi.ArgumentList.Add("--test-start");  psi.ArgumentList.Add(req.testStart);
    psi.ArgumentList.Add("--test-end");    psi.ArgumentList.Add(req.testEnd);

    try
    {
        using var proc = Process.Start(psi);
        if (proc is null)
            return Results.Problem($"Failed to start '{pyExe}'.", statusCode: 500);

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ctx.RequestAborted);
        cts.CancelAfter(TimeSpan.FromMinutes(30)); // safety timeout

        Task<string> stdoutTask = proc.StandardOutput.ReadToEndAsync(cts.Token);
        Task<string> stderrTask = proc.StandardError.ReadToEndAsync(cts.Token);
        await Task.WhenAll(proc.WaitForExitAsync(cts.Token), stdoutTask, stderrTask);

        var stdout = await stdoutTask;
        var stderr = await stderrTask;

        if (proc.ExitCode != 0)
        {
            return Results.Json(new
            {
                message = $"Training failed (exit={proc.ExitCode}).",
                script  = scriptFull,
                pyExe,
                stderr,
                stdout
            }, statusCode: 500);
        }

        return Results.Content(stdout, "application/json");
    }
    catch (System.ComponentModel.Win32Exception ex)
    {
        return Results.Json(new
        {
            message = $"Unable to start '{pyExe}'. Is Python installed and on PATH?",
            pyExe,
            error = ex.Message
        }, statusCode: 500);
    }
    catch (OperationCanceledException)
    {
        try { Process.GetProcessesByName(pyExe).ToList().ForEach(p => { try { p.Kill(true); } catch { } }); } catch { }
        return Results.Json(new { message = "Training timed out." }, statusCode: 500);
    }
    catch (Exception ex)
    {
        return Results.Json(new { message = "Unhandled server error.", error = ex.ToString() }, statusCode: 500);
    }
});

// Simulation endpoint
app.MapPost("/simulate", async (HttpContext ctx, SimulationRequest req) =>
{
    if (string.IsNullOrWhiteSpace(req.fileKey))
        return Results.BadRequest(new { message = "fileKey is required." });

    if (!fileIndex.TryGetValue(req.fileKey, out var csvPath) || !System.IO.File.Exists(csvPath))
        return Results.BadRequest(new { message = "Unknown or expired fileKey." });

    static bool LooksLikeDate(string? s) => !string.IsNullOrWhiteSpace(s) && s!.Length >= 19 && s[4] == '-' && s[7] == '-' && s[10] == ' ';
    if (!LooksLikeDate(req.trainStart) || !LooksLikeDate(req.trainEnd) ||
        !LooksLikeDate(req.simStart)   || !LooksLikeDate(req.simEnd))
        return Results.BadRequest(new { message = "Dates must be 'yyyy-MM-dd HH:mm:ss'." });

    var scriptFull = Path.GetFullPath(simulateScript);
    if (!System.IO.File.Exists(scriptFull))
        return Results.Problem($"simulate.py not found at {scriptFull}", statusCode: 500);

    var psi = new ProcessStartInfo
    {
        FileName = pyExe,
        UseShellExecute = false,
        RedirectStandardOutput = true,
        RedirectStandardError  = true,
        CreateNoWindow = true,
        WorkingDirectory = Path.GetDirectoryName(scriptFull)!,
    };
    psi.Environment["PYTHONUNBUFFERED"] = "1";

    psi.ArgumentList.Add(scriptFull);
    psi.ArgumentList.Add("--csv");         psi.ArgumentList.Add(csvPath);
    psi.ArgumentList.Add("--train-start"); psi.ArgumentList.Add(req.trainStart);
    psi.ArgumentList.Add("--train-end");   psi.ArgumentList.Add(req.trainEnd);
    psi.ArgumentList.Add("--sim-start");   psi.ArgumentList.Add(req.simStart);
    psi.ArgumentList.Add("--sim-end");     psi.ArgumentList.Add(req.simEnd);
    psi.ArgumentList.Add("--max-rows");    psi.ArgumentList.Add((req.maxRows ?? 600).ToString());

    try
    {
        using var proc = Process.Start(psi);
        if (proc is null)
            return Results.Problem($"Failed to start '{pyExe}'.", statusCode: 500);

        using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(30));
        var stdoutTask = proc.StandardOutput.ReadToEndAsync(cts.Token);
        var stderrTask = proc.StandardError.ReadToEndAsync(cts.Token);
        await Task.WhenAll(proc.WaitForExitAsync(cts.Token), stdoutTask, stderrTask);

        var stdout = await stdoutTask;
        var stderr = await stderrTask;

        if (proc.ExitCode != 0)
        {
            return Results.Json(new
            {
                message = $"Simulation failed (exit={proc.ExitCode}).",
                script  = scriptFull,
                pyExe,
                stderr,
                stdout
            }, statusCode: 500);
        }

        // simulate.py prints a JSON array of rows
        return Results.Content(stdout, "application/json");
    }
    catch (Exception ex)
    {
        return Results.Json(new { message = "Unhandled server error.", error = ex.ToString() }, statusCode: 500);
    }
});

app.MapGet("/", () => Results.Ok("MiniML API running."));

app.MapGet("/_diag/python", () =>
{
    static (int code, string so, string se) Run(string exe, params string[] args) {
        var psi = new ProcessStartInfo { FileName = exe, UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)!;
        var so = p.StandardOutput.ReadToEnd();
        var se = p.StandardError.ReadToEnd();
        p.WaitForExit();
        return (p.ExitCode, so, se);
    }

    var ver = Run(pyExe, "--version");
    var imp = Run(pyExe, "-c", "import json,sys; import pandas,sklearn; print(json.dumps({'ok':True,'pandas':pandas.__version__,'sklearn':sklearn.__version__}))");
    return Results.Ok(new {
        pyExe,
        version_exit = ver.code, version_out = ver.so, version_err = ver.se,
        import_exit = imp.code, import_out = imp.so, import_err = imp.se
    });
});

app.Run();


static string[] SplitCsv(string line)
{
    var fields = new List<string>();
    var sb = new StringBuilder();
    bool inQuotes = false;

    for (int i = 0; i < line.Length; i++)
    {
        var ch = line[i];

        if (ch == '\"')
        {
            if (inQuotes && i + 1 < line.Length && line[i + 1] == '\"')
            {
                // escaped quote
                sb.Append('\"');
                i++;
            }
            else
            {
                inQuotes = !inQuotes;
            }
        }
        else if (ch == ',' && !inQuotes)
        {
            fields.Add(sb.ToString());
            sb.Clear();
        }
        else
        {
            sb.Append(ch);
        }
    }
    fields.Add(sb.ToString());
    return fields.ToArray();
}
