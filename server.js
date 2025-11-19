const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static('public'));
app.use(express.json());

const rooms = new Map();
const users = new Map();

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

app.get('/room', (req, res) => {
    res.sendFile(__dirname + '/public/room.html');
});

app.post('/create-room', (req, res) => {
    const roomId = generateRoomCode();
    const { password } = req.body;
    
    rooms.set(roomId, {
        id: roomId,
        password: password || null,
        host: null,
        users: new Map(),
        createdAt: Date.now(),
        settings: {
            maxUsers: 30,
            allowScreenShare: true,
            allowRecording: true
        }
    });
    
    res.json({ success: true, roomId: roomId });
});

io.on('connection', (socket) => {
    console.log('✅ Usuario conectado:', socket.id);
    
    socket.on('join-room', ({ roomId, userName, password }) => {
        const room = rooms.get(roomId);
        
        if (!room) {
            socket.emit('error', { message: 'Sala no encontrada' });
            return;
        }
        
        if (room.password && room.password !== password) {
            socket.emit('error', { message: 'Contraseña incorrecta' });
            return;
        }
        
        socket.join(roomId);
        
        const userData = {
            userId: socket.id,
            userName: userName || `Usuario_${socket.id.slice(0, 4)}`,
            role: room.users.size === 0 ? 'host' : 'participant',
            roomId: roomId,
            handRaised: false,
            isMuted: false,
            joinedAt: Date.now()
        };
        
        room.users.set(socket.id, userData);
        users.set(socket.id, userData);
        
        if (!room.host) {
            room.host = socket.id;
            userData.role = 'host';
        }
        
        console.log(`👤 ${userName} se unió a sala ${roomId}`);
        
        socket.emit('joined-room', {
            success: true,
            userData: userData,
            roomData: {
                id: roomId,
                userCount: room.users.size,
                host: room.host
            }
        });
        
        socket.to(roomId).emit('user-connected', userData);
    });
    
    socket.on('user-ready', ({ roomId, userName, role }) => {
        const room = rooms.get(roomId);
        if (!room) return;
        
        const userData = room.users.get(socket.id);
        if (userData) {
            userData.isReady = true;
            socket.to(roomId).emit('user-connected', userData);
        }
    });
    
    socket.on('signal', ({ to, signal, roomId }) => {
        io.to(to).emit('signal', {
            from: socket.id,
            signal: signal
        });
    });
    
    socket.on('screen-share-start', ({ roomId, userName }) => {
        const room = rooms.get(roomId);
        if (!room) return;
        
        console.log(`🖥️ ${userName} compartiendo pantalla`);
        socket.to(roomId).emit('screen-share-started', {
            userId: socket.id,
            userName: userName
        });
    });
    
    socket.on('screen-signal', ({ to, signal, roomId }) => {
        io.to(to).emit('screen-signal', {
            from: socket.id,
            signal: signal
        });
    });
    
    socket.on('screen-share-stop', ({ roomId, userId }) => {
        socket.to(roomId).emit('screen-share-stopped', {
            userId: userId || socket.id
        });
    });
    
    socket.on('mic-status', ({ roomId, userId, isMuted }) => {
        const room = rooms.get(roomId);
        if (!room) return;
        
        const userData = room.users.get(socket.id);
        if (userData) {
            userData.isMuted = isMuted;
            socket.to(roomId).emit('user-mic-status', {
                userId: socket.id,
                isMuted: isMuted
            });
        }
    });
    
    socket.on('chat-message', ({ roomId, userId, userName, message }) => {
        socket.to(roomId).emit('chat-message', {
            userId: userId,
            userName: userName,
            message: message,
            timestamp: Date.now()
        });
    });
    
    socket.on('hand-raised', ({ roomId, userId, userName, raised }) => {
        const room = rooms.get(roomId);
        if (!room) return;
        
        const userData = room.users.get(socket.id);
        if (userData) {
            userData.handRaised = raised;
            socket.to(roomId).emit('hand-raised', {
                userId: socket.id,
                userName: userName,
                raised: raised
            });
        }
    });
    
    socket.on('reaction', ({ roomId, userId, userName, emoji }) => {
        socket.to(roomId).emit('reaction', {
            userId: userId,
            userName: userName,
            emoji: emoji,
            timestamp: Date.now()
        });
    });
    
    socket.on('draw-line', ({ roomId, fromX, fromY, toX, toY, color }) => {
        socket.to(roomId).emit('draw-line', {
            fromX, fromY, toX, toY, color
        });
    });
    
    socket.on('clear-drawing', ({ roomId }) => {
        socket.to(roomId).emit('clear-drawing');
    });
    
    socket.on('update-user', ({ roomId, userId, userName, role }) => {
        const room = rooms.get(roomId);
        if (!room) return;
        
        const userData = room.users.get(socket.id);
        if (userData) {
            userData.userName = userName;
            userData.role = role;
            
            socket.to(roomId).emit('user-updated', {
                userId: socket.id,
                userName: userName,
                role: role
            });
        }
    });
    
    socket.on('disconnect', () => {
        console.log('❌ Usuario desconectado:', socket.id);
        
        const userData = users.get(socket.id);
        if (!userData) return;
        
        const { roomId } = userData;
        const room = rooms.get(roomId);
        
        if (room) {
            room.users.delete(socket.id);
            socket.to(roomId).emit('user-disconnected', socket.id);
            
            console.log(`👋 ${userData.userName} salió de sala ${roomId}`);
            
            if (room.host === socket.id && room.users.size > 0) {
                const newHost = Array.from(room.users.keys())[0];
                room.host = newHost;
                const newHostData = room.users.get(newHost);
                newHostData.role = 'host';
                
                io.to(roomId).emit('new-host', {
                    userId: newHost,
                    userName: newHostData.userName
                });
            }
            
            if (room.users.size === 0) {
                setTimeout(() => {
                    if (room.users.size === 0) {
                        rooms.delete(roomId);
                        console.log(`🗑️ Sala ${roomId} eliminada`);
                    }
                }, 5 * 60 * 1000);
            }
        }
        
        users.delete(socket.id);
    });
});

function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    if (rooms.has(code)) {
        return generateRoomCode();
    }
    
    return code;
}

setInterval(() => {
    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;
    
    rooms.forEach((room, roomId) => {
        if (room.users.size === 0 && (now - room.createdAt) > ONE_HOUR) {
            rooms.delete(roomId);
            console.log(`🗑️ Sala ${roomId} eliminada`);
        }
    });
}, 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;

http.listen(PORT, () => {
    console.log('╔════════════════════════════════════════╗');
    console.log('║        🎯 OZYMEET SERVER 🎯           ║');
    console.log('╚════════════════════════════════════════╝');
    console.log(`🚀 Servidor en puerto ${PORT}`);
    console.log(`🌐 Local: http://localhost:${PORT}`);
    console.log('✅ TOP 10 funcionalidades activas');
});
