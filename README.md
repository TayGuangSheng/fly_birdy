# Fly Birdy

Fly Birdy is a browser-based arcade flight game controlled with a webcam. Spread your arms to take off, flap to climb, lean forward to dive, and bank with your arms to steer through the course.

## Run locally

```bash
npm install
npm run dev
```

Create a production build with:

```bash
npm run build
```

The generated `dist` directory can be hosted on any static web host.

## Publish on GitHub Pages

Pushing to the `main` branch runs the included GitHub Pages workflow. In the
repository's **Settings → Pages**, select **GitHub Actions** as the deployment
source. The game is then available at
`https://<your-github-username>.github.io/<repository-name>/`.

## Camera and privacy

Fly Birdy needs camera permission to read body movement. Video stays in the browser and is not recorded or uploaded. The pose-tracking model is downloaded from its configured public CDN when the game starts.

Webcam access requires HTTPS in production. `localhost` is allowed during development.

## Controls

- Spread both arms wide to begin a run.
- Lift both arms and bring them back down to flap and climb.
- Lean forward to dive.
- Tilt your arms to bank and steer.
