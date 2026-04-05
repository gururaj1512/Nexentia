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

    if (strncmp(buffer, "OPTIONS", 7) == 0) {
        std::string optionsResponse =
            "HTTP/1.1 200 OK\r\n"
            "Access-Control-Allow-Origin: *\r\n"
            "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
            "Access-Control-Allow-Headers: Content-Type\r\n"
            "Content-Length: 0\r\n\r\n";

        send(clientSocket, optionsResponse.c_str(), optionsResponse.size(), 0);
        close(clientSocket);
        return;
    }

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

    send(backendSocket, buffer, bytesRead, 0);
    std::cout << "[PROXY → BACKEND]\n";

    char backendResponse[8192] = {0};
    int backendBytes = read(backendSocket, backendResponse, sizeof(backendResponse));

    std::cout << "[BACKEND → PROXY]\n";

    std::string response(backendResponse, backendBytes);

    std::string corsHeaders =
        "Access-Control-Allow-Origin: *\r\n"
        "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
        "Access-Control-Allow-Headers: Content-Type\r\n";

    size_t pos = response.find("\r\n");
    if (pos != std::string::npos) {
        response.insert(pos + 2, corsHeaders);
    }

    // 📤 Send back to client
    send(clientSocket, response.c_str(), response.size(), 0);
    std::cout << "[PROXY → CLIENT]\n";

    close(backendSocket);
    close(clientSocket);
}

int main() {
    int serverSocket = socket(AF_INET, SOCK_STREAM, 0);

    sockaddr_in serverAddr{};
    serverAddr.sin_family = AF_INET;
    serverAddr.sin_port = htons(PROXY_PORT);
    serverAddr.sin_addr.s_addr = INADDR_ANY;

    bind(serverSocket, (sockaddr*)&serverAddr, sizeof(serverAddr));
    listen(serverSocket, 10);

    std::cout << "🚀 Proxy running on port " << PROXY_PORT << "\n";

    while (true) {
        int clientSocket = accept(serverSocket, nullptr, nullptr);
        handleClient(clientSocket);
    }

    return 0;
}