const socket = io();
const peers = {};
const audioElements = new Map();

let localStream = null;
let screenStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let currentTool = 'pen';
let currentColor = '#000000';
let currentStrokeWidth = 3;
let isDrawing = false;
let whiteboardContext = null;

const roomId = window.location.pathname.split('/').pop();
document.getElementById('roomIdDisplay').textContent = roomId;

async function init() {
    try {
        console.log('🎤 Iniciando captura de audio...');
        
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: false
        });

        console.log('✅ Audio capturado correctamente');
        
        socket.emit('join-room', roomId);
        
        initControls();
        initWhiteboard();
        initChat();
        loadDevices();
        
    } catch (error) {
        console.error('❌ Error al capturar audio:', error);
        alert('Error al acceder al micrófono. Verifica los permisos del navegador.');
    }
}

socket.on('joined-room', ({ existingUsers }) => {
    console.log('✅ Unido a la sala. Usuarios existentes:', existingUsers);
    
    existingUsers.forEach(userId => {
        if (userId !== socket.id) {
            connectToNewUser(userId);
        }
    });
});

socket.on('user-connected', userId => {
    console.log('👤 Nuevo usuario conectado:', userId);
    connectToNewUser(userId);
});

socket.on('user-disconnected', userId => {
    console.log('👋 Usuario desconectado:', userId);
    if (peers[userId]) {
        peers[userId].destroy();
        delete peers[userId];
    }
    
    if (audioElements.has(userId)) {
        const audio = audioElements.get(userId);
        audio.remove();
        audioElements.delete(userId);
    }
    
    updateParticipantsList();
});

socket.on('chat-message', ({ userId, message, sender }) => {
    addChatMessage(sender || 'Usuario', message);
});

socket.on('emoji-sent', ({ emoji, userId }) => {
    showFloatingEmoji(emoji);
});

socket.on('whiteboard-draw', (data) => {
    if (whiteboardContext && document.getElementById('whiteboardModal').classList.contains('active')) {
        drawOnCanvas(data);
    }
});

socket.on('whiteboard-clear', () => {
    if (whiteboardContext) {
        clearWhiteboardCanvas();
    }
});

function connectToNewUser(userId) {
    console.log(`🔗 Conectando con usuario: ${userId}`);
    
    if (!localStream) {
        console.error('❌ No hay stream local disponible');
        return;
    }
    
    try {
        const peer = new SimplePeer({
            initiator: true,
            trickle: false,
            stream: localStream,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ]
            }
        });

        peer.on('signal', signal => {
            console.log(`📡 Enviando señal a ${userId}`);
            socket.emit('signal', { to: userId, signal });
        });

        peer.on('stream', remoteStream => {
            console.log(`🎵 Stream recibido de ${userId}`);
            addAudioStream(userId, remoteStream);
        });

        peer.on('error', err => {
            console.error(`❌ Error con peer ${userId}:`, err);
        });

        peers[userId] = peer;
        
    } catch (error) {
        console.error(`❌ Error al crear peer para ${userId}:`, error);
    }
}

socket.on('signal', async ({ from, signal }) => {
    console.log(`📡 Señal recibida de ${from}`);
    
    try {
        if (peers[from]) {
            peers[from].signal(signal);
        } else {
            const peer = new SimplePeer({
                initiator: false,
                trickle: false,
                stream: localStream,
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' }
                    ]
                }
            });

            peer.on('signal', responseSignal => {
                console.log(`📡 Enviando señal de respuesta a ${from}`);
                socket.emit('signal', { to: from, signal: responseSignal });
            });

            peer.on('stream', remoteStream => {
                console.log(`🎵 Stream recibido de ${from}`);
                addAudioStream(from, remoteStream);
            });

            peer.on('error', err => {
                console.error(`❌ Error con peer ${from}:`, err);
            });

            peer.signal(signal);

            peers[from] = peer;
        }
    } catch (error) {
        console.error(`❌ Error al procesar señal de ${from}:`, error);
    }
});

function addAudioStream(userId, stream) {
    if (audioElements.has(userId)) {
        console.log(`⚠️ Audio element ya existe para ${userId}, actualizando...`);
        const existingAudio = audioElements.get(userId);
        existingAudio.srcObject = stream;
        return;
    }

    const audio = document.createElement('audio');
    audio.srcObject = stream;
    audio.autoplay = true;
    audio.playsInline = true;
    
    const playAudio = async (retries = 3) => {
        try {
            await audio.play();
            console.log(`✅ Reproduciendo audio de ${userId}`);
        } catch (error) {
            console.warn(`⚠️ Intento de reproducción falló (${4 - retries}/3):`, error);
            if (retries > 0) {
                setTimeout(() => playAudio(retries - 1), 1000);
            } else {
                console.error(`❌ No se pudo reproducir audio de ${userId}:`, error);
            }
        }
    };

    document.body.appendChild(audio);
    audioElements.set(userId, audio);
    
    playAudio();
    
    updateParticipantsList();
}

function updateParticipantsList() {
    const participantsList = document.getElementById('participantsList');
    const participantCount = document.getElementById('participantCount');
    
    const totalUsers = Object.keys(peers).length + 1;
    participantCount.textContent = totalUsers;
    
    participantsList.innerHTML = `
        <div class="participant-item">
            <i class="fas fa-microphone"></i>
            <span>Tú</span>
        </div>
    `;
    
    Object.keys(peers).forEach((userId, index) => {
        participantsList.innerHTML += `
            <div class="participant-item">
                <i class="fas fa-microphone"></i>
                <span>Usuario ${index + 1}</span>
            </div>
        `;
    });
}

function initControls() {
    const toggleMic = document.getElementById('toggleMic');
    const shareScreen = document.getElementById('shareScreen');
    const openWhiteboard = document.getElementById('openWhiteboard');
    const recordBtn = document.getElementById('recordBtn');
    const toggleChat = document.getElementById('toggleChat');
    const settingsBtn = document.getElementById('settingsBtn');
    const leaveRoom = document.getElementById('leaveRoom');

    let isMuted = false;
    toggleMic.addEventListener('click', () => {
        isMuted = !isMuted;
        if (localStream) {
            localStream.getAudioTracks()[0].enabled = !isMuted;
        }
        
        toggleMic.classList.toggle('danger', isMuted);
        toggleMic.classList.toggle('primary', !isMuted);
        toggleMic.querySelector('i').className = isMuted ? 'fas fa-microphone-slash' : 'fas fa-microphone';
    });

    shareScreen.addEventListener('click', async () => {
        if (screenStream) {
            stopScreenShare();
        } else {
            await startScreenShare();
        }
    });

    openWhiteboard.addEventListener('click', () => {
        document.getElementById('whiteboardModal').classList.add('active');
        resizeWhiteboardCanvas();
    });

    let isRecording = false;
    recordBtn.addEventListener('click', () => {
        if (isRecording) {
            stopRecording();
            recordBtn.classList.remove('danger');
            recordBtn.classList.add('secondary');
            recordBtn.querySelector('i').className = 'fas fa-circle';
        } else {
            startRecording();
            recordBtn.classList.remove('secondary');
            recordBtn.classList.add('danger');
            recordBtn.querySelector('i').className = 'fas fa-stop';
        }
        isRecording = !isRecording;
    });

    toggleChat.addEventListener('click', () => {
        document.getElementById('chatPanel').classList.toggle('active');
        toggleChat.classList.toggle('active');
    });

    settingsBtn.addEventListener('click', () => {
        document.getElementById('settingsModal').classList.add('active');
    });

    leaveRoom.addEventListener('click', () => {
        if (confirm('¿Estás seguro de que quieres salir?')) {
            window.location.href = '/';
        }
    });

    document.querySelectorAll('.reaction-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const emoji = btn.dataset.emoji;
            socket.emit('send-emoji', { emoji, roomId });
            showFloatingEmoji(emoji);
        });
    });
}

async function startScreenShare() {
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: 'always'
            },
            audio: false
        });

        const screenVideo = document.getElementById('sharedScreen');
        screenVideo.srcObject = screenStream;
        
        document.getElementById('sharedScreenContainer').classList.add('active');
        document.getElementById('noScreenMessage').style.display = 'none';
        
        document.getElementById('shareScreen').classList.add('active');

        screenStream.getVideoTracks()[0].onended = () => {
            stopScreenShare();
        };

        socket.emit('screen-share-started', roomId);

    } catch (error) {
        console.error('Error al compartir pantalla:', error);
        alert('No se pudo compartir la pantalla');
    }
}

function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }

    document.getElementById('sharedScreenContainer').classList.remove('active');
    document.getElementById('noScreenMessage').style.display = 'block';
    document.getElementById('shareScreen').classList.remove('active');
    
    socket.emit('screen-share-stopped', roomId);
}

function startRecording() {
    try {
        if (!localStream) {
            alert('No hay audio para grabar');
            return;
        }

        recordedChunks = [];
        mediaRecorder = new MediaRecorder(localStream, {
            mimeType: 'audio/webm'
        });

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'audio/webm' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `ozymeet-recording-${Date.now()}.webm`;
            a.click();
            
            URL.revokeObjectURL(url);
        };

        mediaRecorder.start(1000);
        console.log('🔴 Grabación iniciada');
        
    } catch (error) {
        console.error('Error al iniciar grabación:', error);
        alert('No se pudo iniciar la grabación');
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        console.log('⏹️ Grabación detenida');
    }
}

function initWhiteboard() {
    const canvas = document.getElementById('whiteboardCanvas');
    whiteboardContext = canvas.getContext('2d');

    document.getElementById('closeWhiteboard').addEventListener('click', () => {
        document.getElementById('whiteboardModal').classList.remove('active');
    });

    document.querySelectorAll('.whiteboard-btn[data-tool]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.whiteboard-btn[data-tool]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentTool = btn.dataset.tool;
        });
    });

    const colorPickerBtn = document.getElementById('colorPickerBtn');
    const colorPickerDropdown = document.getElementById('colorPickerDropdown');

    colorPickerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        colorPickerDropdown.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
        if (!colorPickerDropdown.contains(e.target) && e.target !== colorPickerBtn) {
            colorPickerDropdown.classList.remove('active');
        }
    });

    document.querySelectorAll('.color-option').forEach(option => {
        option.addEventListener('click', () => {
            currentColor = option.dataset.color;
            
            document.getElementById('currentColorPreview').style.background = currentColor;
            
            document.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');
            
            colorPickerDropdown.classList.remove('active');
        });
    });

    const strokeWidth = document.getElementById('strokeWidth');
    const strokeWidthValue = document.getElementById('strokeWidthValue');
    
    strokeWidth.addEventListener('input', () => {
        currentStrokeWidth = strokeWidth.value;
        strokeWidthValue.textContent = `${currentStrokeWidth}px`;
    });

    document.getElementById('clearCanvas').addEventListener('click', () => {
        clearWhiteboardCanvas();
        socket.emit('whiteboard-clear', roomId);
    });

    let lastX = 0;
    let lastY = 0;

    canvas.addEventListener('mousedown', (e) => {
        isDrawing = true;
        const rect = canvas.getBoundingClientRect();
        lastX = e.clientX - rect.left;
        lastY = e.clientY - rect.top;
    });

    canvas.addEventListener('mousemove', (e) => {
        if (!isDrawing) return;
        
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const drawData = {
            tool: currentTool,
            color: currentColor,
            width: currentStrokeWidth,
            startX: lastX,
            startY: lastY,
            endX: x,
            endY: y
        };

        drawOnCanvas(drawData);
        socket.emit('whiteboard-draw', { roomId, data: drawData });

        lastX = x;
        lastY = y;
    });

    canvas.addEventListener('mouseup', () => {
        isDrawing = false;
    });

    canvas.addEventListener('mouseleave', () => {
        isDrawing = false;
    });
}

function drawOnCanvas(data) {
    if (!whiteboardContext) return;

    whiteboardContext.beginPath();
    whiteboardContext.moveTo(data.startX, data.startY);
    whiteboardContext.lineTo(data.endX, data.endY);
    
    if (data.tool === 'pen') {
        whiteboardContext.strokeStyle = data.color;
        whiteboardContext.lineWidth = data.width;
        whiteboardContext.globalCompositeOperation = 'source-over';
    } else if (data.tool === 'eraser') {
        whiteboardContext.strokeStyle = '#ffffff';
        whiteboardContext.lineWidth = data.width * 3;
        whiteboardContext.globalCompositeOperation = 'destination-out';
    }
    
    whiteboardContext.lineCap = 'round';
    whiteboardContext.lineJoin = 'round';
    whiteboardContext.stroke();
}

function clearWhiteboardCanvas() {
    if (!whiteboardContext) return;
    const canvas = document.getElementById('whiteboardCanvas');
    whiteboardContext.clearRect(0, 0, canvas.width, canvas.height);
}

function resizeWhiteboardCanvas() {
    const canvas = document.getElementById('whiteboardCanvas');
    const container = canvas.parentElement;
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
}

function initChat() {
    const chatInput = document.getElementById('chatInput');
    const sendChat = document.getElementById('sendChat');
    const closeChat = document.getElementById('closeChat');

    sendChat.addEventListener('click', sendChatMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendChatMessage();
        }
    });

    closeChat.addEventListener('click', () => {
        document.getElementById('chatPanel').classList.remove('active');
        document.getElementById('toggleChat').classList.remove('active');
    });
}

function sendChatMessage() {
    const chatInput = document.getElementById('chatInput');
    const message = chatInput.value.trim();
    
    if (message) {
        socket.emit('send-chat', { roomId, message, sender: 'Tú' });
        addChatMessage('Tú', message);
        chatInput.value = '';
    }
}

function addChatMessage(sender, message) {
    const chatMessages = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message';
    messageDiv.innerHTML = `
        <div class="sender">${sender}</div>
        <div class="text">${message}</div>
    `;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showFloatingEmoji(emoji) {
    const emojiElement = document.createElement('div');
    emojiElement.className = 'floating-emoji';
    emojiElement.textContent = emoji;
    
    const randomX = Math.random() * (window.innerWidth - 100) + 50;
    emojiElement.style.left = `${randomX}px`;
    emojiElement.style.bottom = '150px';
    
    document.body.appendChild(emojiElement);
    
    setTimeout(() => {
        emojiElement.remove();
    }, 3000);
}

async function loadDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioDevices = devices.filter(device => device.kind === 'audioinput');
        
        const micSelect = document.getElementById('microphoneSelect');
        micSelect.innerHTML = '';
        
        audioDevices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.textContent = device.label || `Micrófono ${micSelect.length + 1}`;
            micSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error al cargar dispositivos:', error);
    }
}

document.getElementById('closeSettings').addEventListener('click', () => {
    document.getElementById('settingsModal').classList.remove('active');
});

document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.classList.remove('active');
        }
    });
});

window.addEventListener('load', init);

window.addEventListener('beforeunload', () => {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
    }
    Object.values(peers).forEach(peer => peer.destroy());
});
