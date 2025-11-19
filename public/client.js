/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║               🎯 OZYMEET ULTIMATE PRO 🎯                  ║
 * ║         Professional Trading WebRTC Platform              ║
 * ║                    Version 3.0 ULTIMATE                   ║
 * ║   ✅ Audio Fix + Trading Features + Collaborative Draw    ║
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
const audioElements = new Map(); // 🔧 Track audio elements properly

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
let viewMode = 'grid'; // grid, speaker, compact
let masterVolume = 1.0;
let micVolume = 1.0;

let currentUser = {
    id: null,
    name: localStorage.getItem('userName') || 'Trader',
    role: 'participant',
    handRaised: false,
    isConnected: false,
    avatar: localStorage.getItem('userAvatar') || '👤',
    avatarColor: localStorage.getItem('avatarColor') || '#4CAF50'
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
    audio: (msg, data = '') => console.log(`[${new Date().toISOString()}] 🔊 ${msg}`, data),
    debug: (msg, data = '') => console.log(`[${new Date().toISOString()}] 🐛 ${msg}`, data)
};

// ═══════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════

window.addEventListener('DOMContentLoaded', function() {
    Logger.success('DOM fully loaded - Initializing OZYMEET ULTIMATE PRO');
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
    
    // Load saved volume preferences
    masterVolume = parseFloat(localStorage.getItem('masterVolume') || '1.0');
    micVolume = parseFloat(localStorage.getItem('micVolume') || '1.0');
    
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
        
        if (roomId && currentUser.name) {
            Logger.info('Attempting to rejoin room after reconnection');
        }
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
    // ROOM JOIN - Audio starts AFTER room confirmation
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
    };
    
    socket.on('joined-room', ({ success, userData, roomData, existingUsers }) => {
        if (!success) {
            Logger.error('Failed to join room');
            return;
        }
        
        Logger.success(`✅ Successfully joined room: ${roomData.id}`);
        Logger.info(`Room stats: ${roomData.userCount}/${roomData.maxUsers} users`);
        
        currentUser.id = userData.userId;
        currentUser.role = userData.role;
        
        if (existingUsers && existingUsers.length > 0) {
            Logger.info(`📥 Found ${existingUsers.length} existing users in room`);
            
            existingUsers.forEach((user, index) => {
                Logger.peer(`[${index + 1}/${existingUsers.length}] ${user.userName} (${user.userId.slice(0, 8)}...)`);
                
                participants.set(user.userId, {
                    userId: user.userId,
                    userName: user.userName,
                    role: user.role,
                    handRaised: user.handRaised || false,
                    isMuted: user.isMuted || false,
                    isReady: user.isReady || false,
                    avatar: user.avatar || '👤',
                    avatarColor: user.avatarColor || '#4CAF50'
                });
            });
            
            updateParticipantsUI();
            showSystemNotification(`✅ Te uniste con ${existingUsers.length} trader(s)`, 'success');
        } else {
            Logger.info('You are the first user in the room');
            updateParticipantsUI();
            showSystemNotification('✅ Eres el primer trader en la sala', 'info');
        }
        
        // 🔧 CRITICAL FIX: Start audio AFTER room confirmation
        Logger.info('🎤 Starting audio stream after room join...');
        setTimeout(() => {
            startAudioWithRetry();
        }, 800);
    });
    
    // ═══════════════════════════════════════════════════════
    // USER CONNECTED
    // ═══════════════════════════════════════════════════════
    
    socket.on('user-connected', (userData) => {
        Logger.success(`New trader: ${userData.userName} (${userData.userId.slice(0, 8)}...)`);
        
        participants.set(userData.userId, {
            userId: userData.userId,
            userName: userData.userName,
            role: userData.role || 'participant',
            handRaised: userData.handRaised || false,
            isMuted: userData.isMuted || false,
            isReady: userData.isReady || false,
            avatar: userData.avatar || '👤',
            avatarColor: userData.avatarColor || '#4CAF50'
        });
        
        updateParticipantsUI();
        
        if (localStream) {
            Logger.peer(`Initiating connection to ${userData.userName}...`);
            connectToNewUser(userData.userId);
        } else {
            Logger.warn('Local stream not ready yet for new user');
        }
        
        addSystemMessage(`${userData.userName} se unió al trading room`);
        showSystemNotification(`👋 ${userData.userName} se unió`, 'info');
    });
    
    // ═══════════════════════════════════════════════════════
    // USER DISCONNECTED
    // ═══════════════════════════════════════════════════════
    
    socket.on('user-disconnected', (userId) => {
        const user = participants.get(userId);
        const userName = user ? user.userName : 'Usuario';
        
        Logger.warn(`User left: ${userName}`);
        
        // Clean up peer
        if (peers[userId]) {
            peers[userId].destroy();
            delete peers[userId];
        }
        
        if (screenPeers[userId]) {
            screenPeers[userId].destroy();
            delete screenPeers[userId];
            removeScreenVideo(userId);
        }
        
        // 🔧 FIX: Clean up audio element properly
        cleanupAudioElement(userId);
        
        participants.delete(userId);
        updateParticipantsUI();
        
        addSystemMessage(`${userName} salió del trading room`);
        showSystemNotification(`👋 ${userName} salió`, 'info');
    });
    
    // ═══════════════════════════════════════════════════════
    // WEBRTC SIGNALING - 🔧 ENHANCED WITH BETTER AUDIO HANDLING
    // ═══════════════════════════════════════════════════════
    
    socket.on('signal', ({ from, signal }) => {
        Logger.peer(`📡 Received signal from ${from.slice(0, 8)}...`);
        
        if (!localStream) {
            Logger.error('❌ Cannot process signal - no local stream');
            return;
        }
        
        if (!peers[from]) {
            Logger.peer(`Creating NON-INITIATOR peer for ${from.slice(0, 8)}...`);
            
            const peer = new SimplePeer({ 
                initiator: false, 
                stream: localStream, 
                trickle: false,
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' },
                        { urls: 'stun:stun2.l.google.com:19302' }
                    ]
                }
            });
            
            setupPeerHandlers(peer, from);
            peers[from] = peer;
            
            Logger.debug('Signaling peer with received signal...');
            peer.signal(signal);
            
        } else {
            Logger.debug('Peer exists, signaling...');
            peers[from].signal(signal);
        }
    });
    
    function setupPeerHandlers(peer, userId) {
        peer.on('signal', (sig) => {
            Logger.peer(`📤 Sending signal to ${userId.slice(0, 8)}...`);
            socket.emit('signal', { to: userId, signal: sig, roomId });
        });
        
        peer.on('stream', (stream) => {
            Logger.audio(`🔊 RECEIVED AUDIO STREAM from ${userId.slice(0, 8)}...`);
            Logger.debug('Stream tracks:', stream.getTracks().length);
            playAudioStream(userId, stream);
        });
        
        peer.on('connect', () => {
            Logger.success(`✅ Peer connected with ${userId.slice(0, 8)}...`);
        });
        
        peer.on('error', (err) => {
            Logger.error(`❌ Peer error with ${userId.slice(0, 8)}...:`, err.message);
        });
        
        peer.on('close', () => {
            Logger.warn(`Peer closed with ${userId.slice(0, 8)}...`);
            cleanupAudioElement(userId);
        });
    }
    
    // ═══════════════════════════════════════════════════════
    // SCREEN SHARING
    // ═══════════════════════════════════════════════════════
    
    socket.on('screen-share-started', ({ userId, userName }) => {
        Logger.info(`Screen share started by ${userName}`);
        showSystemNotification(`🖥️ ${userName} está compartiendo gráficos`, 'info');
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
            updateParticipantsUI();
        }
    });
    
    socket.on('hand-raised', ({ userId, userName, raised }) => {
        const user = participants.get(userId);
        if (user) {
            user.handRaised = raised;
            updateParticipantsUI();
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
        addSystemMessage(`${userName}: ${emoji}`);
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
    
    socket.on('user-updated', ({ userId, userName, role, avatar, avatarColor }) => {
        const user = participants.get(userId);
        if (user) {
            user.userName = userName;
            user.role = role;
            user.avatar = avatar || user.avatar;
            user.avatarColor = avatarColor || user.avatarColor;
            updateParticipantsUI();
        }
    });
    
    socket.on('new-host', ({ userId, userName }) => {
        Logger.info(`New host: ${userName}`);
        const user = participants.get(userId);
        if (user) {
            user.role = 'host';
            updateParticipantsUI();
        }
        if (userId === currentUser.id) {
            currentUser.role = 'host';
            showSystemNotification('👑 Ahora eres el host', 'success');
        }
        addSystemMessage(`👑 ${userName} es el nuevo host`);
    });
    
    socket.on('server-shutdown', ({ message }) => {
        Logger.warn('Server shutdown:', message);
        showSystemNotification(message, 'warning');
    });
    
    // ═══════════════════════════════════════════════════════
    // UI CONTROLS
    // ═══════════════════════════════════════════════════════
    
    window.toggleMic = function() {
        if (!localStream) {
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
            
            Logger.info(`Microphone ${isMicActive ? 'ON' : 'MUTED'}`);
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
                
                screenStream.getVideoTracks()[0].onended = () => {
                    stopScreenShare();
                };
                
                Logger.success('Screen sharing started');
                showSystemNotification('🖥️ Compartiendo gráficos', 'success');
                
            } catch (err) {
                Logger.error('Failed to share screen:', err.message);
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
        
        Logger.info('Screen sharing stopped');
        showSystemNotification('🖥️ Dejó de compartir', 'info');
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
                showSystemNotification('✏️ Modo dibujo activado (todos pueden dibujar)', 'info');
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
            Logger.error('Recording failed:', err.message);
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
            alert('⚠️ Mensaje muy largo (máx 500 chars)');
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
        addSystemMessage(`${currentUser.name}: ${emoji}`);
    };
    
    window.openSettings = function() {
        const modal = document.getElementById('settingsModal');
        const nameInput = document.getElementById('userNameInput');
        const masterVolumeSlider = document.getElementById('masterVolumeSlider');
        const micVolumeSlider = document.getElementById('micVolumeSlider');
        const viewModeSelect = document.getElementById('viewModeSelect');
        const avatarInput = document.getElementById('avatarInput');
        
        if (modal) modal.classList.add('active');
        if (nameInput) nameInput.value = currentUser.name;
        if (masterVolumeSlider) {
            masterVolumeSlider.value = masterVolume * 100;
            document.getElementById('masterVolumeValue').textContent = Math.round(masterVolume * 100) + '%';
        }
        if (micVolumeSlider) {
            micVolumeSlider.value = micVolume * 100;
            document.getElementById('micVolumeValue').textContent = Math.round(micVolume * 100) + '%';
        }
        if (viewModeSelect) viewModeSelect.value = viewMode;
        if (avatarInput) avatarInput.value = currentUser.avatar;
    };
    
    window.closeSettings = function() {
        const modal = document.getElementById('settingsModal');
        if (modal) modal.classList.remove('active');
    };
    
    window.updateMasterVolume = function(value) {
        masterVolume = value / 100;
        localStorage.setItem('masterVolume', masterVolume);
        document.getElementById('masterVolumeValue').textContent = value + '%';
        
        // Apply to all audio elements
        audioElements.forEach((audio) => {
            if (audio && !audio.paused) {
                audio.volume = masterVolume;
            }
        });
        
        Logger.info(`Master volume: ${value}%`);
    };
    
    window.updateMicVolume = function(value) {
        micVolume = value / 100;
        localStorage.setItem('micVolume', micVolume);
        document.getElementById('micVolumeValue').textContent = value + '%';
        
        if (localStream) {
            const audioTrack = localStream.getAudioTracks()[0];
            if (audioTrack) {
                // Note: This requires AudioContext for precise control
                Logger.info(`Mic volume: ${value}%`);
            }
        }
    };
    
    window.changeViewMode = function(mode) {
        viewMode = mode;
        const participantsContainer = document.getElementById('participantsContainer');
        
        if (participantsContainer) {
            participantsContainer.className = `view-mode-${mode}`;
        }
        
        Logger.info(`View mode: ${mode}`);
    };
    
    window.saveSettings = function() {
        const newName = document.getElementById('userNameInput')?.value.trim();
        const newAvatar = document.getElementById('avatarInput')?.value || '👤';
        const newColor = document.getElementById('avatarColorPicker')?.value || '#4CAF50';
        
        if (newName && newName.length > 0) {
            currentUser.name = newName;
            currentUser.avatar = newAvatar;
            currentUser.avatarColor = newColor;
            
            localStorage.setItem('userName', newName);
            localStorage.setItem('userAvatar', newAvatar);
            localStorage.setItem('avatarColor', newColor);
            
            socket.emit('update-user', {
                roomId,
                userId: currentUser.id,
                userName: newName,
                role: currentUser.role,
                avatar: newAvatar,
                avatarColor: newColor
            });
            
            updateParticipantsUI();
            addSystemMessage(`✅ Configuración actualizada`);
            showSystemNotification('✅ Configuración guardada', 'success');
        }
        
        closeSettings();
    };
    
    // ═══════════════════════════════════════════════════════
    // 🔧 AUDIO FUNCTIONS - CRITICAL FIX WITH RETRY
    // ═══════════════════════════════════════════════════════
    
    async function startAudioWithRetry(retryCount = 0, maxRetries = 3) {
        try {
            Logger.info(`🎤 Requesting microphone... (attempt ${retryCount + 1}/${maxRetries + 1})`);
            
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
            
            Logger.success('✅✅ Microphone GRANTED - Stream ready');
            Logger.debug('Audio tracks:', localStream.getAudioTracks().length);
            
            socket.emit('user-ready', {
                roomId: roomId,
                userName: currentUser.name,
                role: currentUser.role
            });
            
            // Connect to existing participants
            Logger.peer(`Connecting to ${participants.size} existing participants...`);
            
            let connectedCount = 0;
            participants.forEach((userData, userId) => {
                if (!peers[userId]) {
                    Logger.peer(`→ Connecting to ${userData.userName}...`);
                    connectToNewUser(userId);
                    connectedCount++;
                }
            });
            
            if (connectedCount === 0) {
                Logger.info('No existing participants to connect');
            } else {
                Logger.success(`Initiated ${connectedCount} peer connections`);
            }
            
        } catch (err) {
            Logger.error(`❌ Microphone access failed (attempt ${retryCount + 1}):`, err.message);
            
            if (retryCount < maxRetries) {
                const delay = Math.min(1000 * Math.pow(2, retryCount), 5000);
                Logger.warn(`Retrying in ${delay}ms...`);
                
                setTimeout(() => {
                    startAudioWithRetry(retryCount + 1, maxRetries);
                }, delay);
            } else {
                Logger.error('❌ Max retries reached');
                alert('⚠️ No se pudo acceder al micrófono.\n\nVerifica:\n1. Permisos del navegador\n2. Ninguna otra app usa el micrófono\n3. El micrófono está conectado');
            }
        }
    }
    
    function connectToNewUser(userId) {
        if (!localStream) {
            Logger.error('❌ Cannot connect - no local stream');
            return;
        }
        
        if (peers[userId]) {
            Logger.warn(`Peer already exists for ${userId.slice(0, 8)}...`);
            return;
        }
        
        Logger.peer(`Creating INITIATOR peer for ${userId.slice(0, 8)}...`);
        
        const peer = new SimplePeer({ 
            initiator: true, 
            stream: localStream, 
            trickle: false,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' }
                ]
            }
        });
        
        setupPeerHandlers(peer, userId);
        peers[userId] = peer;
    }
    
    function playAudioStream(userId, stream) {
        Logger.audio(`🔊 Setting up audio playback for ${userId.slice(0, 8)}...`);
        
        // Clean up existing audio element
        cleanupAudioElement(userId);
        
        const audio = document.createElement('audio');
        audio.id = `audio-${userId}`;
        audio.srcObject = stream;
        audio.autoplay = true;
        audio.volume = masterVolume;
        audio.style.display = 'none';
        
        audio.addEventListener('loadedmetadata', () => {
            Logger.audio(`📻 Metadata loaded for ${userId.slice(0, 8)}...`);
            audio.play()
                .then(() => {
                    Logger.success(`✅✅ AUDIO PLAYING for ${userId.slice(0, 8)}...`);
                })
                .catch(err => {
                    Logger.error(`❌ Failed to play audio for ${userId.slice(0, 8)}...:`, err.message);
                    
                    // Try to play again after user interaction
                    document.addEventListener('click', () => {
                        audio.play().catch(e => Logger.error('Retry failed:', e));
                    }, { once: true });
                });
        });
        
        audio.addEventListener('error', (e) => {
            Logger.error(`❌ Audio error for ${userId.slice(0, 8)}...:`, e);
        });
        
        audio.addEventListener('playing', () => {
            Logger.success(`▶️ Audio started playing for ${userId.slice(0, 8)}...`);
        });
        
        document.body.appendChild(audio);
        audioElements.set(userId, audio);
        
        Logger.debug(`Audio element created and added to DOM for ${userId.slice(0, 8)}`);
    }
    
    function cleanupAudioElement(userId) {
        const existingAudio = document.getElementById(`audio-${userId}`);
        if (existingAudio) {
            Logger.debug(`Cleaning up audio element for ${userId.slice(0, 8)}...`);
            existingAudio.pause();
            existingAudio.srcObject = null;
            existingAudio.remove();
        }
        audioElements.delete(userId);
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
        label.textContent = `📊 ${userName} - Charts`;
        
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
        messageDiv.className = 'chat-message system';
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
    
    function updateParticipantsUI() {
        const listDiv = document.getElementById('participantsList');
        const countSpan = document.getElementById('participantCount');
        
        if (!listDiv || !countSpan) {
            Logger.warn('Participants UI elements not found');
            return;
        }
        
        const totalCount = participants.size + 1;
        listDiv.innerHTML = '';
        countSpan.textContent = totalCount;
        
        Logger.info(`📊 Updating participants UI: ${totalCount} traders`);
        
        // Add current user
        addParticipantCard(
            currentUser.id, 
            currentUser.name, 
            currentUser.role, 
            currentUser.handRaised, 
            false,
            true,
            currentUser.avatar,
            currentUser.avatarColor
        );
        
        // Add others
        participants.forEach((userData, userId) => {
            addParticipantCard(
                userId, 
                userData.userName, 
                userData.role || 'participant', 
                userData.handRaised, 
                userData.isMuted,
                false,
                userData.avatar || '👤',
                userData.avatarColor || '#4CAF50'
            );
        });
    }
    
    function addParticipantCard(userId, userName, role, handRaised, isMuted, isSelf, avatar, avatarColor) {
        const listDiv = document.getElementById('participantsList');
        if (!listDiv) return;
        
        const card = document.createElement('div');
        card.className = 'participant-card';
        card.id = `participant-${userId}`;
        
        const roleIcon = role === 'host' ? '👑' : '';
        const handIcon = handRaised ? '✋' : '';
        const micIcon = isMuted ? '🔇' : '🎤';
        const selfLabel = isSelf ? ' (Tú)' : '';
        
        card.innerHTML = `
            <div class="participant-avatar-circle" style="background: ${avatarColor}">
                ${avatar}
            </div>
            <div class="participant-details">
                <div class="participant-name">${userName}${selfLabel}</div>
                <div class="participant-status-icons">
                    ${roleIcon ? `<span class="status-icon">${roleIcon}</span>` : ''}
                    ${handIcon ? `<span class="status-icon">${handIcon}</span>` : ''}
                    <span class="status-icon">${micIcon}</span>
                </div>
            </div>
        `;
        
        listDiv.appendChild(card);
    }
    
    function updateConnectionStatus(status) {
        const statusIndicator = document.getElementById('connectionStatus');
        if (!statusIndicator) return;
        
        statusIndicator.className = 'connection-status';
        
        switch(status) {
            case 'connected':
                statusIndicator.classList.add('connected');
                statusIndicator.textContent = '🟢 Live';
                break;
            case 'disconnected':
                statusIndicator.classList.add('disconnected');
                statusIndicator.textContent = '🔴 Offline';
                break;
            case 'reconnecting':
                statusIndicator.classList.add('reconnecting');
                statusIndicator.textContent = '🟡 Reconnecting...';
                break;
            case 'failed':
                statusIndicator.classList.add('failed');
                statusIndicator.textContent = '❌ Failed';
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
    // COLLABORATIVE DRAWING (All users can draw)
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
        updateParticipantsUI();
    }, 100);
    
    Logger.success('🚀 OZYMEET ULTIMATE PRO initialized successfully');
}
