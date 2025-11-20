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

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// SALA ÚNICA PERMANENTE
const MAIN_ROOM = 'TRADING2025';

// Tracking de usuarios - SIMPLIFICADO
const connectedUsers = new Map();

io.on('connection', (socket) => {
  console.log('🔌 Socket conectado:', socket.id);

  // UNIRSE A LA SALA
  socket.on('join-room', (data) => {
    const { userName, isAdmin } = data;
    
    // FORZAR sala única
    socket.join(MAIN_ROOM);
    
    // Guardar usuario
    connectedUsers.set(socket.id, {
      socketId: socket.id,
      userName: userName,
      isAdmin: isAdmin
    });

    console.log(`✅ ${userName} (${isAdmin ? 'ADMIN' : 'GUEST'}) → Sala: ${MAIN_ROOM}`);
    console.log(`📊 Total usuarios conectados: ${connectedUsers.size}`);

    // OBTENER TODOS los usuarios EXCEPTO el que acaba de entrar
    const existingUsers = [];
    connectedUsers.forEach((user, socketId) => {
      if (socketId !== socket.id) {
        existingUsers.push({
          userId: socketId,
          userName: user.userName,
          isAdmin: user.isAdmin
        });
      }
    });

    console.log(`📋 Enviando ${existingUsers.length} usuarios existentes a ${userName}`);

    // 1. Enviar lista de usuarios existentes AL NUEVO USUARIO
    socket.emit('existing-users', existingUsers);

    // 2. Notificar a TODOS LOS DEMÁS sobre el nuevo usuario
    socket.to(MAIN_ROOM).emit('user-joined', {
      userId: socket.id,
      userName: userName,
      isAdmin: isAdmin
    });

    console.log(`📢 Notificado a sala sobre ${userName}`);
  });

  // SEÑALIZACIÓN WEBRTC
  socket.on('signal', ({ to, signal, from }) => {
    console.log(`📡 Relay señal: ${from} → ${to}`);
    io.to(to).emit('signal', {
      signal: signal,
      from: from
    });
  });

  // CHAT
  socket.on('chat-message', (data) => {
    const user = connectedUsers.get(socket.id);
    if (user) {
      console.log(`💬 ${user.userName}: ${data.message}`);
      io.to(MAIN_ROOM).emit('chat-message', {
        userName: user.userName,
        message: data.message,
        timestamp: Date.now()
      });
    }
  });

  // DIBUJO
  socket.on('drawing', (data) => {
    socket.to(MAIN_ROOM).emit('drawing', data);
  });

  socket.on('clear-canvas', () => {
    socket.to(MAIN_ROOM).emit('clear-canvas');
  });

  // CONTROLES ADMIN
  socket.on('mute-all', () => {
    const user = connectedUsers.get(socket.id);
    if (user && user.isAdmin) {
      console.log(`🔇 ${user.userName} silenció a todos`);
      socket.to(MAIN_ROOM).emit('mute-all');
    }
  });

  socket.on('end-meeting', () => {
    const user = connectedUsers.get(socket.id);
    if (user && user.isAdmin) {
      console.log(`🚫 ${user.userName} finalizó reunión`);
      io.to(MAIN_ROOM).emit('meeting-ended');
    }
  });

  // DESCONEXIÓN
  socket.on('disconnect', () => {
    const user = connectedUsers.get(socket.id);
    if (user) {
      console.log(`❌ ${user.userName} desconectado`);
      console.log(`📊 Usuarios restantes: ${connectedUsers.size - 1}`);
      
      // Notificar a otros
      socket.to(MAIN_ROOM).emit('user-left', socket.id);
      
      // Eliminar de tracking
      connectedUsers.delete(socket.id);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('');
  console.log('🚀 ========================================');
  console.log(`   OZYMEET SERVER RUNNING`);
  console.log(`   Puerto: ${PORT}`);
  console.log(`   Sala única: ${MAIN_ROOM}`);
  console.log('🚀 ========================================');
  console.log('');
});

