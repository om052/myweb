require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');

const User = require('./models/User');
const Script = require('./models/Script');
const ShortFilm = require('./models/ShortFilm');
const ChatMessage = require('./models/ChatMessage');
const Request = require('./models/Request');
const adminAuth = require('./middleware/admin');

const app = express();
const server = http.createServer(app);

// ================= SOCKET.IO =================
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// ================= MIDDLEWARE =================
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ================= API ROUTES =================
app.use("/api/auth", require("./routes/auth"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/script", require("./routes/script"));
app.use("/api/profile", require("./routes/profile"));
app.use("/api/chat", require("./routes/chat"));
app.use("/api/shortfilm", require("./routes/shortfilm"));
app.use("/api/requests", require("./routes/requests"));

// ================= FRONTEND (RENDER SAFE FIX) =================
// backend/ and frontend/ must be at same level
const frontendPath = path.join(__dirname, "../frontend");

app.use(express.static(frontendPath));

app.get("/", (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

// ================= MONGODB =================
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("MongoDB Connected");

    // OPTIONAL (keep commented for production)
    // await createAdminUser();
    // await populateSampleData();

  })
  .catch(err => console.log("Mongo error:", err));

// ================= ADMIN CREATION =================
async function createAdminUser() {
  try {
    const existingAdmin = await User.findOne({ email: 'admin@hackthon.com' });

    if (!existingAdmin) {
      const hashedPassword = await bcrypt.hash("admin123", 10);

      const adminUser = new User({
        name: "Platform Administrator",
        email: "admin@hackthon.com",
        password: hashedPassword,
        isAdmin: true,
        isVerified: true,
        roles: ["admin"],
        bio: "Platform Administrator",
        roleInFilm: "Administrator",
        skills: "Management, Moderation"
      });

      await adminUser.save();
      console.log("Admin created: admin@hackthon.com / admin123");
    } else {
      console.log("Admin already exists");
    }
  } catch (err) {
    console.log("Admin creation error:", err.message);
  }
}

// ================= SAMPLE DATA =================
async function populateSampleData() {
  try {
    const userCount = await User.countDocuments();
    if (userCount > 0) {
      console.log("Sample data already exists");
      return;
    }

    const password = await bcrypt.hash("password123", 10);

    const users = await User.insertMany([
      { name: "John", email: "john@test.com", password, roles: ["user"] },
      { name: "Jane", email: "jane@test.com", password, roles: ["user"] }
    ]);

    const scripts = await Script.insertMany([
      {
        title: "Demo Script",
        description: "Test script",
        content: "Story here...",
        uploadedBy: users[0]._id,
        status: "approved"
      }
    ]);

    await ChatMessage.insertMany([
      {
        projectId: scripts[0]._id,
        sender: users[0]._id,
        message: "Hello team",
        messageType: "text"
      }
    ]);

    console.log("Sample data inserted");
  } catch (err) {
    console.log("Sample data error:", err.message);
  }
}

// ================= STATIC UPLOADS =================
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ================= API FALLBACK =================
app.use('/api', (req, res) => {
  res.status(404).json({ message: 'API endpoint not found' });
});

// ================= GLOBAL ERROR HANDLER =================
app.use((err, req, res, next) => {
  console.error("Global error:", err.stack);
  if (!res.headersSent) {
    res.status(500).json({ message: "Internal server error" });
  }
});

// ================= SOCKET.IO =================
const onlineUsers = new Map();

io.on('connection', (socket) => {
  console.log("User connected:", socket.id);

  socket.on('joinProject', async (projectId) => {
    try {
      const token = socket.handshake.auth.token;
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);

      socket.join(projectId);
      socket.projectId = projectId;
      socket.user = user;

      if (!onlineUsers.has(projectId)) {
        onlineUsers.set(projectId, new Set());
      }

      onlineUsers.get(projectId).add(socket.id);

      io.to(projectId).emit("onlineUsers", onlineUsers.get(projectId).size);
      io.to(projectId).emit("userJoined", user);
    } catch (err) {
      console.log("Join error:", err.message);
    }
  });

  socket.on('sendMessage', async (data) => {
    try {
      const message = new ChatMessage({
        projectId: data.projectId,
        sender: socket.user._id,
        message: data.message,
        messageType: data.messageType || "text"
      });

      await message.save();

      const populated = await ChatMessage
        .findById(message._id)
        .populate("sender", "name");

      io.to(data.projectId).emit("message", populated);
    } catch (err) {
      console.log("Message error:", err.message);
    }
  });

  socket.on('disconnect', () => {
    if (socket.projectId && onlineUsers.has(socket.projectId)) {
      onlineUsers.get(socket.projectId).delete(socket.id);
      io.to(socket.projectId).emit(
        "onlineUsers",
        onlineUsers.get(socket.projectId).size
      );
    }
    console.log("User disconnected:", socket.id);
  });
});

// ================= SERVER =================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
