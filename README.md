# We Share 🚀

Mobile-first cloud media sharing and live streaming platform with real-time chat.

## Features

- **Live Streaming**: Low-latency peer-to-peer video broadcasting using WebRTC.
- **Signaling Server**: Full-stack Express + Socket.io backend for WebRTC handshakes.
- **Real-Time Chat**: Instant messaging integrated into every live stream via Firebase Firestore.
- **Google Authentication**: Secure user login and profile management.
- **Responsive UI**: High-performance, dark-themed interface built with Tailwind CSS and Framer Motion.

## Tech Stack

- **Frontend**: React 19, Vite, Tailwind CSS, Framer Motion, Lucide Icons.
- **Backend**: Node.js, Express, Socket.io.
- **Database/Auth**: Firebase (Firestore, Auth).
- **Communication**: WebRTC (RTCPeerConnection).

## Getting Started

### Prerequisites

- Node.js (v18+)
- A Firebase Project

### Installation

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up your Firebase configuration in `firebase-applet-config.json`.
4. Start the development server:
   ```bash
   npm run dev
   ```

## Deployment

### Vercel Deployment Note

This application uses a custom Express server with **Socket.io** for WebRTC signaling. 
- **Frontend**: Can be deployed to Vercel as a static site.
- **Backend**: Vercel Serverless Functions **do not support WebSockets**. For the signaling server to work, you should deploy the backend to a provider that supports long-running processes (e.g., **Railway, Render, or Google Cloud Run**).

#### Deploying to Cloud Run (Recommended)

This app is optimized for containerized environments like Cloud Run.
1. Build the app: `npm run build`
2. Deploy using the provided `Dockerfile` or via your CI/CD pipeline.

### Environment Variables

Ensure the following are set in your deployment environment:
- `GEMINI_API_KEY`: For AI features (if applicable).
- `APP_URL`: The public URL of your deployed application.

## License

Apache-2.0
