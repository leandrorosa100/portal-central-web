using System.ComponentModel.DataAnnotations;

namespace Api.Models;

public class City
{
    [Key]
    public int Id { get; set; }
    [Required]
    public string Name { get; set; } = string.Empty;
    public bool IsPrimary { get; set; }
}

public class PinnedNews
{
    [Key]
    public int Id { get; set; }
    [Required]
    public string Title { get; set; } = string.Empty;
    [Required]
    public string Url { get; set; } = string.Empty;
    public string? UrlToImage { get; set; }
    public string? Description { get; set; }
    public string? SourceName { get; set; }
    public DateTime PinnedAt { get; set; } = DateTime.UtcNow;
}

public class Article
{
    [Key]
    public int Id { get; set; }
    [Required]
    public string Title { get; set; } = string.Empty;
    [Required]
    public string Body { get; set; } = string.Empty;
    [Required]
    public string Category { get; set; } = "Geral";
    [Required]
    public string Author { get; set; } = "Redação";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class CreateUserRequest
{
    [Required]
    public string Username { get; set; } = string.Empty;
    [Required]
    public string Password { get; set; } = string.Empty;
    public string Role { get; set; } = "Editor";
}
