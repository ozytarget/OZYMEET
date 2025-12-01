const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static('public'));
app.use(express.json());

// Routes
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

app.get('/room/:room', (req, res) => {
    res.sendFile(__dirname + '/public/room.html');
});

app.get('/api/new-room', (req, res) => {
    res.json({ roomId: uuidv4() });
});

// Socket.io Logic
const rooms = {}; // Track users in rooms: { roomId: [userId, ...] }

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join-room', (roomId, userId, userName) => {
        socket.join(roomId);
        
        if (!rooms[roomId]) {
            rooms[roomId] = [];
        }
        rooms[roomId].push({ id: userId, name: userName, socketId: socket.id });

        // Broadcast to others in the room that a new user connected
        socket.to(roomId).emit('user-connected', userId, userName);

        // Send existing users to the new user
        const usersInRoom = rooms[roomId].filter(user => user.id !== userId);
        socket.emit('all-users', usersInRoom);

        socket.on('disconnect', () => {
            console.log('User disconnected:', socket.id);
            rooms[roomId] = rooms[roomId].filter(user => user.id !== userId);
            socket.to(roomId).emit('user-disconnected', userId);
        });
    });

    // WebRTC Signaling
    socket.on('sending-signal', payload => {
        io.to(payload.userToSignal).emit('user-joined', { signal: payload.signal, callerID: payload.callerID, callerName: payload.callerName });
    });

    socket.on('returning-signal', payload => {
        io.to(payload.callerID).emit('receiving-returned-signal', { signal: payload.signal, id: socket.id });
    });

    // Chat
    socket.on('send-chat-message', (roomId, message, userName) => {
        socket.to(roomId).emit('chat-message', { message, userName, userId: socket.id });
    });

    // Drawing
    socket.on('draw-line', (roomId, data) => {
        socket.to(roomId).emit('draw-line', data);
    });
    
    // Clear Canvas
    socket.on('clear-canvas', (roomId) => {
        socket.to(roomId).emit('clear-canvas');
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
