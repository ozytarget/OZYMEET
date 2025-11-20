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

app.use(express.static(path.join(__dirname, 'public')));

const MAIN_ROOM = 'TRADING2025';
const users = new Map();
let hostUserId = null;

io.on('connection', (socket) => {
  console.log('Nueva conexión:', socket.id);

  socket.on('join-room', (data) => {
    const userName = data.userName;
    
    socket.join(MAIN_ROOM);
    
    // Si es el primero, es el host
    if (users.size === 0) {
      hostUserId = socket.id;
    }
    
    users.set(socket.id, {
      socketId: socket.id,
      userName: userName,
      isHost: socket.id === hostUserId,
      isMuted: false
    });

    console.log(`${userName} entró a sala ${MAIN_ROOM} - Host: ${socket.id === hostUserId}`);
    console.log(`Total usuarios: ${users.size}`);

    const existingUsers = [];
    users.forEach((user, id) => {
      if (id !== socket.id) {
        existingUsers.push({
          userId: id,
          userName: user.userName,
          isHost: user.isHost,
          isMuted: user.isMuted
        });
      }
    });

    console.log(`Enviando ${existingUsers.length} usuarios a ${userName}`);

    socket.emit('existing-users', existingUsers);
    socket.emit('host-status', { isHost: socket.id === hostUserId, hostId: hostUserId });

    socket.to(MAIN_ROOM).emit('user-joined', {
      userId: socket.id,
      userName: userName,
      isHost: socket.id === hostUserId,
      isMuted: false
    });
  });

  socket.on('signal', ({ to, signal, from }) => {
    io.to(to).emit('signal', { signal, from });
  });

  socket.on('chat-message', (data) => {
    const user = users.get(socket.id);
    if (user) {
      io.to(MAIN_ROOM).emit('chat-message', {
        userName: user.userName,
        message: data.message,
        timestamp: Date.now()
      });
    }
  });

  // EMOJIS FLOTANTES
  socket.on('floating-emoji', (data) => {
    const user = users.get(socket.id);
    if (user) {
      socket.to(MAIN_ROOM).emit('floating-emoji', {
        emoji: data.emoji,
        userName: user.userName
      });
    }
  });

  socket.on('drawing', (data) => {
    socket.to(MAIN_ROOM).emit('drawing', data);
  });

  socket.on('clear-canvas', () => {
    socket.to(MAIN_ROOM).emit('clear-canvas');
  });

  socket.on('screen-share-started', ({ userName }) => {
    socket.to(MAIN_ROOM).emit('screen-share-started', { userId: socket.id, userName });
  });

  socket.on('screen-share-stopped', ({ userName }) => {
    socket.to(MAIN_ROOM).emit('screen-share-stopped', { userId: socket.id });
  });

  // CONTROLES DE HOST
  socket.on('mute-user', ({ targetUserId }) => {
    const user = users.get(socket.id);
    if (user && user.isHost) {
      const targetUser = users.get(targetUserId);
      if (targetUser) {
        targetUser.isMuted = true;
        io.to(targetUserId).emit('force-mute');
        io.to(MAIN_ROOM).emit('user-muted', { userId: targetUserId });
        console.log(`Host ${user.userName} muteó a ${targetUser.userName}`);
      }
    }
  });

  socket.on('kick-user', ({ targetUserId }) => {
    const user = users.get(socket.id);
    if (user && user.isHost) {
      const targetUser = users.get(targetUserId);
      if (targetUser) {
        io.to(targetUserId).emit('kicked-out');
        console.log(`Host ${user.userName} expulsó a ${targetUser.userName}`);
      }
    }
  });

  socket.on('transfer-host', ({ targetUserId }) => {
    const user = users.get(socket.id);
    if (user && user.isHost) {
      const targetUser = users.get(targetUserId);
      if (targetUser) {
        // Remover host actual
        user.isHost = false;
        
        // Asignar nuevo host
        targetUser.isHost = true;
        hostUserId = targetUserId;
        
        io.to(MAIN_ROOM).emit('host-changed', { 
          oldHostId: socket.id, 
          newHostId: targetUserId,
          newHostName: targetUser.userName
        });
        
        console.log(`Host transferido de ${user.userName} a ${targetUser.userName}`);
      }
    }
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      console.log(`${user.userName} salió`);
      socket.to(MAIN_ROOM).emit('user-left', socket.id);
      users.delete(socket.id);
      
      // Si el host se desconecta, asignar nuevo host
      if (socket.id === hostUserId && users.size > 0) {
        const firstUser = users.values().next().value;
        hostUserId = firstUser.socketId;
        firstUser.isHost = true;
        
        io.to(MAIN_ROOM).emit('host-changed', { 
          oldHostId: socket.id, 
          newHostId: hostUserId,
          newHostName: firstUser.userName
        });
        
        console.log(`Nuevo host: ${firstUser.userName}`);
      }
      
      console.log(`Usuarios restantes: ${users.size}`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor en puerto ${PORT}`);
  console.log(`Sala: ${MAIN_ROOM}`);
});

