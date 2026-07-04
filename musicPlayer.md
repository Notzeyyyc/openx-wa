// Spotify Album
const params = new URLSearchParams({
  id: "1",
  q: "search term"
});
const url = "https://api.covenant.sbs/api/spotify/album?" + params;

const res = await fetch(url, {
  method: "GET",
  headers: {
    "x-api-key": "YOUR_API_KEY"
  }
});
const data = await res.json();
console.log(data);

// Spotify Artist
const params = new URLSearchParams({
  id: "1"
});
const url = "https://api.covenant.sbs/api/spotify/artist?" + params;

const res = await fetch(url, {
  method: "GET",
  headers: {
    "x-api-key": "YOUR_API_KEY"
  }
});
const data = await res.json();
console.log(data);

// Spotify Downloader
const params = new URLSearchParams({
  q: "search term",
  url: "https://example.com"
});
const url = "https://api.covenant.sbs/api/spotify/download?" + params;

const res = await fetch(url, {
  method: "GET",
  headers: {
    "x-api-key": "YOUR_API_KEY"
  }
});
const data = await res.json();
console.log(data);

// Spotify Search
const params = new URLSearchParams({
  q: "search term",
  limit: "10"
});
const url = "https://api.covenant.sbs/api/spotify/search?" + params;

const res = await fetch(url, {
  method: "GET",
  headers: {
    "x-api-key": "YOUR_API_KEY"
  }
});
const data = await res.json();
console.log(data);
