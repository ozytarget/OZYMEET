const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.json());

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/sala/:roomId', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

const salasActivas = new Map();

io.on('connection', (socket) => {
    console.log('✅ Usuario conectado:', socket.id);
    
    socket.on('join-room', (roomId, userName) => {
        socket.join(roomId);
        
        if (!salasActivas.has(roomId)) {
            salasActivas.set(roomId, new Map());
        }
        
        salasActivas.get(roomId).set(socket.id, {
            nombre: userName,
            conectadoEn: new Date()
        });
        
        const totalParticipantes = salasActivas.get(roomId).size;
        
        io.to(roomId).emit('user-connected', {
            userId: socket.id,
            userName: userName,
            totalParticipantes: totalParticipantes
        });
        
        const listaParticipantes = Array.from(salasActivas.get(roomId)).map(([id, info]) => ({
            id: id,
            nombre: info.nombre
        }));
        
        socket.emit('current-participants', listaParticipantes);
        
        console.log(`👤 [${roomId}] ${userName} se unió (Total: ${totalParticipantes})`);
    });
    
    socket.on('offer', (data) => {
        socket.to(data.to).emit('offer', {
            offer: data.offer,
            from: socket.id
        });
    });
    
    socket.on('answer', (data) => {
        socket.to(data.to).emit('answer', {
            answer: data.answer,
            from: socket.id
        });
    });
    
    socket.on('ice-candidate', (data) => {
        socket.to(data.to).emit('ice-candidate', {
            candidate: data.candidate,
            from: socket.id
        });
    });
    
    socket.on('start-screen-share', (roomId) => {
        socket.to(roomId).emit('user-sharing-screen', {
            userId: socket.id
        });
        console.log(`🖥️ Usuario compartiendo pantalla`);
    });
    
    socket.on('stop-screen-share', (roomId) => {
        socket.to(roomId).emit('user-stopped-sharing', {
            userId: socket.id
        });
        console.log(`⏹️ Usuario detuvo pantalla`);
    });
    
    socket.on('toggle-audio', (data) => {
        socket.to(data.roomId).emit('user-toggled-audio', {
            userId: socket.id,
            muted: data.muted
        });
    });
    
    socket.on('disconnect', () => {
        salasActivas.forEach((participantes, roomId) => {
            if (participantes.has(socket.id)) {
                const userName = participantes.get(socket.id).nombre;
                participantes.delete(socket.id);
                
                io.to(roomId).emit('user-disconnected', {
                    userId: socket.id,
                    userName: userName,
                    totalParticipantes: participantes.size
                });
                
                console.log(`❌ ${userName} se desconectó`);
                
                if (participantes.size === 0) {
                    salasActivas.delete(roomId);
                }
            }
        });
    });
});

server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════╗
║   🎯 OZYMEET SERVIDOR ACTIVO         ║
╠═══════════════════════════════════════╣
║                                       ║
║   📡 Puerto: ${PORT}                      ║
║   🌐 Local: http://localhost:${PORT}     ║
║                                       ║
║   ✅ Servidor funcionando             ║
║   👥 Esperando conexiones...          ║
║                                       ║
╚═══════════════════════════════════════╝
    `);
});