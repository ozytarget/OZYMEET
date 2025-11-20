/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║                  🎯 SALA DE TRADING 🎯                    ║
 * ║           Professional Video Conference Platform          ║
 * ║                      Version 3.0                          ║
 * ╚═══════════════════════════════════════════════════════════╝
 */

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling']
});

// ═══════════════════════════════════════════════════════════
// MIDDLEWARE & CONFIGURATION
// ═══════════════════════════════════════════════════════════

app.use(express.static('public'));
app.use(express.json());

// Professional logging utility
const Logger = {
    info: (msg, data = '') => console.log(`[${new Date().toISOString()}] ℹ️  ${msg}`, data),
    success: (msg, data = '') => console.log(`[${new Date().toISOString()}] ✅ ${msg}`, data),
    error: (msg, data = '') => console.error(`[${new Date().toISOString()}] ❌ ${msg}`, data),
    warn: (msg, data = '') => console.warn(`[${new Date().toISOString()}] ⚠️  ${msg}`, data),
    user: (msg, data = '') => console.log(`[${new Date().toISOString()}] 👤 ${msg}`, data),
    room: (msg, data = '') => console.log(`[${new Date().toISOString()}] 🏠 ${msg}`, data)
};

// ═══════════════════════════════════════════════════════════
// DATA STRUCTURES
// ═══════════════════════════════════════════════════════════

const MAIN_ROOM = 'TRADING2025'; // Sala única para TODOS
const rooms = new Map();
const users = new Map();

// ═══════════════════════════════════════════════════════════
// HTTP ROUTES
// ═══════════════════════════════════════════════════════════

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

app.get('/room/:roomId', (req, res) => {
    res.sendFile(__dirname + '/public/room.html');
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        stats: {
            activeRooms: rooms.size,
            activeUsers: users.size,
            uptime: process.uptime()
        }
    });
});

// ═══════════════════════════════════════════════════════════
// SOCKET.IO CONNECTION HANDLER
// ═══════════════════════════════════════════════════════════

io.on('connection', (socket) => {
    Logger.success(`Client connected: ${socket.id}`);
    
    socket.on('join-room', ({ roomId, userName, password }) => {
        try {
            // FORZAR que TODOS entren a la MISMA sala
            const actualRoomId = MAIN_ROOM;
            
            if (!userName) {
                socket.emit('error', { message: 'Nombre requerido' });
                return;
            }
            
            Logger.info(`${userName} intentando unirse a ${actualRoomId}`);
            
            let room = rooms.get(actualRoomId);
            
            if (!room) {
                room = {
                    id: actualRoomId,
                    users: new Map(),
                    host: null,
                    createdAt: Date.now(),
                    settings: {
                        maxUsers: 30,
                        allowScreenShare: true,
                        allowRecording: true,
                        allowChat: true
                    }
                };
                rooms.set(actualRoomId, room);
                Logger.room(`Sala creada: ${actualRoomId}`);
            }
            
            if (room.users.size >= room.settings.maxUsers) {
                socket.emit('error', { message: 'Sala llena' });
                return;
            }
            
            // Unir al socket a la sala
            socket.join(actualRoomId);
            
            // Determinar rol
            const isFirstUser = room.users.size === 0;
            const isAdmin = password === '0909'; // Admin detectado por password
            
            const userData = {
                userId: socket.id,
                userName: userName.trim(),
                role: isAdmin ? 'admin' : (isFirstUser ? 'host' : 'guest'),
                roomId: actualRoomId,
                handRaised: false,
                isMuted: false,
                isReady: false,
                joinedAt: Date.now()
            };
            
            room.users.set(socket.id, userData);
            users.set(socket.id, userData);
            
            if (!room.host) {
                room.host = socket.id;
            }
            
            // Obtener lista de usuarios existentes
            const existingUsers = Array.from(room.users.entries())
                .filter(([id]) => id !== socket.id)
                .map(([id, user]) => ({
                    userId: id,
                    userName: user.userName,
                    role: user.role,
                    handRaised: user.handRaised || false,
                    isMuted: user.isMuted || false,
                    isReady: user.isReady || false
                }));
            
            Logger.user(`${userName} (${userData.role}) unido a ${actualRoomId} - Total usuarios: ${room.users.size}`);
            Logger.info(`Usuarios existentes en sala: ${existingUsers.map(u => u.userName).join(', ')}`);
            
            // Notificar al usuario que se unió
            socket.emit('joined-room', {
                success: true,
                userData: userData,
                roomData: {
                    id: actualRoomId,
                    userCount: room.users.size,
                    host: room.host,
                    maxUsers: room.settings.maxUsers,
                    settings: room.settings
                },
                existingUsers: existingUsers
            });
            
            // Notificar a TODOS los demás
            socket.to(actualRoomId).emit('user-connected', {
                userId: userData.userId,
                userName: userData.userName,
                role: userData.role,
                handRaised: false,
                isMuted: false,
                isReady: false
            });
            
            Logger.success(`✅ ${userName} sincronizado con ${existingUsers.length} usuarios`);
            
        } catch (error) {
            Logger.error('Error in join-room:', error.message);
            socket.emit('error', { message: 'Error al unirse' });
        }
    });
    
    socket.on('signal', ({ to, signal, roomId }) => {
        try {
            if (!to || !signal) return;
            
            io.to(to).emit('signal', {
                from: socket.id,
                signal: signal
            });
            
        } catch (error) {
            Logger.error('Error in signal:', error.message);
        }
    });
    
    socket.on('chat-message', ({ roomId, userId, userName, message }) => {
        try {
            if (!message || message.trim().length === 0) return;
            
            const sanitizedMessage = message.trim().slice(0, 500);
            
            socket.to(MAIN_ROOM).emit('chat-message', {
                userId: userId,
                userName: userName,
                message: sanitizedMessage,
                timestamp: Date.now()
            });
            
        } catch (error) {
            Logger.error('Error in chat-message:', error.message);
        }
    });
    
    socket.on('reaction', ({ roomId, userId, userName, emoji }) => {
        try {
            socket.to(MAIN_ROOM).emit('reaction', {
                userId: userId,
                userName: userName,
                emoji: emoji,
                timestamp: Date.now()
            });
            
        } catch (error) {
            Logger.error('Error in reaction:', error.message);
        }
    });
    
    socket.on('draw-line', ({ roomId, fromX, fromY, toX, toY, color }) => {
        try {
            socket.to(MAIN_ROOM).emit('draw-line', {
                fromX, fromY, toX, toY, color
            });
            
        } catch (error) {
            Logger.error('Error in draw-line:', error.message);
        }
    });
    
    socket.on('clear-drawing', ({ roomId }) => {
        try {
            socket.to(MAIN_ROOM).emit('clear-drawing');
            
        } catch (error) {
            Logger.error('Error in clear-drawing:', error.message);
        }
    });
    
    socket.on('disconnect', (reason) => {
        try {
            Logger.warn(`User disconnected: ${socket.id} (${reason})`);
            
            const userData = users.get(socket.id);
            if (!userData) return;
            
            const room = rooms.get(MAIN_ROOM);
            
            if (room) {
                room.users.delete(socket.id);
                
                socket.to(MAIN_ROOM).emit('user-disconnected', socket.id);
                
                Logger.user(`${userData.userName} salió de ${MAIN_ROOM} - Quedan ${room.users.size} usuarios`);
                
                if (room.host === socket.id && room.users.size > 0) {
                    const newHostId = Array.from(room.users.keys())[0];
                    const newHostData = room.users.get(newHostId);
                    
                    room.host = newHostId;
                    newHostData.role = 'host';
                    
                    io.to(MAIN_ROOM).emit('new-host', {
                        userId: newHostId,
                        userName: newHostData.userName
                    });
                    
                    Logger.room(`Nuevo host: ${newHostData.userName}`);
                }
                
                if (room.users.size === 0) {
                    Logger.room(`Sala ${MAIN_ROOM} vacía`);
                }
            }
            
            users.delete(socket.id);
            
        } catch (error) {
            Logger.error('Error in disconnect:', error.message);
        }
    });
});

// ═══════════════════════════════════════════════════════════
// SERVER STARTUP
// ═══════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;

http.listen(PORT, () => {
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════╗');
    console.log('║                                                    ║');
    console.log('║            🎯 SALA DE TRADING 🎯                   ║');
    console.log('║        Professional Video Conference Platform      ║');
    console.log('║                                                    ║');
    console.log('╚════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Local:  http://localhost:${PORT}`);
    console.log(`📊 Health: http://localhost:${PORT}/health`);
    console.log('');
    console.log(`🏠 SALA ÚNICA: ${MAIN_ROOM}`);
    console.log(`🔐 Admin Password: 0909`);
    console.log('');
    console.log('✅ Features Active:');
    console.log('   • Single Room for ALL users');
    console.log('   • Real-time Audio (30 users)');
    console.log('   • Screen Sharing + Drawing');
    console.log('   • Live Chat');
    console.log('   • Emoji Reactions');
    console.log('   • Admin Controls');
    console.log('');
    console.log(`⏰ Started at: ${new Date().toLocaleString()}`);
    console.log('');
});

process.on('SIGTERM', () => {
    Logger.info('SIGTERM received. Shutting down gracefully...');
    
    io.emit('server-shutdown', { message: 'Server is restarting' });
    
    http.close(() => {
        Logger.success('Server closed successfully');
        process.exit(0);
    });
});
