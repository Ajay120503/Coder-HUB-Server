const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());

app.get('/', (req, res) => {
    res.send("Server is working");
});

// Maps socket IDs to usernames
const userSocketMap = {};
// Maps usernames to rooms
const userRoomMap = {};
// Maps room IDs to the latest code
const roomCodeMap = {};
// Maps room IDs to the selected language
const roomLanguageMap = {};

// Helper function to get all connected clients in a room
const getAllConnectedClients = (roomId) => {
    const room = io.sockets.adapter.rooms.get(roomId) || [];
    return Array.from(room).map(socketId => ({
        socketId,
        username: userSocketMap[socketId],
    }));
};

io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('join', ({ roomId, username }) => {
        console.log(`User ${username} joining room ${roomId} with socket ID ${socket.id}`);

        // Update maps
        userSocketMap[socket.id] = username;
        userRoomMap[username] = roomId;

        socket.join(roomId);

        // Get the updated list of clients in the room
        const clients = getAllConnectedClients(roomId);
        console.log('Clients in room:', clients);

        // Notify all clients in the room about the new user
        io.to(roomId).emit('updateMembers', {
            clients,
            joinedUser: { socketId: socket.id, username }
        });

        // Send current editor state to the new user
        const roomCode = roomCodeMap[roomId] || "";
        const roomLanguage = roomLanguageMap[roomId] || "javascript";
        socket.emit('editorUpdate', { value: roomCode, language: roomLanguage });
    });

    socket.on('editorChange', ({ roomId, value }) => {
        roomCodeMap[roomId] = value;
        socket.to(roomId).emit('editorUpdate', { value });
    });

    socket.on('languageChange', ({ roomId, language }) => {
        roomLanguageMap[roomId] = language;
        socket.to(roomId).emit('languageUpdate', { language });
    });

    // Use 'disconnect' to handle cleanup and notifications
    socket.on('disconnect', () => {
        const roomId = userRoomMap[userSocketMap[socket.id]];
        const username = userSocketMap[socket.id];

        if (roomId && username) {
            // Remove user from maps
            delete userSocketMap[socket.id];
            delete userRoomMap[username];

            // Get remaining clients in the room
            const remainingClients = getAllConnectedClients(roomId);

            // Notify others in the room about the user leaving
            io.to(roomId).emit('updateMembers', {
                clients: remainingClients,
                leftUser: { socketId: socket.id, username }
            });
        }
    });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
