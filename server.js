/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║                  🎯 OZYMEET SERVER PRO 🎯                 ║
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
// AUTHENTICATION SYSTEM
// ═══════════════════════════════════════════════════════════

const authorizedUsers = new Map([
    ['0909', { name: 'Admin', role: 'admin', canCreateUsers: true }]
]);

// ═══════════════════════════════════════════════════════════
// DATA STRUCTURES
// ═══════════════════════════════════════════════════════════

const rooms = new Map();
const users = new Map();
const connectionAttempts = new Map();

// ═══════════════════════════════════════════════════════════
// HTTP ROUTES
// ═══════════════════════════════════════════════════════════

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

app.get('/room/:roomId', (req, res) => {
    res.sendFile(__dirname + '/public/room.html');
});

// Health check endpoint
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
// AUTHENTICATION ENDPOINTS
// ═══════════════════════════════════════════════════════════

app.post('/authenticate', (req, res) => {
    const { roomId, userName, password } = req.body;
    
    Logger.info(`Login attempt: ${userName} with password: ${password}`);
    
    if (!password) {
        return res.json({ success: false, message: 'Password requerido' });
    }
    
    const user = authorizedUsers.get(password);
    
    if (user) {
        Logger.success(`✅ Login exitoso: ${userName} (${user.role})`);
        res.json({ 
            success: true, 
            role: user.role,
            canCreateUsers: user.canCreateUsers 
        });
    } else {
        Logger.warn(`❌ Login fallido: ${userName} - password incorrecto`);
        res.json({ success: false, message: 'Password incorrecto' });
    }
});

// Admin: Create new user
app.post('/admin/create-user', (req, res) => {
    const { adminPassword, newUserName, newUserPassword, newUserRole } = req.body;
    
    Logger.info(`Create user attempt by admin with password: ${adminPassword}`);
    
    const admin = authorizedUsers.get(adminPassword);
    if (!admin || !admin.canCreateUsers) {
        Logger.warn('Unauthorized create user attempt');
        return res.json({ success: false, message: 'No autorizado' });
    }
    
    if (!newUserName || !newUserPassword) {
        return res.json({ success: false, message: 'Datos incompletos' });
    }
    
    authorizedUsers.set(newUserPassword, {
        name: newUserName,
        role: newUserRole || 'participant',
        canCreateUsers: false
    });
    
    Logger.success(`✅ Usuario creado: ${newUserName} (${newUserRole}) - Password: ${newUserPassword}`);
    res.json({ success: true, message: 'Usuario creado exitosamente' });
});

// Admin: List users
app.post('/admin/list-users', (req, res) => {
    const { adminPassword } = req.body;
    
    const admin = authorizedUsers.get(adminPassword);
    if (!admin || !admin.canCreateUsers) {
        return res.json({ success: false, message: 'No autorizado' });
    }
    
    const userList = Array.from(authorizedUsers.entries()).map(([pwd, data]) => ({
        password: pwd === '0909' ? '****' : pwd,
        name: data.name,
        role: data.role
    }));
    
    res.json({ success: true, users: userList });
});

// ═══════════════════════════════════════════════════════════
// SOCKET.IO CONNECTION HANDLER
// ═══════════════════════════════════════════════════════════

io.on('connection', (socket) => {
    Logger.success(`Client connected: ${socket.id}`);
    
    const clientIP = socket.handshake.address;
    const attempts = connectionAttempts.get(clientIP) || 0;
    
    if (attempts > 50) {
        Logger.warn(`Rate limit exceeded for IP: ${clientIP}`);
        socket.emit('error', { message: 'Too many connection attempts' });
        socket.disconnect(true);
        return;
    }
    
    connectionAttempts.set(clientIP, attempts + 1);
    setTimeout(() => connectionAttempts.delete(clientIP), 60000);
    
    socket.on('join-room', ({ roomId, userName, password }) => {
        try {
            if (!roomId || !userName || !password) {
                socket.emit('error', { message: 'Datos incompletos' });
                return;
            }
            
            const user = authorizedUsers.get(password);
            if (!user) {
                socket.emit('error', { message: 'No autorizado' });
                return;
            }
            
            let room = rooms.get(roomId);
            
            if (!room) {
                room = {
                    id: roomId,
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
                rooms.set(roomId, room);
            }
            
            if (room.users.size >= room.settings.maxUsers) {
                socket.emit('error', { message: 'Sala llena' });
                return;
            }
            
            socket.join(roomId);
            
            const isFirstUser = room.users.size === 0;
            const userData = {
                userId: socket.id,
                userName: userName.trim(),
                role: isFirstUser ? 'host' : user.role,
                roomId: roomId,
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
            
            Logger.user(`${userName} (${userData.role}) joined room ${roomId} (${room.users.size}/${room.settings.maxUsers})`);
            
            socket.emit('joined-room', {
                success: true,
                userData: userData,
                roomData: {
                    id: roomId,
                    userCount: room.users.size,
                    host: room.host,
                    maxUsers: room.settings.maxUsers,
                    settings: room.settings
                },
                existingUsers: existingUsers
            });
            
            socket.to(roomId).emit('user-connected', {
                userId: userData.userId,
                userName: userData.userName,
                role: userData.role,
                handRaised: false,
                isMuted: false,
                isReady: false
            });
            
        } catch (error) {
            Logger.error('Error in join-room:', error.message);
            socket.emit('error', { message: 'Error al unirse' });
        }
    });
    
    socket.on('signal', ({ to, signal, roomId }) => {
        try {
            if (!to || !signal || !roomId) return;
            
            const room = rooms.get(roomId);
            if (!room || !room.users.has(socket.id)) return;
            
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
            
            const room = rooms.get(roomId);
            if (!room) return;
            
            const sanitizedMessage = message.trim().slice(0, 500);
            
            socket.to(roomId).emit('chat-message', {
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
            socket.to(roomId).emit('reaction', {
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
            socket.to(roomId).emit('draw-line', {
                fromX, fromY, toX, toY, color
            });
            
        } catch (error) {
            Logger.error('Error in draw-line:', error.message);
        }
    });
    
    socket.on('clear-drawing', ({ roomId }) => {
        try {
            socket.to(roomId).emit('clear-drawing');
            
        } catch (error) {
            Logger.error('Error in clear-drawing:', error.message);
        }
    });
    
    socket.on('disconnect', (reason) => {
        try {
            Logger.warn(`User disconnected: ${socket.id} (${reason})`);
            
            const userData = users.get(socket.id);
            if (!userData) return;
            
            const { roomId } = userData;
            const room = rooms.get(roomId);
            
            if (room) {
                room.users.delete(socket.id);
                
                socket.to(roomId).emit('user-disconnected', socket.id);
                
                Logger.user(`${userData.userName} left room ${roomId} (${room.users.size} remaining)`);
                
                if (room.host === socket.id && room.users.size > 0) {
                    const newHostId = Array.from(room.users.keys())[0];
                    const newHostData = room.users.get(newHostId);
                    
                    room.host = newHostId;
                    newHostData.role = 'host';
                    
                    io.to(roomId).emit('new-host', {
                        userId: newHostId,
                        userName: newHostData.userName
                    });
                    
                    Logger.room(`New host: ${newHostData.userName} in room ${roomId}`);
                }
                
                if (room.users.size === 0) {
                    setTimeout(() => {
                        const currentRoom = rooms.get(roomId);
                        if (currentRoom && currentRoom.users.size === 0) {
                            rooms.delete(roomId);
                            Logger.room(`Room deleted: ${roomId} (empty)`);
                        }
                    }, 5 * 60 * 1000);
                }
            }
            
            users.delete(socket.id);
            
        } catch (error) {
            Logger.error('Error in disconnect:', error.message);
        }
    });
});

// ═══════════════════════════════════════════════════════════
// PERIODIC CLEANUP
// ═══════════════════════════════════════════════════════════

setInterval(() => {
    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;
    let cleanedCount = 0;
    
    rooms.forEach((room, roomId) => {
        if (room.users.size === 0 && (now - room.createdAt) > ONE_HOUR) {
            rooms.delete(roomId);
            cleanedCount++;
        }
    });
    
    if (cleanedCount > 0) {
        Logger.info(`Periodic cleanup: ${cleanedCount} empty rooms deleted`);
    }
    
}, 60 * 60 * 1000);

// ═══════════════════════════════════════════════════════════
// SERVER STARTUP
// ═══════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;

http.listen(PORT, () => {
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════╗');
    console.log('║                                                    ║');
    console.log('║            🎯 OZYMEET SERVER PRO 🎯                ║');
    console.log('║        Professional Video Conference Platform      ║');
    console.log('║                   Version 3.0                      ║');
    console.log('║                                                    ║');
    console.log('╚════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Local:  http://localhost:${PORT}`);
    console.log(`📊 Health: http://localhost:${PORT}/health`);
    console.log('');
    console.log('🔐 AUTHENTICATION SYSTEM ACTIVE');
    console.log(`   Master Password: 0909`);
    console.log(`   Registered users: ${authorizedUsers.size}`);
    console.log('');
    console.log('✅ Features Active:');
    console.log('   • Single Room Authentication');
    console.log('   • Admin User Management');
    console.log('   • Real-time Audio (30 users)');
    console.log('   • Screen Sharing');
    console.log('   • Live Chat');
    console.log('   • Whiteboard');
    console.log('   • Emoji Reactions');
    console.log('');
    console.log(`⏰ Started at: ${new Date().toLocaleString()}`);
    console.log('');
});

process.on('SIGTERM', () => {
    Logger.info('SIGTERM received. Shutting down gracefully...');
    
    io.emit('server-shutdown', { message: 'Server is restarting. Please reconnect in a moment.' });
    
    http.close(() => {
        Logger.success('Server closed successfully');
        process.exit(0);
    });
});


