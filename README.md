## Interactive Virtual Museum (A‑Frame) — VirtuMuseum

Project for the course **Interaction and User Experience (VR/AR)**.

<img width="1440" height="900" alt="Image" src="https://github.com/user-attachments/assets/c86ffd17-c35d-4bbe-8dca-250e4f6417e5" />

### Goal (summary)

Create a **desktop/mobile VR** virtual museum experience with an **automatic guided tour**, **free exploration**, informative **hotspots**, and **multimedia** (3D + audio + 360 panorama/video).

### Key features

- **Guided tour** with stops (movement + orientation) and panel text.
- **Free exploration** with WASD (desktop) and look-controls (mouse/touch).
- Clickable **hotspots** with information + audio/feedback.
- **Menu/overlay** with:
  - Start/Pause/Resume/Stop
  - Teleport to stops
  - Volume / ambient music
  - **360 Panorama** and **360 Video** mode
  - Help (shortcuts) + accessibility (reduced motion)
- **Voice (Web Speech)**: commands like “start tour”, “pause”, “resume”, “stop”, “next”, “help”.
- **Audio without required local files**: ambient music

### Use cases (1–2)

1. **Guided tour**: a user enters the museum and follows a route with stops and contextual information.
2. **Explore + discover**: a user explores freely and clicks hotspots to get details and hear narration.

### Tested hardware/tech (suggestion for the report)

- **Desktop**: keyboard + mouse (WASD + click; shortcuts).
- **Smartphone/tablet**: touch (look-controls) + UI; (optional) gyroscope via browser.
- **Software**: A‑Frame 1.5; WebAudio/Tone.js; Web Speech API (when supported).

### How to run

Recommended to serve via HTTP (ES modules and media load more reliably this way).

```bash
cd /Users/tn/Documents/uni/ieedu/virtumuseum
python3 -m http.server 8000
```

Then open `http://localhost:8000/`.

### Project structure

- `index.html`: main page (A‑Frame scene + UI).
- `src/css/style.css`: UI styles.
- `src/js/app.js`: main logic (UI + A‑Frame components + audio + voice).
- `src/assets/models/museu.glb`: 3D museum model.
- `src/assets/*`: placeholders for local media (replace with your own files if you want).

### Credits / references

- A‑Frame examples: `https://aframe.io/aframe/examples/`
- VR heuristics (NN/g): `https://www.nngroup.com/articles/usability-heuristics-virtual-reality/`
