const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Servir archivos estáticos desde carpeta public
app.use(express.static(path.join(__dirname, 'public')));

// SALA ÚNICA PERMANENTE
const MAIN_ROOM = 'TRADING2025';

// Almacenar usuarios conectados
const users = new Map();

io.on('connection', (socket) => {
  console.log('🔌 Nueva conexión:', socket.id);

  // UNIRSE A LA SALA - FORZAR SALA ÚNICA PARA TODOS
  socket.on('join-room', ({ userName, isAdmin }) => {
    // CRÍTICO: Ignorar cualquier roomId del cliente
    // TODOS van a la misma sala TRADING2025
    const roomId = MAIN_ROOM;
    
    // Unir socket a la sala
    socket.join(roomId);
    
    // Guardar información del usuario
    users.set(socket.id, {
      userName: userName,
      isAdmin: isAdmin,
      roomId: roomId
    });

    console.log(`✅ ${userName} (${isAdmin ? 'ADMIN' : 'INVITADO'}) entró a sala: ${roomId}`);

    // Obtener lista de usuarios YA conectados en la misma sala
    const existingUsers = [];
    const roomSockets = io.sockets.adapter.rooms.get(roomId);
    
    if (roomSockets) {
      roomSockets.forEach(socketId => {
        if (socketId !== socket.id && users.has(socketId)) {
          const user = users.get(socketId);
          existingUsers.push({
            userId: socketId,
            userName: user.userName,
            isAdmin: user.isAdmin
          });
        }
      });
    }

    console.log(`📋 Usuarios existentes en sala: ${existingUsers.length}`);

    // Enviar lista de usuarios existentes al nuevo usuario
    socket.emit('existing-users', existingUsers);

    // Notificar a TODOS los demás usuarios sobre el nuevo usuario
    socket.to(roomId).emit('user-joined', {
      userId: socket.id,
      userName: userName,
      isAdmin: isAdmin
    });
  });

  // SEÑALIZACIÓN WEBRTC - Relay de señales entre peers
  socket.on('signal', ({ to, signal, from }) => {
    console.log(`📡 Señal WebRTC: ${from} → ${to}`);
    io.to(to).emit('signal', {
      signal: signal,
      from: from
    });
  });

  // MENSAJES DE CHAT
  socket.on('chat-message', (data) => {
    const user = users.get(socket.id);
    if (user) {
      console.log(`💬 Chat de ${user.userName}: ${data.message}`);
      io.to(MAIN_ROOM).emit('chat-message', {
        userName: user.userName,
        message: data.message,
        timestamp: Date.now()
      });
    }
  });

  // DIBUJO EN PANTALLA COMPARTIDA
  socket.on('drawing', (data) => {
    socket.to(MAIN_ROOM).emit('drawing', data);
  });

  socket.on('clear-canvas', () => {
    socket.to(MAIN_ROOM).emit('clear-canvas');
  });

  // CONTROLES DE ADMINISTRADOR
  socket.on('mute-all', () => {
    const user = users.get(socket.id);
    if (user && user.isAdmin) {
      console.log(`🔇 ${user.userName} silenció a todos`);
      socket.to(MAIN_ROOM).emit('mute-all');
    }
  });

  socket.on('end-meeting', () => {
    const user = users.get(socket.id);
    if (user && user.isAdmin) {
      console.log(`🚫 ${user.userName} finalizó la reunión`);
      io.to(MAIN_ROOM).emit('meeting-ended');
    }
  });

  // DESCONEXIÓN
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      console.log(`❌ ${user.userName} se desconectó`);
      socket.to(MAIN_ROOM).emit('user-left', socket.id);
      users.delete(socket.id);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor OZYMEET corriendo en puerto ${PORT}`);
  console.log(`📍 Sala única: ${MAIN_ROOM}`);
  console.log(`🌐 http://localhost:${PORT}`);
});


