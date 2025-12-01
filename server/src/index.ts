import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { AccessToken } from 'livekit-server-sdk';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});

const PORT = process.env.PORT || 3001;

// LiveKit Configuration
const createToken = (roomName: string, participantName: string) => {
    const at = new AccessToken(
        process.env.LIVEKIT_API_KEY,
        process.env.LIVEKIT_API_SECRET,
        {
            identity: participantName,
            ttl: '10m',
        },
    );
    at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });
    return at.toJwt();
};

app.get('/', (req, res) => {
    res.send('Meet Pro API Server Running');
});

app.post('/api/token', async (req, res) => {
    const { room, username } = req.body;
    if (!room || !username) {
        return res.status(400).json({ error: 'Missing room or username' });
    }

    try {
        const token = await createToken(room, username);
        res.json({ token });
    } catch (error) {
        console.error('Error creating token:', error);
        res.status(500).json({ error: 'Could not create token' });
    }
});

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join_room', (data) => {
        socket.join(data.room);
        console.log(`User ${socket.id} joined room ${data.room}`);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
