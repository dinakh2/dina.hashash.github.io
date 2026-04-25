# dinakh2.github.io

Personal portfolio site.

## What it is

A fully custom, interactive portfolio. The centerpiece is a 3D pixel swarm that forms my silhouette from a point cloud generated from reference photos. Everything runs as static HTML/CSS/JS deployed via GitHub Pages.

## Features

- **Pixel swarm portrait** - ~2,000 particles coalesce into a 3D point cloud of my silhouette on page load, with organic drift, pulse, and ambient spill
- **3D particle system** - particles have real XYZ coordinates sampled from front and side reference photos via a custom Node.js generation script
- **Head tracking** - the head region rotates toward the mouse in true 3D using per-particle bone-space projection
- **Mouse repulsion** - particles physically scatter from the cursor when the cursor goes through the silhouette
- **Mixamo animation layer** - a hidden Three.js skeleton drives particle regions during Easter egg animations (wave, backflip), with per-region bone calibration at animation start
- **Orbiting navigation labels** - About, Education, Experience, Portfolio float around the figure and expand into terminal-style content panels inline
- **Aurebesh Easter eggs** - Star Wars alphabet phrases in the corners that scramble-decode on hover and trigger animations or particle effects
- **Social links** - Instagram, LinkedIn, GitHub

## Stack

- Vanilla HTML + CSS + JavaScript
- Three.js r128 (via CDN) + FBXLoader for skeleton animation
- Canvas 2D for particle rendering
- GitHub Pages for hosting

## Local development

```bash
# Requires Node.js for the portrait generation scripts
npx serve .
# then open http://localhost:xxxx
```

## Portrait data generation

```bash
# Generate 2D particle map from reference photos
node scripts/generate_sample.js

# Generate 3D point cloud from front + side reference photos  
node scripts/generate_3d.js
```

Output files (`assets/js/portrait_data.js`, `assets/js/portrait_data_3d.js`) are committed and served statically. The generation scripts above only need to be re-run if reference photos change.

## Easter eggs

There are a few hidden in the corners. They're in Aurebesh. May the Force be with you.