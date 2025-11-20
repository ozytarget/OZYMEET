const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files
app.use(express.static('public'));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/room', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

// Room management
const MAIN_ROOM = 'TRADING2025';
const users = new Map();
let currentHost = null;
let screenSharingUser = null;

io.on('connection', (socket) => {
    console.log('New connection:', socket.id);

    socket.on('join-room', ({ roomId, userName }) => {
        // Force main room
        const room = MAIN_ROOM;
        socket.join(room);

        // Determine if user is host
        const isHost = users.size === 0;
        if (isHost) {
            currentHost = socket.id;
        }

        // Add user to map
        users.set(socket.id, { 
            userId: socket.id, 
            userName, 
            isHost,
            isMuted: false 
        });

        // Get existing users
        const existingUsers = Array.from(users.values());

        // Notify user about existing users
        socket.emit('user-connected', {
            userId: socket.id,
            userName,
            isHost,
            existingUsers
        });

        // Notify others about new user
        socket.to(room).emit('user-connected', {
            userId: socket.id,
            userName,
            isHost,
            existingUsers
        });

        // If someone is sharing screen, notify new user
        if (screenSharingUser) {
            const sharer = users.get(screenSharingUser);
            if (sharer) {
                socket.emit('screen-share-active', {
                    userId: screenSharingUser,
                    userName: sharer.userName
                });
            }
        }

        console.log(`${userName} joined room ${room} (Host: ${isHost})`);
    });

    socket.on('signal', ({ roomId, userId, signal }) => {
        io.to(userId).emit('signal', {
            userId: socket.id,
            userName: users.get(socket.id)?.userName,
            signal
        });
    });

    socket.on('screen-share-started', ({ roomId }) => {
        screenSharingUser = socket.id;
        const user = users.get(socket.id);
        socket.to(MAIN_ROOM).emit('screen-share-active', {
            userId: socket.id,
            userName: user?.userName
        });
        console.log(`${user?.userName} started screen sharing`);
    });

    socket.on('screen-share-stopped', ({ roomId }) => {
        if (screenSharingUser === socket.id) {
            screenSharingUser = null;
        }
        socket.to(MAIN_ROOM).emit('screen-share-stopped', {
            userId: socket.id
        });
        console.log('Screen sharing stopped');
    });

    socket.on('user-muted', ({ roomId, isMuted }) => {
        const user = users.get(socket.id);
        if (user) {
            user.isMuted = isMuted;
            socket.to(MAIN_ROOM).emit('user-muted', {
                userId: socket.id,
                isMuted
            });
        }
    });

    socket.on('chat-message', ({ roomId, message }) => {
        const user = users.get(socket.id);
        if (user) {
            socket.to(MAIN_ROOM).emit('chat-message', {
                userId: socket.id,
                userName: user.userName,
                message
            });
        }
    });

    socket.on('floating-emoji', ({ roomId, emoji }) => {
        socket.to(MAIN_ROOM).emit('floating-emoji', {
            userId: socket.id,
            emoji
        });
    });

    socket.on('drawing', ({ roomId, lastX, lastY, x, y, color }) => {
        socket.to(MAIN_ROOM).emit('drawing', {
            lastX, lastY, x, y, color
        });
    });

    socket.on('clear-canvas', ({ roomId }) => {
        socket.to(MAIN_ROOM).emit('clear-canvas');
    });

    // Host controls
    socket.on('mute-user', ({ roomId, userId }) => {
        if (socket.id === currentHost) {
            io.to(userId).emit('force-mute');
            const user = users.get(userId);
            if (user) {
                user.isMuted = true;
                io.to(MAIN_ROOM).emit('user-muted', {
                    userId,
                    isMuted: true
                });
            }
        }
    });

    socket.on('kick-user', ({ roomId, userId }) => {
        if (socket.id === currentHost) {
            io.to(userId).emit('kicked');
            const kickedSocket = io.sockets.sockets.get(userId);
            if (kickedSocket) {
                kickedSocket.disconnect(true);
            }
        }
    });

    socket.on('transfer-host', ({ roomId, userId }) => {
        if (socket.id === currentHost) {
            currentHost = userId;
            const oldHost = users.get(socket.id);
            const newHost = users.get(userId);
            
            if (oldHost) oldHost.isHost = false;
            if (newHost) newHost.isHost = true;

            io.to(MAIN_ROOM).emit('host-transferred', {
                oldHostId: socket.id,
                newHostId: userId,
                users: Array.from(users.values())
            });
        }
    });

    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        users.delete(socket.id);

        if (screenSharingUser === socket.id) {
            screenSharingUser = null;
            io.to(MAIN_ROOM).emit('screen-share-stopped', {
                userId: socket.id
            });
        }

        // Assign new host if needed
        let newHost = null;
        if (currentHost === socket.id && users.size > 0) {
            const firstUser = users.values().next().value;
            currentHost = firstUser.userId;
            firstUser.isHost = true;
            newHost = firstUser;
        }

        io.to(MAIN_ROOM).emit('user-disconnected', {
            userId: socket.id,
            newHost,
            remainingUsers: Array.from(users.values())
        });

        if (user) {
            console.log(`${user.userName} disconnected`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 OZYMEET Server running on port ${PORT}`);
    console.log(`📍 Main room: ${MAIN_ROOM}`);
});
