# LoverPlay - Couple Games

A real-time interactive couples game application with video streaming capabilities using WebRTC.

## Features

- 🎮 Real-time multiplayer gameplay via Socket.IO
- 📹 Video streaming with WebRTC peer-to-peer connection
- 🎯 AI-generated challenges powered by Google Generative AI
- 💬 Text answers and emoji reactions
- 📱 Mobile-optimized with rear camera support

## Recent Updates

### Camera Enhancement (Rear Camera Default)
The application now defaults to the **rear camera** on mobile devices to ensure compatibility with devices that have faulty front cameras. See [CAMERA_UPDATE.md](./CAMERA_UPDATE.md) for detailed information.

**Key improvements:**
- ✅ Rear camera prioritized on mobile devices
- ✅ **Camera toggle button** to switch between front/rear cameras
- ✅ Graceful fallback to front camera if rear unavailable
- ✅ Enhanced error handling for Samsung Android devices
- ✅ Debug logging for troubleshooting

## Tech Stack

### Backend
- **Node.js** (v18+)
- **Express.js** - Web server
- **Socket.IO** - Real-time communication
- **Google Generative AI** - Challenge generation

### Frontend
- **Alpine.js** - Reactive UI
- **Tailwind CSS** - Styling
- **WebRTC** - Video/audio streaming
- **Socket.IO Client** - Real-time events

## Setup

### Prerequisites
- Node.js 18 or higher
- Google Generative AI API key

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd couple-games
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   Create a `.env` file in the root directory:
   ```env
   GOOGLE_API_KEY=your_google_ai_api_key_here
   PORT=3000
   ```

4. **Start the server**
   ```bash
   npm start
   ```

5. **Access the application**
   - Local: `http://localhost:3000`
   - Mobile (same network): `http://YOUR_LOCAL_IP:3000`

## Project Structure

```
couple-games/
├── client/                 # Frontend files
│   ├── assets/
│   │   └── css/
│   │       └── style.css
│   ├── index.html         # Home page
│   ├── create.html        # Create room page
│   ├── join.html          # Join room page
│   └── play.html          # Game play page (WebRTC)
├── server/                # Backend files
│   ├── app.js            # Express server setup
│   ├── sockets.js        # Socket.IO handlers
│   ├── rooms.js          # Room management
│   ├── aiService.js      # AI challenge generation
│   └── utils/
│       └── generateRoomCode.js
├── package.json
├── .env                  # Environment variables (create this)
└── README.md
```

## How to Play

1. **Create a Room**
   - Visit the app and click "Create Room"
   - Share the generated room code with your partner

2. **Join a Room**
   - Your partner enters the room code
   - Both players are connected

3. **Start the Game**
   - Player 1 selects a game type and starts
   - Players take turns completing challenges
   - Use video streaming or text answers

4. **Video Mode**
   - Click "📷 Start Webcam" to enable video
   - Rear camera activates by default on mobile devices
   - Click "🔄" button to switch between front/rear cameras
   - Perform challenges live for your partner

## Development

### Running Locally
```bash
npm start
```

### Testing on Mobile Devices

1. **Find your local IP**
   ```bash
   # Linux/Mac
   ifconfig | grep "inet "
   
   # Windows
   ipconfig
   ```

2. **Access from mobile**
   ```
   http://YOUR_IP:3000
   ```

3. **Enable remote debugging (Android)**
   - Enable USB debugging on Android
   - Connect to computer
   - Chrome: `chrome://inspect`

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GOOGLE_API_KEY` | Google Generative AI API key | Yes |
| `PORT` | Server port (default: 3000) | No |

## Camera Implementation

The app uses `navigator.mediaDevices.getUserMedia()` with the following constraint strategy:

1. **Primary**: Force rear camera (`facingMode: { exact: "environment" }`)
2. **Fallback 1**: Prefer rear camera (`facingMode: "environment"`)
3. **Fallback 2**: Use any available camera (`video: true`)

See [CAMERA_UPDATE.md](./CAMERA_UPDATE.md) for complete implementation details.

## Browser Support

### Desktop
- Chrome 80+
- Firefox 75+
- Edge 80+
- Safari 13+

### Mobile
- Chrome for Android 53+
- Samsung Internet 6.2+
- Safari iOS 11+
- Firefox for Android 55+

## Production Deployment

### Important Considerations

1. **HTTPS Required**
   - WebRTC requires HTTPS in production
   - Only works on HTTP for `localhost` development

2. **STUN/TURN Servers**
   - Currently using Google's public STUN servers
   - Consider adding TURN servers for better connectivity

3. **CORS Configuration**
   - Update CORS settings in `server/sockets.js` for production
   - Currently allows all origins (`origin: "*"`)

4. **Environment Security**
   - Never commit `.env` file
   - Use secure key management in production

## Troubleshooting

### Camera Issues
- See [CAMERA_UPDATE.md](./CAMERA_UPDATE.md) troubleshooting section
- Check browser console for detailed logs
- Ensure HTTPS in production (required for camera access)

### Connection Issues
- Verify STUN/TURN server configuration
- Check firewall settings for WebRTC
- Ensure both players are connected to stable network

### AI Challenges Not Loading
- Verify `GOOGLE_API_KEY` is set correctly
- Check server logs for API errors
- Ensure API quota is not exceeded

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly (especially on mobile)
5. Submit a pull request

## License

[Add your license here]

## Support

For issues related to:
- **Camera functionality**: See [CAMERA_UPDATE.md](./CAMERA_UPDATE.md)
- **General bugs**: Open an issue on GitHub
- **Feature requests**: Open an issue with [Feature Request] prefix
