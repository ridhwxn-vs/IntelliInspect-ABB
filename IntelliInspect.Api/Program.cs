using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", policy =>
        policy.AllowAnyOrigin()
              .AllowAnyMethod()
              .AllowAnyHeader());
});

var app = builder.Build();

app.UseCors("AllowAll");

app.MapPost("/upload-dataset", async ([FromForm] IFormFile file) =>
{
    if (file == null || file.Length == 0)
        return Results.BadRequest("No file uploaded.");

    var result = new
    {
        FileName = file.FileName,
        Records = 14704,
        Columns = 5,
        PassRate = 70.5,
        StartDate = "2021-01-01 00:00:00",
        EndDate = "2021-12-31 23:59:59"
    };

    return Results.Ok(result);
});

app.Run();
