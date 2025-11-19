/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║                  🎯 OZYMEET CLIENT PRO 🎯                 ║
 * ║           Professional WebRTC Client Implementation       ║
 * ║                      Version 2.0                          ║
 * ╚═══════════════════════════════════════════════════════════╝
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
    Logger.success('DOM fully loaded - Initializing OZYMEET');
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
        
        // If we had joined a room before, try to rejoin
        if (roomId && currentUser.name) {
            Logger.info('Attempting to rejoin room after reconnection');
            // The welcome modal will handle rejoin
        }
    });
    
    socket.on('disconnect', (reason) => {
        currentUser.isConnected = false;
        Logger.warn(`Disconnected from server: ${reason}`);
        updateConnectionStatus('disconnected');
        
        if (reason === 'io server disconnect') {
            // Server initiated disconnect, try to reconnect
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
    // ROOM JOIN - Enhanced with existing users sync
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
        
        // Start audio after a short delay to ensure room join completes
        setTimeout(() => {
            startAudio();
        }, 500);
    };
    
    // ✅ CRITICAL: Handle joined-room with existing users
    socket.on('joined-room', ({ success, userData, roomData, existingUsers }) => {
        if (!success) {
            Logger.error('Failed to join room');
            return;
        }
        
        Logger.success(`Successfully joined room: ${roomData.id}`);
        Logger.info(`Room stats: ${roomData.userCount}/${roomData.maxUsers} users`);
        
        // Update current user data
        currentUser.id = userData.userId;
        currentUser.role = userData.role;
        
        // ✅ CRITICAL FIX: Process existing users FIRST
        if (existingUsers && existingUsers.length > 0) {
            Logger.info(`📥 Found ${existingUsers.length} existing users in room`);
            
            existingUsers.forEach((user, index) => {
                Logger.peer(`Adding existing user [${index + 1}/${existingUsers.length}]: ${user.userName} (${user.userId.slice(0, 8)}...)`);
                
                // Add to participants map
                participants.set(user.userId, {
                    userId: user.userId,
                    userName: user.userName,
                    role: user.role,
                    handRaised: user.handRaised || false,
                    isMuted: user.isMuted || false,
                    isReady: user.isReady || false
                });
            });
            
            // Update UI immediately
            updateParticipantsList();
            
            // ✅ Connect to existing users after a short delay (wait for audio stream)
            setTimeout(() => {
                if (localStream) {
                    Logger.peer('Initiating WebRTC connections to existing users');
                    existingUsers.forEach(user => {
                        connectToNewUser(user.userId);
                    });
                } else {
                    Logger.warn('Local stream not ready yet, will connect when audio starts');
                }
            }, 1000);
            
            showSystemNotification(`✅ Te uniste a la sala con ${existingUsers.length} persona(s)`, 'success');
        } else {
            Logger.info('You are the first user in the room');
            updateParticipantsList();
            showSystemNotification('✅ Eres el primero en la sala', 'info');
        }
    });
    
    // ═══════════════════════════════════════════════════════
    // USER CONNECTED - New user joins
    // ═══════════════════════════════════════════════════════
    
    socket.on('user-connected', (userData) => {
        Logger.success(`New user connected: ${userData.userName} (${userData.userId.slice(0, 8)}...)`);
        
        // Add to participants
        participants.set(userData.userId, {
            userId: userData.userId,
            userName: userData.userName,
            role: userData.role || 'participant',
            handRaised: userData.handRaised || false,
            isMuted: userData.isMuted || false,
            isReady: userData.isReady || false
        });
        
        updateParticipantsList();
        
        // Connect via WebRTC (as initiator since we were here first)
        if (localStream) {
            connectToNewUser(userData.userId);
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
        
        // Clean up peer connections
        if (peers[userId]) {
            peers[userId].destroy();
            delete peers[userId];
        }
        
        if (screenPeers[userId]) {
            screenPeers[userId].destroy();
            delete screenPeers[userId];
            removeScreenVideo(userId);
        }
        
        // Remove audio element
        const audioElement = document.getElementById(`audio-${userId}`);
        if (audioElement) audioElement.remove();
        
        // Remove from participants
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
        
        if (!peers[from]) {
            // Create new peer connection (non-initiator)
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
            // Existing peer, just signal
            peers[from].signal(signal);
        }
    });
    
    // ═══════════════════════════════════════════════════════
    // SCREEN SHARING SIGNALS
    // ═══════════════════════════════════════════════════════
    
    socket.on('screen-share-started', ({ userId, userName }) => {
        Logger.info(`Screen share started by ${userName}`);
        showSystemNotification(`🖥️ ${userName} está compartiendo pantalla`, 'info');
    });
    
    socket.on('screen-signal', ({ from, signal }) => {
        if (!screenPeers[from]) {
            const screenPeer = new SimplePeer({ 
                initiator: false, 
                trickle: false,
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' }
                    ]
                }
            });
            
            screenPeer.on('signal', (sig) => {
                socket.emit('screen-signal', { to: from, signal: sig, roomId });
            });
            
            screenPeer.on('stream', (stream) => {
                const user = participants.get(from);
                const userName = user ? user.userName : 'Usuario';
                addScreenVideo(from, stream, userName);
            });
            
            screenPeers[from] = screenPeer;
            screenPeer.signal(signal);
        } else {
            screenPeers[from].signal(signal);
        }
    });
    
    socket.on('screen-share-stopped', ({ userId }) => {
        Logger.info(`Screen share stopped by ${userId.slice(0, 8)}...`);
        removeScreenVideo(userId);
    });
    
    // ═══════════════════════════════════════════════════════
    // OTHER SOCKET EVENTS
    // ═══════════════════════════════════════════════════════
    
    socket.on('user-mic-status', ({ userId, isMuted }) => {
        const user = participants.get(userId);
        if (user) {
            user.isMuted = isMuted;
            updateParticipantsList();
        }
    });
    
    socket.on('hand-raised', ({ userId, userName, raised }) => {
        const user = participants.get(userId);
        if (user) {
            user.handRaised = raised;
            updateParticipantsList();
            if (raised) {
                addSystemMessage(`✋ ${userName} levantó la mano`);
                showSystemNotification(`✋ ${userName} levantó la mano`, 'info');
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
        const user = participants.get(userId);
        if (user) {
            user.userName = userName;
            user.role = role;
            updateParticipantsList();
        }
    });
    
    socket.on('new-host', ({ userId, userName }) => {
        Logger.info(`New host assigned: ${userName}`);
        const user = participants.get(userId);
        if (user) {
            user.role = 'host';
            updateParticipantsList();
        }
        if (userId === currentUser.id) {
            currentUser.role = 'host';
            showSystemNotification('👑 Ahora eres el host', 'success');
        }
        addSystemMessage(`👑 ${userName} es ahora el host`);
    });
    
    socket.on('server-shutdown', ({ message }) => {
        Logger.warn('Server shutdown notification:', message);
        showSystemNotification(message, 'warning');
    });
    
    // ═══════════════════════════════════════════════════════
    // UI CONTROLS
    // ═══════════════════════════════════════════════════════
    
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
            
            Logger.info(`Microphone ${isMicActive ? 'enabled' : 'muted'}`);
        }
    };
    
    window.toggleScreenShare = async function() {
        if (!isScreenSharing) {
            try {
                screenStream = await navigator.mediaDevices.getDisplayMedia({ 
                    video: { cursor: 'always' },
                    audio: false
                });
                
                isScreenSharing = true;
                const screenBtn = document.getElementById('screenBtn');
                if (screenBtn) screenBtn.classList.add('active');
                
                addScreenVideo(currentUser.id, screenStream, currentUser.name);
                
                socket.emit('screen-share-start', {
                    roomId: roomId,
                    userName: currentUser.name
                });
                
                // Create screen peer for each connected user
                Object.keys(peers).forEach(userId => {
                    const screenPeer = new SimplePeer({ 
                        initiator: true, 
                        stream: screenStream, 
                        trickle: false,
                        config: {
                            iceServers: [
                                { urls: 'stun:stun.l.google.com:19302' },
                                { urls: 'stun:stun1.l.google.com:19302' }
                            ]
                        }
                    });
                    
                    screenPeer.on('signal', (signal) => {
                        socket.emit('screen-signal', { to: userId, signal, roomId });
                    });
                    
                    screenPeers[userId] = screenPeer;
                });
                
                // Handle screen share end
                screenStream.getVideoTracks()[0].onended = () => {
                    stopScreenShare();
                };
                
                Logger.success('Screen sharing started');
                showSystemNotification('🖥️ Compartiendo pantalla', 'success');
                
            } catch (err) {
                Logger.error('Failed to start screen share:', err.message);
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
        
        // Clean up screen peers
        Object.values(screenPeers).forEach(peer => peer.destroy());
        Object.keys(screenPeers).forEach(key => delete screenPeers[key]);
        
        removeScreenVideo(currentUser.id);
        
        Logger.info('Screen sharing stopped');
        showSystemNotification('🖥️ Compartir pantalla detenido', 'info');
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
            const displayStream = screenStream || await navigator.mediaDevices.getDisplayMedia({ 
                video: true, 
                audio: true 
            });
            
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
                showSystemNotification('✅ Grabación guardada', 'success');
            };
            
            mediaRecorder.start();
            isRecording = true;
            
            const recordBtn = document.getElementById('recordBtn');
            const recordingIndicator = document.getElementById('recordingIndicator');
            if (recordBtn) recordBtn.classList.add('danger');
            if (recordingIndicator) recordingIndicator.classList.add('active');
            
            addSystemMessage('🔴 Grabación iniciada');
            Logger.success('Recording started');
            
        } catch (err) {
            Logger.error('Failed to start recording:', err.message);
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
            
            Logger.info('Recording stopped');
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
        
        if (message.length > 500) {
            alert('⚠️ Mensaje demasiado largo (máximo 500 caracteres)');
            return;
        }
        
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
        
        if (newName && newName.length > 0) {
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
            showSystemNotification('✅ Configuración actualizada', 'success');
        }
        
        closeSettings();
    };
    
    // ═══════════════════════════════════════════════════════
    // AUDIO FUNCTIONS
    // ═══════════════════════════════════════════════════════
    
    async function startAudio() {
        try {
            Logger.info('Requesting microphone access...');
            
            localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 48000
                }
            });
            
            isMicActive = true;
            const micBtn = document.getElementById('micBtn');
            const micIcon = document.getElementById('micIcon');
            
            if (micBtn) micBtn.classList.add('active');
            if (micIcon) micIcon.textContent = '🎤';
            
            Logger.success('Microphone access granted');
            
            // Notify server that we're ready
            socket.emit('user-ready', {
                roomId: roomId,
                userName: currentUser.name,
                role: currentUser.role
            });
            
            // Connect to any existing users that we haven't connected to yet
            participants.forEach((userData, userId) => {
                if (!peers[userId]) {
                    Logger.peer(`Connecting to existing user after audio start: ${userData.userName}`);
                    connectToNewUser(userId);
                }
            });
            
        } catch (err) {
            Logger.error('Failed to access microphone:', err.message);
            alert('⚠️ No se pudo acceder al micrófono. Verifica los permisos del navegador.');
        }
    }
    
    function connectToNewUser(userId) {
        if (!localStream) {
            Logger.warn('Cannot connect to user - no local stream yet');
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
        // Remove existing audio element if any
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
                    Logger.audio(`Audio playing for ${userId.slice(0, 8)}...`);
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
        
        const time = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        
        messageDiv.innerHTML = `
            <div class="sender">${sender} <span style="opacity: 0.5; font-size: 0.8em;">${time}</span></div>
            <div class="text">${escapeHtml(text)}</div>
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
            Logger.warn('Participants list elements not found');
            return;
        }
        
        const totalCount = participants.size + 1; // +1 for current user
        listDiv.innerHTML = '';
        countSpan.textContent = totalCount;
        
        Logger.info(`Updating participants list: ${totalCount} total users`);
        
        // Add current user first
        addParticipantToList(
            currentUser.id, 
            currentUser.name, 
            currentUser.role, 
            currentUser.handRaised, 
            false,
            true
        );
        
        // Add other participants
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
        const micIcon = isMuted ? '🔇' : '';
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
                ${handIcon ? `<span class="status-icon">${handIcon}</span>` : ''}
                ${micIcon ? `<span class="status-icon">${micIcon}</span>` : ''}
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
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `system-notification ${type}`;
        notification.textContent = message;
        
        // Add to document
        document.body.appendChild(notification);
        
        // Trigger animation
        setTimeout(() => notification.classList.add('show'), 10);
        
        // Remove after 3 seconds
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
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
    
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // ═══════════════════════════════════════════════════════
    // CANVAS DRAWING
    // ═══════════════════════════════════════════════════════
    
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
    
    // ═══════════════════════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════════════════════
    
    window.addEventListener('resize', () => {
        resizeCanvas();
        resizeWhiteboard();
    });
    
    setTimeout(() => {
        resizeCanvas();
        updateParticipantsList();
    }, 100);
    
    Logger.success('OZYMEET Client initialized successfully');
}
