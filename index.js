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
// Maps room IDs to the admin (first user)
const roomAdminMap = {};
// Maps room IDs to lock status
const roomLockMap = {};

// Helper function to get all connected clients in a room
const getAllConnectedClients = (roomId) => {
    const room = io.sockets.adapter.rooms.get(roomId) || [];
    return Array.from(room).map(socketId => ({
        socketId,
        username: userSocketMap[socketId].username,
        joinedAt: userSocketMap[socketId].joinedAt, // Include timestamp
    }));
};

io.on("connection", (socket) => {

    socket.on('join', ({ roomId, username }) => {
        // If the room is locked, deny new connections unless it's the admin reconnecting
        if (roomLockMap[roomId] && roomAdminMap[roomId] !== username) {
            socket.emit('roomLocked');
            return;
        }

        const joinedAt = new Date().toISOString();
        // Update maps
        userSocketMap[socket.id] = { username, joinedAt };
        userRoomMap[username] = roomId;

        socket.join(roomId);

        // If the room is empty (i.e., no admin yet), set the first user as admin
        if (!roomAdminMap[roomId]) {
            roomAdminMap[roomId] = username; // Set first user as admin
        }

        // Get the updated list of clients in the room
        const clients = getAllConnectedClients(roomId);

        // Notify all clients in the room about the new user and admin
        io.to(roomId).emit('updateMembers', {
            clients,
            joinedUser: { socketId: socket.id, username, joinedAt },
            admin: roomAdminMap[roomId], // Send admin info
            isLocked: !!roomLockMap[roomId] // Send the lock status
        });

        // Send current editor state to the new user
        const roomCode = roomCodeMap[roomId] || "";
        const roomLanguage = roomLanguageMap[roomId] || "javascript";
        socket.emit('editorUpdate', { value: roomCode, language: roomLanguage });
    });

    // Admin-only action to lock the room
    socket.on('lockRoom', ({ roomId }) => {
        const adminUsername = roomAdminMap[roomId];

        // Check if the current user is the admin
        if (userSocketMap[socket.id]?.username === adminUsername) {
            roomLockMap[roomId] = true; // Lock the room

            // Notify all clients in the room about the room being locked
            io.to(roomId).emit('roomLockedStatus', {
                isLocked: true,
                admin: adminUsername,
            });
        } else {
            socket.emit('noPermission'); // Send error if non-admin tries to lock the room
        }
    });

    // Admin-only action to unlock the room
    socket.on('unlockRoom', ({ roomId }) => {
        const adminUsername = roomAdminMap[roomId];

        // Check if the current user is the admin
        if (userSocketMap[socket.id]?.username === adminUsername) {
            roomLockMap[roomId] = false; // Unlock the room

            // Notify all clients in the room about the room being unlocked
            io.to(roomId).emit('roomLockedStatus', {
                isLocked: false,
                admin: adminUsername,
            });
        } else {
            socket.emit('noPermission'); // Send error if non-admin tries to unlock the room
        }
    });

    socket.on('editorChange', ({ roomId, value }) => {
        roomCodeMap[roomId] = value; // Update room code
        socket.to(roomId).emit('editorUpdate', { value }); // Broadcast editor changes to others
    });

    socket.on('languageChange', ({ roomId, language }) => {
        roomLanguageMap[roomId] = language; // Update room language
        socket.to(roomId).emit('languageUpdate', { language }); // Broadcast language changes to others
    });

    socket.on('disconnect', () => {
        const roomId = userRoomMap[userSocketMap[socket.id]?.username];
        const username = userSocketMap[socket.id]?.username;

        if (roomId && username) {
            // Remove user from maps
            delete userSocketMap[socket.id];
            delete userRoomMap[username];

            // If the user leaving is the admin, reassign admin to another user in the room
            if (roomAdminMap[roomId] === username) {
                const remainingClients = getAllConnectedClients(roomId);
                if (remainingClients.length > 0) {
                    // Assign the new admin to the first remaining user
                    roomAdminMap[roomId] = remainingClients[0].username;
                } else {
                    // If no one is left in the room, remove the admin and lock status
                    delete roomAdminMap[roomId];
                    delete roomLockMap[roomId];
                }
            }

            // Get remaining clients in the room
            const remainingClients = getAllConnectedClients(roomId);

            // Notify others in the room about the user leaving and update admin info
            io.to(roomId).emit('updateMembers', {
                clients: remainingClients,
                leftUser: { socketId: socket.id, username },
                admin: roomAdminMap[roomId], // Send updated admin info
                isLocked: !!roomLockMap[roomId], // Send updated lock status
            });
        }
    });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
