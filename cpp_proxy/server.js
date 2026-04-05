const http = require('http');

http.createServer((req, res) => {
  console.log("[BACKEND] Request received");

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    message: "Hello from backend 🚀",
    time: new Date(),
    path: req.url
  }));
}).listen(4000, () => {
  console.log("✅ Backend running on http://localhost:4000");
});