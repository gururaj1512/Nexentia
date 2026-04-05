#include <iostream>
#include <string>
#include <cstring>
#include <unistd.h>
#include <arpa/inet.h>

#define PROXY_PORT 3000
#define BACKEND_PORT 4000

void handleClient(int clientSocket) {
    char buffer[8192] = {0};
    int bytesRead = read(clientSocket, buffer, sizeof(buffer));

    if (bytesRead <= 0) {
        close(clientSocket);
        return;
    }

    std::cout << "\n[CLIENT → PROXY]\n" << buffer << "\n";

    std::string requestStr(buffer, bytesRead);

    // Force connection close (simplifies streaming)
    size_t httpPos = requestStr.find("HTTP/1.1");
    if (httpPos != std::string::npos) {
        requestStr.replace(httpPos, 8, "HTTP/1.0");
    }

    size_t connPos = requestStr.find("keep-alive");
    if (connPos != std::string::npos) {
        requestStr.replace(connPos, 10, "close     ");
    }

    // ✅ Handle CORS preflight
    if (strncmp(buffer, "OPTIONS", 7) == 0) {
        std::string optionsResponse =
            "HTTP/1.1 200 OK\r\n"
            "Access-Control-Allow-Origin: *\r\n"
            "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
            "Access-Control-Allow-Headers: Content-Type, Authorization\r\n"
            "Content-Length: 0\r\n\r\n";

        send(clientSocket, optionsResponse.c_str(), optionsResponse.size(), 0);
        close(clientSocket);
        return;
    }

    // 🔌 Connect to backend
    int backendSocket = socket(AF_INET, SOCK_STREAM, 0);

    sockaddr_in backendAddr{};
    backendAddr.sin_family = AF_INET;
    backendAddr.sin_port = htons(BACKEND_PORT);
    backendAddr.sin_addr.s_addr = inet_addr("127.0.0.1");

    if (connect(backendSocket, (sockaddr*)&backendAddr, sizeof(backendAddr)) < 0) {
        std::cerr << "Backend connection failed\n";
        close(clientSocket);
        return;
    }

    // 📤 Send request to backend
    send(backendSocket, requestStr.c_str(), requestStr.size(), 0);
    std::cout << "[PROXY → BACKEND]\n";

    // 📥 Read FULL headers first
    std::string response;
    char temp[4096];
    int bytes;

    bool headersComplete = false;
    while ((bytes = read(backendSocket, temp, sizeof(temp))) > 0) {
        response.append(temp, bytes);

        // Stop after headers are complete
        if (response.find("\r\n\r\n") != std::string::npos) {
            headersComplete = true;
            break;
        }
    }

    std::cout << "[BACKEND → PROXY]\n";

    // ✅ Inject CORS headers correctly
    if (headersComplete) {
        std::string corsHeaders =
            "Access-Control-Allow-Origin: *\r\n"
            "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
            "Access-Control-Allow-Headers: Content-Type, Authorization\r\n";

        size_t pos = response.find("\r\n");
        if (pos != std::string::npos) {
            response.insert(pos + 2, corsHeaders);
        }
    }

    // 📤 Send modified headers + initial body
    send(clientSocket, response.c_str(), response.size(), 0);

    // 📡 Stream remaining body
    while ((bytes = read(backendSocket, temp, sizeof(temp))) > 0) {
        send(clientSocket, temp, bytes, 0);
    }

    std::cout << "[PROXY → CLIENT]\n";

    close(backendSocket);
    close(clientSocket);
}

int main() {
    int serverSocket = socket(AF_INET, SOCK_STREAM, 0);

    // ✅ Allow address reuse to prevent bind errors
    int opt = 1;
    setsockopt(serverSocket, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    sockaddr_in serverAddr{};
    serverAddr.sin_family = AF_INET;
    serverAddr.sin_port = htons(PROXY_PORT);
    serverAddr.sin_addr.s_addr = INADDR_ANY;

    if (bind(serverSocket, (sockaddr*)&serverAddr, sizeof(serverAddr)) < 0) {
        std::cerr << "Bind failed. Port " << PROXY_PORT << " might be in use.\n";
        return 1;
    }
    
    listen(serverSocket, 10);

    std::cout << "🚀 Proxy running on port " << PROXY_PORT << "\n";

    while (true) {
        int clientSocket = accept(serverSocket, nullptr, nullptr);
        handleClient(clientSocket);
    }

    return 0;
}
