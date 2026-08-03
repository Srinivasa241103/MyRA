import { io } from "socket.io-client";

const SOCKET_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:9000";

class SocketService {
  constructor() {
    this.socket = null;
  }

  connect() {
    if (this.socket?.connected) return this.socket;

    const token = localStorage.getItem("myra_auth_token");

    this.socket = io(SOCKET_URL, {
      withCredentials: true,
      auth: token ? { token } : {},
    });

    this.socket.on("disconnect", (reason) => {
      console.warn("WebSocket disconnected:", reason);
    });

    this.socket.on("connect_error", (err) => {
      console.error("WebSocket connection error:", err.message);
    });

    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  getSocket() {
    return this.socket;
  }
}

export default new SocketService();
