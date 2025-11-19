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

// ===== ESPERAR A QUE EL DOM ESTÉ LISTO =====
window.addEventListener('DOMContentLoaded', function() {
    console.log('✅ DOM cargado');
    initializeApp();
});

function initializeApp() {
    // Canvas para dibujar
    const canvas = document.getElementById('drawCanvas');
    const ctx = canvas ? canvas.getContext('2d') : null;
    
    // Pizarra compartida
    const whiteboardCanvas = document.getElementById('whiteboardCanvas');
    const whiteboardCtx = whiteboardCanvas ? whiteboardCanvas.getContext('2d') : null;
    
    let isDrawing = false;
    let drawColor = '#FF0000';
    let lastX = 0;
    let lastY = 0;
    
    // ===== CONEXIÓN SOCKET =====
    socket.on('connect', () => {
        currentUser.id = socket.id;
        console.log('🔌 Conectado con ID:', socket.id);
    });
    
    // ===== FUNCIONES GLOBALES =====
    window.toggleMic = function() {
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
            
            if (micBtn && micIcon) {
                if (isMicActive) {
                    micBtn.classList.add('active');
                    micIcon.textContent = '🎤';
                } else {
                    micBtn.classList.remove('active');
                    micIcon.textContent = '🔇';
                }
            }
            
            socket.emit('mic-status', {
                roomId: roomId,
                userId: currentUser.id,
                isMuted: !isMicActive
            });
        }
    };
    
    window.toggleScreenShare = async function() {
        if (!isScreenSharing) {
            try {
                screenStream = await navigator.mediaDevices.getDisplayMedia({ 
                    video: { cursor: 'always' }
                });
                
                isScreenSharing = true;
                const screenBtn = document.getElementById('screenBtn');
                if (screenBtn) screenBtn.classList.add('active');
                
                addScreenVideo(currentUser.id, screenStream, currentUser.name);
                
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
    };
    
    function stopScreenShare() {
        if (screenStream) {
            screenStream.getTracks().forEach(track => track.stop());
            screenStream = null;
        }
        
        isScreenSharing = false;
        const screenBtn = document.getElementById('screenBtn');
        if (screenBtn) screenBtn.classList.remove('active');
        
        socket.emit('screen-share-stop', { roomId: roomId, userId: currentUser.id });
        
        Object.values(screenPeers).forEach(peer => peer.destroy());
        Object.keys(screenPeers).forEach(key => delete screenPeers[key]);
        
        removeScreenVideo(currentUser.id);
    }
    
    window.toggleDrawMode = function() {
        isDrawingMode = !isDrawingMode;
        const drawBtn = document.getElementById('drawBtn');
        const drawTools = document.getElementById('drawTools');
        const canvas = document.getElementById('drawCanvas');
        
        if (drawBtn && drawTools && canvas) {
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
    };
    
    window.setDrawColor = function(color) {
        drawColor = color;
        document.querySelectorAll('.color-btn').forEach(btn => {
            btn.classList.remove('selected');
        });
        event.target.classList.add('selected');
    };
    
    window.clearDrawing = function() {
        if (ctx && canvas) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            socket.emit('clear-drawing', { roomId });
        }
    };
    
    window.toggleWhiteboard = function() {
        const whiteboardContainer = document.getElementById('whiteboardContainer');
        const whiteboardBtn = document.getElementById('whiteboardBtn');
        
        if (whiteboardContainer && whiteboardBtn) {
            if (whiteboardContainer.classList.contains('active')) {
                whiteboardContainer.classList.remove('active');
                whiteboardBtn.classList.remove('active');
            } else {
                whiteboardContainer.classList.add('active');
                whiteboardBtn.classList.add('active');
                resizeWhiteboard();
            }
        }
    };
    
    window.toggleRecording = function() {
        if (!isRecording) {
            startRecording();
        } else {
            stopRecording();
        }
    };
    
    async function startRecording() {
        try {
            const displayStream = screenStream || await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            
            recordedChunks = [];
            mediaRecorder = new MediaRecorder(displayStream, {
                mimeType: 'video/webm;codecs=vp9'
            });
            
            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) recordedChunks.push(e.data);
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
            
            const recordBtn = document.getElementById('recordBtn');
            const recordingIndicator = document.getElementById('recordingIndicator');
            if (recordBtn) recordBtn.classList.add('danger');
            if (recordingIndicator) recordingIndicator.classList.add('active');
            
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
            
            const recordBtn = document.getElementById('recordBtn');
            const recordingIndicator = document.getElementById('recordingIndicator');
            if (recordBtn) recordBtn.classList.remove('danger');
            if (recordingIndicator) recordingIndicator.classList.remove('active');
        }
    }
    
    window.raiseHand = function() {
        currentUser.handRaised = !currentUser.handRaised;
        const handBtn = document.getElementById('handBtn');
        
        if (handBtn) {
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
    };
    
    window.sendChatMessage = function() {
        const input = document.getElementById('chatInput');
        if (!input) return;
        
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
    };
    
    window.handleChatKey = function(e) {
        if (e.key === 'Enter') {
            sendChatMessage();
        }
    };
    
    window.sendReaction = function(emoji) {
        socket.emit('reaction', {
            roomId,
            userId: currentUser.id,
            userName: currentUser.name,
            emoji
        });
        
        showFloatingReaction(emoji);
    };
    
    window.openSettings = function() {
        const modal = document.getElementById('settingsModal');
        const nameInput = document.getElementById('userNameInput');
        if (modal) modal.classList.add('active');
        if (nameInput) nameInput.value = currentUser.name;
    };
    
    window.closeSettings = function() {
        const modal = document.getElementById('settingsModal');
        if (modal) modal.classList.remove('active');
    };
    
    window.saveSettings = function() {
        const newName = document.getElementById('userNameInput')?.value.trim();
        const newPassword = document.getElementById('roomPasswordInput')?.value;
        const newRole = document.getElementById('roleSelect')?.value;
        
        if (newName) {
            currentUser.name = newName;
            currentUser.role = newRole || 'participant';
            localStorage.setItem('userName', newName);
            if (newPassword) localStorage.setItem('roomPassword', newPassword);
            
            socket.emit('update-user', {
                roomId,
                userId: currentUser.id,
                userName: newName,
                role: currentUser.role
            });
            
            updateParticipantsList();
            addSystemMessage(`✅ Configuración actualizada`);
        }
        
        closeSettings();
    };
    
    window.joinRoom = function() {
        const nameInput = document.getElementById('welcomeNameInput');
        const passwordInput = document.getElementById('welcomePasswordInput');
        
        if (!nameInput) return;
        
        const name = nameInput.value.trim();
        const password = passwordInput ? passwordInput.value : '';
        
        if (!name) {
            alert('⚠️ Por favor ingresa tu nombre');
            return;
        }
        
        currentUser.name = name;
        localStorage.setItem('userName', name);
        if (password) localStorage.setItem('roomPassword', password);
        
        const welcomeModal = document.getElementById('welcomeModal');
        if (welcomeModal) welcomeModal.classList.remove('active');
        
        socket.emit('join-room', {
            roomId: roomId,
            userName: name,
            password: password
        });
        
        startAudio();
    };
    
    // ===== FUNCIONES AUXILIARES =====
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
            const micBtn = document.getElementById('micBtn');
            const micIcon = document.getElementById('micIcon');
            
            if (micBtn) micBtn.classList.add('active');
            if (micIcon) micIcon.textContent = '🎤';
            
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
    
    function connectToNewUser(userId) {
        if (!localStream) return;
        
        const peer = new SimplePeer({ 
            initiator: true, 
            stream: localStream, 
            trickle: false
        });
        
        peer.on('signal', (signal) => {
            socket.emit('signal', { to: userId, signal, roomId });
        });
        
        peer.on('stream', (stream) => {
            console.log('Recibiendo audio de:', userId);
        });
        
        peers[userId] = peer;
    }
    
    function addScreenVideo(userId, stream, userName) {
        removeScreenVideo(userId);
        
        const container = document.getElementById('screenContainer');
        if (!container) return;
        
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
        
        resizeCanvas();
    }
    
    function removeScreenVideo(userId) {
        const element = document.getElementById(`screen-${userId}`);
        if (element) element.remove();
        resizeCanvas();
    }
    
    function addChatMessage(sender, text, isOwn) {
        const messagesDiv = document.getElementById('chatMessages');
        if (!messagesDiv) return;
        
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
        if (!messagesDiv) return;
        
        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message';
        messageDiv.style.background = 'rgba(255,255,255,0.05)';
        messageDiv.style.fontStyle = 'italic';
        messageDiv.innerHTML = `<div class="text">ℹ️ ${text}</div>`;
        
        messagesDiv.appendChild(messageDiv);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
    
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
        
        if (!listDiv || !countSpan) {
            console.warn('⚠️ Elementos de participantes no encontrados');
            return;
        }
        
        listDiv.innerHTML = '';
        countSpan.textContent = participants.size + 1;
        
        addParticipantToList(currentUser.id, currentUser.name, currentUser.role, currentUser.handRaised, true);
        
        participants.forEach((userData, userId) => {
            addParticipantToList(userId, userData.userName, userData.role || 'participant', userData.handRaised, false);
        });
    }
    
    function addParticipantToList(userId, userName, role, handRaised, isSelf) {
        const listDiv = document.getElementById('participantsList');
        if (!listDiv) return;
        
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
    
    function resizeCanvas() {
        if (!canvas) return;
        const container = document.getElementById('screenContainer');
        if (container) {
            canvas.width = container.offsetWidth;
            canvas.height = container.offsetHeight;
        }
    }
    
    function resizeWhiteboard() {
        if (whiteboardCanvas) {
            whiteboardCanvas.width = window.innerWidth - 400;
            whiteboardCanvas.height = window.innerHeight - 200;
        }
    }
    
    // ===== EVENTOS SOCKET =====
    socket.on('user-connected', (userData) => {
        console.log('Usuario conectó:', userData);
        participants.set(userData.userId, userData);
        updateParticipantsList();
        connectToNewUser(userData.userId);
        addSystemMessage(`${userData.userName} se unió a la sala`);
    });
    
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
    
    socket.on('signal', ({ from, signal }) => {
        if (!peers[from]) {
            const peer = new SimplePeer({ 
                initiator: false, 
                stream: localStream, 
                trickle: false
            });
            
            peer.on('signal', (sig) => {
                socket.emit('signal', { to: from, signal: sig, roomId });
            });
            
            peer.on('stream', (stream) => {
                console.log('Recibiendo audio de:', from);
            });
            
            peers[from] = peer;
            peer.signal(signal);
        } else {
            peers[from].signal(signal);
        }
    });
    
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
    
    socket.on('chat-message', ({ userName, message }) => {
        addChatMessage(userName, message, false);
    });
    
    socket.on('reaction', ({ userName, emoji }) => {
        showFloatingReaction(emoji);
        addSystemMessage(`${userName} reaccionó con ${emoji}`);
    });
    
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
        if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
    });
    
    socket.on('user-updated', ({ userId, userName, role }) => {
        const participant = participants.get(userId);
        if (participant) {
            participant.userName = userName;
            participant.role = role;
            updateParticipantsList();
        }
    });
    
    // ===== EVENTOS DE CANVAS =====
    if (canvas) {
        canvas.addEventListener('mousedown', (e) => {
            if (!isDrawingMode) return;
            isDrawing = true;
            const rect = canvas.getBoundingClientRect();
            lastX = e.clientX - rect.left;
            lastY = e.clientY - rect.top;
        });
        
        canvas.addEventListener('mousemove', (e) => {
            if (!isDrawing || !isDrawingMode || !ctx) return;
            
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
        });
        
        canvas.addEventListener('mouseup', () => {
            isDrawing = false;
        });
        
        canvas.addEventListener('mouseout', () => {
            isDrawing = false;
        });
    }
    
    // ===== RESIZE EVENTS =====
    window.addEventListener('resize', resizeCanvas);
    setTimeout(resizeCanvas, 100);
    setTimeout(updateParticipantsList, 1000);
}



