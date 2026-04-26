# EchoBloom

Sound-reactive digital art project using p5.js and ml5.js (Teachable Machine).

## What It Does

- Listens for sound via microphone
- Classifies sounds into: shake, knock, clap
- Plays corresponding audio and displays reactive streamgraph visuals
- Visual colors: shake (blue/teal), knock (red/purple), clap (orange/yellow-green)

## How to Run

### Option 1: VS Code Live Server
1. Open the project folder in VS Code
2. Install "Live Server" extension if not installed
3. Right-click `index.html` → "Open with Live Server"

### Option 2: Python HTTP Server
```bash
cd /path/to/EchoBloom
python -m http.server 8000
```
Then open http://localhost:8000 in browser

### Option 3: Any Static Server
Serve the project directory with any static file server.

## Why a Local Server?

Browser security (CORS) blocks loading local files (audio, model) directly from `file://`. A local server bypasses this.

## Required Files - READ THIS

### Audio Files (YOU MUST PROVIDE)
Place these in `assets/audio/`:
- `assets/audio/knock.mp3`
- `assets/audio/shake.mp3`
- `assets/audio/clap.mp3`

### Model Files (YOU MUST PROVIDE)
The Teachable Machine model must be downloaded from your project:

1. Go to https://teachablemachine.withgoogle.com/train/audio
2. Open your project (the URL was: `https://teachablemachine.withgoogle.com/models/X9qbfDK3G/`)
3. Click "Export My Model" → "Download my model"
4. Extract and place in `assets/model/`:
   - `assets/model/model.json`
   - `assets/model/metadata.json`
   - `assets/model/weights.bin` (or similar binary file)

## Controls

- **Click** - Start listening (required for browser audio)
- **Space** - Start listening (alternative)
- **R** - Reset visualization
- **M** - Mute/stop playback

## Microphone Permission

The browser will ask for microphone access on first start. Allow it for sound classification to work.

## Common Issues

1. **CORS errors**: Use a local server, not file://
2. **Model fails to load**: Ensure model.json is in `assets/model/` and model URL in sketch.js matches
3. **Audio won't play**: Click once to unlock browser audio
4. **Classification not working**: Check microphone permission, model files, and confidence threshold (currently 0.7)

## Project Structure

```
EchoBloom/
├── index.html          # Entry point
├── sketch.js           # Main p5.js sketch
├── style.css           # Basic styling
├── assets/
│   ├── audio/          # MP3 files (YOU provide)
│   ├── gif/            # GIF assets (optional)
│   └── model/          # Teachable Machine model (YOU provide)
└── README.md
```

## Editing

To modify visuals, edit `sketch.js`. The core logic is preserved from the original p5 Web Editor project.

## Libraries Used

- p5.js 1.9.0
- p5.sound 1.9.0
- ml5.js 0.12.2
