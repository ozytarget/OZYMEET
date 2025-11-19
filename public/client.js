// ===== CONFIGURACIÓN INICIAL =====
const socket = io();
const roomId = new URLSearchParams(window.location.search).get('room');
const peers = {};
const screenPeers = {};
const participants = new Map();

let localStream = null;
let screenStream = null;
let isScreenSharing = false;
let isMicActive = false;
let isDrawingMode = false;
let isRecording = false;
let mediaRecorder = null;
let recordedChunks = [];

// Usuario actual
let currentUser = {
    id: null,
    name: localStorage.getItem('userName') || 'Usuario',
    role: 'participant',
    handRaised: false
};

// ===== CANVAS PARA DIBUJAR =====
const canvas = document.getElementById('drawCanvas');
const ctx = canvas ? canvas.getContext('2d') : null;
let isDrawing = false;
let drawColor = '#FF0000';
let lastX = 0;
let lastY = 0;

// ===== PIZARRA COMPARTIDA =====
const whiteboardCanvas = document.getElementById('whiteboardCanvas');
const whiteboardCtx = whiteboardCanvas ? whiteboardCanvas.getContext('2d') : null;

// ===== UNIRSE A SALA =====
socket.on('connect', () => {
    currentUser.id = socket.id;
    socket.emit('join-room', {
        roomId: roomId,
        userName: currentUser.name,
        password: localStorage.getItem('roomPassword') || ''
    });
});

// ===== INICIAR AUDIO =====
async function startAudio() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        isMicActive = true;
        document.getElementById('micBtn').classList.add('active');
        document.getElementById('micIcon').textContent = '🎤';
        
        // Notificar que estamos listos
        socket.emit('user-ready', {
            roomId: roomId,
            userName: currentUser.name,
            role: currentUser.role
        });
        
    } catch (err) {
        console.error('Error audio:', err);
        alert('⚠️ No se pudo acceder al micrófono');
    }
}

// ===== TOGGLE MICRÓFONO =====
function toggleMic() {
    if (!localStream) {
        startAudio();
        return;
    }
    
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        isMicActive = audioTrack.enabled;
        
        const micBtn = document.getElementById('micBtn');
        const micIcon = document.getElementById('micIcon');
        
        if (isMicActive) {
            micBtn.classList.add('active');
            micIcon.textContent = '🎤';
        } else {
            micBtn.classList.remove('active');
            micIcon.textContent = '🔇';
        }
        
        socket.emit('mic-status', {
            roomId: roomId,
            userId: currentUser.id,
            isMuted: !isMicActive
        });
    }
}

// ===== NUEVO USUARIO CONECTADO =====
socket.on('user-connected', (userData) => {
    console.log('Usuario conectó:', userData);
    participants.set(userData.userId, userData);
    updateParticipantsList();
    connectToNewUser(userData.userId);
    
    // Mensaje de bienvenida en chat
    addSystemMessage(`${userData.userName} se unió a la sala`);
});

// ===== USUARIO DESCONECTADO =====
socket.on('user-disconnected', (userId) => {
    const userName = participants.get(userId)?.userName || 'Usuario';
    
    if (peers[userId]) {
        peers[userId].destroy();
        delete peers[userId];
    }
    
    if (screenPeers[userId]) {
        screenPeers[userId].destroy();
        delete screenPeers[userId];
        removeScreenVideo(userId);
    }
    
    participants.delete(userId);
    updateParticipantsList();
    addSystemMessage(`${userName} salió de la sala`);
});

// ===== CONECTAR CON NUEVO USUARIO =====
function connectToNewUser(userId) {
    if (!localStream) return;
    
    const peer = new SimplePeer({ 
        initiator: true, 
        stream: localStream, 
        trickle: false,
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        }
    });
    
    peer.on('signal', (signal) => {
        socket.emit('signal', { to: userId, signal, roomId });
    });
    
    peer.on('stream', (stream) => {
        console.log('Recibiendo audio de:', userId);
    });
    
    peer.on('error', (err) => {
        console.error('Error peer:', err);
    });
    
    peers[userId] = peer;
}

// ===== RECIBIR SEÑAL WEBRTC =====
socket.on('signal', ({ from, signal }) => {
    if (!peers[from]) {
        const peer = new SimplePeer({ 
            initiator: false, 
            stream: localStream, 
            trickle: false,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ]
            }
        });
        
        peer.on('signal', (sig) => {
            socket.emit('signal', { to: from, signal: sig, roomId });
        });
        
        peer.on('stream', (stream) => {
            console.log('Recibiendo audio de:', from);
        });
        
        peer.on('error', (err) => {
            console.error('Error peer:', err);
        });
        
        peers[from] = peer;
        peer.signal(signal);
    } else {
        peers[from].signal(signal);
    }
});

// ===== COMPARTIR PANTALLA =====
async function toggleScreenShare() {
    if (!isScreenSharing) {
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({ 
                video: {
                    cursor: 'always',
                    displaySurface: 'monitor'
                }
            });
            
            isScreenSharing = true;
            document.getElementById('screenBtn').classList.add('active');
            
            // Crear video local de pantalla
            addScreenVideo(currentUser.id, screenStream, currentUser.name);
            
            // Enviar a todos
            socket.emit('screen-share-start', {
                roomId: roomId,
                userName: currentUser.name
            });
            
            Object.keys(peers).forEach(userId => {
                const screenPeer = new SimplePeer({ 
                    initiator: true, 
                    stream: screenStream, 
                    trickle: false 
                });
                
                screenPeer.on('signal', (signal) => {
                    socket.emit('screen-signal', { to: userId, signal, roomId });
                });
                
                screenPeers[userId] = screenPeer;
            });
            
            // Detectar cuando se deja de compartir
            screenStream.getVideoTracks()[0].onended = () => {
                stopScreenShare();
            };
            
        } catch (err) {
            console.error('Error pantalla:', err);
            alert('⚠️ No se pudo compartir la pantalla');
        }
    } else {
        stopScreenShare();
    }
}

function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }
    
    isScreenSharing = false;
    document.getElementById('screenBtn').classList.remove('active');
    
    socket.emit('screen-share-stop', {
        roomId: roomId,
        userId: currentUser.id
    });
    
    Object.values(screenPeers).forEach(peer => peer.destroy());
    Object.keys(screenPeers).forEach(key => delete screenPeers[key]);
    
    removeScreenVideo(currentUser.id);
}

// ===== RECIBIR PANTALLA COMPARTIDA =====
socket.on('screen-signal', ({ from, signal }) => {
    if (!screenPeers[from]) {
        const screenPeer = new SimplePeer({ initiator: false, trickle: false });
        
        screenPeer.on('signal', (sig) => {
            socket.emit('screen-signal', { to: from, signal: sig, roomId });
        });
        
        screenPeer.on('stream', (stream) => {
            const userName = participants.get(from)?.userName || 'Usuario';
            addScreenVideo(from, stream, userName);
        });
        
        screenPeers[from] = screenPeer;
        screenPeer.signal(signal);
    } else {
        screenPeers[from].signal(signal);
    }
});

socket.on('screen-share-stopped', ({ userId }) => {
    removeScreenVideo(userId);
});

// ===== AGREGAR VIDEO DE PANTALLA =====
function addScreenVideo(userId, stream, userName) {
    removeScreenVideo(userId);
    
    const container = document.getElementById('screenContainer');
    const wrapper = document.createElement('div');
    wrapper.id = `screen-${userId}`;
    wrapper.className = 'screen-wrapper';
    
    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    
    const label = document.createElement('div');
    label.className = 'screen-label';
    label.textContent = `📺 ${userName}`;
    
    wrapper.appendChild(video);
    wrapper.appendChild(label);
    container.appendChild(wrapper);
    
    // Ajustar canvas
    resizeCanvas();
}

function removeScreenVideo(userId) {
    const element = document.getElementById(`screen-${userId}`);
    if (element) element.remove();
    resizeCanvas();
}

// ===== MODO DIBUJO =====
function toggleDrawMode() {
    isDrawingMode = !isDrawingMode;
    const drawBtn = document.getElementById('drawBtn');
    const drawTools = document.getElementById('drawTools');
    const canvas = document.getElementById('drawCanvas');
    
    if (isDrawingMode) {
        drawBtn.classList.add('active');
        drawTools.classList.add('active');
        canvas.classList.add('drawing-mode');
    } else {
        drawBtn.classList.remove('active');
        drawTools.classList.remove('active');
        canvas.classList.remove('drawing-mode');
    }
}

function setDrawColor(color) {
    drawColor = color;
    document.querySelectorAll('.color-btn').forEach(btn => {
        btn.classList.remove('selected');
    });
    event.target.classList.add('selected');
}

function clearDrawing() {
    if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        socket.emit('clear-drawing', { roomId });
    }
}

// Canvas drawing events
if (canvas) {
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);
}

function startDrawing(e) {
    if (!isDrawingMode) return;
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    lastX = e.clientX - rect.left;
    lastY = e.clientY - rect.top;
}

function draw(e) {
    if (!isDrawing || !isDrawingMode) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    ctx.strokeStyle = drawColor;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    
    // Enviar a otros
    socket.emit('draw-line', {
        roomId,
        fromX: lastX,
        fromY: lastY,
        toX: x,
        toY: y,
        color: drawColor
    });
    
    lastX = x;
    lastY = y;
}

function stopDrawing() {
    isDrawing = false;
}

// Recibir dibujos
socket.on('draw-line', ({ fromX, fromY, toX, toY, color }) => {
    if (ctx) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.stroke();
    }
});

socket.on('clear-drawing', () => {
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
});

function resizeCanvas() {
    if (!canvas) return;
    const container = document.getElementById('screenContainer');
    canvas.width = container.offsetWidth;
    canvas.height = container.offsetHeight;
}

window.addEventListener('resize', resizeCanvas);
setTimeout(resizeCanvas, 100);

// ===== PIZARRA COMPARTIDA =====
function toggleWhiteboard() {
    const whiteboardContainer = document.getElementById('whiteboardContainer');
    const whiteboardBtn = document.getElementById('whiteboardBtn');
    
    if (whiteboardContainer.classList.contains('active')) {
        whiteboardContainer.classList.remove('active');
        whiteboardBtn.classList.remove('active');
    } else {
        whiteboardContainer.classList.add('active');
        whiteboardBtn.classList.add('active');
        resizeWhiteboard();
    }
}

function resizeWhiteboard() {
    if (whiteboardCanvas) {
        whiteboardCanvas.width = window.innerWidth - 400;
        whiteboardCanvas.height = window.innerHeight - 200;
    }
}

// ===== GRABAR REUNIÓN =====
function toggleRecording() {
    if (!isRecording) {
        startRecording();
    } else {
        stopRecording();
    }
}

async function startRecording() {
    try {
        const displayStream = screenStream || await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        
        recordedChunks = [];
        mediaRecorder = new MediaRecorder(displayStream, {
            mimeType: 'video/webm;codecs=vp9'
        });
        
        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                recordedChunks.push(e.data);
            }
        };
        
        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `OZYMEET_${roomId}_${Date.now()}.webm`;
            a.click();
            
            addSystemMessage('✅ Grabación guardada');
        };
        
        mediaRecorder.start();
        isRecording = true;
        document.getElementById('recordBtn').classList.add('danger');
        document.getElementById('recordingIndicator').classList.add('active');
        addSystemMessage('🔴 Grabación iniciada');
        
    } catch (err) {
        console.error('Error grabación:', err);
        alert('⚠️ No se pudo iniciar la grabación');
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        isRecording = false;
        document.getElementById('recordBtn').classList.remove('danger');
        document.getElementById('recordingIndicator').classList.remove('active');
    }
}

// ===== LEVANTAR MANO =====
function raiseHand() {
    currentUser.handRaised = !currentUser.handRaised;
    const handBtn = document.getElementById('handBtn');
    
    if (currentUser.handRaised) {
        handBtn.classList.add('active');
        socket.emit('hand-raised', {
            roomId,
            userId: currentUser.id,
            userName: currentUser.name,
            raised: true
        });
        addSystemMessage(`✋ ${currentUser.name} levantó la mano`);
    } else {
        handBtn.classList.remove('active');
        socket.emit('hand-raised', {
            roomId,
            userId: currentUser.id,
            raised: false
        });
    }
}

socket.on('hand-raised', ({ userId, userName, raised }) => {
    const participant = participants.get(userId);
    if (participant) {
        participant.handRaised = raised;
        updateParticipantsList();
        if (raised) {
            addSystemMessage(`✋ ${userName} levantó la mano`);
        }
    }
});

// ===== CHAT =====
function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    
    if (!message) return;
    
    socket.emit('chat-message', {
        roomId,
        userId: currentUser.id,
        userName: currentUser.name,
        message
    });
    
    addChatMessage(currentUser.name, message, true);
    input.value = '';
}

function handleChatKey(e) {
    if (e.key === 'Enter') {
        sendChatMessage();
    }
}

socket.on('chat-message', ({ userName, message }) => {
    addChatMessage(userName, message, false);
});

function addChatMessage(sender, text, isOwn) {
    const messagesDiv = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${isOwn ? 'own' : ''}`;
    
    messageDiv.innerHTML = `
        <div class="sender">${sender}</div>
        <div class="text">${text}</div>
    `;
    
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function addSystemMessage(text) {
    const messagesDiv = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message';
    messageDiv.style.background = 'rgba(255,255,255,0.05)';
    messageDiv.style.fontStyle = 'italic';
    messageDiv.innerHTML = `<div class="text">ℹ️ ${text}</div>`;
    
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// ===== REACCIONES =====
function sendReaction(emoji) {
    socket.emit('reaction', {
        roomId,
        userId: currentUser.id,
        userName: currentUser.name,
        emoji
    });
    
    showFloatingReaction(emoji);
}

socket.on('reaction', ({ userName, emoji }) => {
    showFloatingReaction(emoji);
    addSystemMessage(`${userName} reaccionó con ${emoji}`);
});

function showFloatingReaction(emoji) {
    const reaction = document.createElement('div');
    reaction.className = 'floating-reaction';
    reaction.textContent = emoji;
    reaction.style.left = Math.random() * (window.innerWidth - 100) + 'px';
    reaction.style.bottom = '0px';
    
    document.body.appendChild(reaction);
    
    setTimeout(() => reaction.remove(), 3000);
}

function updateParticipantsList() {
    const listDiv = document.getElementById('participantsList');
    const countSpan = document.getElementById('participantCount');
    
    // Verificar que los elementos existen
    if (!listDiv || !countSpan) {
        console.warn('Elementos de participantes no encontrados aún');
        return;
    }
    
    listDiv.innerHTML = '';
    countSpan.textContent = participants.size + 1;
    
    // Agregar usuario actual
    addParticipantToList(currentUser.id, currentUser.name, currentUser.role, currentUser.handRaised, true);
    
    // Agregar otros
    participants.forEach((userData, userId) => {
        addParticipantToList(userId, userData.userName, userData.role || 'participant', userData.handRaised, false);
    });
}

function addParticipantToList(userId, userName, role, handRaised, isSelf) {
    const listDiv = document.getElementById('participantsList');
    const itemDiv = document.createElement('div');
    itemDiv.className = 'participant-item';
    itemDiv.id = `participant-${userId}`;
    
    const initial = userName.charAt(0).toUpperCase();
    const roleLabel = role === 'host' ? '👑 Host' : '';
    const handIcon = handRaised ? '✋' : '';
    const selfLabel = isSelf ? ' (Tú)' : '';
    
    itemDiv.innerHTML = `
        <div class="participant-info">
            <div class="participant-avatar">${initial}</div>
            <div>
                <div>${userName}${selfLabel}</div>
                ${roleLabel ? `<span class="participant-role">${roleLabel}</span>` : ''}
            </div>
        </div>
        <div class="participant-status">
            ${handIcon ? `<span class="status-icon">${handIcon}</span>` : ''}
        </div>
    `;
    
    listDiv.appendChild(itemDiv);
}

// ===== CONFIGURACIÓN =====
function openSettings() {
    document.getElementById('settingsModal').classList.add('active');
    document.getElementById('userNameInput').value = currentUser.name;
}

function closeSettings() {
    document.getElementById('settingsModal').classList.remove('active');
}

function saveSettings() {
    const newName = document.getElementById('userNameInput').value.trim();
    const newPassword = document.getElementById('roomPasswordInput').value;
    const newRole = document.getElementById('roleSelect').value;
    
    if (newName) {
        currentUser.name = newName;
        currentUser.role = newRole;
        localStorage.setItem('userName', newName);
        localStorage.setItem('roomPassword', newPassword);
        
        socket.emit('update-user', {
            roomId,
            userId: currentUser.id,
            userName: newName,
            role: newRole
        });
        
        updateParticipantsList();
        addSystemMessage(`✅ Configuración actualizada`);
    }
    
    closeSettings();
}

socket.on('user-updated', ({ userId, userName, role }) => {
    const participant = participants.get(userId);
    if (participant) {
        participant.userName = userName;
        participant.role = role;
        updateParticipantsList();
    }
});

// ===== INICIALIZACIÓN =====
document.addEventListener('DOMContentLoaded', () => {
    // Esperar a que todo el DOM esté cargado
    setTimeout(() => {
        if (document.getElementById('participantsList')) {
            updateParticipantsList();
        }
    }, 1000);
});

// Backup: también ejecutar después de que la ventana cargue
window.addEventListener('load', () => {
    setTimeout(() => {
        if (document.getElementById('participantsList')) {
            updateParticipantsList();
        }
    }, 500);
});


