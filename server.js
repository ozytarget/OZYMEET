const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(express.static('public'));
app.use(express.json());

// Almacenar datos de salas y usuarios
const rooms = new Map();
const users = new Map();

// ===== RUTAS =====
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

app.get('/room', (req, res) => {
    res.sendFile(__dirname + '/public/room.html');
});

// API: Crear sala
app.post('/create-room', (req, res) => {
    const roomId = generateRoomCode();
    const { password, hostName } = req.body;
    
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
    
    res.json({ 
        success: true, 
        roomId: roomId,
        message: 'Sala creada exitosamente'
    });
});

// API: Validar sala
app.get('/validate-room/:roomId', (req, res) => {
    const { roomId } = req.params;
    const room = rooms.get(roomId);
    
    if (room) {
        res.json({
            success: true,
            hasPassword: !!room.password,
            userCount: room.users.size
        });
    } else {
        res.json({
            success: false,
            message: 'Sala no encontrada'
        });
    }
});

// ===== SOCKET.IO - EVENTOS EN TIEMPO REAL =====
io.on('connection', (socket) => {
    console.log('✅ Usuario conectado:', socket.id);
    
    // ===== UNIRSE A SALA =====
    socket.on('join-room', ({ roomId, userName, password }) => {
        const room = rooms.get(roomId);
        
        if (!room) {
            socket.emit('error', { message: 'Sala no encontrada' });
            return;
        }
        
        // Validar contraseña
        if (room.password && room.password !== password) {
            socket.emit('error', { message: 'Contraseña incorrecta' });
            return;
        }
        
        // Validar capacidad
        if (room.users.size >= room.settings.maxUsers) {
            socket.emit('error', { message: 'Sala llena' });
            return;
        }
        
        // Agregar usuario a la sala
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
        
        // Si es el primer usuario, asignarlo como host
        if (!room.host) {
            room.host = socket.id;
            userData.role = 'host';
        }
        
        console.log(`👤 ${userName} se unió a sala ${roomId} (Total: ${room.users.size})`);
        
        // Notificar al usuario que se unió exitosamente
        socket.emit('joined-room', {
            success: true,
            userData: userData,
            roomData: {
                id: roomId,
                userCount: room.users.size,
                host: room.host
            }
        });
        
        // Notificar a todos los demás usuarios
        socket.to(roomId).emit('user-connected', userData);
    });
    
    // ===== USUARIO LISTO (con audio) =====
    socket.on('user-ready', ({ roomId, userName, role }) => {
        const room = rooms.get(roomId);
        if (!room) return;
        
        const userData = room.users.get(socket.id);
        if (userData) {
            userData.isReady = true;
            socket.to(roomId).emit('user-connected', userData);
        }
    });
    
    // ===== SEÑALIZACIÓN WEBRTC =====
    socket.on('signal', ({ to, signal, roomId }) => {
        io.to(to).emit('signal', {
            from: socket.id,
            signal: signal
        });
    });
    
    // ===== PANTALLA COMPARTIDA =====
    socket.on('screen-share-start', ({ roomId, userName }) => {
        const room = rooms.get(roomId);
        if (!room) return;
        
        console.log(`🖥️ ${userName} está compartiendo pantalla en sala ${roomId}`);
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
    
    // ===== ESTADO DEL MICRÓFONO =====
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
    
    // ===== CHAT =====
    socket.on('chat-message', ({ roomId, userId, userName, message }) => {
        const room = rooms.get(roomId);
        if (!room) return;
        
        console.log(`💬 [${roomId}] ${userName}: ${message}`);
        
        socket.to(roomId).emit('chat-message', {
            userId: userId,
            userName: userName,
            message: message,
            timestamp: Date.now()
        });
    });
    
    // ===== LEVANTAR MANO =====
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
            
            console.log(`✋ ${userName} ${raised ? 'levantó' : 'bajó'} la mano`);
        }
    });
    
    // ===== REACCIONES =====
    socket.on('reaction', ({ roomId, userId, userName, emoji }) => {
        socket.to(roomId).emit('reaction', {
            userId: userId,
            userName: userName,
            emoji: emoji,
            timestamp: Date.now()
        });
        
        console.log(`😊 ${userName} reaccionó con ${emoji}`);
    });
    
    // ===== DIBUJO EN CANVAS =====
    socket.on('draw-line', ({ roomId, fromX, fromY, toX, toY, color }) => {
        socket.to(roomId).emit('draw-line', {
            fromX, fromY, toX, toY, color
        });
    });
    
    socket.on('clear-drawing', ({ roomId }) => {
        socket.to(roomId).emit('clear-drawing');
    });
    
    // ===== ACTUALIZAR DATOS DE USUARIO =====
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
            
            console.log(`⚙️ ${userName} actualizó su perfil`);
        }
    });
    
    // ===== PIZARRA COMPARTIDA =====
    socket.on('whiteboard-draw', ({ roomId, data }) => {
        socket.to(roomId).emit('whiteboard-draw', data);
    });
    
    socket.on('whiteboard-clear', ({ roomId }) => {
        socket.to(roomId).emit('whiteboard-clear');
    });
    
    // ===== SILENCIAR A TODOS (solo host) =====
    socket.on('mute-all', ({ roomId }) => {
        const room = rooms.get(roomId);
        if (!room) return;
        
        const userData = room.users.get(socket.id);
        if (userData && userData.role === 'host') {
            socket.to(roomId).emit('force-mute');
            console.log(`🔇 Host silenció a todos en sala ${roomId}`);
        }
    });
    
    // ===== DESCONEXIÓN =====
    socket.on('disconnect', () => {
        console.log('❌ Usuario desconectado:', socket.id);
        
        const userData = users.get(socket.id);
        if (!userData) return;
        
        const { roomId } = userData;
        const room = rooms.get(roomId);
        
        if (room) {
            // Remover usuario de la sala
            room.users.delete(socket.id);
            
            // Notificar a otros usuarios
            socket.to(roomId).emit('user-disconnected', socket.id);
            
            console.log(`👋 ${userData.userName} salió de sala ${roomId} (Quedan: ${room.users.size})`);
            
            // Si era el host, asignar nuevo host
            if (room.host === socket.id && room.users.size > 0) {
                const newHost = Array.from(room.users.keys())[0];
                room.host = newHost;
                const newHostData = room.users.get(newHost);
                newHostData.role = 'host';
                
                io.to(roomId).emit('new-host', {
                    userId: newHost,
                    userName: newHostData.userName
                });
                
                console.log(`👑 Nuevo host asignado: ${newHostData.userName}`);
            }
            
            // Si la sala está vacía, eliminarla después de 5 minutos
            if (room.users.size === 0) {
                setTimeout(() => {
                    if (room.users.size === 0) {
                        rooms.delete(roomId);
                        console.log(`🗑️ Sala ${roomId} eliminada (vacía)`);
                    }
                }, 5 * 60 * 1000); // 5 minutos
            }
        }
        
        users.delete(socket.id);
    });
});

// ===== FUNCIONES AUXILIARES =====
function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    // Si el código ya existe, generar otro
    if (rooms.has(code)) {
        return generateRoomCode();
    }
    
    return code;
}

// Limpiar salas antiguas cada hora
setInterval(() => {
    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;
    
    rooms.forEach((room, roomId) => {
        if (room.users.size === 0 && (now - room.createdAt) > ONE_HOUR) {
            rooms.delete(roomId);
            console.log(`🗑️ Sala ${roomId} eliminada (inactiva por 1 hora)`);
        }
    });
}, 60 * 60 * 1000); // Cada hora

// ===== INICIAR SERVIDOR =====
const PORT = process.env.PORT || 3000;

http.listen(PORT, () => {
    console.log('╔════════════════════════════════════════╗');
    console.log('║                                        ║');
    console.log('║        🎯 OZYMEET SERVER 🎯           ║');
    console.log('║                                        ║');
    console.log('╚════════════════════════════════════════╝');
    console.log('');
    console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
    console.log(`🌐 Local: http://localhost:${PORT}`);
    console.log('');
    console.log('✅ Funcionalidades activas:');
    console.log('   ✓ Audio en tiempo real (hasta 30 usuarios)');
    console.log('   ✓ 2 pantallas compartidas simultáneas');
    console.log('   ✓ Lápiz punteador sobre pantallas');
    console.log('   ✓ Chat en tiempo real');
    console.log('   ✓ Nombres personalizados');
    console.log('   ✓ Levantar mano');
    console.log('   ✓ Reacciones con emojis');
    console.log('   ✓ Grabar reunión (cliente)');
    console.log('   ✓ Contraseña de sala');
    console.log('   ✓ Roles (Host/Participante)');
    console.log('   ✓ Pizarra compartida');
    console.log('');
    console.log('💡 Presiona Ctrl+C para detener el servidor');
    console.log('');
});

// Manejo de errores
process.on('uncaughtException', (err) => {
    console.error('❌ Error no capturado:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promesa rechazada no manejada:', reason);
});
