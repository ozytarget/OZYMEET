/**
 * 🎯 OZYMEET CLIENT PRO v2.1 - MICROPHONE FIX
 * Fix: Micrófono no se activa automáticamente
 */

// ═══════════════════════════════════════════════════════════
// GLOBAL STATE
// ═══════════════════════════════════════════════════════════

const socket = io({
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5,
    transports: ['websocket', 'polling']
});

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
let reconnectAttempts = 0;
let isReconnecting = false;
let audioStartAttempts = 0; // ← NUEVO: Contador de intentos

let currentUser = {
    id: null,
    name: localStorage.getItem('userName') || 'Usuario',
    role: 'participant',
    handRaised: false,
    isConnected: false
};

// ═══════════════════════════════════════════════════════════
// PROFESSIONAL LOGGER
// ═══════════════════════════════════════════════════════════

const Logger = {
    info: (msg, data = '') => console.log(`[${new Date().toISOString()}] ℹ️  ${msg}`, data),
    success: (msg, data = '') => console.log(`[${new Date().toISOString()}] ✅ ${msg}`, data),
    error: (msg, data = '') => console.error(`[${new Date().toISOString()}] ❌ ${msg}`, data),
    warn: (msg, data = '') => console.warn(`[${new Date().toISOString()}] ⚠️  ${msg}`, data),
    peer: (msg, data = '') => console.log(`[${new Date().toISOString()}] 🔗 ${msg}`, data),
    audio: (msg, data = '') => console.log(`[${new Date().toISOString()}] 🔊 ${msg}`, data)
};

// ═══════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════

window.addEventListener('DOMContentLoaded', function() {
    Logger.success('DOM fully loaded - Initializing OZYMEET PRO v2.1');
    initializeApp();
});

function initializeApp() {
    // Canvas setup
    const canvas = document.getElementById('drawCanvas');
    const ctx = canvas ? canvas.getContext('2d') : null;
    
    const whiteboardCanvas = document.getElementById('whiteboardCanvas');
    const whiteboardCtx = whiteboardCanvas ? whiteboardCanvas.getContext('2d') : null;
    
    let isDrawing = false;
    let drawColor = '#FF0000';
    let lastX = 0;
    let lastY = 0;
    
    // ═══════════════════════════════════════════════════════
    // SOCKET CONNECTION HANDLERS
    // ═══════════════════════════════════════════════════════
    
    socket.on('connect', () => {
        currentUser.id = socket.id;
        currentUser.isConnected = true;
        reconnectAttempts = 0;
        isReconnecting = false;
        
        Logger.success(`Connected to server: ${socket.id}`);
        updateConnectionStatus('connected');
    });
    
    socket.on('disconnect', (reason) => {
        currentUser.isConnected = false;
        Logger.warn(`Disconnected from server: ${reason}`);
        updateConnectionStatus('disconnected');
        
        if (reason === 'io server disconnect') {
            socket.connect();
        }
    });
    
    socket.on('reconnect_attempt', (attempt) => {
        reconnectAttempts = attempt;
        Logger.info(`Reconnection attempt ${attempt}`);
        updateConnectionStatus('reconnecting');
    });
    
    socket.on('reconnect_failed', () => {
        Logger.error('Failed to reconnect after multiple attempts');
        updateConnectionStatus('failed');
        showSystemNotification('⚠️ Connection lost. Please refresh the page.', 'error');
    });
    
    socket.on('error', ({ message }) => {
        Logger.error('Server error:', message);
        alert(`❌ ${message}`);
    });
    
    // ═══════════════════════════════════════════════════════
    // ROOM JOIN - FIX: Activar micrófono DESPUÉS de confirmar entrada
    // ═══════════════════════════════════════════════════════
    
    window.joinRoom = function() {
        const nameInput = document.getElementById('welcomeNameInput');
        const passwordInput = document.getElementById('welcomePasswordInput');
        
        if (!nameInput) {
            Logger.error('Name input element not found');
            return;
        }
        
        const name = nameInput.value.trim();
        const password = passwordInput ? passwordInput.value : '';
        
        if (!name) {
            alert('⚠️ Por favor ingresa tu nombre');
            return;
        }
        
        if (name.length > 50) {
            alert('⚠️ El nombre es demasiado largo (máximo 50 caracteres)');
            return;
        }
        
        currentUser.name = name;
        localStorage.setItem('userName', name);
        if (password) localStorage.setItem('roomPassword', password);
        
        const welcomeModal = document.getElementById('welcomeModal');
        if (welcomeModal) welcomeModal.classList.remove('active');
        
        Logger.info(`Joining room ${roomId} as ${name}`);
        
        socket.emit('join-room', {
            roomId: roomId,
            userName: name,
            password: password
        });
        
        // ❌ NO INICIAR AUDIO AQUÍ - Esperar confirmación del servidor
    };
    
    // ✅ FIX CRÍTICO: Activar audio DESPUÉS de confirmar entrada a la sala
    socket.on('joined-room', ({ success, userData, roomData, existingUsers }) => {
        if (!success) {
            Logger.error('Failed to join room');
            return;
        }
        
        Logger.success(`Successfully joined room: ${roomData.id}`);
        Logger.info(`Room stats: ${roomData.userCount}/${roomData.maxUsers} users`);
        
        currentUser.id = userData.userId;
        currentUser.role = userData.role;
        
        // Procesar usuarios existentes
        if (existingUsers && existingUsers.length > 0) {
            Logger.info(`📥 Found ${existingUsers.length} existing users in room`);
            
            existingUsers.forEach((user, index) => {
                Logger.peer(`Adding existing user [${index + 1}/${existingUsers.length}]: ${user.userName} (${user.userId.slice(0, 8)}...)`);
                
                participants.set(user.userId, {
                    userId: user.userId,
                    userName: user.userName,
                    role: user.role,
                    handRaised: user.handRaised || false,
                    isMuted: user.isMuted || false,
                    isReady: user.isReady || false
                });
            });
            
            updateParticipantsList();
            showSystemNotification(`✅ Te uniste a la sala con ${existingUsers.length} persona(s)`, 'success');
        } else {
            Logger.info('You are the first user in the room');
            updateParticipantsList();
            showSystemNotification('✅ Eres el primero en la sala', 'info');
        }
        
        // ✅ FIX CRÍTICO: Iniciar audio AHORA que confirmamos entrada exitosa
        Logger.audio('🎤 Iniciando audio después de confirmar entrada a la sala...');
        setTimeout(() => {
            startAudioWithRetry();
        }, 500);
    });
    
    // ═══════════════════════════════════════════════════════
    // AUDIO FUNCTIONS - FIX CON RETRY AUTOMÁTICO
    // ═══════════════════════════════════════════════════════
    
    async function startAudioWithRetry(retryCount = 0) {
        const MAX_RETRIES = 3;
        
        try {
            Logger.audio(`Requesting microphone access (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
            
            // ✅ FIX: Asegurar que no hay stream previo
            if (localStream) {
                Logger.warn('Cleaning up previous audio stream...');
                localStream.getTracks().forEach(track => track.stop());
                localStream = null;
            }
            
            localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 48000
                }
            });
            
            // ✅ FIX: Verificar que el track está habilitado
            const audioTrack = localStream.getAudioTracks()[0];
            if (!audioTrack) {
                throw new Error('No audio track available');
            }
            
            audioTrack.enabled = true; // ← CRÍTICO: Asegurar que está habilitado
            isMicActive = true;
            
            const micBtn = document.getElementById('micBtn');
            const micIcon = document.getElementById('micIcon');
            
            if (micBtn) micBtn.classList.add('active');
            if (micIcon) micIcon.textContent = '🎤';
            
            Logger.success(`✅ Microphone access granted - Track enabled: ${audioTrack.enabled}`);
            Logger.audio(`Audio settings: ${JSON.stringify(audioTrack.getSettings())}`);
            
            // Notificar al servidor que estamos listos
            socket.emit('user-ready', {
                roomId: roomId,
                userName: currentUser.name,
                role: currentUser.role
            });
            
            // Conectar con usuarios existentes
            setTimeout(() => {
                participants.forEach((userData, userId) => {
                    if (!peers[userId]) {
                        Logger.peer(`Connecting to existing user after audio start: ${userData.userName}`);
                        connectToNewUser(userId);
                    }
                });
            }, 1000);
            
            showSystemNotification('🎤 Micrófono activado correctamente', 'success');
            
        } catch (err) {
            Logger.error(`Failed to access microphone (attempt ${retryCount + 1}):`, err.message);
            
            if (retryCount < MAX_RETRIES - 1) {
                Logger.warn(`Retrying in 2 seconds...`);
                setTimeout(() => {
                    startAudioWithRetry(retryCount + 1);
                }, 2000);
            } else {
                Logger.error('Max retries reached. Microphone could not be activated.');
                alert(`❌ No se pudo acceder al micrófono después de ${MAX_RETRIES} intentos.\n\nVerifica:\n1. Permisos del navegador (debe ser HTTPS)\n2. Que ninguna otra app esté usando el micrófono\n3. Que el micrófono esté conectado y funcionando`);
                showSystemNotification('❌ Error al activar micrófono', 'error');
            }
        }
    }
    
    // ═══════════════════════════════════════════════════════
    // USER CONNECTED - New user joins
    // ═══════════════════════════════════════════════════════
    
    socket.on('user-connected', (userData) => {
        Logger.success(`New user connected: ${userData.userName} (${userData.userId.slice(0, 8)}...)`);
        
        participants.set(userData.userId, {
            userId: userData.userId,
            userName: userData.userName,
            role: userData.role || 'participant',
            handRaised: userData.handRaised || false,
            isMuted: userData.isMuted || false,
            isReady: userData.isReady || false
        });
        
        updateParticipantsList();
        
        if (localStream) {
            connectToNewUser(userData.userId);
        } else {
            Logger.warn('Local stream not ready yet, cannot connect to new user');
        }
        
        addSystemMessage(`${userData.userName} se unió a la sala`);
        showSystemNotification(`👋 ${userData.userName} se unió`, 'info');
    });
    
    // ═══════════════════════════════════════════════════════
    // USER DISCONNECTED
    // ═══════════════════════════════════════════════════════
    
    socket.on('user-disconnected', (userId) => {
        const user = participants.get(userId);
        const userName = user ? user.userName : 'Usuario';
        
        Logger.warn(`User disconnected: ${userName} (${userId.slice(0, 8)}...)`);
        
        if (peers[userId]) {
            peers[userId].destroy();
            delete peers[userId];
        }
        
        if (screenPeers[userId]) {
            screenPeers[userId].destroy();
            delete screenPeers[userId];
            removeScreenVideo(userId);
        }
        
        const audioElement = document.getElementById(`audio-${userId}`);
        if (audioElement) audioElement.remove();
        
        participants.delete(userId);
        updateParticipantsList();
        
        addSystemMessage(`${userName} salió de la sala`);
        showSystemNotification(`👋 ${userName} salió`, 'info');
    });
    
    // ═══════════════════════════════════════════════════════
    // WEBRTC SIGNALING
    // ═══════════════════════════════════════════════════════
    
    socket.on('signal', ({ from, signal }) => {
        Logger.peer(`Received signal from ${from.slice(0, 8)}...`);
        
        if (!localStream) {
            Logger.error('Cannot process signal - no local stream available');
            return;
        }
        
        if (!peers[from]) {
            Logger.peer(`Creating peer connection as non-initiator for ${from.slice(0, 8)}...`);
            
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
                Logger.peer(`Sending signal back to ${from.slice(0, 8)}...`);
                socket.emit('signal', { to: from, signal: sig, roomId });
            });
            
            peer.on('stream', (stream) => {
                Logger.audio(`Receiving audio stream from ${from.slice(0, 8)}...`);
                playAudioStream(from, stream);
            });
            
            peer.on('connect', () => {
                Logger.success(`Peer connection established with ${from.slice(0, 8)}...`);
            });
            
            peer.on('error', (err) => {
                Logger.error(`Peer error with ${from.slice(0, 8)}...:`, err.message);
            });
            
            peer.on('close', () => {
                Logger.warn(`Peer connection closed with ${from.slice(0, 8)}...`);
            });
            
            peers[from] = peer;
            peer.signal(signal);
        } else {
            peers[from].signal(signal);
        }
    });
    
    // ═══════════════════════════════════════════════════════
    // UI CONTROLS
    // ═══════════════════════════════════════════════════════
    
    window.toggleMic = function() {
        if (!localStream) {
            Logger.warn('No local stream - attempting to start audio...');
            startAudioWithRetry();
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
                    Logger.info('🎤 Microphone ENABLED');
                    showSystemNotification('🎤 Micrófono activado', 'success');
                } else {
                    micBtn.classList.remove('active');
                    micIcon.textContent = '🔇';
                    Logger.info('🔇 Microphone MUTED');
                    showSystemNotification('🔇 Micrófono silenciado', 'info');
                }
            }
            
            socket.emit('mic-status', {
                roomId: roomId,
                userId: currentUser.id,
                isMuted: !isMicActive
            });
        } else {
            Logger.error('No audio track available');
        }
    };
    
    function connectToNewUser(userId) {
        if (!localStream) {
            Logger.warn(`Cannot connect to user ${userId.slice(0, 8)}... - no local stream`);
            return;
        }
        
        if (peers[userId]) {
            Logger.warn(`Peer connection already exists for ${userId.slice(0, 8)}...`);
            return;
        }
        
        Logger.peer(`Creating peer connection as initiator for ${userId.slice(0, 8)}...`);
        
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
            Logger.peer(`Sending signal to ${userId.slice(0, 8)}...`);
            socket.emit('signal', { to: userId, signal, roomId });
        });
        
        peer.on('stream', (stream) => {
            Logger.audio(`Receiving audio stream from ${userId.slice(0, 8)}...`);
            playAudioStream(userId, stream);
        });
        
        peer.on('connect', () => {
            Logger.success(`Peer connection established with ${userId.slice(0, 8)}...`);
        });
        
        peer.on('error', (err) => {
            Logger.error(`Peer error with ${userId.slice(0, 8)}...:`, err.message);
        });
        
        peer.on('close', () => {
            Logger.warn(`Peer connection closed with ${userId.slice(0, 8)}...`);
        });
        
        peers[userId] = peer;
    }
    
    function playAudioStream(userId, stream) {
        const existingAudio = document.getElementById(`audio-${userId}`);
        if (existingAudio) {
            Logger.warn(`Removing existing audio element for ${userId.slice(0, 8)}...`);
            existingAudio.remove();
        }
        
        const audio = document.createElement('audio');
        audio.id = `audio-${userId}`;
        audio.srcObject = stream;
        audio.autoplay = true;
        audio.volume = 1.0;
        audio.style.display = 'none';
        
        audio.addEventListener('loadedmetadata', () => {
            audio.play()
                .then(() => {
                    Logger.audio(`🔊 Audio playing for ${userId.slice(0, 8)}...`);
                })
                .catch(err => {
                    Logger.error(`Failed to play audio for ${userId.slice(0, 8)}...:`, err.message);
                });
        });
        
        audio.addEventListener('error', (e) => {
            Logger.error(`Audio error for ${userId.slice(0, 8)}...:`, e);
        });
        
        document.body.appendChild(audio);
    }
    
    // ═══════════════════════════════════════════════════════
    // UI HELPER FUNCTIONS
    // ═══════════════════════════════════════════════════════
    
    function updateParticipantsList() {
        const listDiv = document.getElementById('participantsList');
        const countSpan = document.getElementById('participantCount');
        
        if (!listDiv || !countSpan) {
            Logger.warn('Participants list elements not found');
            return;
        }
        
        const totalCount = participants.size + 1;
        listDiv.innerHTML = '';
        countSpan.textContent = totalCount;
        
        Logger.info(`Updating participants list: ${totalCount} total users`);
        
        addParticipantToList(
            currentUser.id, 
            currentUser.name, 
            currentUser.role, 
            currentUser.handRaised, 
            !isMicActive,
            true
        );
        
        participants.forEach((userData, userId) => {
            addParticipantToList(
                userId, 
                userData.userName, 
                userData.role || 'participant', 
                userData.handRaised, 
                userData.isMuted,
                false
            );
        });
    }
    
    function addParticipantToList(userId, userName, role, handRaised, isMuted, isSelf) {
        const listDiv = document.getElementById('participantsList');
        if (!listDiv) return;
        
        const itemDiv = document.createElement('div');
        itemDiv.className = 'participant-item';
        itemDiv.id = `participant-${userId}`;
        
        const initial = userName.charAt(0).toUpperCase();
        const roleIcon = role === 'host' ? '👑' : '';
        const handIcon = handRaised ? '✋' : '';
        const micIcon = isMuted ? '🔇' : '🎤';
        const selfLabel = isSelf ? ' (Tú)' : '';
        
        itemDiv.innerHTML = `
            <div class="participant-info">
                <div class="participant-avatar">${initial}</div>
                <div>
                    <div>${userName}${selfLabel}</div>
                    ${roleIcon ? `<span class="participant-role">${roleIcon} Host</span>` : ''}
                </div>
            </div>
            <div class="participant-status">
                <span class="status-icon">${micIcon}</span>
                ${handIcon ? `<span class="status-icon">${handIcon}</span>` : ''}
            </div>
        `;
        
        listDiv.appendChild(itemDiv);
    }
    
    function updateConnectionStatus(status) {
        const statusIndicator = document.getElementById('connectionStatus');
        if (!statusIndicator) return;
        
        statusIndicator.className = 'connection-status';
        
        switch(status) {
            case 'connected':
                statusIndicator.classList.add('connected');
                statusIndicator.textContent = '🟢 Conectado';
                break;
            case 'disconnected':
                statusIndicator.classList.add('disconnected');
                statusIndicator.textContent = '🔴 Desconectado';
                break;
            case 'reconnecting':
                statusIndicator.classList.add('reconnecting');
                statusIndicator.textContent = '🟡 Reconectando...';
                break;
            case 'failed':
                statusIndicator.classList.add('failed');
                statusIndicator.textContent = '❌ Error de conexión';
                break;
        }
    }
    
    function showSystemNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `system-notification ${type}`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => notification.classList.add('show'), 10);
        
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
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
    
    // Inicializar lista de participantes
    setTimeout(() => {
        updateParticipantsList();
    }, 1000);
    
    Logger.success('OZYMEET Client PRO v2.1 initialized successfully');
}
