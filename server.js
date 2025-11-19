/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║                  🎯 OZYMEET SERVER PRO 🎯                 ║
 * ║           Professional Video Conference Platform          ║
 * ║                      Version 2.0                          ║
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

const rooms = new Map();
const users = new Map();
const connectionAttempts = new Map(); // Track connection attempts for rate limiting

// ═══════════════════════════════════════════════════════════
// HTTP ROUTES
// ═══════════════════════════════════════════════════════════

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

app.get('/room', (req, res) => {
    res.sendFile(__dirname + '/public/room.html');
});

// Health check endpoint for monitoring
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

// Create room endpoint with validation
app.post('/create-room', (req, res) => {
    try {
        const roomId = generateRoomCode();
        const { password } = req.body;
        
        // Validate password if provided
        if (password && (password.length < 4 || password.length > 20)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Password must be between 4-20 characters' 
            });
        }
        
        rooms.set(roomId, {
            id: roomId,
            password: password || null,
            host: null,
            users: new Map(),
            createdAt: Date.now(),
            settings: {
                maxUsers: 30,
                allowScreenShare: true,
                allowRecording: true,
                allowChat: true
            },
            metadata: {
                version: '2.0',
                totalJoins: 0
            }
        });
        
        Logger.room(`Room created: ${roomId} ${password ? '🔒' : '🔓'}`);
        res.json({ success: true, roomId: roomId });
        
    } catch (error) {
        Logger.error('Failed to create room:', error.message);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ═══════════════════════════════════════════════════════════
// SOCKET.IO CONNECTION HANDLER
// ═══════════════════════════════════════════════════════════

io.on('connection', (socket) => {
    Logger.success(`Client connected: ${socket.id}`);
    
    // Rate limiting check (basic implementation)
    const clientIP = socket.handshake.address;
    const attempts = connectionAttempts.get(clientIP) || 0;
    
    if (attempts > 50) {
        Logger.warn(`Rate limit exceeded for IP: ${clientIP}`);
        socket.emit('error', { message: 'Too many connection attempts. Please try again later.' });
        socket.disconnect(true);
        return;
    }
    
    connectionAttempts.set(clientIP, attempts + 1);
    setTimeout(() => connectionAttempts.delete(clientIP), 60000); // Reset after 1 minute
    
    // ═══════════════════════════════════════════════════════
    // JOIN ROOM - CRITICAL FIX FOR USER ISOLATION
    // ═══════════════════════════════════════════════════════
    
    socket.on('join-room', ({ roomId, userName, password }) => {
        try {
            // Validation
            if (!roomId || typeof roomId !== 'string') {
                socket.emit('error', { message: 'Invalid room ID' });
                return;
            }
            
            if (!userName || userName.trim().length === 0) {
                socket.emit('error', { message: 'Username is required' });
                return;
            }
            
            const room = rooms.get(roomId);
            
            if (!room) {
                Logger.warn(`Attempt to join non-existent room: ${roomId}`);
                socket.emit('error', { message: 'Sala no encontrada' });
                return;
            }
            
            // Password check
            if (room.password && room.password !== password) {
                Logger.warn(`Invalid password attempt for room ${roomId}`);
                socket.emit('error', { message: 'Contraseña incorrecta' });
                return;
            }
            
            // Max users check
            if (room.users.size >= room.settings.maxUsers) {
                socket.emit('error', { message: 'Sala llena. Intenta más tarde.' });
                return;
            }
            
            // Join the Socket.IO room
            socket.join(roomId);
            
            // Create user data
            const isFirstUser = room.users.size === 0;
            const userData = {
                userId: socket.id,
                userName: userName.trim().slice(0, 50), // Limit username length
                role: isFirstUser ? 'host' : 'participant',
                roomId: roomId,
                handRaised: false,
                isMuted: false,
                isReady: false,
                joinedAt: Date.now(),
                reconnectAttempts: 0
            };
            
            // Store user data
            room.users.set(socket.id, userData);
            users.set(socket.id, userData);
            
            // Set host if first user
            if (!room.host) {
                room.host = socket.id;
                userData.role = 'host';
            }
            
            // Update metadata
            room.metadata.totalJoins++;
            
            // ✅ CRITICAL FIX: Get list of existing users BEFORE notifying
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
            
            Logger.user(`${userName} joined room ${roomId} (${room.users.size}/${room.settings.maxUsers})`);
            
            if (existingUsers.length > 0) {
                Logger.info(`Existing users in room: ${existingUsers.map(u => u.userName).join(', ')}`);
            }
            
            // ✅ STEP 1: Send confirmation WITH list of existing users
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
                existingUsers: existingUsers // ← KEY: Who's already here
            });
            
            // ✅ STEP 2: Notify others about the new user
            socket.to(roomId).emit('user-connected', {
                userId: userData.userId,
                userName: userData.userName,
                role: userData.role,
                handRaised: false,
                isMuted: false,
                isReady: false
            });
            
            Logger.success(`User sync complete: ${userName} (${existingUsers.length} existing users)`);
            
        } catch (error) {
            Logger.error('Error in join-room:', error.message);
            socket.emit('error', { message: 'Error al unirse a la sala' });
        }
    });
    
    // ═══════════════════════════════════════════════════════
    // USER READY - Enhanced with validation
    // ═══════════════════════════════════════════════════════
    
    socket.on('user-ready', ({ roomId, userName, role }) => {
        try {
            const room = rooms.get(roomId);
            if (!room) {
                Logger.warn(`user-ready: Room ${roomId} not found`);
                return;
            }
            
            const userData = room.users.get(socket.id);
            if (!userData) {
                Logger.warn(`user-ready: User ${socket.id} not in room ${roomId}`);
                return;
            }
            
            userData.isReady = true;
            Logger.info(`User ready: ${userName} in room ${roomId}`);
            
            // Notify others that user is ready for WebRTC
            socket.to(roomId).emit('user-ready', {
                userId: socket.id,
                userName: userData.userName,
                role: userData.role
            });
            
        } catch (error) {
            Logger.error('Error in user-ready:', error.message);
        }
    });
    
    // ═══════════════════════════════════════════════════════
    // WEBRTC SIGNALING - Enhanced with validation
    // ═══════════════════════════════════════════════════════
    
    socket.on('signal', ({ to, signal, roomId }) => {
        try {
            if (!to || !signal || !roomId) {
                Logger.warn('Invalid signal data received');
                return;
            }
            
            const room = rooms.get(roomId);
            if (!room || !room.users.has(socket.id)) {
                Logger.warn(`Signal from unauthorized user: ${socket.id}`);
                return;
            }
            
            // Forward signal to target peer
            io.to(to).emit('signal', {
                from: socket.id,
                signal: signal
            });
            
        } catch (error) {
            Logger.error('Error in signal:', error.message);
        }
    });
    
    // ═══════════════════════════════════════════════════════
    // SCREEN SHARING
    // ═══════════════════════════════════════════════════════
    
    socket.on('screen-share-start', ({ roomId, userName }) => {
        try {
            const room = rooms.get(roomId);
            if (!room) return;
            
            Logger.info(`Screen share started: ${userName} in room ${roomId}`);
            
            socket.to(roomId).emit('screen-share-started', {
                userId: socket.id,
                userName: userName
            });
            
        } catch (error) {
            Logger.error('Error in screen-share-start:', error.message);
        }
    });
    
    socket.on('screen-signal', ({ to, signal, roomId }) => {
        try {
            if (!to || !signal) return;
            
            io.to(to).emit('screen-signal', {
                from: socket.id,
                signal: signal
            });
            
        } catch (error) {
            Logger.error('Error in screen-signal:', error.message);
        }
    });
    
    socket.on('screen-share-stop', ({ roomId, userId }) => {
        try {
            socket.to(roomId).emit('screen-share-stopped', {
                userId: userId || socket.id
            });
            
            Logger.info(`Screen share stopped: ${socket.id} in room ${roomId}`);
            
        } catch (error) {
            Logger.error('Error in screen-share-stop:', error.message);
        }
    });
    
    // ═══════════════════════════════════════════════════════
    // AUDIO/MIC STATUS
    // ═══════════════════════════════════════════════════════
    
    socket.on('mic-status', ({ roomId, userId, isMuted }) => {
        try {
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
            
        } catch (error) {
            Logger.error('Error in mic-status:', error.message);
        }
    });
    
    // ═══════════════════════════════════════════════════════
    // CHAT MESSAGES
    // ═══════════════════════════════════════════════════════
    
    socket.on('chat-message', ({ roomId, userId, userName, message }) => {
        try {
            if (!message || message.trim().length === 0) return;
            
            const room = rooms.get(roomId);
            if (!room || !room.settings.allowChat) return;
            
            // Sanitize message (basic)
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
    
    // ═══════════════════════════════════════════════════════
    // HAND RAISED
    // ═══════════════════════════════════════════════════════
    
    socket.on('hand-raised', ({ roomId, userId, userName, raised }) => {
        try {
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
            
        } catch (error) {
            Logger.error('Error in hand-raised:', error.message);
        }
    });
    
    // ═══════════════════════════════════════════════════════
    // REACTIONS
    // ═══════════════════════════════════════════════════════
    
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
    
    // ═══════════════════════════════════════════════════════
    // DRAWING/WHITEBOARD
    // ═══════════════════════════════════════════════════════
    
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
    
    // ═══════════════════════════════════════════════════════
    // USER UPDATE
    // ═══════════════════════════════════════════════════════
    
    socket.on('update-user', ({ roomId, userId, userName, role }) => {
        try {
            const room = rooms.get(roomId);
            if (!room) return;
            
            const userData = room.users.get(socket.id);
            if (userData) {
                if (userName) userData.userName = userName.trim().slice(0, 50);
                if (role && (role === 'host' || role === 'participant')) userData.role = role;
                
                socket.to(roomId).emit('user-updated', {
                    userId: socket.id,
                    userName: userData.userName,
                    role: userData.role
                });
                
                Logger.info(`User updated: ${userData.userName} (${userData.role})`);
            }
            
        } catch (error) {
            Logger.error('Error in update-user:', error.message);
        }
    });
    
    // ═══════════════════════════════════════════════════════
    // DISCONNECT - Enhanced cleanup
    // ═══════════════════════════════════════════════════════
    
    socket.on('disconnect', (reason) => {
        try {
            Logger.warn(`User disconnected: ${socket.id} (${reason})`);
            
            const userData = users.get(socket.id);
            if (!userData) return;
            
            const { roomId } = userData;
            const room = rooms.get(roomId);
            
            if (room) {
                // Remove user from room
                room.users.delete(socket.id);
                
                // Notify others
                socket.to(roomId).emit('user-disconnected', socket.id);
                
                Logger.user(`${userData.userName} left room ${roomId} (${room.users.size} remaining)`);
                
                // Transfer host if needed
                if (room.host === socket.id && room.users.size > 0) {
                    const newHostId = Array.from(room.users.keys())[0];
                    const newHostData = room.users.get(newHostId);
                    
                    room.host = newHostId;
                    newHostData.role = 'host';
                    
                    io.to(roomId).emit('new-host', {
                        userId: newHostId,
                        userName: newHostData.userName
                    });
                    
                    Logger.room(`New host assigned: ${newHostData.userName} in room ${roomId}`);
                }
                
                // Schedule room cleanup if empty
                if (room.users.size === 0) {
                    setTimeout(() => {
                        const currentRoom = rooms.get(roomId);
                        if (currentRoom && currentRoom.users.size === 0) {
                            rooms.delete(roomId);
                            Logger.room(`Room deleted: ${roomId} (empty)`);
                        }
                    }, 5 * 60 * 1000); // 5 minutes grace period
                }
            }
            
            // Clean up user data
            users.delete(socket.id);
            
        } catch (error) {
            Logger.error('Error in disconnect:', error.message);
        }
    });
    
    // ═══════════════════════════════════════════════════════
    // RECONNECTION HANDLER
    // ═══════════════════════════════════════════════════════
    
    socket.on('reconnect-to-room', ({ roomId, userName, previousId }) => {
        try {
            const room = rooms.get(roomId);
            if (!room) {
                socket.emit('error', { message: 'Room no longer exists' });
                return;
            }
            
            Logger.info(`Reconnection attempt: ${userName} to room ${roomId}`);
            
            // Trigger standard join process
            socket.emit('reconnect-success', { roomId });
            
        } catch (error) {
            Logger.error('Error in reconnect-to-room:', error.message);
        }
    });
});

// ═══════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════

function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    // Ensure uniqueness
    if (rooms.has(code)) {
        return generateRoomCode();
    }
    
    return code;
}

// ═══════════════════════════════════════════════════════════
// PERIODIC CLEANUP TASKS
// ═══════════════════════════════════════════════════════════

// Clean up old empty rooms every hour
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

// Log statistics every 5 minutes
setInterval(() => {
    const totalUsers = Array.from(rooms.values()).reduce((sum, room) => sum + room.users.size, 0);
    Logger.info(`Stats: ${rooms.size} rooms, ${totalUsers} total users, ${users.size} connections`);
}, 5 * 60 * 1000);

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
    console.log('║                                                    ║');
    console.log('╚════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Local:  http://localhost:${PORT}`);
    console.log(`📊 Health: http://localhost:${PORT}/health`);
    console.log('');
    console.log('✅ TOP 10 Professional Features Active:');
    console.log('   • Real-time Audio (30 users)');
    console.log('   • Dual Screen Sharing');
    console.log('   • Interactive Pointer');
    console.log('   • Live Chat');
    console.log('   • Custom Names & Roles');
    console.log('   • Hand Raise System');
    console.log('   • Emoji Reactions');
    console.log('   • Meeting Recording');
    console.log('   • Password Protection');
    console.log('   • Shared Whiteboard');
    console.log('');
    console.log(`⏰ Started at: ${new Date().toLocaleString()}`);
    console.log('');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    Logger.info('SIGTERM received. Shutting down gracefully...');
    
    // Notify all users
    io.emit('server-shutdown', { message: 'Server is restarting. Please reconnect in a moment.' });
    
    http.close(() => {
        Logger.success('Server closed successfully');
        process.exit(0);
    });
});
