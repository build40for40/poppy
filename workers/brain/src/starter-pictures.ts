import type { Scene } from "./pictures";

/**
 * The pictures Poppy starts with: thirty common activities for small children, drawn by hand in the house style (see
 * `pictures.ts`). Each is a scene and the shapes on top of it. Ids are permanent: they end up in play notes and picture URLs.
 */
export interface StarterPicture {
  id: string;
  /** What the picture shows, for Claude to match against an activity. */
  about: string;
  scene: Scene;
  body: string;
}

const INK = "#2C2C2A";
const WHITE = "#FFFFFF";
const CARD = "#BA7517";
const CARD_LIGHT = "#EF9F27";

const car = (x: number, y: number, fill: string, angle = 0, scale = 1) =>
  `<g transform="translate(${x} ${y}) rotate(${angle}) scale(${scale})"><path d="M8 0 q10-22 30-22 h14 q16 0 24 22 Z" fill="${fill}"/><rect x="0" y="-2" width="86" height="26" rx="10" fill="${fill}"/><rect x="28" y="-17" width="14" height="13" rx="3" fill="#E6F1FB"/><rect x="46" y="-17" width="16" height="13" rx="3" fill="#E6F1FB"/><circle cx="20" cy="26" r="11" fill="${INK}"/><circle cx="66" cy="26" r="11" fill="${INK}"/><circle cx="20" cy="26" r="4" fill="#B4B2A9"/><circle cx="66" cy="26" r="4" fill="#B4B2A9"/></g>`;

const block = (x: number, y: number, size: number, fill: string) => `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="6" fill="${fill}"/><rect x="${x + size * 0.3}" y="${y + size * 0.3}" width="${size * 0.4}" height="${size * 0.4}" rx="4" fill="${WHITE}" opacity="0.35"/>`;

const ball = (x: number, y: number, r: number, fill: string) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/><path d="M${x - r * 0.75} ${y - r * 0.2} q${r * 0.75} ${r * 0.6} ${r * 1.5} 0" fill="none" stroke="${WHITE}" stroke-width="${Math.max(2, r * 0.12)}" opacity="0.6"/>`;

const bubble = (x: number, y: number, r: number) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#B5D4F4" fill-opacity="0.45" stroke="#85B7EB" stroke-width="2"/><circle cx="${x - r * 0.35}" cy="${y - r * 0.35}" r="${r * 0.22}" fill="${WHITE}" opacity="0.9"/>`;

const note = (x: number, y: number, fill: string) => `<ellipse cx="${x}" cy="${y}" rx="11" ry="8" transform="rotate(-20 ${x} ${y})" fill="${fill}"/><rect x="${x + 7}" y="${y - 40}" width="5" height="40" fill="${fill}"/><path d="M${x + 12} ${y - 40} q18 6 14 22 q-4-10-14-12 Z" fill="${fill}"/>`;

const teddy = (x: number, y: number, scale = 1) =>
  `<g transform="translate(${x} ${y}) scale(${scale})"><ellipse cx="0" cy="40" rx="42" ry="46" fill="${CARD}"/><ellipse cx="0" cy="48" rx="24" ry="28" fill="#FAC775"/><circle cx="-34" cy="-38" r="16" fill="${CARD}"/><circle cx="34" cy="-38" r="16" fill="${CARD}"/><circle cx="-34" cy="-38" r="8" fill="#FAC775"/><circle cx="34" cy="-38" r="8" fill="#FAC775"/><circle cx="0" cy="-16" r="40" fill="${CARD}"/><ellipse cx="0" cy="-2" rx="17" ry="13" fill="#FAC775"/><circle cx="-14" cy="-24" r="4" fill="${INK}"/><circle cx="14" cy="-24" r="4" fill="${INK}"/><ellipse cx="0" cy="-8" rx="6" ry="4" fill="${INK}"/><ellipse cx="-36" cy="86" rx="18" ry="12" fill="${CARD}"/><ellipse cx="36" cy="86" rx="18" ry="12" fill="${CARD}"/></g>`;

const dino = (x: number, y: number, fill: string, scale = 1, flip = false) =>
  `<g transform="translate(${x} ${y}) scale(${flip ? -scale : scale} ${scale})"><path d="M-60 10 q-30-4-44 14 q30 4 48 0 Z" fill="${fill}"/><ellipse cx="-10" cy="4" rx="56" ry="34" fill="${fill}"/><path d="M30 -10 q6-44 34-50 q24-2 26 18 q0 14-20 16 l-14 2 q-2 18-10 30 Z" fill="${fill}"/><circle cx="72" cy="-46" r="4" fill="${INK}"/><rect x="-40" y="26" width="18" height="30" rx="8" fill="${fill}"/><rect x="8" y="26" width="18" height="30" rx="8" fill="${fill}"/><path d="M-54 -22 l10-16 l10 14 l10-18 l10 16 l10-16 l8 16" fill="none" stroke="${WHITE}" stroke-width="5" stroke-linejoin="round" opacity="0.5"/></g>`;

const leaf = (x: number, y: number, fill: string, angle: number) => `<g transform="translate(${x} ${y}) rotate(${angle})"><path d="M0 0 q20-26 44 0 q-20 26-44 0 Z" fill="${fill}"/><path d="M0 0 h44" stroke="${WHITE}" stroke-width="2" opacity="0.5"/></g>`;

const book = (x: number, y: number, w: number, h: number, fill: string) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${fill}"/><rect x="${x + 6}" y="${y + h * 0.3}" width="${w - 12}" height="${h * 0.15}" rx="2" fill="${WHITE}" opacity="0.5"/>`;

const table = `<rect x="80" y="196" width="440" height="20" rx="6" fill="${CARD}"/><rect x="104" y="214" width="16" height="96" fill="${CARD}"/><rect x="480" y="214" width="16" height="96" fill="${CARD}"/>`;

export const STARTER_PICTURES: StarterPicture[] = [
  {
    id: "toy-bath",
    about: "Toys having a bath: plastic dinosaurs in a bowl of soapy water with a toothbrush",
    scene: "indoor",
    body: `<ellipse cx="300" cy="258" rx="190" ry="26" fill="#85B7EB"/><path d="M110 258 Q300 360 490 258 Z" fill="#378ADD"/>${dino(230, 200, "#639922", 0.9)}${dino(390, 214, "#D85A30", 0.75, true)}${bubble(150, 222, 18)}${bubble(178, 196, 11)}${bubble(320, 226, 14)}${bubble(462, 214, 16)}${bubble(300, 150, 9)}<g transform="rotate(32 520 170)"><rect x="512" y="110" width="18" height="110" rx="8" fill="#D4537E"/><rect x="506" y="80" width="30" height="36" rx="6" fill="#F1EFE8"/></g>`,
  },
  {
    id: "car-ramp",
    about: "Toy cars racing down a cardboard ramp propped on a pile of books",
    scene: "indoor",
    body: `${book(60, 226, 130, 26, "#378ADD")}${book(70, 200, 112, 26, "#D4537E")}${book(64, 174, 124, 26, "#1D9E75")}<path d="M90 172 L560 262 L560 274 L90 186 Z" fill="${CARD_LIGHT}"/><path d="M90 172 L560 262" stroke="${CARD}" stroke-width="5"/>${car(150, 150, "#D85A30", 11, 0.8)}${car(330, 186, "#378ADD", 11, 0.8)}${car(470, 240, "#639922", 0, 0.8)}<path d="M120 120 h40 M110 136 h36 M290 160 h36" stroke="#85B7EB" stroke-width="5" stroke-linecap="round"/>`,
  },
  {
    id: "tape-roads",
    about: "Roads made of masking tape on the floor, with toy cars driving along them",
    scene: "floor",
    body: `<path d="M-10 110 H380 Q440 110 440 170 V350" fill="none" stroke="#B4B2A9" stroke-width="56"/><path d="M-10 110 H380 Q440 110 440 170 V350" fill="none" stroke="${WHITE}" stroke-width="4" stroke-dasharray="18 16"/><path d="M160 -10 V350" fill="none" stroke="#B4B2A9" stroke-width="56"/><path d="M160 -10 V350" fill="none" stroke="${WHITE}" stroke-width="4" stroke-dasharray="18 16"/>${car(250, 96, "#D85A30", 0, 0.7)}${car(146, 230, "#378ADD", 90, 0.7)}${car(454, 250, "#639922", 90, 0.7)}<rect x="500" y="40" width="70" height="56" rx="4" fill="#D4537E"/><path d="M490 44 L535 6 L580 44 Z" fill="#993556"/><rect x="525" y="66" width="20" height="30" rx="3" fill="#FAEEDA"/>`,
  },
  {
    id: "ice-rescue",
    about: "Small toys frozen in blocks of ice, rescued with a squeezy bottle and a cup of warm water",
    scene: "indoor",
    body: `<rect x="90" y="222" width="420" height="40" rx="10" fill="#378ADD"/><rect x="104" y="212" width="392" height="20" rx="6" fill="#85B7EB"/>${[150, 260, 370].map((x, i) => `<rect x="${x}" y="142" width="84" height="76" rx="14" fill="#B5D4F4" fill-opacity="0.85" stroke="#85B7EB" stroke-width="3"/>${dino(x + 42, 184, ["#639922", "#D85A30", "#7F77DD"][i], 0.28)}<path d="M${x + 12} ${152} l14 0" stroke="${WHITE}" stroke-width="4" stroke-linecap="round"/>`).join("")}<rect x="476" y="130" width="40" height="84" rx="10" fill="#D4537E"/><rect x="486" y="112" width="20" height="22" rx="4" fill="#993556"/><path d="M58 172 h52 l-6 46 h-40 Z" fill="#F1EFE8"/><path d="M64 184 h40" stroke="#85B7EB" stroke-width="10"/>`,
  },
  {
    id: "sensory-bin",
    about: "A big tub of dry rice and pasta with scoops, cups and a funnel for pouring",
    scene: "indoor",
    body: `<path d="M110 170 H490 L470 280 H130 Z" fill="#7F77DD"/><rect x="100" y="160" width="400" height="22" rx="8" fill="#534AB7"/><path d="M128 182 Q300 150 472 182 Z" fill="#FAC775"/>${Array.from({ length: 26 }, (_, i) => `<ellipse cx="${150 + ((i * 53) % 300)}" cy="${172 - ((i * 7) % 14)}" rx="9" ry="4" transform="rotate(${(i * 37) % 180} ${150 + ((i * 53) % 300)} ${172 - ((i * 7) % 14)})" fill="${i % 3 ? "#EF9F27" : WHITE}"/>`).join("")}<path d="M372 104 h70 l-20 40 h-30 Z" fill="#1D9E75"/><rect x="398" y="142" width="12" height="26" fill="#1D9E75"/><path d="M160 116 q0 40 40 40 q40 0 40-40 Z" fill="#D85A30"/><rect x="236" y="104" width="70" height="12" rx="6" fill="#D85A30" transform="rotate(-20 236 110)"/><rect x="520" y="226" width="48" height="44" rx="8" fill="#378ADD"/>`,
  },
  {
    id: "play-dough",
    about: "Play dough on a board with a rolling pin and cutters",
    scene: "indoor",
    body: `${table}<rect x="150" y="164" width="300" height="34" rx="10" fill="#F1EFE8"/><ellipse cx="210" cy="160" rx="38" ry="22" fill="#D4537E"/><ellipse cx="300" cy="166" rx="56" ry="14" fill="#378ADD"/><circle cx="392" cy="154" r="22" fill="#639922"/><circle cx="420" cy="170" r="12" fill="#EF9F27"/><rect x="120" y="132" width="170" height="20" rx="10" fill="${CARD_LIGHT}" transform="rotate(-8 205 142)"/><rect x="104" y="136" width="30" height="14" rx="7" fill="${CARD}" transform="rotate(-8 205 142)"/><rect x="276" y="112" width="30" height="14" rx="7" fill="${CARD}" transform="rotate(-8 205 142)"/><path d="M480 120 l10 22 24 2 -18 16 6 24 -22-12 -22 12 6-24 -18-16 24-2 Z" fill="none" stroke="#7F77DD" stroke-width="6" stroke-linejoin="round"/>`,
  },
  {
    id: "painting",
    about: "Painting on a big sheet of paper with pots of paint and chunky brushes",
    scene: "indoor",
    body: `<path d="M90 286 L170 196 H510 L470 286 Z" fill="${WHITE}"/><path d="M190 260 q40-50 90-20 q50 30 100-14" fill="none" stroke="#D85A30" stroke-width="16" stroke-linecap="round"/><path d="M210 236 q60-30 110 0" fill="none" stroke="#EF9F27" stroke-width="12" stroke-linecap="round"/><circle cx="420" cy="232" r="22" fill="#378ADD"/><circle cx="246" cy="270" r="10" fill="#639922"/>${[["#D85A30", 110], ["#378ADD", 168], ["#639922", 226]].map(([c, x]) => `<rect x="${x}" y="292" width="46" height="36" rx="8" fill="#F1EFE8"/><ellipse cx="${Number(x) + 23}" cy="294" rx="20" ry="6" fill="${c}"/>`).join("")}<g transform="rotate(-30 470 150)"><rect x="462" y="80" width="14" height="110" rx="6" fill="${CARD_LIGHT}"/><rect x="460" y="184" width="18" height="16" fill="#B4B2A9"/><path d="M460 200 h18 l-4 26 h-10 Z" fill="#D4537E"/></g>`,
  },
  {
    id: "water-painting",
    about: "Painting a wall or fence outside with just water, a bucket and a big brush",
    scene: "outdoor",
    body: `${Array.from({ length: 5 }, (_, r) => Array.from({ length: 7 }, (_, c) => `<rect x="${40 + c * 76 + (r % 2) * 38}" y="${60 + r * 36}" width="70" height="30" rx="3" fill="${(r + c) % 4 === 0 ? "#85503A" : "#B3654A"}"/>`).join("")).join("")}<path d="M120 90 q60 30 120 0 q40-20 80 10" fill="none" stroke="#712B13" stroke-width="22" stroke-linecap="round" opacity="0.55"/><path d="M150 160 q40 20 90-6" fill="none" stroke="#712B13" stroke-width="18" stroke-linecap="round" opacity="0.55"/><path d="M420 250 h86 l-10 70 h-66 Z" fill="#378ADD"/><ellipse cx="463" cy="252" rx="43" ry="10" fill="#85B7EB"/><path d="M430 250 q33-60 66 0" fill="none" stroke="#185FA5" stroke-width="5"/><g transform="rotate(25 320 230)"><rect x="312" y="200" width="16" height="96" rx="6" fill="${CARD_LIGHT}"/><rect x="300" y="182" width="40" height="22" rx="4" fill="#B4B2A9"/><rect x="300" y="160" width="40" height="24" rx="4" fill="#D85A30"/></g>`,
  },
  {
    id: "chalk",
    about: "Drawing on the patio or pavement outside with chunky chalk: a sun, squares to hop on",
    scene: "outdoor",
    body: `<path d="M0 200 H600 V340 H0 Z" fill="#D3D1C7"/>${Array.from({ length: 6 }, (_, i) => `<path d="M${i * 110} 200 V340" stroke="#B4B2A9" stroke-width="3"/>`).join("")}<path d="M0 270 H600" stroke="#B4B2A9" stroke-width="3"/><circle cx="120" cy="250" r="30" fill="none" stroke="#EF9F27" stroke-width="7"/>${Array.from({ length: 8 }, (_, i) => `<path d="M${120 + Math.cos((i * Math.PI) / 4) * 42} ${250 + Math.sin((i * Math.PI) / 4) * 42} L${120 + Math.cos((i * Math.PI) / 4) * 58} ${250 + Math.sin((i * Math.PI) / 4) * 58}" stroke="#EF9F27" stroke-width="7" stroke-linecap="round"/>`).join("")}${[0, 1, 2].map((i) => `<rect x="${250 + i * 70}" y="226" width="62" height="54" fill="none" stroke="#D4537E" stroke-width="7"/>`).join("")}<rect x="460" y="300" width="40" height="18" rx="9" fill="#378ADD" transform="rotate(-15 480 309)"/><rect x="510" y="290" width="40" height="18" rx="9" fill="#639922" transform="rotate(10 530 299)"/><rect x="420" y="312" width="40" height="18" rx="9" fill="#D4537E"/>`,
  },
  {
    id: "stickers",
    about: "Sticking big stickers onto paper: stars, dots and shapes",
    scene: "indoor",
    body: `${table}<rect x="150" y="96" width="210" height="100" rx="4" fill="${WHITE}" transform="rotate(-4 255 146)"/><path d="M200 120 l8 16 18 2 -13 12 4 18 -17-9 -17 9 4-18 -13-12 18-2 Z" fill="#EF9F27"/><circle cx="280" cy="140" r="16" fill="#D4537E"/><rect x="306" y="150" width="30" height="30" rx="4" fill="#378ADD" transform="rotate(12 321 165)"/><circle cx="236" cy="174" r="12" fill="#639922"/><rect x="390" y="120" width="120" height="74" rx="6" fill="#CECBF6"/>${[0, 1, 2].map((i) => `<circle cx="${416 + i * 34}" cy="142" r="12" fill="${["#D85A30", "#1D9E75", "#7F77DD"][i]}"/>`).join("")}<circle cx="416" cy="174" r="12" fill="#EF9F27"/><circle cx="450" cy="174" r="12" fill="none" stroke="#7F77DD" stroke-width="2" stroke-dasharray="4 3"/>`,
  },
  {
    id: "blocks",
    about: "Building a tall tower out of chunky blocks, with more blocks scattered around",
    scene: "indoor",
    body: `${block(250, 210, 60, "#D85A30")}${block(312, 210, 60, "#378ADD")}${block(280, 150, 60, "#EF9F27")}${block(270, 90, 60, "#639922")}${block(288, 30, 50, "#7F77DD")}${block(120, 236, 44, "#D4537E")}${block(170, 244, 36, "#1D9E75")}${block(440, 230, 50, "#EF9F27")}<path d="M410 286 l26-44 26 44 Z" fill="#378ADD"/><rect x="500" y="250" width="70" height="30" rx="6" fill="#D85A30"/>`,
  },
  {
    id: "box-car",
    about: "A big cardboard box turned into a car, with paper plate wheels and a steering wheel",
    scene: "indoor",
    body: `<path d="M140 140 H460 V262 H140 Z" fill="${CARD_LIGHT}"/><path d="M140 140 L180 104 H420 L460 140 Z" fill="#FAC775"/><path d="M180 104 L140 140 M420 104 L460 140" stroke="${CARD}" stroke-width="4"/><circle cx="210" cy="266" r="40" fill="${WHITE}"/><circle cx="210" cy="266" r="14" fill="#B4B2A9"/><circle cx="390" cy="266" r="40" fill="${WHITE}"/><circle cx="390" cy="266" r="14" fill="#B4B2A9"/><circle cx="440" cy="176" r="14" fill="#FAC775" stroke="${CARD}" stroke-width="4"/><rect x="150" y="190" width="40" height="14" rx="4" fill="#D85A30"/><circle cx="330" cy="92" r="30" fill="none" stroke="#378ADD" stroke-width="10"/><rect x="324" y="96" width="12" height="40" fill="#378ADD"/><path d="M200 160 h120" stroke="${CARD}" stroke-width="4" stroke-dasharray="10 8"/>`,
  },
  {
    id: "blanket-den",
    about: "A den made from a blanket over two chairs, with cushions inside",
    scene: "indoor",
    body: `<rect x="70" y="80" width="20" height="176" fill="${CARD}"/><rect x="70" y="160" width="90" height="16" fill="${CARD}"/><rect x="146" y="160" width="14" height="96" fill="${CARD}"/><rect x="510" y="80" width="20" height="176" fill="${CARD}"/><rect x="440" y="160" width="90" height="16" fill="${CARD}"/><rect x="440" y="160" width="14" height="96" fill="${CARD}"/><path d="M60 84 Q300 40 540 84 L560 270 Q480 240 400 262 L300 160 L200 262 Q120 240 40 270 Z" fill="#7F77DD"/><path d="M60 84 Q300 40 540 84" fill="none" stroke="#534AB7" stroke-width="6"/>${[110, 200, 290, 380, 470].map((x) => `<circle cx="${x}" cy="${110 + (x % 3) * 10}" r="8" fill="#CECBF6"/>`).join("")}<path d="M300 160 L220 262 H380 Z" fill="#26215C"/><ellipse cx="270" cy="252" rx="40" ry="18" fill="#D4537E"/><ellipse cx="336" cy="256" rx="36" ry="16" fill="#EF9F27"/>`,
  },
  {
    id: "obstacle-course",
    about: "An indoor obstacle course of cushions to climb over, a tunnel to crawl through and a hoop to jump in",
    scene: "indoor",
    body: `<path d="M60 262 V200 A70 70 0 0 1 200 200 V262 Z" fill="#1D9E75"/><path d="M90 262 V206 A40 40 0 0 1 170 206 V262 Z" fill="#085041"/>${[["#D4537E", 240], ["#EF9F27", 300], ["#378ADD", 270]].map(([c, x], i) => `<rect x="${x}" y="${232 - i * 26}" width="110" height="30" rx="12" fill="${c}"/>`).join("")}<ellipse cx="490" cy="276" rx="80" ry="20" fill="none" stroke="#D85A30" stroke-width="12"/><path d="M220 120 q80-60 160 0" fill="none" stroke="#85B7EB" stroke-width="5" stroke-dasharray="12 10"/><path d="M372 112 l14 12 -18 6" fill="none" stroke="#85B7EB" stroke-width="5"/>`,
  },
  {
    id: "bubbles",
    about: "Blowing and chasing bubbles outside with a wand and a pot of bubble mix",
    scene: "outdoor",
    body: `${bubble(170, 130, 34)}${bubble(250, 80, 22)}${bubble(320, 150, 40)}${bubble(400, 90, 18)}${bubble(440, 170, 28)}${bubble(220, 200, 16)}${bubble(370, 46, 12)}<rect x="90" y="236" width="56" height="76" rx="10" fill="#D4537E"/><rect x="98" y="222" width="40" height="18" rx="4" fill="#993556"/><g transform="rotate(-35 140 220)"><rect x="136" y="150" width="8" height="90" rx="4" fill="#378ADD"/><circle cx="140" cy="140" r="16" fill="none" stroke="#378ADD" stroke-width="6"/></g>`,
  },
  {
    id: "dance-party",
    about: "A kitchen dance party: music playing, scarves to twirl and lots of moving about",
    scene: "indoor",
    body: `<rect x="70" y="150" width="90" height="110" rx="12" fill="#444441"/><circle cx="115" cy="186" r="20" fill="#888780"/><circle cx="115" cy="186" r="8" fill="#2C2C2A"/><circle cx="115" cy="234" r="14" fill="#888780"/>${note(220, 140, "#7F77DD")}${note(300, 96, "#D4537E")}${note(380, 150, "#1D9E75")}<path d="M300 220 q40-60 90-20 q50 40 100-10 q20-20 40 0" fill="none" stroke="#D85A30" stroke-width="18" stroke-linecap="round"/><path d="M260 270 q50-40 100 0 q50 40 100 0" fill="none" stroke="#EF9F27" stroke-width="16" stroke-linecap="round"/><path d="M180 100 l6 6 M190 80 l10 0 M176 74 l-4-8" stroke="#888780" stroke-width="4" stroke-linecap="round"/>`,
  },
  {
    id: "treasure-hunt",
    about: "A treasure hunt round the house or garden, with a map, clues and a treasure box",
    scene: "indoor",
    body: `<path d="M90 90 L250 70 L270 230 L110 250 Z" fill="#FAEEDA" stroke="${CARD}" stroke-width="5"/><path d="M130 220 q30-30 20-60 q-10-30 30-40 q40-10 50-40" fill="none" stroke="#D85A30" stroke-width="5" stroke-dasharray="10 9"/><path d="M220 70 l20 20 M240 70 l-20 20" stroke="#A32D2D" stroke-width="7" stroke-linecap="round" transform="translate(-2 4)"/><circle cx="140" cy="226" r="7" fill="#1D9E75"/><rect x="340" y="176" width="180" height="90" rx="10" fill="${CARD}"/><path d="M340 186 Q430 110 520 186 Z" fill="${CARD_LIGHT}"/><rect x="340" y="180" width="180" height="14" fill="#633806"/><rect x="418" y="186" width="24" height="30" rx="4" fill="#FAC775"/><circle cx="390" cy="160" r="12" fill="#FAC775"/><circle cx="470" cy="156" r="9" fill="#FAC775"/><path d="M430 128 l6 10 12 1 -9 8 3 12 -12-6 -12 6 3-12 -9-8 12-1 Z" fill="#FAC775"/>`,
  },
  {
    id: "nature-walk",
    about: "A nature hunt outside, collecting leaves, sticks and pine cones in a basket",
    scene: "outdoor",
    body: `<rect x="470" y="70" width="34" height="180" fill="${CARD}"/><circle cx="487" cy="70" r="70" fill="#639922"/><circle cx="440" cy="100" r="40" fill="#3B6D11"/><path d="M180 214 h160 l-20 70 h-120 Z" fill="${CARD_LIGHT}"/><path d="M190 214 q70-90 140 0" fill="none" stroke="${CARD}" stroke-width="10"/><path d="M196 236 h128 M204 258 h112" stroke="${CARD}" stroke-width="4"/>${leaf(210, 206, "#D85A30", -30)}${leaf(260, 200, "#EF9F27", -60)}${leaf(290, 210, "#639922", -20)}${leaf(90, 280, "#EF9F27", 20)}${leaf(380, 296, "#D85A30", -10)}<ellipse cx="420" cy="270" rx="16" ry="24" fill="#854F0B"/><path d="M406 258 h28 M404 270 h32 M408 282 h24" stroke="#633806" stroke-width="3"/><rect x="60" y="240" width="90" height="8" rx="4" fill="#854F0B" transform="rotate(-12 105 244)"/>`,
  },
  {
    id: "mud-kitchen",
    about: "A mud kitchen outside: pots, pans and spoons for making mud pies and potions",
    scene: "outdoor",
    body: `<rect x="90" y="150" width="420" height="22" rx="4" fill="${CARD}"/><rect x="110" y="170" width="20" height="120" fill="${CARD}"/><rect x="470" y="170" width="20" height="120" fill="${CARD}"/><rect x="140" y="104" width="100" height="48" rx="8" fill="#888780"/><ellipse cx="190" cy="106" rx="50" ry="10" fill="#633806"/><rect x="236" y="112" width="40" height="10" rx="5" fill="#5F5E5A"/><ellipse cx="350" cy="140" rx="54" ry="12" fill="#5F5E5A"/><ellipse cx="350" cy="134" rx="44" ry="10" fill="#854F0B"/><circle cx="330" cy="128" r="5" fill="#639922"/><circle cx="364" cy="130" r="4" fill="#D4537E"/><g transform="rotate(-25 450 110)"><rect x="446" y="60" width="10" height="80" rx="5" fill="${CARD_LIGHT}"/><ellipse cx="451" cy="58" rx="14" ry="20" fill="${CARD_LIGHT}"/></g><ellipse cx="300" cy="300" rx="120" ry="18" fill="#854F0B"/><ellipse cx="230" cy="290" rx="34" ry="12" fill="#633806"/>`,
  },
  {
    id: "tea-party",
    about: "A teddy bears' tea party with a teapot, cups and pretend cakes",
    scene: "indoor",
    body: `${teddy(110, 150, 0.8)}<rect x="200" y="196" width="360" height="18" rx="6" fill="#ED93B1"/><rect x="220" y="212" width="14" height="80" fill="#993556"/><rect x="526" y="212" width="14" height="80" fill="#993556"/><path d="M270 196 q-10-70 50-70 q60 0 50 70 Z" fill="#378ADD"/><rect x="306" y="110" width="28" height="20" rx="8" fill="#378ADD"/><path d="M366 160 q34-6 36-30" fill="none" stroke="#378ADD" stroke-width="10" stroke-linecap="round"/><path d="M272 150 q-30 0-30 30" fill="none" stroke="#378ADD" stroke-width="8"/><path d="M420 168 h46 l-6 28 h-34 Z" fill="${WHITE}"/><path d="M466 176 q14 4 0 14" fill="none" stroke="${WHITE}" stroke-width="5"/><path d="M490 196 l20-34 20 34 Z" fill="#FAC775"/><path d="M494 180 h32" stroke="#D4537E" stroke-width="6"/><circle cx="510" cy="160" r="5" fill="#E24B4A"/>`,
  },
  {
    id: "teddy-doctor",
    about: "Playing doctors or vets with a poorly teddy, plasters and a toy doctor's kit",
    scene: "indoor",
    body: `${teddy(230, 150, 1)}<rect x="196" y="98" width="68" height="16" rx="8" fill="${WHITE}" transform="rotate(-10 230 106)"/><path d="M224 100 v12 M218 106 h12" stroke="#E24B4A" stroke-width="3" transform="rotate(-10 230 106)"/><rect x="256" y="190" width="40" height="14" rx="5" fill="#FAC775" transform="rotate(30 276 197)"/><rect x="360" y="170" width="160" height="96" rx="12" fill="#E24B4A"/><rect x="420" y="152" width="40" height="22" rx="6" fill="none" stroke="#A32D2D" stroke-width="6"/><rect x="428" y="196" width="24" height="56" rx="3" fill="${WHITE}"/><rect x="412" y="212" width="56" height="24" rx="3" fill="${WHITE}"/><rect x="380" y="278" width="44" height="16" rx="6" fill="#FAC775" transform="rotate(-8 402 286)"/><rect x="440" y="282" width="44" height="16" rx="6" fill="#FAC775" transform="rotate(6 462 290)"/>`,
  },
  {
    id: "pretend-shop",
    about: "Playing shops: pushing a toy shopping trolley full of tins, boxes and fruit",
    scene: "indoor",
    body: `<path d="M150 120 H430 L410 230 H180 Z" fill="none" stroke="#378ADD" stroke-width="8" stroke-linejoin="round"/>${[0, 1, 2, 3].map((i) => `<path d="M${200 + i * 56} 124 L${206 + i * 50} 228" stroke="#378ADD" stroke-width="4"/>`).join("")}<path d="M166 176 H420" stroke="#378ADD" stroke-width="4"/><path d="M430 120 L470 84 H500" fill="none" stroke="#378ADD" stroke-width="8" stroke-linecap="round"/><path d="M180 230 L170 256 H420" fill="none" stroke="#378ADD" stroke-width="8"/><circle cx="196" cy="268" r="14" fill="${INK}"/><circle cx="398" cy="268" r="14" fill="${INK}"/><rect x="200" y="78" width="46" height="60" rx="6" fill="#D85A30"/><rect x="200" y="94" width="46" height="18" fill="#FAC775"/><rect x="258" y="62" width="64" height="76" rx="4" fill="#EF9F27"/><rect x="270" y="78" width="40" height="22" rx="3" fill="${WHITE}" opacity="0.6"/><circle cx="352" cy="110" r="24" fill="#E24B4A"/><rect x="350" y="80" width="5" height="10" fill="#633806"/><path d="M354 86 q12-8 18 0 q-10 6-18 0" fill="#639922"/><path d="M380 96 q20-30 40 0 q-4 40-20 40 q-16 0-20-40 Z" fill="#FAC775"/>`,
  },
  {
    id: "colour-sorting",
    about: "Sorting big toys or blocks by colour into the cups of a muffin tin or bowls",
    scene: "indoor",
    body: `${table}<rect x="150" y="140" width="300" height="58" rx="10" fill="#888780"/>${[0, 1, 2, 3, 4].map((i) => `<ellipse cx="${180 + i * 60}" cy="160" rx="24" ry="14" fill="#5F5E5A"/><circle cx="${180 + i * 60}" cy="150" r="17" fill="${["#D85A30", "#378ADD", "#639922", "#EF9F27", "#7F77DD"][i]}"/>`).join("")}${block(470, 160, 34, "#378ADD")}${block(100, 160, 34, "#D85A30")}<circle cx="520" cy="250" r="20" fill="#639922"/><circle cx="72" cy="260" r="18" fill="#EF9F27"/>`,
  },
  {
    id: "jigsaw",
    about: "Doing a chunky jigsaw puzzle on the floor",
    scene: "floor",
    body: `<rect x="130" y="60" width="340" height="220" rx="10" fill="#FAC775"/>${[[0, 0, "#378ADD"], [1, 0, "#639922"], [2, 0, "#D4537E"], [0, 1, "#EF9F27"], [1, 1, "#7F77DD"]].map(([c, r, f]) => `<rect x="${150 + Number(c) * 104}" y="${80 + Number(r) * 96}" width="96" height="88" rx="8" fill="${f}"/><circle cx="${150 + Number(c) * 104 + 96}" cy="${80 + Number(r) * 96 + 44}" r="14" fill="${f}"/>`).join("")}<rect x="358" y="176" width="96" height="88" rx="8" fill="#EF9F27" opacity="0.25"/><g transform="rotate(18 520 240)"><rect x="480" y="200" width="96" height="88" rx="8" fill="#1D9E75"/><circle cx="480" cy="244" r="14" fill="#FAC775"/></g>`,
  },
  {
    id: "story-time",
    about: "A cosy reading corner with a pile of picture books and a cushion",
    scene: "indoor",
    body: `<ellipse cx="200" cy="246" rx="120" ry="34" fill="#D4537E"/><ellipse cx="200" cy="236" rx="100" ry="24" fill="#ED93B1"/>${book(380, 226, 150, 30, "#378ADD")}${book(392, 196, 130, 30, "#EF9F27")}${book(386, 166, 140, 30, "#639922")}<path d="M150 210 L200 190 L250 210 L250 150 L200 130 L150 150 Z" fill="${WHITE}"/><path d="M200 130 V190" stroke="#B4B2A9" stroke-width="3"/><path d="M162 152 l28-10 M162 166 l28-10 M210 142 l28 10 M210 156 l28 10" stroke="#B4B2A9" stroke-width="3"/><path d="M146 150 L200 128 L254 150" fill="none" stroke="#D85A30" stroke-width="5"/>${teddy(300, 170, 0.5)}`,
  },
  {
    id: "kitchen-band",
    about: "A kitchen band: banging upside-down pots and pans with wooden spoons",
    scene: "indoor",
    body: `<path d="M110 260 V200 Q110 180 130 180 H230 Q250 180 250 200 V260 Z" fill="#888780"/><rect x="100" y="172" width="160" height="14" rx="6" fill="#5F5E5A"/><path d="M290 260 V214 Q290 200 304 200 H386 Q400 200 400 214 V260 Z" fill="#B4B2A9"/><rect x="284" y="194" width="122" height="12" rx="5" fill="#888780"/><rect x="400" y="230" width="90" height="12" rx="6" fill="#5F5E5A"/><ellipse cx="510" cy="262" rx="50" ry="14" fill="#888780"/><g transform="rotate(-30 200 120)"><rect x="196" y="70" width="10" height="100" rx="5" fill="${CARD_LIGHT}"/><ellipse cx="201" cy="66" rx="14" ry="20" fill="${CARD_LIGHT}"/></g><g transform="rotate(30 360 140)"><rect x="356" y="90" width="10" height="100" rx="5" fill="${CARD_LIGHT}"/><ellipse cx="361" cy="86" rx="14" ry="20" fill="${CARD_LIGHT}"/></g>${note(470, 140, "#7F77DD")}${note(110, 120, "#D4537E")}<path d="M240 150 l10-12 M262 156 l14-6 M300 160 l-6-14" stroke="#EF9F27" stroke-width="5" stroke-linecap="round"/>`,
  },
  {
    id: "posting-box",
    about: "Posting things through a slot in a cardboard box: cards, jar lids or envelopes",
    scene: "indoor",
    body: `<path d="M150 130 H400 V262 H150 Z" fill="${CARD_LIGHT}"/><path d="M150 130 L200 96 H450 L400 130 Z" fill="#FAC775"/><path d="M400 130 L450 96 V230 L400 262 Z" fill="${CARD}"/><rect x="220" y="160" width="110" height="16" rx="8" fill="#633806"/><rect x="250" y="90" width="50" height="78" rx="4" fill="#E24B4A" transform="rotate(8 275 129)"/><rect x="260" y="104" width="30" height="20" rx="2" fill="${WHITE}" opacity="0.6" transform="rotate(8 275 129)"/><rect x="470" y="226" width="50" height="34" rx="4" fill="#378ADD"/><circle cx="110" cy="250" r="20" fill="#EF9F27"/><circle cx="110" cy="250" r="12" fill="#FAC775"/><rect x="480" y="190" width="50" height="34" rx="4" fill="#639922" transform="rotate(-12 505 207)"/>`,
  },
  {
    id: "sand-play",
    about: "Digging in a sandpit with a bucket and spade, making sandcastles",
    scene: "outdoor",
    body: `<rect x="60" y="200" width="480" height="110" rx="14" fill="#1D9E75"/><rect x="76" y="212" width="448" height="86" rx="8" fill="#FAC775"/><path d="M200 250 h80 v-34 h-14 v12 h-14 v-12 h-14 v12 h-14 v-12 h-24 Z" fill="#EF9F27"/><rect x="226" y="194" width="28" height="24" fill="#EF9F27"/><path d="M226 194 h7 v-8 h7 v8 h7 v-8 h7 v8" fill="#EF9F27"/><path d="M240 170 v24 M240 170 l18 7 -18 7" fill="#D85A30" stroke="#D85A30" stroke-width="3"/><path d="M340 196 h70 l-10 64 h-50 Z" fill="#D85A30"/><path d="M344 196 q31-50 62 0" fill="none" stroke="#993556" stroke-width="5"/><g transform="rotate(30 460 230)"><rect x="454" y="150" width="12" height="80" rx="5" fill="#378ADD"/><path d="M440 226 h40 l-6 36 q-14 10-28 0 Z" fill="#378ADD"/></g>`,
  },
  {
    id: "feed-the-monster",
    about: "Feeding a hungry monster: a box with a big mouth to throw rolled-up socks or soft balls into",
    scene: "indoor",
    body: `<rect x="160" y="80" width="230" height="182" rx="10" fill="#1D9E75"/><circle cx="230" cy="130" r="26" fill="${WHITE}"/><circle cx="236" cy="134" r="12" fill="${INK}"/><circle cx="320" cy="130" r="26" fill="${WHITE}"/><circle cx="326" cy="134" r="12" fill="${INK}"/><ellipse cx="275" cy="210" rx="72" ry="36" fill="#04342C"/><path d="M218 190 l14 18 14-20 14 20 14-20 14 20 14-20 14 18" fill="${WHITE}"/><path d="M180 80 l-10-34 30 26 M370 80 l10-34 -30 26" fill="#1D9E75"/>${ball(470, 250, 22, "#D4537E")}${ball(520, 230, 18, "#378ADD")}${ball(440, 140, 18, "#EF9F27")}<path d="M500 110 q-60-30-110 30" fill="none" stroke="#B4B2A9" stroke-width="4" stroke-dasharray="10 8"/>`,
  },
  {
    id: "ball-toss",
    about: "Throwing soft balls or bean bags into a laundry basket, then running to fetch them",
    scene: "indoor",
    body: `<path d="M330 160 H500 L484 262 H346 Z" fill="#378ADD"/><rect x="322" y="150" width="186" height="20" rx="8" fill="#185FA5"/>${[0, 1, 2, 3].map((i) => `<rect x="${360 + i * 34}" y="190" width="18" height="52" rx="6" fill="#85B7EB"/>`).join("")}${ball(150, 236, 26, "#D85A30")}${ball(240, 120, 22, "#EF9F27")}${ball(408, 146, 18, "#639922")}<path d="M150 210 q60-150 240-80" fill="none" stroke="#B4B2A9" stroke-width="4" stroke-dasharray="10 8"/><rect x="80" y="262" width="40" height="22" rx="8" fill="#D4537E"/>`,
  },
];
