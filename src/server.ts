import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: { origin: "*" }
});

const rooms = new Map<string, { players: string[], state: any }>();

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("create-room", (code) => {
        rooms.set(code, { players: [socket.id], state: null });
        socket.join(code);
        socket.emit("room-created", code);
    });

    socket.on("join-room", (code) => {
        const room = rooms.get(code);
        if (room && room.players.length < 2) {
            room.players.push(socket.id);
            socket.join(code);
            socket.emit("room-joined", { code, playerIndex: 1 });
            io.to(code).emit("player-joined", { count: 2 });
        } else {
            socket.emit("error", "Room not found or full");
        }
    });

    socket.on("sync-state", ({ code, state }) => {
        const room = rooms.get(code);
        if (room) {
            room.state = state;
            socket.to(code).emit("state-updated", state);
        }
    });

    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
    });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
