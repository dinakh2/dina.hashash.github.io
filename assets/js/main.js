const canvas = document.getElementById('portrait-canvas');
const ctx = canvas.getContext('2d');

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);

// --- Config ---
const ACCENT = '#A3CFA7';
const PARTICLE_BASE_SIZE = 1.7;

// --- Easing (drag factor) ---
// EASE_INITIAL is the slow assembly pull. EASE_STEADY is the snappier speed 
// used after(1.0 = instant, 0.02 = very laggy). FORMATION_MS is how long 
// slow formation phase lasts before spring ramps up to EASE_STEADY.
const EASE_INITIAL = 0.02;
const EASE_STEADY  = 0.18;
const FORMATION_MS = 4000;
let   _formationStartMs = null;  // set by the intro timeline

let _forceSlowEndMs = 0;
let _forceSlowEase  = 0.02;

function currentEase() {
  // Intro freeze
  if (!window._introComplete || _formationStartMs === null) return 0;
  if (performance.now() < _forceSlowEndMs) return _forceSlowEase;
  const elapsed = performance.now() - _formationStartMs;
  const t = elapsed / FORMATION_MS;
  if (t >= 1) return EASE_STEADY;

  // smoothstep from EASE_INITIAL to EASE_STEADY
  const s = t * t * (3 - 2 * t);
  return EASE_INITIAL + (EASE_STEADY - EASE_INITIAL) * s;
}

const SCATTER = 0.01;
const AMBIENT_COUNT = 2000;
const REPULSE_RADIUS = 15;
const REPULSE_STRENGTH = 2;

// --- Layout state ---
let panelOpen = false;

// Figure center: 0.5 = screen center, 0.28 = left position
const FIGURE_CENTER_CLOSED = 0.5;
const FIGURE_CENTER_OPEN = 0.28;
let figureCenterX = FIGURE_CENTER_CLOSED;  // animated val
let figureCenterTarget = FIGURE_CENTER_CLOSED;


// Portrait source aspect ratio 
// Sampled at 80x120, ratio is 80/120 = 0.667
const PORTRAIT_ASPECT = 0.61;
// original: 80 / 120

// How much particles drift from their resting position
const DRIFT_AMOUNT = 2; // pixels

// --- Mouse tracking ---
const mouse = { x: -9999, y: -9999, active: false};
window.addEventListener('mousemove', e => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  mouse.active = true;
})

// --- Camera rotation ---
const camera = { rotX: 0, rotY: Math.PI };
const camTarget = { rotX: 0, rotY: Math.PI };
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let dragStartRot = { x: 0, y: 0 };

// window.addEventListener('mousedown', e => {
//   isDragging = true;
//   dragStart = { x: e.clientX, y: e.clientY };
//   dragStartRot = { x: camTarget.rotX, y: camTarget.rotY }; // already doing this
// });

// window.addEventListener('mouseup', () => { isDragging = false; });

window.addEventListener('mousemove', e => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});

// --- Figure bounds ---
// function figureRect() {
//   const figH = canvas.height * 0.6;
//   const figW = figH * PORTRAIT_ASPECT;  // respect actual aspect ratio
//   const x = canvas.width / 2 - figW / 2;
//   const y = canvas.height * 0.2;
//   return { x, y, w: figW, h: figH };
// }

function figureRect() {
  const figH = canvas.height * 0.6;
  const figW = figH * PORTRAIT_ASPECT;
  const x = canvas.width * figureCenterX - figW / 2;
  const y = canvas.height * 0.2;
  return { x, y, w: figW, h: figH };
}

// --- 3D projection ---
const FOV = 600;
function project(nx, ny, nz) {
  const r = figureRect();

  // Add Z rotation
  const baseX = r.x + nx * r.w;
  const baseY = r.y + ny * r.h;

  // Work in pixel space centered on the figure
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  let x = baseX - cx;
  let y = baseY - cy;
  let z = nz * r.w;

  // Rotate Y (left/right spin)
  const cosY = Math.cos(camera.rotY);
  const sinY = Math.sin(camera.rotY);
  const x1 = x * cosY - z * sinY;
  const z1 = x * sinY + z * cosY;

  // Rotate X (up/down tilt)
  const cosX = Math.cos(camera.rotX);
  const sinX = Math.sin(camera.rotX);
  const y1 = y * cosX - z1 * sinX;
  const z2 = y * sinX + z1 * cosX;

  const p = FOV / (FOV + z2);
  return {
    sx: cx + x1 * p,
    sy: cy + y1 * p,
    scale: p
  };
}

// --- Particle class ---
class Particle {
  constructor(normX, normY, density, isAmbient = false) {
    this.density = density;
    this.normX = normX;
    this.normY = normY;
    this.isAmbient = isAmbient;

    this.x = Math.random() * canvas.width;
    this.y = Math.random() * canvas.height;

    this.size = PARTICLE_BASE_SIZE * (0.5 + density * 0.8);

    // Pulse
    this.pulsePhase = Math.random() * Math.PI * 2;
    this.pulseSpeed = 0.02 + Math.random() * 0.03;

    // Scatter offset baked in at construction
    this.scatterX = (Math.random() - 0.5) * SCATTER;
    this.scatterY = (Math.random() - 0.5) * SCATTER;
  
    this.normZ = 0;
    this.scatterZ = (Math.random() - 0.5) * SCATTER;

    this.driftPhaseX = Math.random() * Math.PI * 2;
    this.driftPhaseY = Math.random() * Math.PI * 2;
    this.driftSpeedX = 0.004 + Math.random() * 0.006;
    this.driftSpeedY = 0.004 + Math.random() * 0.006;

    if (isAmbient) {
      // Random angle and distance - exp distribution pulls most close
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.pow(Math.random(), 0.6);  // 0-1, biased toward center
      this.ambientAngle = angle;
      this.ambientDist = dist; // normalized 0-1
      // alpha inversely proportional to dist
    }
  }

  getTarget() {
    const r = figureRect();
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;

    if (this.isAmbient) {
      const maxSpread = Math.max(r.w, r.h) * 0.75;
      return {
        tx: cx + Math.cos(this.ambientAngle) * this.ambientDist * maxSpread,
        ty: cy + Math.sin(this.ambientAngle) * this.ambientDist * maxSpread,
      };
    }

    const { sx, sy, scale } = project(
      this.normX + this.scatterX,
      this.normY + this.scatterY,
      this.normZ || 0
    );
    this.projScale = scale;

    // Head tracking
    // let headOffsetX = 0;
    // let headOffsetY = 0;
    // if (this.normY < 0.28 && mouse.active) {
    //   const normMouseX = (mouse.x / canvas.width - 0.5) * 2;
    //   const normMouseY = (mouse.y / canvas.height - 0.5) * 2;

    //   // How deep in the head region
    //   const headStrength = (0.28 - this.normY) / 0.28;

    //   headOffsetX = normMouseX * 12 * headStrength;
    //   headOffsetY = normMouseY * 5 * headStrength;
    // }

    if (this.normY < 0.28) {
      const normMouseX = (mouse.active ? mouse.x / canvas.width : 0.5) - 0.5;
      const headStrength = (0.28 - this.normY) / 0.28;
      const headRotY = normMouseX * 0.7 * headStrength;  // max ~34° rotation

      // Re-project with head rotation
      const r = figureRect();
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;

      const baseX = r.x + (this.normX + this.scatterX) * r.w;
      const baseY = r.y + (this.normY + this.scatterY) * r.h;
      let x = baseX - cx;
      let y = baseY - cy;
      let z = (this.normZ || 0) * r.w;

      // Apply head rotation first
      // const totalRotY = camera.rotY + headRotY;
      const normMouseY = (mouse.active ? mouse.y / canvas.height : 0.25) - 0.25;
      const headRotX = normMouseY * 0.2 * headStrength; // max ~23° up/down
      const totalRotY = camera.rotY + headRotY;
      const totalRotX = camera.rotX + headRotX;

      const cosY = Math.cos(totalRotY);
      const sinY = Math.sin(totalRotY);
      const x1 = x * cosY - z * sinY;
      const z1 = x * sinY + z * cosY;

      const cosX = Math.cos(totalRotX);
      const sinX = Math.sin(totalRotX);
      const y1 = y * cosX - z1 * sinX;
      const z2 = y * sinX + z1 * cosX;

      const p = FOV / (FOV + z2);
      this.projScale = p;
      return {
        tx: cx + x1 * p,
        ty: cy + y1 * p
      };
    }

    return { tx: sx /*+ headOffsetX*/, ty: sy /*+ headOffsetY*/ };
  }

  update() {

    const { tx, ty } = this.getTarget();

    // Advance drift phases
    this.driftPhaseX += this.driftSpeedX;
    this.driftPhaseY += this.driftSpeedY;

    // Resting position = target + slow drift
    const restX = tx + Math.sin(this.driftPhaseX) * DRIFT_AMOUNT;
    const restY = ty + Math.sin(this.driftPhaseY) * DRIFT_AMOUNT;

    // Spring toward drifting rest position
    const e = currentEase();
    this.x += (restX - this.x) * e;
    this.y += (restY - this.y) * e;

    // Mouse repulsion
    const dx = this.x - mouse.x;
    const dy = this.y - mouse.y;
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist < REPULSE_RADIUS && dist > 0) {
      // Closer the mouse is, make the force stronger
      const force = (1 - dist / REPULSE_RADIUS) * REPULSE_STRENGTH
      this.x += (dx / dist) * force;
      this.y += (dy / dist) * force;
    }

    // Pulse
    this.pulsePhase += this.pulseSpeed;
    this.pulseFactor = 0.7 + 0.25 * Math.sin(this.pulsePhase);
  }

  draw() {
    let baseAlpha;

    if (this.isAmbient) {
      baseAlpha = (1 - this.ambientDist) * 0.4 * this.density;
    } else {
      baseAlpha = 0.35 + this.density * 0.3;
    }

    const alpha = baseAlpha * this.pulseFactor;
    const size = this.size * (0.85 + 0.15 * this.pulseFactor);

    ctx.beginPath();
    ctx.arc(this.x, this.y, size, 0, Math.PI * 2);
    ctx.fillStyle = ACCENT;
    ctx.globalAlpha = Math.min(alpha, 1);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// spawn particles from portrait data
const particles = PORTRAIT_DATA_3D.map(([nx, ny, nz, d]) => {
  const p = new Particle(nx, ny, d);
  p.normZ = nz;
  return p;
});

// Ambient spill particles
for (let i = 0; i < AMBIENT_COUNT; i++) {
  const nx = 0.5;
  const ny = 0.5;
  const d = 0.2 + Math.random() * 0.4;
  particles.push(new Particle(nx, ny, d, true));
}

function drawGround() {
  const r = figureRect();
  const gridSize = 20;
  const spacing = 0.08;

  ctx.fillStyle = ACCENT;

  for (let gx = -gridSize / 2; gx <= gridSize / 2; gx++) {
    for (let gz = -gridSize / 2; gz <= gridSize / 2; gz++) {
      const nx = 0.5 + gx * spacing * 0.4;
      const ny = 0.9;  // near the feet
      const nz = gz * spacing * 0.4;

      const { sx, sy, scale } = project(nx, ny, nz);

      // Skip if projected off screen
      if (sx < 0 || sx > canvas.width || sy < 0 || sy > canvas.height) continue;

      const distFromCenter = Math.sqrt(gx * gx + gz * gz) / (gridSize / 2);
      const alpha = (1 - distFromCenter) * 0.2 * scale;
      if (alpha <= 0) continue;

      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(sx, sy, scale * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

// --- Panel content ---
const PANEL_CONTENT = {
  about: () => `
    <div class="panel-section">
      <div class="panel-section-title">// about</div>
      <p class="panel-text">I'm a student at Stanford University studying Computer Graphics, working at the intersection of creative expression and technical applications.</p>
      <p class="panel-text">I'm also pursuing my Master's degree in Computer Science in Artificial Intelligence, and a Research Supervisor at Stanford's Virtual Human Interaction Lab (VHIL).</p>
      <p class="panel-text">I've worked on a broad range of projects, including production stage development at Netflix and Eyeline Studios, freelance videography through Ethography, and creative management for Six of Spades Band and Sofi Manassyan.</p>
    </div>
    <div class="panel-section">
      <div class="panel-section-title">// what i'm doing</div>
      <div class="timeline-entry">
        <div class="timeline-entry-title">Production Research & Development</div>
        <div class="timeline-entry-text">Researching, designing, and coding to enhance production workflows in the entertainment industry.</div>
      </div>
      <div class="timeline-entry">
        <div class="timeline-entry-title">Computer Graphics & 3D Modeling</div>
        <div class="timeline-entry-text">Industry standard models and renderings of assets.</div>
      </div>
      <div class="timeline-entry">
        <div class="timeline-entry-title">Interactive Media</div>
        <div class="timeline-entry-text">Advising and creating interactive media experiences.</div>
      </div>
      <div class="timeline-entry">
        <div class="timeline-entry-title">Videography & Content Production</div>
        <div class="timeline-entry-text">High-quality event coverage and content strategy for creators.</div>
      </div>
    </div>
    <div class="panel-section">
      <div class="panel-section-title">// contact</div>
      <div class="contact-link-item"><span class="contact-label">EMAIL</span><a href="mailto:hashash@stanford.edu">hashash@stanford.edu</a></div>
      <div class="contact-link-item"><span class="contact-label">LINKEDIN</span><a href="https://www.linkedin.com/in/dina-hashash-9589121b7/" target="_blank">dina-hashash</a></div>
      <div class="contact-link-item"><span class="contact-label">INSTAGRAM</span><a href="https://www.instagram.com/dina_hashash/" target="_blank">@dina_hashash</a></div>
      <div class="contact-link-item"><span class="contact-label">LOCATION</span><span>California, USA</span></div>
    </div>
  `,

  education: () => `
    <div class="panel-section">
      <div class="panel-section-title">// education</div>
      <div class="timeline-entry">
        <div class="timeline-entry-title">Stanford University — MS</div>
        <div class="timeline-entry-date">2025 — 2027 (expected)</div>
        <div class="timeline-entry-text">Computer Science, concentration in Artificial Intelligence. Coursework: Deep Generative Models, NLP with Deep Learning, Decision Making under Uncertainty.</div>
      </div>
      <div class="timeline-entry">
        <div class="timeline-entry-title">Stanford University — BS</div>
        <div class="timeline-entry-date">2022 — 2026 (expected)</div>
        <div class="timeline-entry-text">Computer Science, concentration in Visual Computation and Graphics. Coursework: Computer Graphics and Imaging, Rendering, Animation and Simulation, Deep Learning for Computer Vision, Virtual Reality.</div>
      </div>
      <div class="timeline-entry">
        <div class="timeline-entry-title">University of Illinois at Urbana-Champaign</div>
        <div class="timeline-entry-date">2020 — 2022 (concurrent enrollment)</div>
      </div>
      <div class="timeline-entry">
        <div class="timeline-entry-title">University Laboratory High School</div>
        <div class="timeline-entry-date">2018 — 2022</div>
      </div>
    </div>
  `,

  experience: () => `
    <div class="panel-section">
      <div class="panel-section-title">// experience</div>
      <div class="timeline-entry">
        <div class="timeline-entry-title">Research Supervisor</div>
        <div class="timeline-entry-date">Jan 2026 — Present · Stanford VHIL</div>
        <div class="timeline-entry-text">Supervising research projects and supporting lab operations at Stanford's Virtual Human Interaction Lab.</div>
      </div>
      <div class="timeline-entry">
        <div class="timeline-entry-title">Freelance Videographer & Editor</div>
        <div class="timeline-entry-date">May 2023 — Present · Ethography LLC</div>
        <div class="timeline-entry-text">Videographed, photographed, and edited for clients including Stanford University.</div>
      </div>
      <div class="timeline-entry">
        <div class="timeline-entry-title">Creative Management & Strategy</div>
        <div class="timeline-entry-date">Jan 2023 — Present</div>
        <div class="timeline-entry-text">Managed social media for Six of Spades (@sixofspadesband), growing from 0 to 87k followers. Advised and filmed content for Sofi Manassyan (@sofimanassyan), securing invitations to Universal Studios and other venues.</div>
      </div>
      <div class="timeline-entry">
        <div class="timeline-entry-title">Part-Time Researcher</div>
        <div class="timeline-entry-date">Oct 2024 — Feb 2025 · Eyeline Studios / Netflix</div>
        <div class="timeline-entry-text">Continued development of the Virtual Production stage platform controls for upcoming shoots.</div>
      </div>
      <div class="timeline-entry">
        <div class="timeline-entry-title">Research Intern</div>
        <div class="timeline-entry-date">Jun–Sep 2023, Jul–Sep 2024 · Eyeline Studios / Netflix</div>
        <div class="timeline-entry-text">Oversaw construction of Netflix's new Virtual Production stage. Built a custom platform for DPs and Directors, including a lighting algorithm to simulate environmental lighting for any environment. Also worked on volumetric/motion capture and robotics.</div>
      </div>
      <div class="timeline-entry">
        <div class="timeline-entry-title">Computer Graphics Generalist</div>
        <div class="timeline-entry-date">Jun — Aug 2022 · Netflix</div>
        <div class="timeline-entry-text">Worked under Dr. Paul Debevec in Netflix's Production Innovation Creative Algorithms and Technologies Team. Used SolidWorks, Maya, and Blender to design and simulate Virtual Production stages.</div>
      </div>
    </div>
  `,

  portfolio: () => `
    <div class="panel-section">
      <div class="panel-section-title">// portfolio</div>
      <div class="portfolio-filter">
        <button class="portfolio-filter-btn active" data-filter="all">all</button>
        <button class="portfolio-filter-btn" data-filter="3d">3d</button>
        <button class="portfolio-filter-btn" data-filter="video">photo/video</button>
        <button class="portfolio-filter-btn" data-filter="social">social</button>
      </div>
      <div class="portfolio-grid">

        <div class="portfolio-item" data-cat="3d" onclick="window.open('https://drive.google.com/drive/folders/1eJC9ebdkJZbKcgAcLQQtpV2Ma2YQ58-t?usp=sharing','_blank')">
          <img src="./assets/portfolio/CAD/148rendering.png" alt="Forest Scene" loading="lazy">
          <div class="portfolio-item-label">Blender Forest Scene</div>
        </div>

        <div class="portfolio-item" data-cat="3d">
          <video muted loop autoplay playsinline src="./assets/portfolio/CAD/asteroid_flipsim.mp4"></video>
          <div class="portfolio-item-label">Houdini Water Simulation</div>
        </div>

        <div class="portfolio-item" data-cat="3d">
          <video muted loop autoplay playsinline src="./assets/portfolio/CAD/tubes.mp4"></video>
          <div class="portfolio-item-label">Houdini Pool Simulation</div>
        </div>

        <div class="portfolio-item" data-cat="3d">
          <video muted loop autoplay playsinline src="./assets/portfolio/CAD/thedavid.mp4"></video>
          <div class="portfolio-item-label">Houdini Grain & Glass Fracture</div>
        </div>

        <div class="portfolio-item" data-cat="3d" onclick="window.open('https://youtu.be/yzr5Kq8WuD4?si=lqwT9YPPtQwmaE77','_blank')">
          <video muted loop autoplay playsinline src="./assets/portfolio/CAD/tomorrowland.mp4"></video>
          <div class="portfolio-item-label">Houdini Sequence</div>
        </div>

        <div class="portfolio-item" data-cat="video">
          <video muted loop autoplay playsinline src="./assets/portfolio/videos/SHOWCASE_ITZY.mp4"></video>
          <div class="portfolio-item-label">"ITZY" Billboard Ad</div>
        </div>

        <div class="portfolio-item" data-cat="video">
          <video muted loop autoplay playsinline src="./assets/portfolio/videos/SHOWCASE_WEEEKLY.mp4"></video>
          <div class="portfolio-item-label">"WEEEKLY" Billboard Ad</div>
        </div>

        <div class="portfolio-item" data-cat="video">
          <video muted loop autoplay playsinline src="./assets/portfolio/videos/SpadeRaveTrailer_uncut.mp4"></video>
          <div class="portfolio-item-label">Six of Spades Event Trailer</div>
        </div>

        <div class="portfolio-item" data-cat="video" onclick="window.open('https://youtu.be/0mchKR9WLBk?si=SwZKhOaQKW3sVC72','_blank')">
          <img src="./assets/portfolio/videos/MLK_edit_coverimg.png" alt="MLK" loading="lazy">
          <div class="portfolio-item-label">MLK at Stanford</div>
        </div>

        <div class="portfolio-item" data-cat="video">
          <img src="./assets/portfolio/photos/Lili_1.jpg" alt="Lili" loading="lazy">
          <div class="portfolio-item-label">Charlotte Hood for Lili</div>
        </div>

        <div class="portfolio-item" data-cat="video">
          <img src="./assets/portfolio/photos/DSC_8208.JPG" alt="Kai" loading="lazy">
          <div class="portfolio-item-label">Kai Sharp for Stanford Concert Network</div>
        </div>

        <div class="portfolio-item" data-cat="video">
          <img src="./assets/portfolio/photos/R1-05835-0001.JPG" alt="Film" loading="lazy">
          <div class="portfolio-item-label">Line Andersson (Film)</div>
        </div>

        <div class="portfolio-item" data-cat="social" onclick="window.open('https://www.instagram.com/p/DAT5UXESKDx/?img_index=1','_blank')">
          <img src="./assets/portfolio/social/ted_coverimg.jpg" alt="Ted" loading="lazy">
          <div class="portfolio-item-label">Ted Sarandos at Eyeline Studios</div>
        </div>

        <div class="portfolio-item" data-cat="social" onclick="window.open('https://www.instagram.com/chateaubarefoot/p/C_vff6ZpUBd/?img_index=1','_blank')">
          <img src="./assets/portfolio/social/charlotte_coverimg.jpg" alt="Charlotte" loading="lazy">
          <div class="portfolio-item-label">Charlotte Hood for Lili</div>
        </div>

        <div class="portfolio-item" data-cat="social" onclick="window.open('https://www.instagram.com/sofimanassyan/reel/CyOWy9gxfm3/','_blank')">
          <img src="./assets/portfolio/social/foodfest_coverimg.jpg" alt="Sofi" loading="lazy">
          <div class="portfolio-item-label">Sofi Manassyan · Food Fest</div>
        </div>

        <div class="portfolio-item" data-cat="social" onclick="window.open('https://www.instagram.com/sixofspadesband/reel/C2VmXRoypFb/','_blank')">
          <img src="./assets/portfolio/social/bassist_coverimg.png" alt="Spades" loading="lazy">
          <div class="portfolio-item-label">Six of Spades at CoHo</div>
        </div>

        <div class="portfolio-item" data-cat="social" onclick="window.open('https://www.instagram.com/sixofspadesband/reel/C-lUBcHPjoQ/','_blank')">
          <img src="./assets/portfolio/social/runnintrailer_coverimg.jpg" alt="Trailer" loading="lazy">
          <div class="portfolio-item-label">Six of Spades Release Trailer</div>
        </div>

        <div class="portfolio-item" data-cat="social" onclick="window.open('https://www.instagram.com/sixofspadesband/reel/C7j8l3JPud-/','_blank')">
          <img src="./assets/portfolio/social/standby_coverimg.jpg" alt="Standby" loading="lazy">
          <div class="portfolio-item-label">Stand by Me x Beautiful Girls</div>
        </div>

      </div>
    </div>
  `
};

// --- Labels ---
const LABEL_DEFS = [
  { id: 'about',      text: 'about_',      nxClosed: 0.06, ny: 0.25, nz: 0.0 },
  { id: 'education',  text: 'education_',  nxClosed: 0.95, ny: 0.30, nz: 0.0 },
  { id: 'experience', text: 'experience_', nxClosed: 0.04, ny: 0.55, nz: 0.0 },
  { id: 'portfolio',  text: 'portfolio_',  nxClosed: 0.98, ny: 0.60, nz: 0.0 },
];

const labelStates = LABEL_DEFS.map((def, i) => ({
  ...def,
  bobPhase: i * (Math.PI / 2),
  bobSpeed: 0.008 + i * 0.002,
  currentZ: def.nz,
  currentNx: def.nxClosed,  // animated nx
  hovered: false,
  active: false,  // is this the open panel's label?
  el: null,
}));

let activePanel = null;

// Open label's inline panel. If another already open, deactivate
// at the same time so the two transitions run simultaneously.
function openPanel(id) {
  const target = labelStates.find(l => l.id === id);
  if (!target) return;

  labelStates.forEach(l => {
    if (l.id === id) return;
    if (l.active) {
      l.active = false;
      l.el.classList.remove('active');
    }
  });

  target.active = true;
  target.el.classList.add('active');

  // Inject panel content into the active label's inline panel div.
  const panelEl = target.el.querySelector('.label-panel');
  panelEl.innerHTML = PANEL_CONTENT[id]();

  panelOpen = true;
  activePanel = id;
  figureCenterTarget = FIGURE_CENTER_OPEN;

  // Portfolio filter wiring
  if (id === 'portfolio') {
    panelEl.querySelectorAll('.portfolio-filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        panelEl.querySelectorAll('.portfolio-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const filter = btn.dataset.filter;
        panelEl.querySelectorAll('.portfolio-item').forEach(item => {
          item.style.display = (filter === 'all' || item.dataset.cat === filter) ? 'block' : 'none';
        });
      });
    });
  }
}

function closePanel() {
  labelStates.forEach(l => {
    if (l.active) {
      l.active = false;
      l.el.classList.remove('active');
    }
  });
  panelOpen = false;
  activePanel = null;
  figureCenterTarget = FIGURE_CENTER_CLOSED;
}

document.addEventListener('click', (e) => {
  if (!panelOpen) return;
  // Don't close if clicking inside an active label or its panel
  const clickedInsideLabel = labelStates.some(l => l.active && l.el.contains(e.target));
  if (!clickedInsideLabel) closePanel();
});

// label dom elements and event listeners
labelStates.forEach(label => {
  const el = document.createElement('div');
  el.className = 'label';
  el.innerHTML = `<span class="label-arrow">&gt;</span>${label.text}<span class="cursor"></span><div class="label-panel"></div>`;
  el.style.display = 'none';
  document.body.appendChild(el);
  label.el = el;

  el.addEventListener('mouseenter', () => { label.hovered = true; });
  el.addEventListener('mouseleave', () => { label.hovered = false; });

  el.addEventListener('click', (e) => {
    // Clicks inside the expanded content (links, portfolio items,..)
    if (e.target.closest('.label-panel')) return;
    if (label.active) closePanel();
    else openPanel(label.id);
  });
});

// Upper-right "docked" target for the active label (in screen px)
// Label anchor is its top-right corner (transform: translate(-100%, 0))
const ACTIVE_LABEL_RIGHT_PAD = 24;  // px in from right edge
const ACTIVE_LABEL_TOP = 0.09;  // fraction of canvas height

function updateLabels() {
  const r = figureRect();

  labelStates.forEach(label => {
    if (label.active) {
      const targetSx = canvas.width - ACTIVE_LABEL_RIGHT_PAD;
      const targetSy = canvas.height * ACTIVE_LABEL_TOP;

      label._currentSx = label._currentSx ?? targetSx;
      label._currentSy = label._currentSy ?? targetSy;
      label._currentSx += (targetSx - label._currentSx) * 0.08;
      label._currentSy += (targetSy - label._currentSy) * 0.08;

      label.el.style.display = 'block';
      label.el.style.left = `${label._currentSx}px`;
      label.el.style.top  = `${label._currentSy}px`;
      label.el.style.opacity = 1;
      label.el.style.fontSize = '15px';
      label.el.style.transform = 'translate(-100%, 0)';
      label.el.style.color = '#ffffff';
      label.el.style.pointerEvents = 'auto';
      return;
    }

    if (!label.hovered) label.bobPhase += label.bobSpeed;
    const bobOffset = label.hovered ? 0 : Math.sin(label.bobPhase) * 0.015;

    const targetZ = label.hovered ? 0.2 : label.nz;
    label.currentZ += (targetZ - label.currentZ) * 0.25;

    const { sy, scale } = project(label.nxClosed, label.ny + bobOffset, label.currentZ);

    const isLeft = label.nxClosed < 0.5;
    const closedSx = isLeft ? r.x - 80 : r.x + r.w + 80;
    label._sxTarget = closedSx;

    label._currentSx = label._currentSx ?? closedSx;
    label._currentSx += (label._sxTarget - label._currentSx) * 0.06;

    // Lerp Y too so the label glides smoothly back from the docked position
    label._currentSy = label._currentSy ?? sy;
    label._currentSy += (sy - label._currentSy) * 0.12;

    if (label._currentSx < -100 || label._currentSx > canvas.width + 100) {
      label.el.style.display = 'none';
      return;
    }

    const alpha = Math.max(0, Math.min(1, (scale - 0.7) * 2.5));
    const fontSize = Math.round(11 + scale * 4);

    label.el.style.display = 'block';
    label.el.style.left = `${label._currentSx}px`;
    label.el.style.top  = `${label._currentSy}px`;
    label.el.style.opacity = alpha;
    label.el.style.fontSize = `${fontSize}px`;
    label.el.style.transform = 'translate(-50%, -50%)';
    label.el.style.color = '';
    label.el.style.pointerEvents = alpha > 0.3 ? 'auto' : 'none';
  });

  // Intro gate - keep labels fully hidden until the intro sequence unlocks them
  if (!window._introLabelsReady) {
    labelStates.forEach(l => {
      l.el.style.opacity = '0';
      l.el.style.pointerEvents = 'none';
    });
  }
}

// --- Loop ---
function loop() {
  figureCenterX += (figureCenterTarget - figureCenterX) * 0.06;

  camera.rotX += (camTarget.rotX - camera.rotX) * 0.08;
  camera.rotY += (camTarget.rotY - camera.rotY) * 0.08;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGround();

  particles.forEach(p => {
    p.update();
    p.draw();
  });

  updateLabels();
  requestAnimationFrame(loop);
}

// ============================================================
// --- Three.js Animation Layer (Easter egg animations) ---
// ============================================================

const threeCanvas = document.createElement('canvas');
threeCanvas.style.cssText = `
  position: fixed; top: 0; left: 0;
  width: 100%; height: 100%;
  pointer-events: none; z-index: 10;
`;
document.body.appendChild(threeCanvas);

const threeRenderer = new THREE.WebGLRenderer({
  canvas: threeCanvas, alpha: true, antialias: true
});
threeRenderer.setSize(window.innerWidth, window.innerHeight);
threeRenderer.setPixelRatio(window.devicePixelRatio);

const threeScene = new THREE.Scene();
const threeCamera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
threeCamera.position.set(0, 1, 3);
threeCamera.lookAt(0, 1, 0);

window.addEventListener('resize', () => {
  threeRenderer.setSize(window.innerWidth, window.innerHeight);
  threeCamera.aspect = window.innerWidth / window.innerHeight;
  threeCamera.updateProjectionMatrix();
});

let threeAnimMixer = null;
let threeModel = null;
let threeAnimating = false;
const threeClock = new THREE.Clock();
const fbxCache = {};
const bones = {};

// 0 = normal particle system, 1 = fully bone-driven
let animBlend = 0;
let animBlendTarget = 0;

// Smoothness of the enter/exit transition into an FBX animation
const ANIM_BLEND_LERP = 0.02;

// Populated by calibrateRegions() at animation start
let regionCalib = null;

// Body regions: particle coordinate test - bone that drives that region
// Listed in priority order - each particle is assigned to the first match
// Arms are split at the elbow seam (ny ≈ 0.45) so the forearm/hand articulates
// independently from the upper arm instead of moving as one rigid block
// Mixamo bone naming is from the CHARACTER's perspective, not the viewer's
// mixamorig6LeftArm = character's left = viewer's RIGHT side of screen (normX > 0.5)
// All arm/leg bones are therefore mirrored relative to screen normX.
const REGION_DEFS = [
  {
    id: 'head',
    bone: 'mixamorig6Head',
    test: (nx, ny) => ny < 0.21,
  },
  {
    id: 'leftUpperArm',
    bone: 'mixamorig6RightArm',  // screen-left = character-right
    test: (nx, ny) => nx < 0.385 && ny >= 0.21 && ny < 0.39,
  },
  {
    id: 'leftForeArm',
    bone: 'mixamorig6RightForeArm',
    test: (nx, ny) => nx < 0.35 && ny >= 0.37 && ny < 0.6,
  },
  {
    id: 'rightUpperArm',
    bone: 'mixamorig6LeftArm',  // screen-right = character-left
    test: (nx, ny) => nx > 0.6 && ny >= 0.22 && ny < 0.39,
  },
  {
    id: 'rightForeArm',
    bone: 'mixamorig6LeftForeArm',
    test: (nx, ny) => nx > 0.63 && ny >= 0.37 && ny < 0.6,
  },
  {
    id: 'leftLeg',
    bone: 'mixamorig6RightUpLeg',  // screen-left = character-right
    test: (nx, ny) => nx < 0.5 && ny >= 0.51 && ny < 0.85,
  },
  {
    id: 'rightLeg',
    bone: 'mixamorig6LeftUpLeg',  // screen-right = character-left
    test: (nx, ny) => nx >= 0.5 && ny >= 0.51 && ny < 0.85,
  },
  {
    id: 'leftFoot',
    bone: 'mixamorig6RightFoot',  // screen-left = character-right
    test: (nx, ny) => nx < 0.5 && ny >= 0.85,
  },
  {
    id: 'rightFoot',
    bone: 'mixamorig6LeftFoot',  // screen-right = character-left
    test: (nx, ny) => nx >= 0.5 && ny >= 0.85,
  },
];
// Center torso particles (no region matched above) fall back to Spine1
const FALLBACK_BONE = 'mixamorig6Spine1';

// -------------------------------------------------------------------
// SKELETON ↔ PARTICLE FIGURE ALIGNMENT
// -------------------------------------------------------------------
// Turn on the bone overlay (press B during an animation). The CYAN stick
// figure is the skeleton mapped through SKEL_ADJUST — that's the one you
// tune until it sits inside the green figureRect outline. A faint yellow
// stick figure is also drawn as a fixed reference (raw Three.js camera
// projection — unaffected by SKEL_ADJUST). Order to try:
//   1. yScale — shorten if cyan legs hang below the figure
//   2. xScale — shrink if cyan arms stick outside the figure's sides
//   3. yOffset — nudge the cyan head up/down if vertically offset
// Values of 1.0 are pass-through; 0.5 halves that axis; 2.0 doubles it.
// Per-animation tunables. Each animation has its own object so the wave
// and backflip can be calibrated independently (Mixamo clips often start
// from different root poses, so the same mapping won't work for both).
// Tune live in devtools, e.g.:
//   SKEL_ADJUST_BACKFLIP.yScale = 1.2
// playAnimation() swaps the active reference (`SKEL_ADJUST`) when it runs.
const SKEL_ADJUST_WAVE = {
  xScale:  1.7,
  yScale:  1.5,
  yOffset: -0.2,
};

const SKEL_ADJUST_BACKFLIP = {
  // Starts as a copy of the wave values - adjust these while playing the
  // backflip until the cyan skeleton sits inside the green figureRect.
  xScale:  1.7,
  yScale:  1.5,
  yOffset: -0.2,
};

// Active mapping - playAnimation swaps this to the per-animation object.
let SKEL_ADJUST = SKEL_ADJUST_WAVE;
let activeAnimName = 'wave';

// Expose so you can tweak in devtools
window.SKEL_ADJUST_WAVE = SKEL_ADJUST_WAVE;
window.SKEL_ADJUST_BACKFLIP = SKEL_ADJUST_BACKFLIP;

function loadFBX(path) {
  return new Promise((resolve, reject) => {
    if (fbxCache[path]) { resolve(fbxCache[path]); return; }
    const loader = new THREE.FBXLoader();
    loader.load(path, fbx => { fbxCache[path] = fbx; resolve(fbx); }, undefined, reject);
  });
}

function cacheBones(model) {
  model.traverse(child => { if (child.isBone) bones[child.name] = child; });
}

function boneWorldPos(name) {
  const bone = bones[name];
  if (!bone) return null;
  const v = new THREE.Vector3();
  bone.getWorldPosition(v);
  return v;
}

function boneToScreen(worldPos) {
  const v = worldPos.clone().project(threeCamera);
  return {
    x: (v.x + 1) / 2 * canvas.width,
    y: (-v.y + 1) / 2 * canvas.height,
  };
}

// Capture unpatched getTarget so calibration always reads geometric particle targets,
// not positions that drift with physics or a previous animation blend.
const _originalGetTarget = Particle.prototype.getTarget;

// Returns the bone's current world-space rotation quaternion.
function boneWorldQuat(name) {
  const bone = bones[name];
  if (!bone) return null;
  const q = new THREE.Quaternion();
  bone.getWorldQuaternion(q);
  return q;
}

// Uniform world-norm scale computed at calibration.
// Using a single scale for all three axes keeps 3D rotations geometrically isotropic
// (no axis squashing when the body flips or arms arc).
let figScale = null; // { s: worldUnitsPerNormUnit, headY: world Y at normY=0 }

function computeFigureScale() {
  const headW = boneWorldPos('mixamorig6Head');
  const footW = boneWorldPos('mixamorig6LeftFoot') || boneWorldPos('mixamorig6RightFoot');
  if (!headW || !footW) return false;
  const h = Math.abs(headW.y - footW.y);
  if (h < 0.01) return false;
  figScale = { s: h, headY: headW.y };
  return true;
}

// Particle normalized coords → Three.js world space.
// Y scale = figure height * yScale; X/Z scale = figH * PORTRAIT_ASPECT * xScale.
// SKEL_ADJUST lets the user retune the mapping when the Mixamo rig's
// proportions don't match the particle silhouette.
function normToWorld(nx, ny, nz) {
  const sy = figScale.s * SKEL_ADJUST.yScale;
  const sx = figScale.s * PORTRAIT_ASPECT * SKEL_ADJUST.xScale;
  return new THREE.Vector3(
    (nx - 0.5) * sx,
    figScale.headY - (ny + SKEL_ADJUST.yOffset) * sy,
    (nz || 0) * sx,
  );
}

// Three.js world space → particle normalized coords
function worldToNorm(v) {
  const sy = figScale.s * SKEL_ADJUST.yScale;
  const sx = figScale.s * PORTRAIT_ASPECT * SKEL_ADJUST.xScale;
  return {
    nx: v.x / sx + 0.5,
    ny: (figScale.headY - v.y) / sy - SKEL_ADJUST.yOffset,
    nz: v.z / sx,
  };
}

function calibrateRegions() {
  regionCalib = {};

  if (!computeFigureScale()) {
    console.warn('Animation: head/foot bones not found — cannot calibrate');
    return;
  }

  const buckets = {};
  REGION_DEFS.forEach(def => { buckets[def.id] = []; });
  const fallbackBucket = [];

  particles.forEach(p => {
    if (p.isAmbient) return;
    p._regionId = undefined;
    p._localBonePos = undefined;  // THREE.Vector3 in bone-local space
    p._targetNX = undefined;
    p._targetNY = undefined;
    p._targetNZ = undefined;

    let matched = false;
    for (const def of REGION_DEFS) {
      if (def.test(p.normX, p.normY)) { buckets[def.id].push(p); matched = true; break; }
    }
    if (!matched) fallbackBucket.push(p);
  });

  const buildRegion = (id, boneName, parts) => {
    if (parts.length === 0) return;
    const bp = boneWorldPos(boneName);
    const bq = boneWorldQuat(boneName);
    if (!bp || !bq) return;

    const invQ = bq.clone().invert();
    parts.forEach(p => {
      p._regionId = id;
      // Convert particle 3D norm position to world, offset from bone origin,
      // then rotate into bone-local space.
      p._localBonePos = normToWorld(p.normX, p.normY, p.normZ || 0)
        .sub(bp)
        .applyQuaternion(invQ);
    });

    regionCalib[id] = { bone: boneName, particles: parts };
  };

  REGION_DEFS.forEach(def => buildRegion(def.id, def.bone, buckets[def.id]));
  buildRegion('fallback', FALLBACK_BONE, fallbackBucket);
}

// Each frame: apply the bone's current 3D transform to each particle's bone-local
// position, convert back to norm coords, and store as the animation target.
// The existing project() call in getTarget handles 3D-2D perspective from there.
function applyBoneAnimation() {
  if (animBlend <= 0.001 || !regionCalib || !figScale) return;

  for (const data of Object.values(regionCalib)) {
    const bp = boneWorldPos(data.bone);
    const bq = boneWorldQuat(data.bone);
    if (!bp || !bq) continue;

    for (const p of data.particles) {
      if (!p._localBonePos) continue;
      // Rotate local offset by current bone world rotation, then translate by bone world pos
      const wPos = p._localBonePos.clone().applyQuaternion(bq).add(bp);
      const n = worldToNorm(wPos);
      p._targetNX = n.nx;
      p._targetNY = n.ny;
      p._targetNZ = n.nz;
    }
  }
}

// Blend bone-driven 3D norm coordinates into the normal getTarget projection.
// Bypasses the 2D screen-space path entirely - animated coords go through the
// same project() perspective math as the rest of the particle system.
Particle.prototype.getTarget = function() {
  if (animBlend <= 0.001 || this._targetNX === undefined) {
    return _originalGetTarget.call(this);
  }

  const blend = animBlend;
  const nx = this.normX + (this._targetNX - this.normX) * blend;
  const ny = this.normY + (this._targetNY - this.normY) * blend;
  const nz = (this.normZ || 0) + (this._targetNZ - (this.normZ || 0)) * blend;

  // Re-run the full 3D-2D projection with animated coordinates + original scatter
  const r = figureRect();
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  let x = r.x + (nx + this.scatterX) * r.w - cx;
  let y = r.y + (ny + this.scatterY) * r.h - cy;
  let z = (nz + (this.scatterZ || 0)) * r.w;

  const cosY = Math.cos(camera.rotY), sinY = Math.sin(camera.rotY);
  const x1 = x * cosY - z * sinY;
  const z1 = x * sinY + z * cosY;

  const cosX = Math.cos(camera.rotX), sinX = Math.sin(camera.rotX);
  const y1 = y * cosX - z1 * sinX;
  const z2 = y * sinX + z1 * cosX;

  const pf = FOV / (FOV + z2);
  return { tx: cx + x1 * pf, ty: cy + y1 * pf };
};

async function playAnimation(fbxPath, opts = {}) {
  if (threeAnimating) return;
  threeAnimating = true;
  animBlendTarget = 0;

  // Swap in animation's SKEL_ADJUST before calibration so the
  // bone-local offsets use the correct per-animation proportions.
  if (opts.adjust) SKEL_ADJUST = opts.adjust;
  if (opts.name)   activeAnimName = opts.name;

  try {
    const animFBX = await loadFBX(fbxPath);

    if (!threeModel) {
      threeModel = animFBX;
      threeModel.traverse(child => { if (child.isMesh) child.visible = false; });
      threeModel.scale.setScalar(0.01);
      threeModel.position.set(0, 0, 0);
      threeScene.add(threeModel);
      cacheBones(threeModel);
    }

    // Seek skeleton to frame 0 of the animation clip before calibrating.
    // The action must be ACTIVE (play called) before update(0) will evaluate
    // the clip and write bone transforms - reset alone does nothing.
    threeAnimMixer = new THREE.AnimationMixer(threeModel);
    const clip = animFBX.animations[0];
    const action = threeAnimMixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.reset();
    action.play();
    threeAnimMixer.update(0); // evaluates frame 0, bones now at animation start pose

    // Wait one rAF so the renderer has committed the frame-0 bone transforms
    await new Promise(r => requestAnimationFrame(r));

    // Calibrate: particle centroids ↔ bone screen positions at frame 0
    calibrateRegions();

    // action is already playing from frame 0 - just open the blend
    animBlendTarget = 1;

    await new Promise(resolve => {
      threeAnimMixer.addEventListener('finished', resolve, { once: true });
    });

    await new Promise(r => setTimeout(r, 400));

  } catch (err) {
    console.warn('Animation error:', err);
  }

  animBlendTarget = 0;
  threeAnimating = false;
}

/* ---- Debug overlays and debug tooling (disabled for production) ----
// ---- Region debug overlay ----
const debugCanvas = document.createElement('canvas');
debugCanvas.style.cssText = `
  position: fixed; top: 0; left: 0;
  width: 100%; height: 100%;
  pointer-events: none; z-index: 30;
`;
document.body.appendChild(debugCanvas);
const debugCtx = debugCanvas.getContext('2d');
function resizeDebugCanvas() {
  debugCanvas.width = window.innerWidth;
  debugCanvas.height = window.innerHeight;
}
resizeDebugCanvas();
window.addEventListener('resize', resizeDebugCanvas);

let showRegionDebug = false;

const REGION_COLORS = {
  head:          '#ff4444',
  leftUpperArm:  '#ff8800',
  leftForeArm:   '#ffdd00',
  rightUpperArm: '#00ccff',
  rightForeArm:  '#0055ff',
  leftLeg:       '#00ff88',
  rightLeg:      '#008844',
  leftFoot:      '#ff66cc',
  rightFoot:     '#aa2288',
  fallback:      '#cc44ff',
};

function drawRegionDebug() {

  particles.forEach(p => {
    if (p.isAmbient) return;

    let regionId = 'fallback';
    for (const def of REGION_DEFS) {
      if (def.test(p.normX, p.normY)) { regionId = def.id; break; }
    }

    debugCtx.beginPath();
    debugCtx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    debugCtx.fillStyle = REGION_COLORS[regionId] || '#ffffff';
    debugCtx.globalAlpha = 0.85;
    debugCtx.fill();
  });
  debugCtx.globalAlpha = 1;

  // Legend
  debugCtx.font = 'bold 12px monospace';
  let ly = 24;
  const lx = 16;
  Object.entries(REGION_COLORS).forEach(([id, color]) => {
    debugCtx.fillStyle = color;
    debugCtx.fillRect(lx, ly - 10, 12, 12);
    debugCtx.fillStyle = '#ffffff';
    debugCtx.shadowColor = '#000';
    debugCtx.shadowBlur = 3;
    debugCtx.fillText(id, lx + 18, ly);
    debugCtx.shadowBlur = 0;
    ly += 18;
  });
}

window.toggleRegionDebug = () => {
  showRegionDebug = !showRegionDebug;
  console.log(`Region debug ${showRegionDebug ? 'ON' : 'OFF'} — press D to toggle`);
};

// Bone skeleton debug overlay (press B)
let showBoneDebug = false;

const BONE_DEBUG_LIST = [
  'mixamorig6Head', 'mixamorig6Neck',
  'mixamorig6Spine2', 'mixamorig6Spine1', 'mixamorig6Spine', 'mixamorig6Hips',
  'mixamorig6RightShoulder', 'mixamorig6RightArm', 'mixamorig6RightForeArm', 'mixamorig6RightHand',
  'mixamorig6LeftShoulder',  'mixamorig6LeftArm',  'mixamorig6LeftForeArm',  'mixamorig6LeftHand',
  'mixamorig6RightUpLeg', 'mixamorig6RightLeg', 'mixamorig6RightFoot', 'mixamorig6RightToeBase',
  'mixamorig6LeftUpLeg',  'mixamorig6LeftLeg',  'mixamorig6LeftFoot',  'mixamorig6LeftToeBase',
];

const BONE_HIGHLIGHT = new Set([
  'mixamorig6RightFoot', 'mixamorig6LeftFoot',
  'mixamorig6RightToeBase', 'mixamorig6LeftToeBase',
]);

const BONE_CONNECTIONS = [
  ['mixamorig6Head', 'mixamorig6Neck'],
  ['mixamorig6Neck', 'mixamorig6Spine2'],
  ['mixamorig6Spine2', 'mixamorig6Spine1'],
  ['mixamorig6Spine1', 'mixamorig6Spine'],
  ['mixamorig6Spine', 'mixamorig6Hips'],
  ['mixamorig6Hips', 'mixamorig6RightUpLeg'],
  ['mixamorig6RightUpLeg', 'mixamorig6RightLeg'],
  ['mixamorig6RightLeg', 'mixamorig6RightFoot'],
  ['mixamorig6RightFoot', 'mixamorig6RightToeBase'],
  ['mixamorig6Hips', 'mixamorig6LeftUpLeg'],
  ['mixamorig6LeftUpLeg', 'mixamorig6LeftLeg'],
  ['mixamorig6LeftLeg', 'mixamorig6LeftFoot'],
  ['mixamorig6LeftFoot', 'mixamorig6LeftToeBase'],
  ['mixamorig6Spine2', 'mixamorig6RightShoulder'],
  ['mixamorig6RightShoulder', 'mixamorig6RightArm'],
  ['mixamorig6RightArm', 'mixamorig6RightForeArm'],
  ['mixamorig6RightForeArm', 'mixamorig6RightHand'],
  ['mixamorig6Spine2', 'mixamorig6LeftShoulder'],
  ['mixamorig6LeftShoulder', 'mixamorig6LeftArm'],
  ['mixamorig6LeftArm', 'mixamorig6LeftForeArm'],
  ['mixamorig6LeftForeArm', 'mixamorig6LeftHand'],
];

// Project a bone world position through worldToNorm + project() so dot
// lands where the bone would drive a particle in particle-screen space
function boneToParticleScreen(worldPos) {
  if (!figScale) return null;
  const n = worldToNorm(worldPos);
  const { sx, sy } = project(n.nx, n.ny, n.nz);
  return { x: sx, y: sy };
}

function drawBoneDebug() {
  // tune SKEL_ADJUST until the yellow is inside green triangle
  const fr = figureRect();
  debugCtx.lineWidth = 2;
  debugCtx.strokeStyle = '#00ff00';
  debugCtx.strokeRect(fr.x, fr.y, fr.w, fr.h);
  debugCtx.fillStyle = '#00ff00';
  debugCtx.font = 'bold 11px monospace';
  debugCtx.shadowColor = '#000000';
  debugCtx.shadowBlur = 3;
  debugCtx.fillText('particle figureRect', fr.x + 4, fr.y - 6);
  debugCtx.shadowBlur = 0;

  // Current SKEL_ADJUST values, upper-right corner
  debugCtx.font = 'bold 12px monospace';
  debugCtx.fillStyle = '#ffffff';
  debugCtx.shadowColor = '#000000';
  debugCtx.shadowBlur = 3;
  const adjName = `SKEL_ADJUST_${activeAnimName.toUpperCase()}`;
  const txt = [
    `active: ${adjName}`,
    `  xScale  = ${SKEL_ADJUST.xScale.toFixed(2)}`,
    `  yScale  = ${SKEL_ADJUST.yScale.toFixed(2)}`,
    `  yOffset = ${SKEL_ADJUST.yOffset.toFixed(2)}`,
  ];
  txt.forEach((line, i) => {
    debugCtx.fillText(line, debugCanvas.width - 260, 24 + i * 16);
  });
  debugCtx.shadowBlur = 0;

  if (!Object.keys(bones).length) {
    debugCtx.fillStyle = '#ff4444';
    debugCtx.font = 'bold 14px monospace';
    debugCtx.fillText('No skeleton loaded — run playWave() first', 16, debugCanvas.height - 20);
    return;
  }

  // Lazy-init figScale 
  if (!figScale) computeFigureScale();
  if (!figScale) {
    debugCtx.fillStyle = '#ff4444';
    debugCtx.font = 'bold 14px monospace';
    debugCtx.fillText('figScale not ready — head/foot bones missing', 16, debugCanvas.height - 20);
    return;
  }

  // Cyan = bones mapped through SKEL_ADJUST into particle space (do not tune)
  // Thin yellow = raw Three.js camera projection (do not tune)
  const bPosMapped = {}; // cyan
  const bPosRaw = {}; // yellow reference
  BONE_DEBUG_LIST.forEach(name => {
    const wp = boneWorldPos(name);
    if (!wp) return;
    bPosMapped[name] = boneToParticleScreen(wp);
    bPosRaw[name] = boneToScreen(wp);
  });

  // Thin reference stick figure (raw Three.js projection)
  debugCtx.lineWidth = 1;
  debugCtx.strokeStyle = 'rgba(255,255,80,0.35)';
  BONE_CONNECTIONS.forEach(([a, b]) => {
    const pa = bPosRaw[a], pb = bPosRaw[b];
    if (!pa || !pb) return;
    debugCtx.beginPath();
    debugCtx.moveTo(pa.x, pa.y);
    debugCtx.lineTo(pb.x, pb.y);
    debugCtx.stroke();
  });

  // Mapped stick figure lines
  debugCtx.lineWidth = 2;
  debugCtx.strokeStyle = 'rgba(0,230,255,0.85)';
  BONE_CONNECTIONS.forEach(([a, b]) => {
    const pa = bPosMapped[a], pb = bPosMapped[b];
    if (!pa || !pb) return;
    debugCtx.beginPath();
    debugCtx.moveTo(pa.x, pa.y);
    debugCtx.lineTo(pb.x, pb.y);
    debugCtx.stroke();
  });

  // Mapped bone dots + labels (feet highlighted magenta + larger)
  debugCtx.font = 'bold 10px monospace';
  Object.entries(bPosMapped).forEach(([name, pos]) => {
    if (!pos) return;
    const label = name.replace('mixamorig6', '');
    const isFoot = BONE_HIGHLIGHT.has(name);
    debugCtx.beginPath();
    debugCtx.arc(pos.x, pos.y, isFoot ? 7 : 5, 0, Math.PI * 2);
    debugCtx.fillStyle = isFoot ? '#ff00ff' : '#00e6ff';
    debugCtx.globalAlpha = 0.95;
    debugCtx.fill();
    debugCtx.globalAlpha = 1;
    debugCtx.fillStyle = '#ffffff';
    debugCtx.shadowColor = '#000000';
    debugCtx.shadowBlur = 3;
    debugCtx.fillText(label, pos.x + 8, pos.y + 4);
    debugCtx.shadowBlur = 0;
  });
}

window.toggleBoneDebug = () => {
  showBoneDebug = !showBoneDebug;
  console.log(`Bone debug ${showBoneDebug ? 'ON' : 'OFF'} — press B to toggle`);
};

window.addEventListener('keydown', e => {
  if (e.key === 'd' || e.key === 'D') window.toggleRegionDebug();
  if (e.key === 'b' || e.key === 'B') window.toggleBoneDebug();
});

function drawDebugOverlays() {
  debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
  if (showRegionDebug) drawRegionDebug();
  if (showBoneDebug) drawBoneDebug();
}
*/

function threeLoop() {
  requestAnimationFrame(threeLoop);
  animBlend += (animBlendTarget - animBlend) * ANIM_BLEND_LERP;
  if (threeAnimMixer) threeAnimMixer.update(threeClock.getDelta());
  applyBoneAnimation();
  threeRenderer.render(threeScene, threeCamera);
  // drawDebugOverlays();
}
threeLoop();

window.playWave     = () => playAnimation('./assets/Waving.fbx',   { adjust: SKEL_ADJUST_WAVE,     name: 'wave' });
window.playBackflip = () => playAnimation('./assets/Backflip2.fbx', { adjust: SKEL_ADJUST_BACKFLIP, name: 'backflip' });

// ============================================================
// --- Aurebesh Easter Eggs ---
// ============================================================
const AUREBESH_MAP = Object.fromEntries(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(c => [c, c])
);

// Pool of characters flicker-cycled during the scramble transition.
const SCRAMBLE_POOL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*';

function toAurebesh(str) {
  return str.split('').map(c => AUREBESH_MAP[c] || c).join('');
}

// ---- playForce tunables ----
// FORCE_BURST_PX - total outward displacement per particle (px)
// FORCE_BURST_MS - how long the outward push takes (spread across frames)
// FORCE_RETURN_EASE - spring strength during the slow drift back (smaller = slower)
// FORCE_RETURN_MS - how long after the burst to keep the slow ease active
const FORCE_BURST_PX = 500;
const FORCE_BURST_MS = 700;
const FORCE_RETURN_EASE = 0.012;
const FORCE_RETURN_MS = 3500;

window.playForce = () => {
  const r = figureRect();
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h * 0.35;

  const dirs = particles.map(p => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d  = Math.sqrt(dx * dx + dy * dy) || 1;

    // Add random angular deviation
    const angle = Math.atan2(dy, dx) + (Math.random() - 0.5) * 1.2;  // ±0.6 rad wobble
    const dist = FORCE_BURST_PX * (0.3 + Math.random() * 1.4);  // 0.3x–1.7x

    return {
      nx: Math.cos(angle),
      ny: Math.sin(angle),
      total: dist,
      applied: 0,
    };
  });

  _forceSlowEase  = FORCE_RETURN_EASE;
  _forceSlowEndMs = performance.now() + FORCE_BURST_MS + FORCE_RETURN_MS;

  const burstStart = performance.now();
  function burstTick() {
    const t = Math.min(1, (performance.now() - burstStart) / FORCE_BURST_MS);
    // ease-out: fast initial push, tapering off
    const progress = 1 - Math.pow(1 - t, 2);
    particles.forEach((p, i) => {
      const d = dirs[i];
      const wanted = d.total * progress;
      const delta  = wanted - d.applied;
      p.x += d.nx * delta;
      p.y += d.ny * delta;
      d.applied = wanted;
    });
    if (t < 1) requestAnimationFrame(burstTick);
  }
  burstTick();
};

// Phrase list 
const AUREBESH_PHRASES = [
  { text: 'HELLO THERE', action: () => window.playWave(), pos: { top: '28px', left: '32px' } },
  { text: 'DO A FLIP', action: () => window.playBackflip(), pos: { top: '28px', right: '32px' } },
  { text: 'USE THE FORCE', action: () => window.playForce(), pos: { bottom: '32px', left: '32px' } },
  {
    text: 'YOU FOUND ME!',
    action: null,
    consumeOnClick: true,
    randomize: false,
    fontSize: '10px',
    pos: { bottom: '200px', left: '50%', transform: 'translateX(-50%)' },
  },
];

function createAurebeshPhrase({ text, action, pos, consumeOnClick = false, randomize = true, fontSize }) {
  // Per-phrase randomization 
  // rather than uniformly pinned to corners. YOU FOUND ME opts out.
  // const baseOpacity = randomize ? (0.08 + Math.random() * 0.05) : 0.1;
  // const jitter = randomize ? 18 : 0;
  // const tiltDeg = randomize ? (Math.random() - 0.5) * 3 : 0;
  const baseOpacity = randomize ? (0.08 + Math.random() * 0.05) : 0.1;
  const jitter = 0; 
  const tiltDeg = 0;
  const sizePx = fontSize || (randomize ? (11 + Math.floor(Math.random() * 3)) + 'px' : '13px');

  const el = document.createElement('div');
  el.style.cssText = `
    position: fixed;
    z-index: 50;
    font-family: 'Aurebesh', monospace;
    font-size: ${sizePx};
    letter-spacing: 2px;
    color: ${ACCENT};
    opacity: ${baseOpacity};
    text-shadow: 0 0 4px rgba(163, 207, 167, 0.35),
                 0 0 10px rgba(163, 207, 167, 0.12);
    pointer-events: auto;
    cursor: ${(action || consumeOnClick) ? 'pointer' : 'default'};
    user-select: none;
    transition: opacity 0.6s ease;
    white-space: nowrap;
  `;

  // Jitter numeric px values in the pos object so corners feel less pinned
Object.entries(pos).forEach(([k, v]) => {
    if (jitter > 0 && typeof v === 'string' && v.endsWith('px')) {
      const n = parseInt(v, 10);
      el.style[k] = (n + (Math.random() - 0.5) * jitter * 2) + 'px';
    } else {
      el.style[k] = v;
    }
  });

  // Apply tilt
  if (tiltDeg !== 0) {
    const existing = el.style.transform || '';
    el.style.transform = `${existing} rotate(${tiltDeg.toFixed(2)}deg)`.trim();
  }

  el.textContent = toAurebesh(text);
  document.body.appendChild(el);

  // Remember base opacity so refreshOpacity restores per-phrase value
  el._baseOpacity = baseOpacity;

  // states: encoded → decoding → decoded → encoding → encoded
  // _consumed is a terminal state: once true, the phrase stays hidden forever.
  el._state = 'encoded';
  el._armed = false;
  el._consumed = false;
  let handle = null;

  function refreshOpacity() {
    if (el._consumed) {
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      return;
    }
    if (panelOpen) {
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      return;
    }
    el.style.pointerEvents = 'auto';
    el.style.opacity = (el._state === 'decoded' || el._state === 'decoding') ? '1' : String(el._baseOpacity);
  }
  el._refreshOpacity = refreshOpacity;

  function stopTicker() {
    if (handle !== null) { clearTimeout(handle); handle = null; }
  }

  // Letters flicker through SCRAMBLE_POOL, then lock left-to-right to
  // the target character, staggered via `lockAt` array
  function runScramble(targetChars, perLetter, initialDelay, onDone) {
    const lockAt = targetChars.map((_, i) => i * perLetter + initialDelay);
    const start  = performance.now();
    function tick() {
      const t = performance.now() - start;
      const display = targetChars.map((ch, i) => {
        if (ch === ' ') return ' ';
        if (t >= lockAt[i]) return ch;
        return SCRAMBLE_POOL[Math.floor(Math.random() * SCRAMBLE_POOL.length)];
      });
      el.textContent = display.join('');
      if (t >= lockAt[lockAt.length - 1]) {
        el.textContent = targetChars.join('');
        handle = null;
        onDone();
        return;
      }
      handle = setTimeout(tick, 35);
    }
    tick();
  }

  function decode() {
    stopTicker();
    el._state = 'decoding';
    el._armed = false;
    el.style.fontFamily = "'IBM Plex Mono', monospace";  // switch to English font before scramble
    refreshOpacity();
    runScramble(text.split(''), 55, 220, () => {
      el._state = 'decoded';
      el._armed = !!(action || consumeOnClick);
    });
  }

  function encode() {
    stopTicker();
    el._state = 'encoding';
    el._armed = false;
    el.style.fontFamily = "'Aurebesh', monospace"; // stay in Aurebesh font throughout
    refreshOpacity();
    // Scramble using English chars (font renders them as Aurebesh glyphs)
    // landing on the final English text (which Aurebesh font shows as Aurebesh)
    runScramble(text.split(''), 45, 0, () => {
      el.textContent = text;
      el._state = 'encoded';
    });
  }

  el.addEventListener('mouseenter', () => {
    if (el._consumed) return;
    if (el._state === 'encoded' || el._state === 'encoding') decode();
  });
  el.addEventListener('mouseleave', () => {
    if (el._consumed) return;
    if (el._state === 'decoded' || el._state === 'decoding') encode();
  });
  el.addEventListener('click', () => {
    if (el._consumed) return;
    if (el._state !== 'decoded' || !el._armed) return;
    if (!action && !consumeOnClick) return;
    el._armed = false;  // one-shot per decode
    if (action) action();
    if (consumeOnClick) {
      el._consumed = true;
      refreshOpacity();  // fade out permanently
    }
  });

  return el;
}

const aurebeshElements = AUREBESH_PHRASES.map(createAurebeshPhrase);

(function aurebeshPanelWatcher() {
  let last = null;
  function tick() {
    if (panelOpen !== last) {
      last = panelOpen;
      aurebeshElements.forEach(el => el._refreshOpacity());
    }
    requestAnimationFrame(tick);
  }
  tick();
})();

// ============================================================
// --- Intro Sequence & UI Chrome ---
// ============================================================
//
// Timeline (approx):
//   0.00s  Black overlay covers everything. Particles are invisible.
//   0.30s  "DINA HASHASH" letters fade in
//   1.40s  Name fades out.
//   1.70s  Overlay fades out (1.2s), revealing particles
//   2.50s  Labels + name-block + social links fade in
//   3.50s  Aurebesh phrases fade in
const INTRO = {
  letterStart: 400,
  nameOut:     2000,
  overlayOut:  2800,
  chromeIn:    5000,
  aurebeshIn:  5000,
};

// ---- Intro overlay ----
const introOverlay = document.createElement('div');
introOverlay.id = 'intro-overlay';
const introName = document.createElement('div');
introName.id = 'intro-name';
introOverlay.appendChild(introName);
document.body.appendChild(introOverlay);

(function buildIntroName() {
  const mk = (ch, cls) => {
    const l = document.createElement('span');
    l.className = 'intro-letter ' + cls;
    l.textContent = ch;
    introName.appendChild(l);
  };
  [...'DINA'].forEach(ch => mk(ch, 'thin'));
  mk(' ', 'space');
  [...'HASHASH'].forEach(ch => mk(ch, 'bold'));
})();

// ---- Persistent name + tagline (upper left) ----
const nameBlock = document.createElement('div');
nameBlock.id = 'name-block';
nameBlock.innerHTML = `
  <div class="chrome-name">
    <span class="chrome-thin">DINA</span> <span class="chrome-bold">HASHASH</span>
  </div>
  <div class="chrome-tagline">// cs + graphics + ai @ stanford</div>
`;
document.body.appendChild(nameBlock);
nameBlock.style.top = '8vh';
nameBlock.style.left = '4vh';

// ---- Social links (bottom right) ----
const socialLinks = document.createElement('div');
socialLinks.id = 'social-links';
socialLinks.innerHTML = `
  <a href="https://www.instagram.com/dina_hashash/" target="_blank" rel="noopener" aria-label="Instagram">
    <svg viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.849.07 1.366.062 2.633.336 3.608 1.311.975.975 1.249 2.242 1.311 3.608.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.062 1.366-.336 2.633-1.311 3.608-.975.975-2.242 1.249-3.608 1.311-1.265.058-1.645.069-4.849.069-3.204 0-3.584-.012-4.849-.069-1.366-.062-2.633-.336-3.608-1.311-.975-.975-1.249-2.242-1.311-3.608-.058-1.265-.069-1.645-.069-4.849 0-3.204.012-3.584.069-4.849.062-1.366.336-2.633 1.311-3.608.975-.975 2.242-1.249 3.608-1.311 1.265-.058 1.645-.07 4.849-.07zm0 1.802c-3.152 0-3.522.012-4.765.069-1.15.052-1.775.243-2.19.403-.552.214-.945.47-1.359.884-.414.414-.669.807-.884 1.359-.16.416-.35 1.04-.403 2.19-.057 1.243-.069 1.613-.069 4.765s.012 3.522.069 4.765c.052 1.15.243 1.775.403 2.19.214.552.47.945.884 1.359.414.414.807.669 1.359.884.416.16 1.04.35 2.19.403 1.243.057 1.613.069 4.765.069 3.152 0 3.522-.012 4.765-.069 1.15-.052 1.775-.243 2.19-.403.552-.214.945-.47 1.359-.884.414-.414.669-.807.884-1.359.16-.416.35-1.04.403-2.19.057-1.243.069-1.613.069-4.765s-.012-3.522-.069-4.765c-.052-1.15-.243-1.775-.403-2.19-.214-.552-.47-.945-.884-1.359-.414-.414-.807-.669-1.359-.884-.416-.16-1.04-.35-2.19-.403-1.243-.057-1.613-.069-4.765-.069zm0 3.063a5.135 5.135 0 1 1 0 10.27 5.135 5.135 0 0 1 0-10.27zm0 8.468a3.333 3.333 0 1 0 0-6.666 3.333 3.333 0 0 0 0 6.666zm5.338-8.669a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4z"/></svg>
  </a>
  <a href="https://www.linkedin.com/in/dina-hashash-9589121b7/" target="_blank" rel="noopener" aria-label="LinkedIn">
    <svg viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.852 3.37-1.852 3.601 0 4.267 2.37 4.267 5.455v6.288zM5.337 7.433a2.063 2.063 0 1 1 0-4.126 2.063 2.063 0 0 1 0 4.126zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
  </a>
  <a href="https://github.com/dinakh2" target="_blank" rel="noopener" aria-label="GitHub">
    <svg viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.111.82-.261.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23a11.5 11.5 0 0 1 3-.405c1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
  </a>
`;
document.body.appendChild(socialLinks);

// ---- Panel-reactive fade (name + social) ----
function applyChromeFade() {
  nameBlock.classList.toggle('panel-hidden', panelOpen);
  socialLinks.classList.toggle('panel-hidden', panelOpen);
}

(function chromePanelWatcher() {
  let last = null;
  function tick() {
    if (panelOpen !== last) {
      last = panelOpen;
      applyChromeFade();
    }
    requestAnimationFrame(tick);
  }
  tick();
})();

// ---- Hide Aurebesh during intro ----
window._aurebeshIntroDone = false;
if (typeof aurebeshElements !== 'undefined') {
  aurebeshElements.forEach(el => {
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    const origRefresh = el._refreshOpacity;
    el._refreshOpacity = () => {
      if (!window._aurebeshIntroDone) {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
        return;
      }
      origRefresh();
    };
  });
}

// ---- Intro timeline ----
window._introLabelsReady = false;
window._introComplete    = false;  // particles are frozen until this flips

setTimeout(() => { introName.classList.add('visible'); }, INTRO.letterStart);
setTimeout(() => { introName.classList.add('out'); },     INTRO.nameOut);
setTimeout(() => {
  introOverlay.classList.add('out');
  document.getElementById('portrait-canvas').style.opacity = '1';

  window._introComplete = true;
  _formationStartMs = performance.now();

  setTimeout(() => introOverlay.remove(), 2200);
}, INTRO.overlayOut);

setTimeout(() => {
  window._introLabelsReady = true;
  nameBlock.classList.add('visible');
  socialLinks.classList.add('visible');
}, INTRO.chromeIn);

setTimeout(() => {
  window._aurebeshIntroDone = true;
  if (typeof aurebeshElements !== 'undefined') {
    aurebeshElements.forEach(el => el._refreshOpacity());
  }
}, INTRO.aurebeshIn);

loop();