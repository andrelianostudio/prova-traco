// Prova do traço gerado por código (prova-traco.html).
// A fachada da Sé é modelada em 3D aqui mesmo, em caixas e arcos. A hachura, o contorno tremido e o papel são
// desenhados pelos shaders, do jeito do site da Chartogne-Taillet. O ornamento (capitéis, frontões das janelas,
// a imagem do alto e os balaústres), as flores do casamento e as imagens dos altares são desenho à mão: peças de
// img/ornato.png coladas de frente, que entram como tinta no passo 1.
// Com o scroll a câmera desce até as portas, a do meio se abre e ela entra pela nave (ver "Por dentro").
//
// Como o desenho é feito, em dois passos:
//   1. a cena vai para três texturas: normal e profundidade; hachura, número da peça e distância até a porta;
//      e o quanto a peça some nas bordas da cena;
//   2. um passo de tela cheia acha os contornos nessas texturas, treme tudo com ruído e põe o papel.
// As medidas da fachada saíram da arte final (ilustracoes/azul-sobre-creme/praca-da-se/final/praca-final-2x.png),
// num recorte de 1300 x 1600 px: X(), Y() e U() convertem esses pixels para unidades da cena.

import * as THREE from "./vendor/three.module.js";
import { ATLAS, ORNATOS } from "./ornato-mapa.js";

const abertura = document.querySelector(".abertura3d");
const palco = abertura.querySelector(".palco3d");
const tela = palco.querySelector(".tela3d");
const texto = palco.querySelector(".ceu-texto");
const dica = palco.querySelector(".dica");
const frase = palco.querySelector(".frase");
const parado =matchMedia("(prefers-reduced-motion: reduce)").matches;
// O trilho das etapas: cinco pontos na beira da tela. Mostram onde se está no caminho e levam a cada parada.
const trilho = palco.querySelector(".trilho");
const paradas = trilho ? [...trilho.querySelectorAll("button")] : [];
let paradaAtual = -1, trilhoVisto = -1;
for (const b of paradas) {
  b.addEventListener("click", () => {
    const r = abertura.getBoundingClientRect();
    scrollTo({ top: scrollY + r.top + (r.height - innerHeight) * +b.dataset.p, behavior: parado ? "auto" : "smooth" });
  });
}

const limitar = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const suave = (v) => { const t = limitar(v); return t * t * (3 - 2 * t); };
const misturar = (a, b, t) => a + (b - a) * t;

// ---------- Medidas ----------
// 100 px do recorte = 1 unidade. O eixo da fachada fica em x = 0 e o pé da igreja em y = 0.
const X = (px) => (px - 651) / 100;
const Y = (py) => (1500 - py) / 100;
const U = (px) => px / 100;

const Z_TORRE = 0; // frente das torres
const Z_CORPO = 0.3; // frente do corpo central, um pouco à frente das torres
const ALTO = Y(50); // alto das cruzes
const PORTA = new THREE.Vector3(0, 1.1, Z_CORPO); // meio da porta central
const LONGE = 120;

const SELO_VISTA = { x: 18.22, y: 24.48, w: 622, h: 449.73 }; // a caixa do desenho do monograma (598 x 425,73) com 12 de folga
const SELO_LARG = 0.9; // a largura do monograma, em unidades da cena
const SELO_TAM = [(SELO_LARG * SELO_VISTA.w) / 598, (SELO_LARG * SELO_VISTA.h) / 598]; // a chapa onde ele é pintado
const SELO_TX = 1536; // a largura da textura do monograma
const LISO = 0, JUNTAS = 1, CANELURAS = 2, CHEIO = 3, TELHADO = 4, CHAO = 5, TABUAS = 6, TRONCO = 7, FOLHA = 8, ORNATO = 9, LADRILHO = 10, MADEIRA = 11, SELO = 12, PLACA = 13, MOSAICO = 14, MARMORE = 15;

// ---------- Montagem da geometria ----------
// Todas as peças vão para uma malha só. Cada peça leva um tipo (como é hachurada) e um número
// (o passo de tela cheia risca um contorno onde dois números diferentes se encostam).
class Obra {
  constructor() { this.pos = []; this.nor = []; this.tipo = []; this.id = []; this.vento = []; this.fase = []; this.uv = []; this.n = 0; this.sopro = null; }

  novoId() { this.n += 1; return (((this.n * 7) % 61) + 1) / 64; }

  junta(geo, tipo = LISO, id = this.novoId(), chato = false) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (chato) g.computeVertexNormals();
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    const uv = tipo === ORNATO || tipo === SELO ? g.attributes.uv.array : null;
    const gb = g.attributes.balanco ? g.attributes.balanco.array : null; // a peça que traz o seu balanço (ver retangulo)
    for (let i = 0; i < p.length; i++) { this.pos.push(p[i]); this.nor.push(n[i]); }
    for (let i = 0; i < p.length / 3; i++) {
      this.tipo.push(tipo); this.id.push(id);
      // sopro(x, y, z) diz quanto o ponto balança ao vento e com que atraso; sem ele, a peça é fixa
      const [peso, fase] = gb ? [gb[i * 2], gb[i * 2 + 1]] : this.sopro ? this.sopro(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]) : [0, 0];
      this.vento.push(peso); this.fase.push(fase);
      this.uv.push(uv ? uv[i * 2] : 0, uv ? uv[i * 2 + 1] : 0);
    }
    geo.dispose();
    if (g !== geo) g.dispose();
    return id;
  }

  geometria() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("aTipo", new THREE.Float32BufferAttribute(this.tipo, 1));
    g.setAttribute("aId", new THREE.Float32BufferAttribute(this.id, 1));
    g.setAttribute("aVento", new THREE.Float32BufferAttribute(this.vento, 1));
    g.setAttribute("aUv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("aFase", new THREE.Float32BufferAttribute(this.fase, 1));
    return g;
  }
}

// Caixa: x e y em pixels do recorte (yT é o alto), z em unidades
function caixa(o, x0, x1, yT, yB, z0, z1, tipo = LISO, id) {
  const g = new THREE.BoxGeometry(U(x1 - x0), U(yB - yT), z1 - z0);
  g.translate(X((x0 + x1) / 2), Y((yT + yB) / 2), (z0 + z1) / 2);
  return o.junta(g, tipo, id);
}

// Contorno de um vão: retângulo, ou retângulo fechado em arco pleno. folga alarga o vão (para molduras).
function contorno(f, folga = 0) {
  const xa = X(f.cx - f.hw - folga), xb = X(f.cx + f.hw + folga);
  const yb = Y(f.base), r = U(f.hw + folga);
  const p = new THREE.Path();
  p.moveTo(xa, yb);
  if (f.arco) {
    const ym = Y(f.topo - folga) - r;
    p.lineTo(xa, ym);
    p.absarc(X(f.cx), ym, r, Math.PI, 0, true);
  } else {
    p.lineTo(xa, Y(f.topo - folga));
    p.lineTo(xb, Y(f.topo - folga));
  }
  p.lineTo(xb, yb);
  p.closePath();
  return p;
}

// Parede com vãos de verdade: zF é a face da frente, esp a espessura
function parede(o, x0, x1, yT, yB, zF, esp, furos, tipo, id) {
  const s = new THREE.Shape();
  s.moveTo(X(x0), Y(yB)); s.lineTo(X(x1), Y(yB)); s.lineTo(X(x1), Y(yT)); s.lineTo(X(x0), Y(yT)); s.closePath();
  for (const f of furos) if (f.cx - f.hw > x0 && f.cx + f.hw < x1) s.holes.push(contorno(f));
  const g = new THREE.ExtrudeGeometry(s, { depth: esp, bevelEnabled: false, curveSegments: 14 });
  g.translate(0, 0, zF - esp);
  return o.junta(g, tipo, id);
}

// Moldura em volta de um vão (arquivolta ou guarnição), saliente da parede
function moldura(o, f, larg, z0, z1, tipo = LISO) {
  const s = new THREE.Shape(contorno(f, larg).getPoints(14));
  s.holes.push(contorno({ ...f, base: f.base - 2 }));
  const g = new THREE.ExtrudeGeometry(s, { depth: z1 - z0, bevelEnabled: false, curveSegments: 14 });
  g.translate(0, 0, z0);
  return o.junta(g, tipo);
}

// Prisma ou tronco de pirâmide de n lados com uma face de frente. Raios dados pela apótema, em unidades.
function prisma(o, cx, cz, yB, yT, rB, rT, lados, tipo = LISO) {
  const k = 1 / Math.cos(Math.PI / lados);
  const g = new THREE.CylinderGeometry(rT * k, rB * k, U(yB - yT), lados, 1);
  g.rotateY(Math.PI / lados);
  g.translate(cx, Y((yB + yT) / 2), cz);
  return o.junta(g, tipo, undefined, true);
}

// Viga inclinada entre dois pontos (as cornijas do frontão)
function viga(o, ax, ay, bx, by, esp, z0, z1, tipo = LISO) {
  const A = [X(ax), Y(ay)], B = [X(bx), Y(by)];
  const comp = Math.hypot(B[0] - A[0], B[1] - A[1]), ang = Math.atan2(B[1] - A[1], B[0] - A[0]);
  const g = new THREE.BoxGeometry(comp + U(esp), U(esp), z1 - z0);
  g.rotateZ(ang);
  g.translate((A[0] + B[0]) / 2 - (Math.sin(ang) * U(esp)) / 2, (A[1] + B[1]) / 2 + (Math.cos(ang) * U(esp)) / 2, (z0 + z1) / 2);
  return o.junta(g, tipo);
}

// Caixilho: travessas claras dentro de um vão escuro
function caixilho(o, f, z, colunas, linhas) {
  const id = o.novoId();
  const alto = f.arco ? f.topo + f.hw : f.topo;
  for (let i = 1; i < colunas; i++) {
    const x = f.cx - f.hw + (2 * f.hw * i) / colunas;
    caixa(o, x - 1.6, x + 1.6, f.topo + 4, f.base, z - 0.04, z, LISO, id);
  }
  for (let j = 0; j < linhas; j++) {
    const y = alto + ((f.base - alto) * j) / linhas;
    caixa(o, f.cx - f.hw, f.cx + f.hw, y - 1.6, y + 1.6, z - 0.04, z, LISO, id);
  }
}

// Balaústres entre dois x, com corrimão e soleira
function balaustrada(o, x0, x1, yT, yB, z0, z1, passo = 13) {
  caixa(o, x0, x1, yT, yT + 6, z0 - 0.03, z1 + 0.03);
  caixa(o, x0, x1, yB - 6, yB, z0 - 0.03, z1 + 0.03);
  // Cada balaústre é o desenho à mão, esticado até a altura do vão e nunca mais largo que o seu lugar na fila
  const n = Math.max(1, Math.round((x1 - x0) / passo));
  const m = ORNATOS.balaustre;
  const sy = U(yB - yT - 12) / m.h;
  const sx = Math.min(sy, (0.86 * U((x1 - x0) / n)) / m.w);
  for (let i = 0; i < n; i++) {
    const x = x0 + ((i + 0.5) * (x1 - x0)) / n;
    ornato(o, "balaustre", X(x), Y(yB - 6), (z0 + z1) / 2, sx, sy);
  }
}

function corpoCentral(o) {
  const Z = Z_CORPO, ESP = 0.45;
  const vaos = [450, 651, 860];
  const altas = vaos.map((cx) => ({ cx, hw: 28, topo: 945, base: 1038 }));
  const meio = vaos.map((cx) => ({ cx, hw: 40, topo: 1095, base: 1222, arco: true }));
  const portas = vaos.map((cx) => ({ cx, hw: 37, topo: 1295, base: 1496, arco: true }));

  parede(o, 325, 985, 870, 1500, Z, ESP, [...altas, ...meio, ...portas], JUNTAS);
  // O escuro atrás dos vãos. Atrás da porta do meio não há nada: ela dá para a nave (ver nave()).
  caixa(o, 330, 980, 880, 1262, Z - ESP - 0.06, Z - ESP, CHEIO);
  caixa(o, 330, 560, 1262, 1500, Z - ESP - 0.06, Z - ESP, CHEIO);
  caixa(o, 742, 980, 1262, 1500, Z - ESP - 0.06, Z - ESP, CHEIO);

  for (const f of altas) {
    moldura(o, f, 6, Z, Z + 0.06);
    caixa(o, f.cx - 40, f.cx + 40, 1040, 1049, Z, Z + 0.12); // peitoril
    // o frontão da janela é desenho à mão: ver ornatos()
    // o escuro fica logo atrás da face: com a parede inteira de fundura, o vidro fugia do meio da moldura
    caixa(o, f.cx - f.hw - 2, f.cx + f.hw + 2, f.topo - 2, f.base + 2, Z - 0.2, Z - 0.16, CHEIO);
    caixilho(o, f, Z - 0.1, 2, 2);
  }
  for (const f of meio) {
    moldura(o, f, 7, Z, Z + 0.06);
    caixa(o, f.cx - 3.5, f.cx + 3.5, 1082, 1096, Z, Z + 0.1); // fecho do arco
    caixa(o, f.cx - f.hw - 2, f.cx + f.hw + 2, f.topo - 2, f.base + 2, Z - 0.2, Z - 0.16, CHEIO);
    caixilho(o, { ...f, base: 1190 }, Z - 0.1, 4, 3);
    caixa(o, f.cx - 50, f.cx + 50, 1222, 1231, Z, Z + 0.24); // laje do balcão
    balaustrada(o, f.cx - 46, f.cx + 46, 1188, 1222, Z + 0.13, Z + 0.19);
  }
  for (const f of portas) {
    moldura(o, f, 9, Z, Z + 0.08);
    caixa(o, f.cx - 4.5, f.cx + 4.5, 1280, 1297, Z, Z + 0.13);
    // as folhas das portas dos lados ficam fechadas; as da porta do meio giram e são montadas à parte
    if (f.cx !== 651) for (const lado of [-1, 1]) folha(o, lado, X(f.cx) + lado * PORTA_HW, PISO, Z_FOLHA);
  }

  caixa(o, 325, 985, 1062, 1072, Z, Z + 0.06); // cinta entre o andar alto e o do meio
  caixa(o, 325, 985, 1232, 1245, Z, Z + 0.08); // cinta sobre as portas

  // Pilastras de ordem colossal sobre pedestais
  for (const c of [352, 545, 758, 958]) {
    caixa(o, c - 22, c + 22, 908, 1310, Z, Z + 0.2, CANELURAS); // o fuste sobe até atrás do capitel desenhado
    caixa(o, c - 27, c + 27, 1310, 1323, Z, Z + 0.26); // base
    caixa(o, c - 40, c + 40, 1323, 1336, Z, Z + 0.4);
    caixa(o, c - 36, c + 36, 1336, 1470, Z, Z + 0.34); // pedestal
    caixa(o, c - 40, c + 40, 1470, 1500, Z, Z + 0.4);
  }

  // Entablamento, dentículos e cornija
  caixa(o, 316, 994, 835, 875, Z - 0.1, Z + 0.24);
  const dent = o.novoId();
  for (let x = 322; x < 990; x += 14) caixa(o, x, x + 7, 822, 835, Z + 0.24, Z + 0.34, LISO, dent);
  caixa(o, 308, 1000, 806, 822, Z - 0.2, Z + 0.5);
  caixa(o, 304, 1004, 798, 806, Z - 0.2, Z + 0.56);

  // Frontão: o tímpano segue para trás como telhado de duas águas
  const s = new THREE.Shape();
  s.moveTo(X(312), Y(798)); s.lineTo(X(996), Y(798)); s.lineTo(X(654), Y(662)); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 5 + Z + 0.12, bevelEnabled: false });
  g.translate(0, 0, -5);
  o.junta(g);
  viga(o, 304, 798, 654, 655, 15, Z - 0.2, Z + 0.56);
  viga(o, 654, 655, 1004, 798, 15, Z - 0.2, Z + 0.56);
  viga(o, 330, 798, 654, 672, 6, Z + 0.12, Z + 0.3);
  viga(o, 654, 672, 978, 798, 6, Z + 0.12, Z + 0.3);

  // A imagem no alto do frontão, só o vulto
  caixa(o, 640, 668, 628, 648, Z - 0.15, Z + 0.2);
}

// O retângulo de uma peça do atlas. p é o ponto de pega; (a0, a1) e (b0, b1) são os limites ao longo da largura e
// da altura da peça, contados a partir dele. roda gira a peça no próprio plano; vira gira o plano em torno do eixo
// vertical (com 0 a peça olha para a porta; positivo, ela se volta para a direita); espelha troca os lados.
// Uma peça que se mexe (as chamas do lustre, as fitas dos buquês) é dividida em vários retângulos: cortes diz onde,
// em frações da imagem dela ([da esquerda para a direita], [do alto para o pé]), e balanco(fx, fy) devolve o peso e
// o atraso do balanço de cada ponto da imagem (ver o passo 1: é o desenho que se deforma, nada é redesenhado).
function retangulo(o, m, p, a0, a1, b0, b1, { roda = 0, vira = 0, espelha = false, cortes = null, balanco = null } = {}) {
  const cr = Math.cos(roda), sr = Math.sin(roda), cv = Math.cos(vira), sv = Math.sin(vira);
  const ponto = (a, b) => { const x = a * cr - b * sr, y = a * sr + b * cr; return [p[0] + x * cv, p[1] + y, p[2] - x * sv]; };
  let u0 = m.x / ATLAS.w, u1 = (m.x + m.w) / ATLAS.w;
  if (espelha) [u0, u1] = [u1, u0];
  const v1 = 1 - m.y / ATLAS.h, v0 = 1 - (m.y + m.h) / ATLAS.h;
  // as divisões ao longo da largura e da altura da peça, de 0 a 1, a partir do canto de baixo
  const fa = cortes ? (espelha ? cortes[0].map((x) => 1 - x).reverse() : cortes[0]) : [0, 1];
  const fb = cortes ? cortes[1].map((y) => 1 - y).reverse() : [0, 1];
  const pos = [], nor = [], uv = [], bal = [];
  const canto = (i, j) => {
    pos.push(...ponto(a0 + (a1 - a0) * fa[i], b0 + (b1 - b0) * fb[j]));
    nor.push(0, 0, 1);
    uv.push(u0 + (u1 - u0) * fa[i], v0 + (v1 - v0) * fb[j]);
    if (balanco) bal.push(...balanco(espelha ? 1 - fa[i] : fa[i], 1 - fb[j]));
  };
  for (let j = 0; j < fb.length - 1; j++) {
    for (let i = 0; i < fa.length - 1; i++) {
      canto(i, j); canto(i + 1, j); canto(i + 1, j + 1);
      canto(i, j); canto(i + 1, j + 1); canto(i, j + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  if (balanco) g.setAttribute("balanco", new THREE.Float32BufferAttribute(bal, 2));
  o.junta(g, ORNATO);
}

// As chamas das velas do lustre, na imagem dele (340 x 550): o meio, a ponta e o pé de cada uma. A imagem é
// dividida em volta delas, e só elas se inclinam.
const CHAMAS = [[56, 265, 287], [117, 253, 275], [225, 254, 276], [286, 264, 287], [14, 346, 366], [44, 352, 374], [111, 354, 373], [228, 353, 375], [296, 353, 374], [322, 347, 367]];
const LUSTRE_CORTES = (() => {
  const m = ORNATOS.lustre, xs = new Set([0, m.w]), ys = new Set([0, m.h]);
  // (em volta de cada chama fica uma margem que não se mexe: é nela, no vazio, que a malha estica, e não no desenho)
  for (const [cx] of CHAMAS) for (const d of [-8, -4.5, 0, 4.5, 8]) xs.add(limitar(cx + d, 0, m.w));
  for (const [de, ate] of [[244, 288], [336, 376]]) for (let y = de; y <= ate; y += 4) ys.add(y);
  const ordem = (s, t) => [...s].sort((a, b) => a - b).map((v) => v / t);
  return [ordem(xs, m.w), ordem(ys, m.h)];
})();
function balancoDaChama(fx, fy) {
  const m = ORNATOS.lustre, px = fx * m.w, py = fy * m.h;
  for (let i = 0; i < CHAMAS.length; i++) {
    const [cx, ponta, pe] = CHAMAS[i];
    // (de -2 para baixo é chama: o que passa de 2 é o peso, que vai de 0 no pé a 1 na ponta)
    if (Math.abs(px - cx) < 5 && py > ponta - 5 && py < pe) return [-2 - limitar((pe - py) / (pe - ponta), 0, 1.2), i * 2.4 + 0.7];
  }
  return [0, 0];
}
// As fitas do maço dos bancos: da metade da imagem para baixo, cada vez mais soltas (de 0 a -1 é fita)
const FITA_CORTES = [[0, 1], [0, 0.5, 0.57, 0.64, 0.71, 0.78, 0.85, 0.92, 1]];
const balancoDaFita = (fase) => (fx, fy) => [-Math.pow(limitar((fy - 0.5) / 0.5), 1.5), fase];

// Uma peça desenhada à mão, colada de frente. (wx, wy) é onde cai a âncora da peça, em unidades da cena.
// sx e sy trocam a escala da peça (o balaústre é esticado para caber no vão).
function ornato(o, nome, wx, wy, z, sx = ORNATOS[nome].s, sy = sx) {
  const m = ORNATOS[nome];
  retangulo(o, m, [wx, wy, z], -m.ax * sx, (m.w - m.ax) * sx, -(m.h - m.ay) * sy, m.ay * sy);
}

// Uma peça desenhada à mão no tamanho pedido: alt ou larg, em unidades da cena. pega diz que ponto da peça cai em
// (x, y, z): "pe" (o meio da base), "meio" ou "alto" (o meio do topo). Com eixo, o que cai em x é a âncora do
// desenho e não o meio do corte (a corrente do lustre, que não está no meio dele). O resto vai para retangulo().
// É como entram as flores do casamento, as imagens dos altares, os lustres, os castiçais e os postes.
function colar(o, nome, x, y, z, { alt, larg, pega = "pe", eixo = false, ...resto }) {
  const m = ORNATOS[nome];
  const s = alt ? alt / m.h : larg / m.w, w = m.w * s, h = m.h * s;
  const b0 = pega === "pe" ? 0 : pega === "meio" ? -h / 2 : -h;
  const a0 = eixo ? -(resto.espelha ? m.w - m.ax : m.ax) * s : -w / 2;
  retangulo(o, m, [x, y, z], a0, a0 + w, b0, b0 + h, resto);
}

// O ornamento da fachada: capitéis das quatro pilastras, frontões das três janelas altas e a imagem do alto.
// Vai numa malha à parte, fora do mapa de sombra, para o retângulo da peça não fazer sombra.
function ornatos(o) {
  const Z = Z_CORPO;
  // Cada peça fica rente ao que ela coroa (o fuste, a moldura da janela). Mais à frente, a perspectiva
  // a deslocava para fora nas pilastras e janelas dos lados, e ela parecia fora de centro.
  for (const c of [352, 545, 758, 958]) ornato(o, "capitel", X(c), Y(875), Z + 0.21);
  for (const cx of [450, 651, 860]) ornato(o, "frontao", X(cx), Y(898), Z + 0.075);
  ornato(o, "imagem", X(654), Y(628), Z + 0.03);
  // as flores de um lado e do outro da porta do meio (as colunas delas estão em terraco())
  for (const s of [-1, 1]) floresDoArranjo(o, s * 0.88, 0, 0.98, 0.95, 0.62, s > 0);
}

// Uma torre. d desloca em pixels a partir da torre esquerda, cujo eixo fica em x = 207.
function torre(o, d) {
  const x = (v) => v + d;
  const Z = Z_TORRE, ESP = 0.4, FUNDO = -3.35;
  const cx = X(x(207)), cz = (FUNDO + Z) / 2;
  const sineira = { cx: x(203), hw: 27, topo: 640, base: 782, arco: true };
  const janela = { cx: x(200), hw: 26, topo: 1112, base: 1206, arco: true };
  const porta = { cx: x(200), hw: 40, topo: 1305, base: 1496, arco: true };
  const furos = [sineira, janela, porta];

  parede(o, x(40), x(375), 620, 1500, Z, ESP, furos, LISO);
  parede(o, x(120), x(275), 620, 1500, Z + 0.05, 0.05, furos, JUNTAS); // faixa central rusticada
  caixa(o, x(40), x(375), 620, 1500, FUNDO, Z - ESP - 0.06);
  caixa(o, x(150), x(260), 632, 1500, Z - ESP - 0.06, Z - ESP, CHEIO);
  caixa(o, x(162), x(238), 1346, 1496, Z - 0.3, Z - 0.24, TABUAS); // folhas da porta
  caixilho(o, janela, Z - 0.2, 3, 3);

  moldura(o, sineira, 7, Z + 0.05, Z + 0.12);
  moldura(o, janela, 6, Z + 0.05, Z + 0.11);
  moldura(o, porta, 9, Z + 0.05, Z + 0.13);
  caixa(o, x(168), x(238), 782, 791, Z + 0.05, Z + 0.15);
  caixa(o, x(166), x(234), 1206, 1215, Z + 0.05, Z + 0.15);

  // Cintas que dão a volta na torre
  const cinta = (yT, yB, sal) => caixa(o, x(40) - sal * 100, x(375) + sal * 100, yT, yB, FUNDO - sal, Z + sal);
  cinta(795, 807, 0.1);
  cinta(1022, 1030, 0.07);
  cinta(1066, 1076, 0.1);
  cinta(1232, 1244, 0.1);
  cinta(1456, 1500, 0.07);

  // Relógio: aro, mostrador e as doze marcas
  const aro = new THREE.Shape();
  aro.absarc(0, 0, 0.5, 0, Math.PI * 2, false);
  const miolo = new THREE.Path();
  miolo.absarc(0, 0, 0.41, 0, Math.PI * 2, true);
  aro.holes.push(miolo);
  const ga = new THREE.ExtrudeGeometry(aro, { depth: 0.13, bevelEnabled: false, curveSegments: 40 });
  ga.translate(X(x(200)), Y(853), Z + 0.05);
  o.junta(ga);
  const gm = new THREE.CylinderGeometry(0.42, 0.42, 0.03, 40);
  gm.rotateX(Math.PI / 2);
  gm.translate(X(x(200)), Y(853), Z + 0.075);
  o.junta(gm);
  const marcas = o.novoId();
  for (let h = 0; h < 12; h++) {
    const a = (h / 12) * Math.PI * 2;
    const g = new THREE.BoxGeometry(0.02, h % 3 ? 0.06 : 0.1, 0.01);
    g.translate(0, 0.34, 0);
    g.rotateZ(-a);
    g.translate(X(x(200)), Y(853), Z + 0.095);
    o.junta(g, CHEIO, marcas);
  }

  // Cornija da torre, em três degraus
  cinta(602, 620, 0.1);
  cinta(589, 602, 0.2);
  cinta(575, 589, 0.3);

  // Coroamento: saia do telhado, tambor quadrado, dois corpos oitavados e a agulha
  prisma(o, cx, cz, 575, 524, 1.62, 1.2, 4, TELHADO);
  prisma(o, cx, cz, 524, 472, 1.14, 1.14, 4);
  prisma(o, cx, cz, 472, 463, 1.25, 1.25, 4);
  prisma(o, cx, cz, 463, 397, 1.03, 0.98, 8);
  prisma(o, cx, cz, 397, 388, 1.1, 1.1, 8);
  prisma(o, cx, cz, 388, 322, 0.74, 0.72, 8);
  prisma(o, cx, cz, 322, 313, 0.81, 0.81, 8);
  prisma(o, cx, cz, 313, 162, 0.72, 0.012, 8, TELHADO);

  // Cruz
  const cruz = o.novoId();
  const haste = (x0, x1, yT, yB) => caixa(o, x0, x1, yT, yB, cz - 0.025, cz + 0.025, CHEIO, cruz);
  haste(x(207) - 2.2, x(207) + 2.2, 52, 165);
  haste(x(207) - 34, x(207) + 34, 91, 96);
  const orbe = new THREE.SphereGeometry(0.065, 12, 8);
  orbe.translate(cx, Y(150), cz);
  o.junta(orbe);
}

// Terraço, escada e balaustrada. A praça fica um metro abaixo do pé da igreja.
function terraco(o) {
  const g = new THREE.BoxGeometry(46, 1, 7.4);
  g.translate(0, -0.5, -2.5);
  o.junta(g, JUNTAS);
  const praca = new THREE.BoxGeometry(90, 0.2, 60);
  praca.translate(0, -1.1, 14);
  o.junta(praca, CHAO);

  const degraus = o.novoId();
  for (let i = 1; i <= 4; i++) {
    const d = new THREE.BoxGeometry(U(872 - 430), 1 - 0.2 * i, 0.36);
    d.translate(0, -1 + (1 - 0.2 * i) / 2, 1.2 + 0.36 * (i - 0.5));
    o.junta(d, LISO, degraus + i / 640);
  }
  for (const lado of [-1, 1]) { // os dois muretes que seguram a escada
    const m = new THREE.BoxGeometry(0.22, 1.3, 1.6);
    m.translate(lado * (U(872 - 430) / 2 + 0.11), -0.35, 1.2 + 0.8);
    o.junta(m);
  }

  tapeteFora(o);
  for (const s of [-1, 1]) colunaDoArranjo(o, s * 0.88, 0, 0.98, 0.95); // as flores que elas seguram estão em ornatos()

  const esq = [-150, 410], dir = [892, 1452];
  for (const [x0, x1] of [esq, dir]) {
    balaustrada(o, x0, x1, 1500 - 74, 1500, 0.98, 1.1, 22);
    for (let x = x0; x <= x1 + 1; x += (x1 - x0) / 2) caixa(o, x - 9, x + 9, 1500 - 82, 1500, 0.94, 1.14);
  }
}

// Palmeira-imperial desenhada à mão (a peça "palmeira" do atlas): um cartão de frente, em malha, para poder
// balançar ao vento. O tronco quase não se mexe; a copa balança, e as pontas das folhas mais que o meio dela.
// alt é a altura do tronco; o desenho inteiro, com o palmito e a copa, mede alt + 3,2. As de semente par são
// espelhadas, para as duas de cada lado não serem a mesma.
function palmeira(o, px, pz, alt, semente) {
  const m = ORNATOS.palmeira; // deitada no atlas: o alto do desenho fica à direita
  const pw = m.h, ph = m.w;
  const base = -1, H = alt + 3.2, W = (H * pw) / ph;
  const espelha = semente % 2 === 0;
  const eixo = ((espelha ? pw - m.ax : m.ax) / pw) * W; // do canto esquerdo do cartão ao eixo do tronco
  const NC = 6, NL = 12;
  const ponto = (i, j) => {
    const a = i / NC, b = j / NL, aa = espelha ? 1 - a : a;
    return { p: [px - eixo + a * W, base + b * H, pz], uv: [(m.x + b * m.w) / ATLAS.w, 1 - (m.y + aa * m.h) / ATLAS.h] };
  };
  const ps = [], ns = [], uvs = [];
  for (let j = 0; j < NL; j++) {
    for (let i = 0; i < NC; i++) {
      const A = ponto(i, j), B = ponto(i + 1, j), C = ponto(i + 1, j + 1), D = ponto(i, j + 1);
      for (const q of [A, B, C, A, C, D]) { ps.push(...q.p); ns.push(0, 0, 1); uvs.push(...q.uv); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(ps, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(ns, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  o.sopro = (x, y) => {
    const b = (y - base) / H, lado = limitar(Math.abs(x - px) / (W * 0.5));
    return [0.22 * Math.pow(limitar(b), 2.2) + 0.5 * suave((b - 0.6) / 0.15) * Math.pow(lado, 1.5), semente + lado * 2.4];
  };
  o.junta(g, ORNATO);
  o.sopro = null;
}

// A praça em volta: duas palmeiras de cada lado e um corredor de postes que se abre para quem chega.
// As palmeiras e os postes são desenho à mão: a câmera nunca gira lá fora, então o cartão de frente não se denuncia.
// Na tela em pé a janela mostra só 7 de cada lado, então fica uma palmeira de cada lado, rente à torre e mais alta que ela, com a copa no céu.
function praca(o, estreita) {
  if (estreita) {
    palmeira(o, -6.5, 1.9, 15.6, 1);
    palmeira(o, 6.5, 1.9, 16.2, 2);
  } else {
    palmeira(o, -8.5, 2.6, 9.4, 1);
    palmeira(o, 8.5, 2.6, 9.8, 2);
    palmeira(o, -11.7, 5.6, 11.4, 3);
    palmeira(o, 11.7, 5.6, 10.9, 4);
  }
  for (const [x, z] of [[2.9, 3.6], [4.0, 7.4], [5.3, 11.2]]) {
    for (const s of [-1, 1]) colar(o, "poste", s * x, -1, z, { alt: 1.95, espelha: s > 0 });
  }
}

// ---------- Por dentro ----------
// A nave, em unidades da cena (a porta tem 2 de altura). Vai numa malha à parte, com outra luz (DENTRO, no shader):
// lá dentro a luz vem do altar, e o que fica longe se desfaz no papel.
// Entre as torres fica o vestíbulo, baixo, debaixo do coro; depois dele a nave abre em largura e em altura.
// A igreja está arrumada para o casamento: tapete no corredor (que sai pela porta e desce a escada) e flores.
const PISO = Y(1496); // a soleira da porta
const PORTA_HW = U(37), PORTA_ALT = U(1496 - 1295), Z_FOLHA = Z_CORPO - 0.3;
const NAVE = { z0: -3.6, z1: -19, larg: 3, vaos: 4 };

// Caixa em unidades da cena
function bloco(o, x0, x1, y0, y1, z0, z1, tipo = LISO, id) {
  const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return o.junta(g, tipo, id);
}

// Espelha uma geometria no eixo x e desvira os triângulos, para a frente continuar sendo a frente
function espelhar(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.scale(-1, 1, 1);
  for (const nome of ["position", "normal", "uv"]) {
    const a = g.attributes[nome];
    if (!a) continue;
    const v = a.array, n = a.itemSize;
    for (let i = 0; i < v.length; i += 3 * n) {
      for (let k = 0; k < n; k++) { const t = v[i + n + k]; v[i + n + k] = v[i + 2 * n + k]; v[i + 2 * n + k] = t; }
    }
  }
  return g;
}

// Uma folha de porta, com o gonzo em x = 0. lado -1: a da esquerda, que se estende para +x; lado 1: a da direita.
// (hx, hy, hz) leva o gonzo para o lugar, nas portas que não se mexem.
function folha(o, lado, hx = 0, hy = 0, hz = 0) {
  const w = PORTA_HW, h = PORTA_ALT;
  const por = (g) => { const m = lado > 0 ? espelhar(g) : g; m.translate(hx, hy, hz); return m; };
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(w, 0); s.lineTo(w, h);
  s.absarc(w, h - w, w, Math.PI / 2, Math.PI, false);
  s.closePath();
  const tabua = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: false, curveSegments: 10 });
  tabua.translate(0, 0, -0.025);
  o.junta(por(tabua), TABUAS);
  const almofadas = o.novoId();
  for (const [y0, y1] of [[0.14, 0.72], [0.86, 1.5]]) {
    const g = new THREE.BoxGeometry(w - 0.13, y1 - y0, 0.02);
    g.translate(w / 2, (y0 + y1) / 2, 0.035);
    o.junta(por(g), LISO, almofadas);
  }
}

// Muro visto de frente, com arcos que chegam ao chão (em ordem de cx) e janelas (em arco, ou retas com reto: true)
function muroForma(x0, x1, y0, y1, arcos, janelas = []) {
  const s = new THREE.Shape();
  s.moveTo(x0, y0);
  for (const f of arcos) {
    s.lineTo(f.cx - f.hw, y0);
    s.lineTo(f.cx - f.hw, f.topo - f.hw);
    s.absarc(f.cx, f.topo - f.hw, f.hw, Math.PI, 0, true);
    s.lineTo(f.cx + f.hw, y0);
  }
  s.lineTo(x1, y0); s.lineTo(x1, y1); s.lineTo(x0, y1);
  s.closePath();
  for (const f of janelas) {
    const p = new THREE.Path();
    p.moveTo(f.cx - f.hw, f.base);
    if (f.reto) {
      p.lineTo(f.cx - f.hw, f.topo);
      p.lineTo(f.cx + f.hw, f.topo);
    } else {
      p.lineTo(f.cx - f.hw, f.topo - f.hw);
      p.absarc(f.cx, f.topo - f.hw, f.hw, Math.PI, 0, true);
    }
    p.lineTo(f.cx + f.hw, f.base);
    p.closePath();
    s.holes.push(p);
  }
  return s;
}

// A faixa que acompanha um arco (arquivolta)
function arquivoltaForma(cx, hw, base, topo, larg) {
  const s = new THREE.Shape();
  const ym = topo - hw;
  s.moveTo(cx - hw - larg, base);
  s.lineTo(cx - hw - larg, ym);
  s.absarc(cx, ym, hw + larg, Math.PI, 0, true);
  s.lineTo(cx + hw + larg, base);
  s.lineTo(cx + hw, base);
  s.lineTo(cx + hw, ym);
  s.absarc(cx, ym, hw, 0, Math.PI, false);
  s.lineTo(cx - hw, base);
  s.closePath();
  return s;
}

// Leva uma forma desenhada no plano (d, y), em que d é a distância para dentro da igreja, para a parede
// do lado s (1 a da direita, -1 a da esquerda). x é a face voltada para a nave, esp a espessura para fora.
function naParede(forma, esp, s, x) {
  const g = new THREE.ExtrudeGeometry(forma, { depth: esp, bevelEnabled: false, curveSegments: 16 });
  g.rotateY(Math.PI / 2); // (d, y, e) vira (e, y, -d)
  g.translate(x, 0, 0);
  return s < 0 ? espelhar(g) : g;
}

// Arranjo alto: uma coluna do modelo e, em cima dela, o maço de flores na taça, que é desenho à mão.
// São duas funções porque, do lado de fora, só a coluna entra no mapa de sombra. larg é a largura do maço.
function colunaDoArranjo(o, x, yBase, z, alt) {
  const por = (g, y) => { g.translate(x, yBase + y, z); return o.junta(g); };
  por(new THREE.CylinderGeometry(0.13, 0.15, 0.06, 12), 0.03);
  por(new THREE.CylinderGeometry(0.045, 0.065, alt, 10), 0.06 + alt / 2);
  por(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 12), 0.06 + alt + 0.015); // a laje onde a taça assenta
}
function floresDoArranjo(o, x, yBase, z, alt, larg, espelha = false) {
  colar(o, "arranjoAlto", x, yBase + 0.09 + alt, z, { larg, espelha });
}
function jarro(o, x, yBase, z, alt, larg, espelha = false) {
  colunaDoArranjo(o, x, yBase, z, alt);
  floresDoArranjo(o, x, yBase, z, alt, larg, espelha);
}

// Banco de igreja, como os da Sé: duas ilhargas de madeira com o braço em curva e a cabeça redonda, encosto
// inclinado entre dois travessões, assento com testeira e um pé no meio. Por baixo do assento ele é vazado.
// s é o lado da nave, z a linha do encosto; quem senta olha para o altar (z negativo).
const BANCO = (() => {
  const p = new THREE.Shape(); // a ilharga, no plano (z, y)
  p.moveTo(-0.34, 0);
  p.lineTo(-0.34, 0.37);
  p.quadraticCurveTo(-0.345, 0.43, -0.29, 0.43); // a ponta do braço
  p.lineTo(-0.14, 0.43);
  p.quadraticCurveTo(-0.045, 0.44, -0.035, 0.58); // o braço sobe para o encosto
  p.quadraticCurveTo(-0.03, 0.665, 0.025, 0.665); // a cabeça redonda
  p.quadraticCurveTo(0.08, 0.665, 0.08, 0.6);
  p.lineTo(0.05, 0);
  p.closePath();
  return p;
})();
function banco(o, s, z) {
  const xa = 0.84, xb = 2.5, e = 0.05, xi = xa + e, xf = xb - e, meio = (xa + xb) / 2;
  const ilhargas = o.novoId();
  for (const x of [xa, xb - e]) {
    const g = new THREE.ExtrudeGeometry(BANCO, { depth: e, bevelEnabled: false, curveSegments: 6 });
    g.rotateY(-Math.PI / 2); // (z, y, e) vira (-e, y, z)
    g.translate(s > 0 ? x + e : -x, PISO, z);
    o.junta(g, MADEIRA, ilhargas);
  }
  const caixa = (x0, x1, ya, yb, za, zb) => bloco(o, s * x0, s * x1, PISO + ya, PISO + yb, z + za, z + zb, MADEIRA);
  const enc = new THREE.BoxGeometry(xf - xi, 0.27, 0.025); // o encosto, deitado para trás
  enc.translate(0, 0.135, 0);
  enc.rotateX(0.13);
  enc.translate(s * meio, PISO + 0.31, z);
  o.junta(enc, MADEIRA);
  caixa(xi, xf, 0.57, 0.615, 0.008, 0.072); // travessão de cima
  caixa(xi, xf, 0.27, 0.315, -0.02, 0.025); // travessão de baixo
  caixa(xi, xf, 0.25, 0.28, -0.31, -0.01); // assento
  caixa(xi, xf, 0.2, 0.25, -0.31, -0.285); // testeira
  caixa(meio - 0.02, meio + 0.02, 0, 0.25, -0.28, 0.02); // pé do meio
}

// Passadeira: uma faixa clara com duas linhas de borda. y é o chão onde ela assenta.
// Dentro da igreja a beira dela cai na junta do ladrilho (os ladrilhos têm 0,19 e o eixo da nave é uma junta):
// dois ladrilhos para cada lado, e meio centímetro a mais para a linha da junta ficar debaixo do pano. Com 0,34
// sobrava, de cada lado, uma tira de ladrilho cortado entre o tapete e a junta.
const TAPETE_HW = 2 * 0.19 + 0.005;
function tapete(o, hw, y, za, zb) {
  bloco(o, -hw, hw, y, y + 0.012, za, zb);
  bloco(o, -hw + 0.07, hw - 0.07, y + 0.012, y + 0.016, za, zb);
}

// O tapete do casamento do lado de fora: sai da porta do meio, cruza o terraço e desce a escada até a praça
function tapeteFora(o) {
  const hw = 0.34; // mais estreito que o de dentro: tem de passar pelo vão da porta, que tem 0,37 de cada lado
  tapete(o, hw, PISO, Z_CORPO - 0.45, Z_CORPO);
  tapete(o, hw, 0, Z_CORPO, 1.2);
  for (let i = 1; i <= 5; i++) {
    const y = -0.2 * i, z = 1.2 + 0.36 * (i - 1);
    bloco(o, -hw, hw, y, y + 0.2, z, z + 0.012); // o pano que desce o espelho do degrau
    tapete(o, hw, y, z, i < 5 ? z + 0.36 : z + 1.1);
  }
}

// Abóbada de berço abatida: uma faixa em arco entre dois z. meia é o meio vão, nasce a altura do arranque.
function abobada(o, meia, nasce, flecha, za, zb, tipo = LISO) {
  const R = (meia * meia + flecha * flecha) / (2 * flecha), cy = nasce + flecha - R;
  const a0 = Math.atan2(nasce - cy, meia);
  const s = new THREE.Shape();
  s.absarc(0, cy, R, a0, Math.PI - a0, false);
  s.absarc(0, cy, R + 0.12, Math.PI - a0, a0, true);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.abs(za - zb), bevelEnabled: false, curveSegments: 28 });
  g.translate(0, 0, Math.min(za, zb));
  o.junta(g, tipo);
  return { R, cy };
}
// A abóbada da nave: o mosaico de cacos do forro é desenrolado sobre ela no passo 1, e precisa do raio e do centro
const NAVE_NASCE = 5.0, NAVE_FLECHA = 1.5; // arranque e flecha
const NAVE_R = (3 * 3 + NAVE_FLECHA * NAVE_FLECHA) / (2 * NAVE_FLECHA), NAVE_CY = NAVE_NASCE + NAVE_FLECHA - NAVE_R;

// Uma peça desenhada à mão deitada no forro: uma tira de retângulos que acompanha a curva da abóbada (raio R,
// centro na altura cy). pos é a distância do meio da peça ao fecho, medida sobre a curva (positiva para a
// direita); z é o meio dela ao longo da nave; arco é quanto ela mede sobre a curva. Com sobe, a altura do desenho
// sobe pela curva, com o topo para o lado do fecho. Sem ele, a largura do desenho atravessa a nave e o topo fica
// para o lado de quem entra, que é como a peça se lê de pé olhando para o altar.
function noForro(o, nome, R, cy, pos, z, arco, { sobe = false, espelha = false, folga = 0.03 } = {}) {
  const m = ORNATOS[nome], r = R - folga, N = 8;
  const fundo = arco * (sobe ? m.w / m.h : m.h / m.w); // quanto a peça mede ao longo da nave
  let u0 = m.x / ATLAS.w, u1 = (m.x + m.w) / ATLAS.w;
  if (espelha) [u0, u1] = [u1, u0];
  const v1 = 1 - m.y / ATLAS.h, v0 = 1 - (m.y + m.h) / ATLAS.h;
  const ponto = (t, k) => { // t vai de 0 a 1 sobre a curva, k é 0 no fundo da nave e 1 perto da porta
    const a = (pos + (t - 0.5) * arco) / r;
    const paraOFecho = pos > 0 ? 1 - t : t;
    return {
      p: [r * Math.sin(a), cy + r * Math.cos(a), z + (k - 0.5) * fundo],
      n: [-Math.sin(a), -Math.cos(a), 0],
      uv: sobe ? [u0 + k * (u1 - u0), v0 + paraOFecho * (v1 - v0)] : [u0 + t * (u1 - u0), v0 + k * (v1 - v0)],
    };
  };
  const ps = [], ns = [], uvs = [];
  for (let i = 0; i < N; i++) {
    const A = ponto(i / N, 0), B = ponto((i + 1) / N, 0), C = ponto((i + 1) / N, 1), D = ponto(i / N, 1);
    for (const q of [A, B, C, A, C, D]) { ps.push(...q.p); ns.push(...q.n); uvs.push(...q.uv); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(ps, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(ns, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  o.junta(g, ORNATO);
}

// A nave da Sé, como nas fotos (Wikimedia Commons, série "Catedral de Nossa Senhora da Vitória São Luís
// Maranhão Interior 2025"): nave única de paredes brancas, pilastras e cornija, abóbada de berço com pinturas,
// altares laterais com tribuna em cima, um arco para a capela do cruzeiro, portal de mármore no arco-cruzeiro
// entre dois altares colaterais, e a capela-mor com o retábulo ao fundo.
function nave(o) {
  const { z0, z1, larg, vaos } = NAVE;
  const vao = (z0 - z1) / vaos;
  const zEntrada = Z_CORPO - 0.45; // a face de dentro da parede da fachada
  const NASCE = NAVE_NASCE, FLECHA = NAVE_FLECHA; // arranque e flecha da abóbada

  // Piso de ladrilho hidráulico e o tapete no corredor
  const chao = o.novoId();
  bloco(o, -2.5, 2.5, -0.2, PISO, z0, zEntrada, LADRILHO, chao);
  bloco(o, -5.2, 5.2, -0.2, PISO, -25, z0, LADRILHO, chao);
  tapete(o, TAPETE_HW, PISO, -20.09, zEntrada);

  // Vestíbulo, debaixo do coro
  for (const s of [-1, 1]) {
    bloco(o, s * 2.4, s * 2.5, 0, 2.95, z0, zEntrada);
    bloco(o, s * 2.34, s * 2.4, PISO, 0.95, z0, zEntrada); // lambri
    bloco(o, s * 2.16, s * 2.4, PISO, 2.6, z0 - 0.12, z0 + 0.12); // pé-direito do coro
  }
  bloco(o, -2.5, 2.5, 2.9, 3.0, z0, zEntrada);
  for (const z of [-1.3, -2.45]) bloco(o, -2.4, 2.4, 2.72, 2.9, z - 0.09, z + 0.09);
  bloco(o, -2.5, 2.5, 2.6, 2.9, z0 - 0.12, z0 + 0.12); // viga do coro
  // quatro festões de flores pendurados na viga
  for (let i = 0; i < 4; i++) colar(o, "festao", -1.8 + i * 1.2, 2.68, z0 + 0.14, { larg: 1.26, pega: "alto", espelha: i % 2 === 1 });

  // Abóbada revestida de mosaico de cacos, como a da Sé (o mosaico é feito no passo 1, pelo tipo da peça). As
  // pinturas são desenho à mão, dispostas pelo que as fotos mostram. No fecho: uma rosácea de oito pétalas nos
  // dois primeiros vãos (é dela que pende o lustre) e o medalhão oval da pomba no terceiro; no último, o fecho é
  // do florão do monograma. Nos flancos, subindo pela curva: os painéis lobulados de céu com um anjo e o seu rolo,
  // alternados com o painel estreito dos querubins. Entre os vãos: uma treliça em cada flanco e, no fecho, o
  // ladrilho da cruz entre dois crescentes.
  const { R, cy } = abobada(o, larg, NASCE, FLECHA, z0, z1, MOSAICO);
  const anjos = ["anjoA", "anjoB", "anjoC", "anjoA"];
  for (let i = 0; i < vaos; i++) {
    const z = z0 - vao * (i + 0.5), ultimo = i === vaos - 1;
    if (i < 2) noForro(o, "rosacea", R, cy, 0, z, 0.9);
    else if (!ultimo) noForro(o, "medalhaoPomba", R, cy, 0, z, 2.1);
    for (const s of [-1, 1]) {
      // (no último vão os painéis são menores e ficam mais abaixo na curva, para não encostarem no florão nem
      // sobrarem cortados no quadro do fim)
      if (i % 2 === 0) noForro(o, anjos[i + (s > 0 ? 1 : 0)], R, cy, s * 2.28, z, 2.1, { sobe: true, espelha: s > 0 });
      else noForro(o, "querubins", R, cy, s * (ultimo ? 2.58 : 2.3), z, ultimo ? 1.7 : 2.2, { sobe: true, espelha: s > 0 });
      if (i > 0) {
        const zj = z + vao / 2; // a linha entre este vão e o anterior
        noForro(o, "trelica", R, cy, s * 2.5, zj, 1.5, { sobe: true });
        noForro(o, "crescente", R, cy, s * 0.46, zj, 0.36, { espelha: s < 0 });
      }
    }
    if (i > 0) noForro(o, "ladrilhoCruz", R, cy, 0, z + vao / 2, 0.3);
  }
  // Dois lustres de dois andares de velas, pendurados no fecho da abóbada nos dois primeiros vãos (a corrente vem
  // no desenho). Ficam antes do meio da nave: dali em diante a câmera levanta o olhar para o florão, e um cartão
  // de frente, visto de baixo, apareceria de fio.
  for (let i = 0; i < 2; i++) colar(o, "lustre", 0, NASCE + FLECHA - 0.02, z0 - vao * (i + 0.5), { alt: 2.1, pega: "alto", eixo: true, espelha: i === 1, cortes: LUSTRE_CORTES, balanco: balancoDaChama });

  // Paredes: três vãos com altar lateral e tribuna, e o último com o arco da capela do cruzeiro
  const dc = (i) => -z0 + vao * (i + 0.5);
  const arco = { cx: dc(vaos - 1), hw: 1.2, topo: 4.1 };
  const tribunas = [];
  for (let i = 0; i < vaos - 1; i++) tribunas.push({ cx: dc(i), hw: 0.42, base: 3.0, topo: 3.95, reto: true });
  for (const s of [-1, 1]) {
    o.junta(naParede(muroForma(-z0, -z1, 0, NASCE + 0.1, [arco], tribunas), 0.4, s, larg));

    for (let i = 0; i <= vaos; i++) { // pilastras
      const z = z0 - vao * i;
      bloco(o, s * (larg - 0.12), s * larg, PISO, 4.8, z - 0.25, z + 0.25);
      bloco(o, s * (larg - 0.17), s * larg, PISO, 0.5, z - 0.3, z + 0.3);
      bloco(o, s * (larg - 0.18), s * larg, 4.55, 4.8, z - 0.31, z + 0.31);
    }
    bloco(o, s * (larg - 0.22), s * larg, 4.8, 4.92, z1, z0); // cornija
    bloco(o, s * (larg - 0.3), s * larg, 4.92, NASCE, z1, z0);

    for (const [i, t] of tribunas.entries()) {
      const z = -t.cx;
      // tribuna: guarnição da janela, grade, remate e o painel do peitoril
      const guarnicao = o.novoId();
      for (const d of [-1, 1]) bloco(o, s * (larg - 0.06), s * larg, 3.0, 3.95, z + d * 0.42, z + d * 0.52, LISO, guarnicao);
      bloco(o, s * (larg - 0.06), s * larg, 3.95, 4.05, z - 0.52, z + 0.52, LISO, guarnicao);
      bloco(o, s * (larg - 0.1), s * larg, 4.05, 4.12, z - 0.6, z + 0.6);
      const remate = new THREE.Shape();
      remate.moveTo(t.cx - 0.5, 4.12); remate.lineTo(t.cx + 0.5, 4.12); remate.lineTo(t.cx + 0.2, 4.34); remate.lineTo(t.cx, 4.46); remate.lineTo(t.cx - 0.2, 4.34);
      remate.closePath();
      o.junta(naParede(remate, 0.06, s, larg - 0.06));
      const grade = o.novoId();
      for (let k = 1; k < 4; k++) {
        bloco(o, s * (larg + 0.14), s * (larg + 0.17), 3.0, 3.95, z - 0.42 + k * 0.21 - 0.012, z - 0.42 + k * 0.21 + 0.012, LISO, grade);
        bloco(o, s * (larg + 0.14), s * (larg + 0.17), 3.0 + k * 0.2375 - 0.012, 3.0 + k * 0.2375 + 0.012, z - 0.42, z + 0.42, LISO, grade);
      }
      bloco(o, s * (larg - 0.16), s * larg, 2.9, 3.0, z - 0.62, z + 0.62);
      bloco(o, s * (larg - 0.1), s * larg, 2.36, 2.9, z - 0.54, z + 0.54);
      bloco(o, s * (larg - 0.12), s * (larg - 0.1), 2.46, 2.8, z - 0.42, z + 0.42);
      bloco(o, s * (larg - 0.16), s * larg, 2.28, 2.36, z - 0.62, z + 0.62);
      // altar lateral: nicho em arco entre duas colunas, com a imagem, e a mesa
      o.junta(naParede(arquivoltaForma(t.cx, 0.42, 0.9, 2.1, 0.13), 0.1, s, larg - 0.1));
      for (const d of [-1, 1]) {
        const col = new THREE.CylinderGeometry(0.04, 0.045, 1.3, 8);
        col.translate(s * (larg - 0.16), 0.9 + 0.65, z + d * 0.66);
        o.junta(col);
        bloco(o, s * (larg - 0.22), s * larg, 2.2, 2.28, z + d * 0.66 - 0.07, z + d * 0.66 + 0.07);
      }
      // a imagem fica meio voltada para o corredor: de frente para a parede oposta, quem entra a veria de perfil
      colar(o, ["santo", "santa", "imagem"][(i + (s > 0 ? 1 : 0)) % 3], s * (larg - 0.2), 0.91, z, { alt: 1.02, vira: -s * 0.7, espelha: s < 0 });
      bloco(o, s * (larg - 0.42), s * larg, PISO, 0.86, z - 0.74, z + 0.74);
      bloco(o, s * (larg - 0.46), s * larg, 0.86, 0.91, z - 0.78, z + 0.78);
      for (const d of [-1, 1]) colar(o, "cacho", s * (larg - 0.26), 0.91, z + d * 0.5, { alt: 0.27, vira: -s * 0.7, espelha: d > 0 });
    }

    // o arco e a capela do cruzeiro, com o seu altar ao fundo
    const za = -arco.cx;
    o.junta(naParede(arquivoltaForma(arco.cx, arco.hw, PISO, arco.topo, 0.14), 0.05, s, larg - 0.05));
    const crista = new THREE.Shape();
    crista.moveTo(arco.cx - 0.7, arco.topo + 0.14); crista.lineTo(arco.cx + 0.7, arco.topo + 0.14); crista.lineTo(arco.cx + 0.25, arco.topo + 0.4); crista.lineTo(arco.cx, arco.topo + 0.56); crista.lineTo(arco.cx - 0.25, arco.topo + 0.4);
    crista.closePath();
    o.junta(naParede(crista, 0.05, s, larg - 0.05));
    bloco(o, s * 5.0, s * 5.1, 0, 4.6, z1 - 0.1, za + arco.hw + 0.5);
    bloco(o, s * (larg + 0.4), s * 5.1, 4.5, 4.6, z1 - 0.1, za + arco.hw + 0.5);
    bloco(o, s * (larg + 0.4), s * 5.0, 0, 4.5, za + arco.hw + 0.4, za + arco.hw + 0.5);
    bloco(o, s * (larg + 0.4), s * 5.0, 0, 4.5, z1 - 0.1, z1);
    o.junta(naParede(arquivoltaForma(arco.cx, 0.5, 0.9, 2.5, 0.14), 0.1, s, 4.9));
    colar(o, s > 0 ? "santa" : "santo", s * 4.78, 0.91, za, { alt: 1.3, vira: -s * 0.7, espelha: s < 0 });
    bloco(o, s * 4.55, s * 5.0, PISO, 0.86, za - 0.8, za + 0.8);
    bloco(o, s * 4.5, s * 5.0, 0.86, 0.91, za - 0.85, za + 0.85);
  }

  // Bancos, com um maço de flores e fita na ponta de fileiras alternadas
  for (let i = 0; i < 20; i++) {
    const z = -5.5 - 0.62 * i;
    for (const s of [-1, 1]) {
      banco(o, s, z);
      if (i % 2 === 0) {
        colar(o, "macoBanco", s * 0.74, PISO + 0.82, z + 0.1, { alt: 0.64, pega: "alto", espelha: (i / 2) % 2 === (s > 0 ? 1 : 0), cortes: FITA_CORTES, balanco: balancoDaFita(i * 1.7 + (s > 0 ? 0.9 : 0)) });
      }
    }
  }
  for (const s of [-1, 1]) jarro(o, s * 1.2, PISO, -4.7, 1.2, 0.7, s > 0);

  // Arco-cruzeiro, como na Sé: parede branca; no meio, o portal de mármore cinzento, que é uma moldura retangular
  // com o arco de volta inteira recortado nela, as impostas marcadas e uma cornija em cima; no alto, a cartela.
  const mor = { cx: 0, hw: 1.3, topo: 4.12 };
  const muro = new THREE.ExtrudeGeometry(muroForma(-larg - 0.4, larg + 0.4, 0, NASCE + FLECHA + 0.3, [mor]), { depth: 0.45, bevelEnabled: false, curveSegments: 24 });
  muro.translate(0, 0, z1 - 0.45);
  o.junta(muro);
  const QUADRO = 1.6, QUADRO_ALTO = 4.4; // a meia largura e o alto da moldura de mármore
  const marmore = new THREE.ExtrudeGeometry(muroForma(-QUADRO, QUADRO, PISO, QUADRO_ALTO, [mor]), { depth: 0.08, bevelEnabled: false, curveSegments: 24 });
  marmore.translate(0, 0, z1);
  o.junta(marmore, MARMORE);
  const faixa = new THREE.ExtrudeGeometry(arquivoltaForma(0, mor.hw, mor.topo - mor.hw, mor.topo, 0.11), { depth: 0.04, bevelEnabled: false, curveSegments: 24 });
  faixa.translate(0, 0, z1 + 0.08);
  o.junta(faixa, MARMORE);
  for (const s of [-1, 1]) {
    bloco(o, s * (mor.hw - 0.02), s * (mor.hw + 0.17), mor.topo - mor.hw - 0.1, mor.topo - mor.hw, z1 + 0.08, z1 + 0.15, MARMORE); // imposta
    bloco(o, s * (mor.hw - 0.02), s * (QUADRO + 0.04), PISO, 0.44, z1 + 0.08, z1 + 0.13, MARMORE); // soco
  }
  bloco(o, -QUADRO - 0.08, QUADRO + 0.08, QUADRO_ALTO, QUADRO_ALTO + 0.12, z1, z1 + 0.14, MARMORE);
  bloco(o, -QUADRO - 0.16, QUADRO + 0.16, QUADRO_ALTO + 0.12, QUADRO_ALTO + 0.2, z1, z1 + 0.2, MARMORE);
  bloco(o, -0.1, 0.1, mor.topo - 0.05, QUADRO_ALTO, z1 + 0.08, z1 + 0.17, MARMORE); // fecho do arco
  // a cartela, desenho à mão a partir da que há na Sé: dossel, cortinas, moldura quadrilobada com o ramo de palma
  // atado por um laço (a palma da vitória, da padroeira), dois meninos e, no pé, volutas com uma concha
  colar(o, "cartela", 0, 5.7, z1 + 0.03, { alt: 1.46, pega: "meio" });
  // guirlanda de flores do casamento sobre o arco do portal: cachos e ramos alternados, deitados ao longo dele.
  // Um fica um fio à frente do outro, para não disputarem a mesma profundidade. As ombreiras ficam livres, para
  // o mármore aparecer.
  const ym = mor.topo - mor.hw, rg = mor.hw + 0.07;
  for (let i = 1; i < 16; i++) {
    const a = (i / 16) * Math.PI;
    colar(o, i % 2 ? "ramo" : "cacho", Math.cos(a) * rg, ym + Math.sin(a) * rg, z1 + 0.2 + (i % 2) * 0.012, { alt: i % 2 ? 0.3 : 0.36, pega: "meio", roda: a - Math.PI / 2, espelha: i % 4 > 1 });
  }

  // Altares colaterais, um de cada lado do portal. O retábulo é desenho à mão (mesa, nicho entre colunas, arco de
  // volutas com a concha e o ático), sobre um degrau, com a imagem no nicho e flores na mesa. Em cima dele, a
  // janela de moldura da Sé: a veneziana no alto e a grade de quadrados embaixo.
  for (const s of [-1, 1]) {
    const x = s * 2.24, la = 1.2, aa = 2.12, pe = PISO + 0.14;
    bloco(o, x - 0.66, x + 0.66, PISO, pe, z1, z1 + 0.5);
    retangulo(o, ORNATOS.altarColateral, [x, pe, z1 + 0.05], -la / 2, la / 2, 0, aa, { espelha: s > 0 });
    colar(o, s > 0 ? "santo" : "santa", x, pe + aa * 0.283, z1 + 0.09, { alt: aa * 0.345, espelha: s > 0 });
    colar(o, "arranjoBaixo", x, pe + aa * 0.212, z1 + 0.13, { larg: 0.5, espelha: s > 0 });
    const caixao = o.novoId();
    bloco(o, x - 0.36, x + 0.36, 2.62, 3.72, z1, z1 + 0.05, LISO, caixao);
    bloco(o, x - 0.42, x + 0.42, 2.55, 2.62, z1, z1 + 0.09);
    bloco(o, x - 0.42, x + 0.42, 3.72, 3.79, z1, z1 + 0.09);
    for (let k = 0; k < 4; k++) bloco(o, x - 0.29, x + 0.29, 3.355 + k * 0.075, 3.395 + k * 0.075, z1 + 0.05, z1 + 0.08);
    const grade = o.novoId();
    for (let k = 0; k <= 4; k++) {
      bloco(o, x - 0.29 + k * 0.145 - 0.011, x - 0.29 + k * 0.145 + 0.011, 2.69, 3.3, z1 + 0.05, z1 + 0.075, LISO, grade);
      bloco(o, x - 0.29, x + 0.29, 2.69 + k * 0.1525 - 0.011, 2.69 + k * 0.1525 + 0.011, z1 + 0.05, z1 + 0.075, LISO, grade);
    }
  }

  // Capela-mor: abóbada, degraus com o tapete, mesa e o retábulo ao fundo
  const zc = z1 - 0.45, zf = -24.5;
  const capela = abobada(o, 2.3, 3.7, 1.5, zc, zf);
  for (const s of [-1, 1]) {
    bloco(o, s * 2.3, s * 2.4, 0, 3.8, zf, zc);
    bloco(o, s * 2.16, s * 2.3, 3.56, 3.7, zf, zc);
  }
  bloco(o, -2.4, 2.4, 0, 5.4, zf - 0.2, zf);
  for (let i = 1; i <= 3; i++) {
    const z = -19.75 - 0.34 * i;
    bloco(o, -2.3, 2.3, PISO, PISO + 0.1 * i, zf, z);
    bloco(o, -TAPETE_HW, TAPETE_HW, PISO + 0.1 * (i - 1), PISO + 0.1 * i, z, z + 0.012);
    tapete(o, TAPETE_HW, PISO + 0.1 * i, i < 3 ? z - 0.34 : -21.9, z);
  }
  const yA = PISO + 0.3;
  bloco(o, -0.85, 0.85, yA, yA + 0.5, -22.7, -22.1);
  bloco(o, -0.95, 0.95, yA + 0.5, yA + 0.56, -22.78, -22.02);
  colar(o, "crucifixo", 0, yA + 0.56, -22.4, { alt: 0.66 });
  colar(o, "arranjoBaixo", 0, yA, -21.98, { larg: 1.3 }); // flores ao pé da mesa
  for (const s of [-1, 1]) {
    // três castiçais de cada lado do crucifixo, desenhados à mão
    for (const x of [0.4, 0.58, 0.76]) colar(o, "castical", s * x, yA + 0.56, -22.4, { alt: 0.5, espelha: s > 0 });
    jarro(o, s * 1.5, yA, -22.3, 0.9, 0.64, s > 0);
    jarro(o, s * 1.05, PISO, z1 + 0.55, 1.1, 0.68, s < 0);
  }
  // O retábulo-mor, desenho à mão pelo que as fotos mostram: colunas torsas com parras, arquivoltas concêntricas
  // e o trono em degraus com a imagem da padroeira no alto. Encosta na parede do fundo, sobre um supedâneo.
  bloco(o, -2.0, 2.0, yA, yA + 0.12, zf, zf + 0.5);
  colar(o, "retabuloMor", 0, yA + 0.12, zf + 0.06, { larg: 3.5 });
  // no forro da capela-mor, um painel de céu com um anjo, como o medalhão que há ali
  noForro(o, "anjoC", capela.R, capela.cy, 0, (zc + zf) / 2 + 0.5, 1.9);
}

// ---------- Shaders ----------
const RUIDO = /* glsl */ `
  float sorteio(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float ruido(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(sorteio(i), sorteio(i + vec2(1.0, 0.0)), f.x),
               mix(sorteio(i + vec2(0.0, 1.0)), sorteio(i + vec2(1.0, 1.0)), f.x), f.y);
  }
`;

const comum = {
  uLuz: { value: new THREE.Vector3(-0.45, 0.75, 0.5).normalize() },
  uLuzMat: { value: new THREE.Matrix4() },
  uSombra: { value: null },
  uPasso: { value: 4.6 }, // distância entre riscos da hachura, em pixels da tela
  uTempo: { value: 0 },
  uPassa: { value: 0 }, // quanto a câmera está andando agora, de 0 (parada) a 1 (passo cheio): as chamas e as fitas respondem
  uOlhoZ: { value: 0 }, // onde a câmera está ao longo da nave
  uOrnato: { value: null },
  uPorta: { value: PORTA },
  uPeso: { value: 0.62 }, // grossura dos riscos da hachura
  uTom: { value: 1 }, // quanto de sombra vira hachura (0 = só linha)
  uSelo: { value: null }, // o monograma, em branco sobre preto
  uSeloCampo: { value: null }, // para cada ponto do monograma, a distância até a nascente da tinta, por dentro do traço (0 a 1)
  uSeloCheio: { value: -1 }, // até que distância a tinta já correu (abaixo de 0 = só hachura e contorno, acima de 1 = tinta cheia)
  uSeloPasso: { value: 0.008 }, // distância entre os riscos do monograma, em unidades da cena
  uFim: { value: 0 }, // quanto a vinheta do fim já fechou em volta do florão
  uFimZ: { value: 0 }, // o meio do florão, ao longo da nave
  uFimRaio: { value: new THREE.Vector2(2, 1.25) }, // meia largura e meia altura do quadro do fim, em unidades da cena
};

// Passo 1: cada peça escreve a sua hachura, presa à superfície e não à tela
const materialTraco = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  uniforms: comum,
  side: THREE.DoubleSide, // as folhas das palmeiras e as asas não têm espessura
  vertexShader: /* glsl */ `
    in float aTipo;
    in float aId;
    in float aVento;
    in float aFase;
    in vec2 aUv;
    uniform float uTempo;
    uniform float uPassa;
    uniform float uOlhoZ;
    out vec2 vUvO;
    out vec3 vW;
    out vec3 vN;
    out vec3 vNV;
    out float vTipo;
    out float vId;
    out float vProf;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      if (aVento > 0.0) {
        // Vento: uma rajada lenta que atravessa a praça da esquerda para a direita, mais um tremor de cada folha
        float rajada = 0.5 + 0.5 * sin(uTempo * 0.8 - w.x * 0.22);
        float tremor = sin(uTempo * 2.3 + aFase) * 0.07 + sin(uTempo * 5.3 + aFase * 1.7) * 0.02;
        w.x += (0.22 * rajada + tremor) * aVento;
        w.y -= 0.1 * rajada * aVento * aVento;
      } else if (aVento < -1.5) {
        // Chama de vela: quase parada, respira de leve; quando o visitante anda, a corrente de ar a deita e ela
        // tremula. Parou de andar, ela se endireita.
        float peso = -aVento - 2.0;
        float dobra = peso * peso;
        float leve = sin(uTempo * 2.6 + aFase) * 0.6 + sin(uTempo * 6.1 + aFase * 2.3) * 0.4;
        float bate = 0.65 + 0.35 * sin(uTempo * 11.0 + aFase * 3.7);
        w.x += (0.011 * leve + 0.055 * uPassa * bate) * dobra;
        w.y -= 0.02 * uPassa * dobra;
      } else if (aVento < 0.0) {
        // Fitas dos buquês dos bancos: abrem para fora do corredor um pouco antes de o visitante chegar a elas, como
        // se o passo dele empurrasse o ar, e voltam ao lugar quando ele passa ou para
        float peso = -aVento;
        float falta = uOlhoZ - w.z; // quanto falta para a câmera chegar ao buquê
        float onda = exp(-pow((falta - 3.4) / 1.7, 2.0));
        float vai = 0.6 + 0.4 * sin(falta * 2.6 + aFase);
        float abre = uPassa * onda * vai * peso;
        w.x += sign(w.x) * 0.1 * abre;
        w.y += 0.03 * abre;
      }
      vW = w.xyz;
      vN = normalize(mat3(modelMatrix) * normal);
      vNV = normalize(mat3(viewMatrix) * vN);
      vec4 mv = viewMatrix * w;
      vProf = -mv.z / ${LONGE.toFixed(1)};
      vTipo = aTipo;
      vId = aId;
      vUvO = aUv;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    in vec3 vW;
    in vec3 vN;
    in vec3 vNV;
    in float vTipo;
    in float vId;
    in float vProf;
    in vec2 vUvO;
    uniform sampler2D uOrnato;
    uniform vec3 uLuz;
    uniform mat4 uLuzMat;
    uniform highp sampler2DShadow uSombra;
    uniform float uPasso;
    uniform vec3 uPorta;
    uniform float uPeso;
    uniform float uTom;
    uniform sampler2D uSelo;
    uniform sampler2D uSeloCampo;
    uniform float uSeloCheio;
    uniform float uSeloPasso;
    uniform float uFim;
    uniform float uFimZ;
    uniform vec2 uFimRaio;
    layout(location = 0) out vec4 o0;
    layout(location = 1) out vec4 o1;
    layout(location = 2) out vec4 o2;
    ${RUIDO}

    const float SELO_BORRA = 1.6; // quanto o contorno do monograma entra na forma (níveis da textura além do da tela)
    const float SELO_RISCO = 0.17; // meia largura dos riscos do monograma antes de ele se encher, em passos

    // Uma família de riscos paralelos, com riscos no inteiro de x. meia é a meia largura, em períodos.
    float linha(float x, float dx, float meia) {
      float d = abs(fract(x + 0.5) - 0.5);
      return 1.0 - smoothstep(meia - dx * 0.75, meia + dx * 0.75, d);
    }

    // Distância até um retângulo de canto a canto (negativa dentro): serve para os traços retos do ladrilho
    float tira(vec2 p, vec2 a, vec2 b) { vec2 q = max(a - p, p - b); return max(q.x, q.y); }

    // Mosaico de cacos: a distância do ponto até a junta mais próxima, com um caco por unidade (células de Voronoi)
    vec2 caco(vec2 c) { return vec2(sorteio(c), sorteio(c + 17.3)); }
    float cacos(vec2 x) {
      vec2 n = floor(x), f = fract(x), mg = vec2(0.0), mr = vec2(0.0);
      float md = 8.0;
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j)), r = g + caco(n + g) - f;
        float d = dot(r, r);
        if (d < md) { md = d; mr = r; mg = g; }
      }
      md = 8.0;
      for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
        vec2 g = mg + vec2(float(i), float(j)), r = g + caco(n + g) - f;
        if (dot(mr - r, mr - r) > 0.00001) md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
      }
      return md;
    }

    // Hachura que mantém o espaçamento na tela: ao chegar perto, nascem riscos novos entre os antigos
    float riscos(vec2 q, vec2 dir, float tom, float semente) {
      if (tom < 0.06) return 0.0;
      float u = dot(q, dir);
      float du = max(fwidth(u), 1e-5);
      float longo = dot(q, vec2(-dir.y, dir.x));
      u += (ruido(q * 1.7 + semente) - 0.5) * 0.05; // a régua não é perfeita
      float nivel = log2(1.0 / (uPasso * du));
      float f0 = exp2(floor(nivel)), t = fract(nivel);
      float pena = 0.7 + 0.6 * ruido(vec2(longo * 1.3, floor(u * f0 + 0.5) * 3.1 + semente));
      float meiaPx = max(tom * 0.2 * uPasso * pena * uPeso, 0.34 * min(uPeso, 1.0));
      float a = linha(u * f0, du * f0, meiaPx * du * f0);
      float b = linha(u * f0 * 2.0, du * f0 * 2.0, meiaPx * du * f0 * 2.0);
      float tinta = max(a, b * smoothstep(0.1, 0.9, t));
      // nos tons claros o risco falha
      float falha = ruido(vec2(longo * 2.4, floor(u * f0 * 2.0 + 0.5) * 5.3 + semente));
      float inteiro = smoothstep(0.34 - tom * 0.7, 0.44 - tom * 0.7, falha);
      #ifdef DENTRO
      inteiro = mix(1.0, inteiro, 0.25); // lá dentro o risco quase não falha: as falhas viravam um chuvisco nas paredes
      #endif
      return tinta * inteiro;
    }

    float naSombra(vec3 w, vec3 n) {
      vec4 l = uLuzMat * vec4(w + n * 0.03, 1.0);
      vec3 c = l.xyz / l.w * 0.5 + 0.5;
      if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 0.0;
      // quatro leituras em roda; em cada uma a placa compara e mistura os quatro pontos vizinhos
      vec2 ponto = 1.0 / vec2(textureSize(uSombra, 0));
      float z = c.z - 0.0012;
      float luz = textureLod(uSombra, vec3(c.xy + vec2(-0.75, -0.25) * ponto, z), 0.0)
                + textureLod(uSombra, vec3(c.xy + vec2(0.25, -0.75) * ponto, z), 0.0)
                + textureLod(uSombra, vec3(c.xy + vec2(0.75, 0.25) * ponto, z), 0.0)
                + textureLod(uSombra, vec3(c.xy + vec2(-0.25, 0.75) * ponto, z), 0.0);
      return 1.0 - 0.25 * luz;
    }

    void main() {
      int tipo = int(vTipo + 0.5);
      // R = tinta do desenho à mão, G = dentro da peça. O viés puxa um nível de detalhe mais fino da textura,
      // para a peça pequena não sair mais macia que a linha feita por código.
      vec4 desenho = texture(uOrnato, vUvO, -0.8);
      vec3 n = normalize(vN);
      if (!gl_FrontFacing) n = -n;
      vec3 an = abs(n);

      // Em que plano a hachura corre, e para que lado: muda com a face, como numa gravura
      vec2 q; vec2 dir; float semente;
      bool frente = an.z >= an.x && an.z >= an.y;
      if (frente) { q = vW.xy; dir = normalize(vec2(1.0, 1.15)); semente = 1.0; }
      else if (an.x >= an.y) { q = vW.zy; dir = normalize(vec2(1.0, 0.3)); semente = 7.0; }
      else { q = vW.xz; dir = normalize(vec2(0.25, 1.0)); semente = 13.0; }

      #ifdef DENTRO
      // Dentro da igreja a luz vem do altar e das janelas altas: o que olha para a porta fica na contraluz
      float ndl = dot(n, vec3(0.0, 0.6, -0.8));
      float tom = clamp((0.1 - ndl) / 2.6, 0.0, 0.4); // a igreja é branca por dentro: sombras leves
      if (n.y < -0.3) tom *= 0.7; // o forro e o que olha para baixo: mais claro, para as pinturas e o florão aparecerem
      #else
      float ndl = dot(n, uLuz);
      float tom = clamp((0.4 - ndl) / 0.75, 0.0, 0.85);
      if (ndl > 0.0) tom = max(tom, naSombra(vW, n) * 0.62);
      #endif
      if (tipo == ${TELHADO}) tom = max(tom, 0.16);
      if (tipo == ${TABUAS}) tom = max(tom, 0.22);
      if (tipo == ${CHAO}) tom = 0.0;
      if (tipo == ${PLACA}) tom = 0.0; // o campo do florão fica em papel limpo
      if (tipo == ${FOLHA}) tom = max(tom, 0.42);
      if (tipo == ${ORNATO}) tom = 0.0; // o desenho já traz a sua hachura
      if (tipo == ${MOSAICO}) tom = 0.0; // o forro de mosaico é branco: o desenho dele são as juntas dos cacos
      if (tipo == ${MARMORE}) tom = max(tom, 0.17); // o mármore do portal é cinzento, na parede branca
      #ifdef DENTRO
      if (tipo == ${TABUAS}) tom = max(tom, 0.32);
      if (tipo == ${MADEIRA}) tom = tom * 0.5 + 0.24; // bancos de madeira escura: o tampo mais claro, as costas mais fundas
      #endif
      // Piso de ladrilho hidráulico, como o da Sé: ladrilhos claros, cada um com uma rosácea de oito pétalas, em
      // faixas atravessadas na nave e separadas por uma fileira de grega. De longe o desenho vira um tom só.
      vec2 pedra = vW.xz / 0.19;
      vec2 dPedra = max(fwidth(pedra), vec2(1e-5));
      float pertoDoPiso = 1.0 - smoothstep(0.09, 0.26, max(dPedra.x, dPedra.y));
      // Dos bancos para dentro o piso muda, como na Sé: nos corredores, um ladrilho mais fechado, de aro com flor
      // e estrela nos cantos; debaixo dos bancos continua a rosácea solta. A última grega fica na frente dos bancos.
      float fileira = floor(pedra.y);
      bool dosBancos = fileira < -25.5;
      bool fechado = dosBancos && (abs(vW.x) < 0.76 || abs(vW.x) > 2.47);
      if (tipo == ${LADRILHO}) tom = mix(fechado ? 0.2 : 0.13, 0.0, pertoDoPiso);
      #ifdef MEIA_LUZ
      tom = min(tom, 0.36); // as folhas abertas ficam no vão da porta: nem o sol nem a sombra dele chegam inteiros
      #endif
      tom = min(tom * uTom, 0.85);

      float tinta = riscos(q, dir, tom, semente);
      // nos tons fundos, uma segunda hachura cruza a primeira
      float cruzado = smoothstep(0.6, 0.85, tom);
      if (cruzado > 0.0) {
        vec2 d2 = vec2(dir.x * 0.34 - dir.y * 0.94, dir.x * 0.94 + dir.y * 0.34);
        tinta = max(tinta, riscos(q, d2, tom * 0.8 * cruzado, semente + 3.0));
      }

      // Juntas da cantaria: riscos horizontais finos e falhados
      if (tipo == ${JUNTAS} && frente) {
        float dy = max(fwidth(vW.y), 1e-5);
        float j = abs(fract(vW.y / 0.22 + 0.5) - 0.5) * 0.22 / dy;
        float fio = 1.0 - smoothstep(0.35, 1.05, j);
        float falha = ruido(vec2(vW.x * 0.9, floor(vW.y / 0.22 + 0.5) * 7.3));
        tinta = max(tinta, fio * 0.8 * smoothstep(0.3, 0.42, falha) * smoothstep(1.8, 3.2, 0.22 / dy));
      }
      // Anéis do tronco das palmeiras
      if (tipo == ${TRONCO}) {
        float dy = max(fwidth(vW.y), 1e-5);
        float j = abs(fract(vW.y / 0.3 + 0.5) - 0.5) * 0.3 / dy;
        float fio = 1.0 - smoothstep(0.35, 1.05, j);
        float falha = ruido(vec2((vW.x + vW.z) * 3.0, floor(vW.y / 0.3 + 0.5) * 7.3));
        tinta = max(tinta, fio * 0.7 * smoothstep(0.3, 0.45, falha) * smoothstep(1.8, 3.2, 0.3 / dy));
      }
      // Caneluras das pilastras e tábuas das portas: riscos verticais
      if ((tipo == ${CANELURAS} || tipo == ${TABUAS}) && frente) {
        float passo = tipo == ${CANELURAS} ? 0.075 : 0.13;
        float dx = max(fwidth(vW.x), 1e-5);
        float j = abs(fract(vW.x / passo + 0.5) - 0.5) * passo / dx;
        float fio = 1.0 - smoothstep(0.35, 1.05, j);
        float falha = ruido(vec2(floor(vW.x / passo + 0.5) * 5.1, vW.y * 0.8));
        tinta = max(tinta, fio * 0.75 * smoothstep(0.24, 0.36, falha) * smoothstep(2.4, 4.0, passo / dx));
      }
      // O forro de mosaico de cacos da Sé: as juntas dos cacos, desenroladas sobre a curva da abóbada. De longe
      // elas se fechariam numa mancha: somem antes disso.
      if (tipo == ${MOSAICO}) {
        vec2 mq = vec2(atan(vW.x, vW.y - ${NAVE_CY.toFixed(4)}) * ${NAVE_R.toFixed(4)}, vW.z) / 0.17;
        vec2 dm = fwidth(mq);
        float ponto = max(max(dm.x, dm.y), 1e-5); // cacos por ponto da tela
        float perto = 1.0 - smoothstep(0.05, 0.16, ponto);
        if (perto > 0.0) tinta = max(tinta, (1.0 - smoothstep(0.3 * ponto, 1.0 * ponto, cacos(mq))) * 0.42 * perto);
      }
      // O mármore do portal: veios soltos, em diagonal, que falham
      if (tipo == ${MARMORE} && frente) {
        float veio = (vW.x * 0.5 + vW.y * 0.87) * 2.6 + 1.9 * ruido(vW.xy * 0.9 + 3.0) + 0.5 * ruido(vW.xy * 2.9);
        float dv = max(fwidth(veio), 1e-5);
        float falha = ruido(vW.xy * 1.3 + 9.0);
        tinta = max(tinta, linha(veio, dv, 0.8 * dv) * 0.52 * smoothstep(0.4, 0.56, falha) * (1.0 - smoothstep(0.1, 0.3, dv)));
      }

      if (tipo == ${LADRILHO}) {
        vec2 c = fract(pedra) - 0.5;
        vec2 j = (0.5 - abs(c)) / dPedra; // as juntas
        float desenho = (1.0 - smoothstep(0.35, 1.05, min(j.x, j.y))) * 0.45;
        float d;
        if (!dosBancos && mod(fileira, 5.0) < 0.5) {
          // a grega: duas linhas de borda e, em cada ladrilho, um gancho em espiral
          vec2 u = c + 0.5;
          d = min(tira(u, vec2(0.0, 0.04), vec2(1.0, 0.11)), tira(u, vec2(0.0, 0.89), vec2(1.0, 0.96)));
          d = min(d, tira(u, vec2(0.0, 0.74), vec2(1.0, 0.825)));
          d = min(d, tira(u, vec2(0.8, 0.26), vec2(0.885, 0.825)));
          d = min(d, tira(u, vec2(0.2, 0.26), vec2(0.885, 0.345)));
          d = min(d, tira(u, vec2(0.2, 0.26), vec2(0.285, 0.6)));
          d = min(d, tira(u, vec2(0.2, 0.515), vec2(0.62, 0.6)));
        } else if (fechado) {
          // o ladrilho fechado: um aro grosso com um fio por dentro, uma flor no meio e, em cada canto, um quarto
          // da estrela de quatro pontas que se completa com os ladrilhos vizinhos
          float r = length(c);
          d = abs(r - 0.4) - 0.035;
          d = min(d, abs(r - 0.3) - 0.012);
          float petala = 0.23 * pow(abs(cos(4.0 * atan(c.y, c.x))), 0.6);
          d = min(d, max(r - petala, 0.06 - r));
          d = min(d, r - 0.03);
          vec2 k = 0.5 - abs(c);
          d = min(d, pow(k.x, 0.7) + pow(k.y, 0.7) - 0.27);
        } else {
          // a rosácea: oito pétalas em gota em volta de um miolo, dentro de um aro fino
          float r = length(c);
          float petala = 0.36 * pow(abs(cos(4.0 * atan(c.y, c.x))), 0.6);
          d = max(r - petala, 0.085 - r);
          d = min(d, r - 0.04);
          d = min(d, abs(r - 0.44) - 0.012);
        }
        float borda = max(fwidth(d), 1e-4);
        desenho = max(desenho, (1.0 - smoothstep(-borda, borda, d)) * 0.66);
        tinta = max(tinta, desenho * pertoDoPiso);
      }

      float cheio = tipo == ${CHEIO} ? 1.0 : 0.0;
      tinta = max(tinta, cheio);

      // Peça desenhada à mão: fora do contorno ela não existe; dentro, a tinta é a do desenho
      float ornato = 0.0;
      if (tipo == ${ORNATO}) {
        // de longe a textura vira um cinza fraco: a tinta ganha força quando a peça fica pequena na tela
        float texels = fwidth(vUvO.x) * ${ATLAS.w.toFixed(1)};
        float forte = desenho.r * mix(1.15, 1.7, smoothstep(1.5, 7.0, texels));
        // Fora do contorno só fica o traço firme. A beirada macia do traço, se ficasse, saía como um fio claro
        // em volta da peça quando atrás dela há escuro (as mísulas contra a janela).
        if (desenho.g < 0.5 && forte < 0.45) discard;
        tinta = smoothstep(0.06, 0.8, forte);
        ornato = 1.0;
      }
      // O monograma do fim, pintado no florão do forro. Ele é gravado como o resto da cena: um contorno e uma
      // hachura. Depois que a coroa se solta ele se enche de tinta sem esmaecer: a tinta corre por dentro do traço,
      // do laço do alto do A até as pontas dos dois M, e a frente dela é nítida.
      if (tipo == ${SELO}) {
        // a beira é afiada aqui: a textura reduzida chega macia, e a tinta macia saía como um halo cinza
        float forma = texture(uSelo, vUvO).r;
        float beira = max(fwidth(forma), 0.02);
        float dentro = smoothstep(0.5 - beira, 0.5 + beira, forma);
        if (dentro < 0.02) discard;
        // o contorno: a mesma forma lida num nível mais borrado da textura só chega a 1 longe da beira
        // (onde a haste é mais fina que o borrão ela fica toda em tinta, e de longe o monograma inteiro)
        float ponto = fwidth(vUvO.x) * ${SELO_TX.toFixed(1)}; // pontos da textura por ponto da tela
        float borrada = textureLod(uSelo, vUvO, log2(max(ponto, 1.0)) + SELO_BORRA).r;
        float contorno = 1.0 - smoothstep(0.72, 0.92, borrada);
        // se a tinta já chegou a este ponto: uSeloCampo guarda a distância dele até a nascente, andando por dentro
        // da forma, e uSeloCheio diz até onde a frente já foi. A passagem tem a largura de um ponto da tela.
        float campo = texture(uSeloCampo, vUvO).r;
        float enche = smoothstep(-1.0, 1.0, (uSeloCheio - campo) / clamp(fwidth(campo), 2e-4, 0.01));
        vec2 qs = (vUvO - 0.5) * vec2(${SELO_TAM[0].toFixed(4)}, ${SELO_TAM[1].toFixed(4)});
        // os riscos são presos à letra e crescem com ela (na hachura da cena nasceriam riscos novos no meio do
        // crescimento); o passo é o da cena quando o monograma chega ao tamanho final
        vec2 dirS = vec2(0.7071, 0.7071);
        float us = dot(qs, dirS) / uSeloPasso;
        float penaS = 0.8 + 0.4 * ruido(vec2(dot(qs, vec2(-dirS.y, dirS.x)) * 9.0, floor(us + 0.5) * 3.1));
        float hach = linha(us, max(fwidth(us), 1e-5), SELO_RISCO * penaS);
        tinta = dentro * max(max(hach, contorno), enche);
        cheio = enche;
        ornato = 1.0;
      }

      // As bordas da cena somem no papel, para o desenho não acabar numa linha reta
      float some = 1.0 - smoothstep(13.0, 19.0, abs(vW.x));
      if (tipo == ${CHAO}) some *= 1.0 - smoothstep(4.0, 9.0, vW.z);
      #ifdef DENTRO
      // O fundo da nave é mais claro, como visto na luz do altar
      // (a distância conta a partir da porta enquanto a câmera está fora, e a partir da câmera depois que ela entra)
      float adiante = min(cameraPosition.z, 0.0) - vW.z;
      some = 1.0 - 0.95 * smoothstep(5.0, 22.0, adiante);
      // as peças desenhadas à mão clareiam mais cedo: longe, os maços dos bancos se juntavam numa mancha azul
      if (tipo == ${ORNATO}) some *= 1.0 - 0.78 * smoothstep(3.0, 12.0, adiante);
      // No fim, com a câmera virada para o forro, o desenho se desfaz em volta do florão: sobra uma vinheta oval,
      // do tamanho do quadro, e os cantos ficam em papel
      // (o florão fica de fora: quando se solta, ele cresce e sai pelas beiras da tela com a tinta inteira)
      #ifndef SOLTO
      some *= 1.0 - uFim * smoothstep(0.78, 1.08, length((vW.xz - vec2(0.0, uFimZ)) / uFimRaio));
      #endif
      #endif

      o0 = vec4(normalize(vNV) * 0.5 + 0.5, vProf);
      o1 = vec4(tinta, vId, length(vW - uPorta) / 32.0, cheio);
      o2 = vec4(some, ornato, 0.0, 1.0);
    }
  `,
});

// A mesma tinta para o lado de dentro: outra luz, sem a sombra projetada do sol, e o fundo que se desfaz em luz
const materialNave = materialTraco.clone();
materialNave.defines = { DENTRO: 1 };
materialNave.uniforms = comum;
// O florão e o monograma: a tinta da nave, mas fora da vinheta do fim (SOLTO)
const materialFlorao = materialTraco.clone();
materialFlorao.defines = { DENTRO: 1, SOLTO: 1 };
materialFlorao.uniforms = comum;
const materialFolha = materialTraco.clone();
materialFolha.defines = { MEIA_LUZ: 1 };
materialFolha.uniforms = comum;

// O tremor da mão (o contorno ondulado, que "fervia" de quadro em quadro) saiu a pedido de André: o padrão é 0.
// Para comparar, pelo endereço: ?treme=0.7 traz o tremor de volta, e ?ferve=0 o deixa parado.
const PEDIDO = new URLSearchParams(location.search);
const TREME = PEDIDO.has("treme") && isFinite(+PEDIDO.get("treme")) ? limitar(+PEDIDO.get("treme"), 0, 2) : 0;
const FERVE = PEDIDO.get("ferve") !== "0";

// Passo 2: contornos, tremor da mão, revelação e papel
const final = {
  t0: { value: null },
  t1: { value: null },
  t2: { value: null },
  uTela: { value: new THREE.Vector2(1, 1) },
  uDpr: { value: 1 },
  uRevela: { value: 0 },
  uFerve: { value: 0 },
  uLinha: { value: 0.5 }, // meia grossura do contorno, em pixels
  uTreme: { value: TREME }, // quanto a mão treme
  uDuplo: { value: 0 }, // segundo traço por cima, deslocado, como quem repassa a linha
  uQuebra: { value: 0 }, // quanto a linha falha
  uCarga: { value: 0.92 }, // força da tinta
  tPapel: { value: null }, // grão do papel, carga da tinta e peso da pena, pintados uma vez por tamanho de tela
  uPapel: { value: new THREE.Vector3(255 / 255, 239 / 255, 215 / 255) },
  uFio: { value: new THREE.Vector3(40 / 255, 72 / 255, 140 / 255) },
  uMar: { value: new THREE.Vector3(8 / 255, 40 / 255, 130 / 255) },
};

const materialFinal = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  uniforms: final,
  depthTest: false,
  depthWrite: false,
  vertexShader: /* glsl */ `
    out vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    in vec2 vUv;
    uniform sampler2D t0;
    uniform sampler2D t1;
    uniform sampler2D t2;
    uniform sampler2D tPapel;
    uniform vec2 uTela;
    uniform float uDpr;
    uniform float uRevela;
    uniform float uFerve;
    uniform float uLinha;
    uniform float uTreme;
    uniform float uDuplo;
    uniform float uQuebra;
    uniform float uCarga;
    uniform vec3 uPapel;
    uniform vec3 uFio;
    uniform vec3 uMar;
    out vec4 cor;
    ${RUIDO}

    // Contorno numa vizinhança de raio r (em pixels): silhueta, vinco entre faces e encontro de peças.
    // Devolve também a maior distância até a porta e o maior "some" entre os vizinhos.
    float borda(vec2 uv, float r, out float dist, out float some, out float cheio) {
      vec2 d = r / uTela;
      vec2 pa = uv + d, pb = uv - d, pc = uv + vec2(d.x, -d.y), pd = uv + vec2(-d.x, d.y);
      vec4 a0 = texture(t0, pa), b0 = texture(t0, pb), c0 = texture(t0, pc), d0 = texture(t0, pd);
      vec4 a1 = texture(t1, pa), b1 = texture(t1, pb), c1 = texture(t1, pc), d1 = texture(t1, pd);
      float ta = step(0.004, a1.g), tb = step(0.004, b1.g), tc = step(0.004, c1.g), td = step(0.004, d1.g);
      float za = mix(1.0, a0.a, ta), zb = mix(1.0, b0.a, tb), zc = mix(1.0, c0.a, tc), zd = mix(1.0, d0.a, td);
      vec4 m0 = texture(t0, uv);
      float inclina = clamp((m0.b * 2.0 - 1.0), 0.18, 1.0); // face rasante tem degrau de profundidade natural
      float gz = (abs(za - zb) + abs(zc - zd)) / min(min(za, zb), min(zc, zd));
      float silhueta = smoothstep(0.012, 0.03, gz * inclina);
      vec3 na = a0.xyz * 2.0 - 1.0, nb = b0.xyz * 2.0 - 1.0, nc = c0.xyz * 2.0 - 1.0, nd = d0.xyz * 2.0 - 1.0;
      float todos = ta * tb * tc * td;
      float vinco = smoothstep(0.3, 0.7, (1.0 - dot(na, nb)) + (1.0 - dot(nc, nd))) * todos;
      float peca = smoothstep(0.004, 0.012, abs(a1.g - b1.g) + abs(c1.g - d1.g));
      dist = max(max(a1.b * ta, b1.b * tb), max(c1.b * tc, d1.b * td));
      vec4 a2 = texture(t2, pa), b2 = texture(t2, pb), c2 = texture(t2, pc), d2 = texture(t2, pd);
      some = max(max(a2.r, b2.r), max(c2.r, d2.r));
      float ornato = max(max(a2.g, b2.g), max(c2.g, d2.g)); // peça desenhada à mão por perto
      cheio = max(max(a1.a, b1.a), max(c1.a, d1.a));
      return max(silhueta, max(vinco * 0.8, peca * 0.72)) * (1.0 - ornato);
    }

    void main() {
      vec2 fc = vUv * uTela;
      // R = grão do papel, G = carga da tinta, B = peso da pena, A = pressão: ruídos que não mudam de quadro para
      // quadro, pintados uma vez numa textura do tamanho da tela (ver pintarPapel)
      vec4 fixo = texelFetch(tPapel, ivec2(gl_FragCoord.xy), 0);
      ${TREME > 0 ? `// O tremor da mão desloca tudo o que é lido: os contornos saem levemente ondulados
      vec2 lento = vec2(ruido(fc / (44.0 * uDpr)), ruido(fc / (44.0 * uDpr) + 31.7)) - 0.5;
      vec2 curto = vec2(ruido(fc / (9.0 * uDpr) + 5.0), ruido(fc / (9.0 * uDpr) + 9.0)) - 0.5;
      vec2 ferve = vec2(ruido(fc / (14.0 * uDpr) + uFerve * 13.7), ruido(fc / (14.0 * uDpr) - uFerve * 9.1)) - 0.5;
      vec2 uv = vUv + (lento * 1.7 + curto * 0.5 + ferve * 0.4) * uTreme * uDpr / uTela;` : "vec2 uv = vUv; // sem tremor, não há o que deslocar"}

      vec4 c1 = texture(t1, uv);
      float tem = step(0.004, c1.g);
      float dist, some, cheioB;
      float peso = 0.75 + 0.5 * fixo.b; // a pena pesa mais num trecho e menos noutro
      float e = borda(uv, uLinha * uDpr * peso, dist, some, cheioB);
      if (uQuebra > 0.0) e *= smoothstep(uQuebra - 0.12, uQuebra, ruido(fc / (20.0 * uDpr) + 23.0));
      if (uDuplo > 0.0) {
        vec2 lento2 = vec2(ruido(fc / (37.0 * uDpr) + 71.3), ruido(fc / (37.0 * uDpr) + 113.9)) - 0.5;
        float d2, s2, c2;
        float e2 = borda(vUv + lento2 * 3.4 * uTreme * uDpr / uTela, uLinha * 0.8 * uDpr, d2, s2, c2);
        e2 *= smoothstep(0.3, 0.5, ruido(fc / (26.0 * uDpr) + 57.0));
        e = max(e, e2 * 0.6 * uDuplo);
        dist = max(dist, d2); some = max(some, s2);
      }
      float pressao = 0.78 + 0.22 * fixo.a;
      float tinta = max(c1.r * tem, e * pressao);

      // A tinta chega a partir da porta (só nos primeiros segundos: depois não há o que calcular)
      if (uRevela < 1.199) {
        float d = mix(dist, c1.b, tem) * (32.0 / 24.0) + (ruido(fc / (22.0 * uDpr)) - 0.5) * 0.07;
        float frente = uRevela * 1.2;
        tinta *= 1.0 - smoothstep(frente - 0.08, frente, d);
      }
      tinta *= mix(some, texture(t2, uv).r, tem);

      // Papel: grão fino e fibras deitadas
      vec3 papel = uPapel * (1.0 - (fixo.r - 0.5) * 0.07);

      float carga = tinta * uCarga * (0.9 + 0.1 * fixo.g);
      vec3 corTinta = mix(uFio, uMar, max(c1.a * tem, cheioB * 0.5));
      cor = vec4(mix(papel, corTinta, carga), 1.0);
    }
  `,
});

// Os ruídos do passo 2 que não mudam de quadro para quadro (grão e fibras do papel, carga da tinta, peso e pressão
// da pena) são pintados uma vez numa textura do tamanho da tela. Antes eram calculados em todo ponto, todo quadro.
const materialPapel = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  uniforms: { uDpr: final.uDpr },
  depthTest: false,
  depthWrite: false,
  vertexShader: /* glsl */ `
    void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform float uDpr;
    out vec4 cor;
    ${RUIDO}
    void main() {
      vec2 fc = gl_FragCoord.xy;
      float grao = ruido(fc / (1.5 * uDpr));
      float fibra = ruido(vec2(fc.x / (70.0 * uDpr), fc.y / (2.6 * uDpr)));
      float nuvem = ruido(fc / (260.0 * uDpr));
      float v = 0.03 * (grao - 0.5) + 0.012 * (fibra - 0.5) + 0.025 * (nuvem - 0.5); // de -0,0335 a 0,0335
      cor = vec4(v / 0.07 + 0.5, ruido(fc / (2.3 * uDpr) + 41.0), ruido(fc / (30.0 * uDpr) + 3.0), ruido(fc / (16.0 * uDpr) + 11.0));
    }
  `,
});
let papelAlvo = null, papelFeito = "";
function pintarPapel(larg, alt) {
  const chave = larg + "x" + alt + "@" + final.uDpr.value.toFixed(4);
  if (chave === papelFeito) return;
  papelFeito = chave;
  if (!papelAlvo) {
    papelAlvo = new THREE.WebGLRenderTarget(larg, alt, { type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    final.tPapel.value = papelAlvo.texture;
  } else papelAlvo.setSize(larg, alt);
  quadroCheio.material = materialPapel;
  renderer.setRenderTarget(papelAlvo);
  renderer.render(cenaFinal, cameraFinal);
  renderer.setRenderTarget(null);
  quadroCheio.material = materialFinal;
}

// ---------- Cena ----------
const cena = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();
camera.matrixAutoUpdate = true;
const cenaFinal = new THREE.Scene();
const cameraFinal = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quadroCheio = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), materialFinal);
quadroCheio.frustumCulled = false;
cenaFinal.add(quadroCheio);

// Tudo o que é do lado de fora fica num grupo, que some quando a câmera já entrou
const fora = new THREE.Group();
cena.add(fora);
let interior = null;
const folhas = []; // as duas folhas da porta do meio
const ponteiros = [];
const aves = [];

// Um bando de sete pássaros que cruza por trás das torres. Cada um são duas asas que batem.
function montarAves() {
  for (let i = 0; i < 7; i++) {
    const ave = new THREE.Group();
    for (const s of [-1, 1]) {
      const o = new Obra();
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute([0, -0.03, 0, s * 0.36, 0.0, 0, 0, 0.04, 0], 3));
      g.computeVertexNormals();
      o.junta(g, CHEIO, 0.97);
      const asa = new THREE.Mesh(o.geometria(), materialTraco);
      asa.frustumCulled = false;
      ave.add(asa);
    }
    ave.userData = { atraso: i * 0.38 + (i % 3) * 0.21, dy: ((i * 5) % 7) * 0.22 - 0.6, fase: i * 1.3, z: -7 - i * 0.5 };
    ave.visible = false;
    fora.add(ave);
    aves.push(ave);
  }
}

function moverAves(t) {
  const CICLO = 21, VOO = 13;
  for (const ave of aves) {
    const d = ave.userData;
    const tt = (((t - 2.2 - d.atraso) % CICLO) + CICLO) % CICLO;
    ave.visible = !parado && t > 2.2 + d.atraso && tt < VOO;
    if (!ave.visible) continue;
    const u = tt / VOO;
    ave.position.set(-17 + 34 * u, 12.6 + d.dy + Math.sin(u * 9 + d.fase) * 0.25, d.z);
    const bate = Math.sin(t * 7.5 + d.fase) * 0.55 + 0.15;
    ave.children[0].rotation.z = -bate;
    ave.children[1].rotation.z = bate;
  }
}

// ---------- A pomba da fachada ----------
// Uma pomba branca desenhada à mão: sete poses da mesma folha, no atlas, trocadas como num desenho animado.
// Ela vive nas janelas da fachada. Pousa num peitoril ou num corrimão de balcão, cisca, e de tempos em tempos pula
// para outra janela: agacha, salta, bate as asas no ar e pousa. Só escolhe pousos que estão no quadro: quando o
// visitante chega perto e a janela dela sai da tela, ela vem para uma que ficou. Quando a porta começa a abrir
// ela levanta voo e sai pelo alto; se o visitante volta e a porta fecha, ela vem pousar de novo.
// Quem pediu menos movimento a vê pousada no balcão do meio.
const POSES = ["pombaPousada", "pombaBica", "pombaAgachada", "pombaSalto", "pombaAlto", "pombaPe", "pombaAberta"];
const BATE = ["pombaPe", "pombaAlto", "pombaAberta", "pombaAlto"]; // a batida da asa: em pé, alta, aberta, alta
const QUADROS = 13; // poses por segundo no ar
let pomba = null;
// Os pousos: em cada um dos três vãos, o peitoril da janela alta e as duas pontas do corrimão do balcão.
// (a ave fica na beira da frente da pedra: vista de baixo, é a beira que aparece)
const POUSOS = [];
for (const cx of [450, 651, 860]) {
  const janela = POUSOS.length;
  POUSOS.push({ x: X(cx) + 0.13, y: Y(1040), z: Z_CORPO + 0.125, janela });
  for (const d of [-0.24, 0.24]) POUSOS.push({ x: X(cx) + d, y: Y(1188), z: Z_CORPO + 0.225, janela: janela + 1 });
}
const POUSO_MEIO = 5; // a ponta direita do corrimão do balcão do meio
const voo = {
  estado: 0, // 0 pousada, 1 pulando de um pouso a outro, 2 indo embora, 3 fora da tela, 4 voltando
  em: 3, para: 3, // o pouso em que está e o pouso para onde pula (começa no peitoril da janela alta do meio)
  u: 0, dura: 1, // o pulo, de 0 a 1, e quanto ele dura
  tau: 0, de: new THREE.Vector3(), // o voo de saída: há quantos segundos, e de onde partiu
  espera: 1.6, parada: 0, // quanto falta para o próximo pulo, e há quanto tempo está pousada
  vez: 0, // conta os pulos: é dela que saem as escolhas
  lado: -1, // para onde olha: -1 para a esquerda, como no desenho; 1 para a direita
  rumo: -1, // para que lado vai embora: o lado para onde estava olhando quando a porta abriu
  antes: null, fixo: null,
};
const sortePomba = (n) => { const v = Math.sin(n * 12.9898 + 4.1) * 43758.5453; return v - Math.floor(v); };
const duraDoPulo = (de, para) => 0.5 + 0.28 * Math.hypot(POUSOS[para].x - POUSOS[de].x, POUSOS[para].y - POUSOS[de].y);

function montarPomba() {
  pomba = new THREE.Group();
  pomba.userData.poses = {};
  for (const nome of POSES) {
    const o = new Obra();
    ornato(o, nome, 0, 0, 0); // os pés na origem
    const m = new THREE.Mesh(o.geometria(), materialTraco);
    m.frustumCulled = false;
    m.visible = false;
    pomba.add(m);
    pomba.userData.poses[nome] = m;
  }
  fora.add(pomba);
  pomba.position.set(POUSOS[POUSO_MEIO].x, POUSOS[POUSO_MEIO].y, POUSOS[POUSO_MEIO].z);
  mostrarPomba("pombaPousada", -1);
}

// Uma pose, virada para um lado e com o bico mais alto ou mais baixo (inclina, em radianos: positivo sobe)
function mostrarPomba(pose, lado, inclina = 0) {
  for (const nome of POSES) pomba.userData.poses[nome].visible = nome === pose;
  pomba.scale.x = -lado;
  pomba.rotation.z = lado * inclina;
}

// O pulo de um pouso a outro, com u de 0 a 1
function porPulo(de, para, u, dura) {
  const a = POUSOS[de], b = POUSOS[para];
  const dist = Math.hypot(b.x - a.x, b.y - a.y), lado = b.x >= a.x ? 1 : -1;
  const AG = 0.1 / dura; // a parte do pulo em que ela está agachada: antes de sair e depois de chegar
  const v = limitar((u - AG) / (1 - 2 * AG)); // o trecho no ar
  const e = misturar(v, suave(v), 0.5), arco = Math.sin(Math.PI * v);
  pomba.position.set(misturar(a.x, b.x, e), misturar(a.y, b.y, e) + (0.14 + 0.09 * dist) * arco, misturar(a.z, b.z, e) + 0.08 * arco);
  let pose = "pombaAgachada", inclina = 0;
  if (v > 0 && v < 1) {
    const noAr = v * dura * (1 - 2 * AG); // segundos desde o salto
    pose = v < 0.14 || v > 0.86 ? "pombaSalto" : BATE[Math.floor(noAr * QUADROS) % BATE.length];
    // o bico acompanha o caminho: sobe na saída, desce na chegada
    inclina = 0.5 * Math.atan2((b.y - a.y) / Math.max(dist, 0.4) + 0.5 * Math.cos(Math.PI * v), 1);
  }
  mostrarPomba(pose, lado, inclina);
}

// O voo de saída, tau segundos depois de levantar: para o lado em que ela olhava (rumo) e para o alto, até sair
// da tela. Na volta o mesmo caminho é feito ao contrário, com a ave virada para o pouso e o bico mais baixo.
function porVoo(tau, rumo, volta = false) {
  const u = tau / 2.4;
  pomba.position.set(voo.de.x + rumo * 1.9 * Math.pow(u, 1.4), voo.de.y + 0.9 * u + 2.2 * u * u, voo.de.z + 0.5 * u);
  const pose = tau < 0.09 ? "pombaAgachada" : tau < 0.22 ? "pombaSalto" : BATE[Math.floor(tau * QUADROS) % BATE.length];
  mostrarPomba(pose, volta ? -rumo : rumo, suave((tau - 0.09) / 0.3) * (volta ? -0.14 : 0.3));
}

// Se o pouso está no quadro, com folga para a ave caber inteira
function pousoNoQuadro(i) {
  if (!fora.visible) return false;
  pontoNaTela.set(POUSOS[i].x, POUSOS[i].y + 0.14, POUSOS[i].z).project(camera);
  return Math.abs(pontoNaTela.x) < 0.84 && pontoNaTela.y > -0.8 && pontoNaTela.y < 0.82;
}

// Para onde ela pula agora: outra janela que esteja no quadro. Se a dela saiu do quadro, a mais próxima.
function proximoPouso() {
  const aqui = POUSOS[voo.em], longe = (i) => Math.hypot(POUSOS[i].x - aqui.x, POUSOS[i].y - aqui.y);
  let candidatos = POUSOS.map((_, i) => i).filter((i) => i !== voo.em && pousoNoQuadro(i));
  if (!candidatos.length) return -1;
  if (!pousoNoQuadro(voo.em)) return candidatos.reduce((a, b) => (longe(a) <= longe(b) ? a : b));
  const outras = candidatos.filter((i) => POUSOS[i].janela !== aqui.janela);
  if (outras.length) candidatos = outras;
  return candidatos[Math.floor(sortePomba(voo.vez) * candidatos.length) % candidatos.length];
}

function moverPomba(t, abre) {
  if (!pomba) return;
  const dt = voo.antes === null ? 0 : limitar(t - voo.antes, 0, 0.05);
  voo.antes = t;
  pomba.visible = true;
  if (voo.fixo) { // para as capturas: um instante do voo de saída ou de um pulo
    if (voo.fixo.tau !== undefined) {
      voo.de.set(POUSOS[POUSO_MEIO].x, POUSOS[POUSO_MEIO].y, POUSOS[POUSO_MEIO].z);
      porVoo(voo.fixo.tau, -1);
    } else porPulo(voo.fixo.de, voo.fixo.para, voo.fixo.u, duraDoPulo(voo.fixo.de, voo.fixo.para));
    return;
  }
  if (parado) {
    pomba.position.set(POUSOS[POUSO_MEIO].x, POUSOS[POUSO_MEIO].y, POUSOS[POUSO_MEIO].z);
    mostrarPomba("pombaPousada", -1);
    return;
  }

  // A porta manda: abriu, ela vai embora de onde estiver; fechou, ela volta
  if (abre > 0.02 && (voo.estado === 0 || voo.estado === 1 || voo.estado === 4)) {
    if (voo.estado !== 4) {
      voo.de.copy(pomba.position);
      voo.tau = 0;
      // sai para o lado em que já estava virada: não dá meia-volta no ar
      voo.rumo = voo.estado === 1 ? (POUSOS[voo.para].x >= POUSOS[voo.em].x ? 1 : -1) : voo.lado;
      if (voo.estado === 1) voo.em = voo.para; // saiu no meio de um pulo: na volta, pousa onde ia pousar
    }
    voo.estado = 2;
  } else if (abre < 0.005 && (voo.estado === 2 || voo.estado === 3)) {
    voo.estado = 4;
    voo.tau = Math.min(voo.tau, 2.6); // volta da beira da tela, não de onde foi parar
  }

  if (voo.estado === 0) {
    const p = POUSOS[voo.em];
    pomba.position.set(p.x, p.y, p.z);
    voo.parada += dt;
    voo.espera -= dt;
    // pousada, ela cisca de vez em quando: baixa a cabeça duas vezes e volta
    const fase = (voo.parada + voo.vez * 0.37) % 2.3;
    const cisca = voo.parada > 0.5 && ((fase > 1.1 && fase < 1.42) || (fase > 1.62 && fase < 1.94));
    mostrarPomba(cisca ? "pombaBica" : "pombaPousada", voo.lado);
    if (voo.espera <= 0 || (voo.parada > 0.35 && fora.visible && !pousoNoQuadro(voo.em))) {
      const para = proximoPouso();
      if (para < 0) voo.espera = 1.2;
      else {
        voo.para = para;
        voo.u = 0;
        voo.dura = duraDoPulo(voo.em, para);
        voo.estado = 1;
        voo.vez += 1;
      }
    }
  } else if (voo.estado === 1) {
    voo.u += dt / voo.dura;
    porPulo(voo.em, voo.para, Math.min(voo.u, 1), voo.dura);
    if (voo.u >= 1) {
      voo.lado = POUSOS[voo.para].x >= POUSOS[voo.em].x ? 1 : -1;
      voo.em = voo.para;
      voo.estado = 0;
      voo.parada = 0;
      voo.espera = 2.4 + 2.4 * sortePomba(voo.vez + 0.5);
    }
  } else if (voo.estado === 2) {
    voo.tau += dt;
    porVoo(voo.tau, voo.rumo);
    // saiu da tela (ou a câmera já entrou na igreja): some até a porta fechar de novo
    pontoNaTela.copy(pomba.position).project(camera);
    if (!fora.visible || Math.abs(pontoNaTela.x) > 1.15 || pontoNaTela.y > 1.15 || voo.tau > 6) voo.estado = 3;
  } else if (voo.estado === 3) {
    pomba.visible = false;
  } else if (voo.estado === 4) {
    voo.tau -= dt;
    const p = POUSOS[voo.em];
    pontoNaTela.set(p.x, p.y, p.z);
    voo.de.lerp(pontoNaTela, 1 - Math.exp(-dt * 6)); // se saiu do meio de um pulo, o caminho se acerta com o pouso
    if (voo.tau <= 0) {
      voo.tau = 0;
      voo.estado = 0;
      voo.lado = -voo.rumo;
      voo.parada = 0;
      voo.espera = 2.6;
      pomba.position.set(p.x, p.y, p.z);
      mostrarPomba("pombaPousada", voo.lado);
    } else porVoo(voo.tau, voo.rumo, true);
  }
}

// Pétalas de rosa caindo devagar na nave: é o que se mexe lá dentro. São poucas, só o contorno, e não chegam ao
// último vão, para não passarem na frente do monograma. Quem pediu menos movimento não as vê.
const petalas = [];
function montarPetalas() {
  const forma = new THREE.Shape();
  forma.moveTo(0, -0.05);
  forma.quadraticCurveTo(0.055, -0.01, 0.03, 0.045);
  forma.quadraticCurveTo(0, 0.03, -0.03, 0.045);
  forma.quadraticCurveTo(-0.055, -0.01, 0, -0.05);
  for (let i = 0; i < 22; i++) {
    const o = new Obra();
    const g = new THREE.ShapeGeometry(forma, 5);
    g.scale(0.7, 0.7, 1); // as grandes, na frente do arco do altar, pareciam rasgos no desenho
    o.junta(g, PLACA, (((i * 11) % 53) + 2) / 64);
    const m = new THREE.Mesh(o.geometria(), materialNave);
    m.frustumCulled = false;
    const s = (n) => { const v = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453; return v - Math.floor(v); };
    m.userData = { x: (s(1) * 2 - 1) * 2.5, z: -4.6 - s(2) * 9.4, fase: s(3) * 40, queda: 0.22 + s(4) * 0.16, giro: 0.5 + s(5) * 1.1, vai: 0.15 + s(6) * 0.25 };
    interior.add(m);
    petalas.push(m);
  }
}

const pontoNaTela = new THREE.Vector3();
function moverPetalas(t) {
  const TETO = 5.6;
  for (const m of petalas) {
    const d = m.userData;
    m.position.set(d.x + Math.sin(t * 0.5 + d.fase) * d.vai, TETO + 0.1 - (((t + d.fase) * d.queda) % TETO), d.z + Math.cos(t * 0.37 + d.fase) * d.vai * 0.6);
    m.rotation.set(t * d.giro + d.fase, t * d.giro * 0.6, Math.sin(t * 0.8 + d.fase) * 1.2);
    m.visible = !parado && Math.abs(m.position.z - camera.position.z) > 2.2; // perto da câmera ela ficaria grande demais na tela
    // Nenhuma pétala passa por trás da frase: quem chega à oval em volta da estrofe encolhe até sumir, e volta a
    // crescer ao sair pelo outro lado
    let tam = 1;
    if (m.visible && fraseNaTela > 0.001) {
      pontoNaTela.copy(m.position).project(camera);
      const dx = ((pontoNaTela.x + 1) * 0.5 * vw - caixaFrase.x) / (caixaFrase.a + 18);
      const dy = ((1 - pontoNaTela.y) * 0.5 * vh - caixaFrase.y) / (caixaFrase.b + 14);
      tam = 1 - fraseNaTela * (1 - suave((Math.hypot(dx, dy) - 1) / 0.45));
      if (tam < 0.05) m.visible = false;
    }
    m.scale.setScalar(tam);
  }
}

// As palmeiras e os postes. Refeito quando a tela passa de deitada para em pé, porque o lugar das palmeiras muda.
let entorno = null, entornoEstreito = null;
function montarEntorno(estreita) {
  if (entornoEstreito === estreita) return;
  entornoEstreito = estreita;
  if (entorno) { fora.remove(entorno); entorno.geometry.dispose(); }
  const o = new Obra();
  praca(o, estreita);
  entorno = new THREE.Mesh(o.geometria(), materialTraco);
  entorno.frustumCulled = false;
  fora.add(entorno);
}

// ---------- O florão do forro ----------
// O monograma do fim fica pintado num florão no forro do último vão da nave, antes do arco-cruzeiro (na Sé, o
// forro da capela-mor tem mesmo um monograma pintado numa cartela). O desenho vem dos três traçados do svg da
// página (o M da esquerda, o A e o M da direita), pintados numa textura.
const FLORAO = { y: 6.28, z: NAVE.z0 - ((NAVE.z0 - NAVE.z1) / NAVE.vaos) * (NAVE.vaos - 0.5) }; // a face de baixo e o meio do vão
let florao = null, seloFim = null, floraoEstreito = null;
let soltando = false; // a coroa já começou a se soltar (posicionarCamera escreve)
let fimDist = 2.5; // a que distância do florão a câmera para
const SELO_CRESCE = 1.5; // quanto o monograma cresce quando a coroa se solta
const COROA_CRESCE = 4.8; // quanto o florão cresce ao se soltar: com 3,7 a coroa já saiu inteira da tela

function texturaDoSelo(renderer) {
  const partes = ["mono-1", "mono-2", "mono-3"].map((id) => document.getElementById(id)?.getAttribute("d")).filter(Boolean);
  const larg = SELO_TX, alt = Math.round((larg * SELO_VISTA.h) / SELO_VISTA.w);
  const papel = document.createElement("canvas");
  papel.width = larg;
  papel.height = alt;
  const c = papel.getContext("2d");
  c.fillStyle = "#000";
  c.fillRect(0, 0, larg, alt);
  const e = larg / SELO_VISTA.w;
  c.setTransform(e, 0, 0, e, -SELO_VISTA.x * e, -SELO_VISTA.y * e);
  c.fillStyle = "#fff";
  for (const d of partes) c.fill(new Path2D(d));
  comum.uSeloCampo.value = campoDaTinta(papel);
  const tx = new THREE.CanvasTexture(papel);
  tx.colorSpace = THREE.NoColorSpace;
  tx.generateMipmaps = true;
  tx.minFilter = THREE.LinearMipmapLinearFilter;
  tx.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tx;
}

// A tinta do monograma. Para ele se encher sem esmaecer, a tinta corre por dentro do traço: nasce no laço do alto
// do A e segue as hastes até as pontas dos dois M, com a frente nítida. Cada ponto da forma guarda a distância até
// a nascente, andando por dentro da forma, e o shader pinta de cheio o que a frente já alcançou. Onde uma haste
// passa por baixo de outra há um vão de papel: a tinta pula o vão, e o passo no papel custa mais que o de dentro,
// para ela preferir o caminho por dentro. A conta é feita uma vez, numa grade três vezes menor que a textura.
const CAMPO_L = 512; // a largura da grade
// Quanto custa um passo no papel, em passos por dentro da forma. Com 20 a tinta se atrasava em cada cruzamento e
// enchia o M da esquerda inteiro antes do da direita; com 3 ela desce o A e toma os dois M ao mesmo tempo, e
// ainda não salta de uma haste para a vizinha por cima do branco.
const PASSO_PAPEL = 3;
const VX = [1, -1, 0, 0, 1, 1, -1, -1], VY = [0, 0, 1, -1, 1, -1, 1, -1]; // os oito vizinhos: quatro de lado, quatro de quina
let tintaQuantil = null; // para cada fração da área já cheia (0 a 1, em 256 partes), a distância a que a frente chegou

function campoDaTinta(papel, passoPapel = PASSO_PAPEL) {
  const L = CAMPO_L, A = Math.round((L * papel.height) / papel.width), n = L * A;
  const menor = document.createElement("canvas");
  menor.width = L;
  menor.height = A;
  const c = menor.getContext("2d", { willReadFrequently: true });
  c.imageSmoothingQuality = "high";
  c.drawImage(papel, 0, 0, L, A);
  const px = c.getImageData(0, 0, L, A).data;
  const dentro = new Uint8Array(n);
  for (let i = 0; i < n; i++) dentro[i] = px[i * 4] > 90 ? 1 : 0;
  // a nascente: o ponto mais alto da forma, que é o laço do A; na linha dele, o mais perto do meio
  let nascente = -1;
  for (let y = 0; y < A && nascente < 0; y++) {
    for (let x = 0; x < L; x++) {
      if (dentro[y * L + x] && (nascente < 0 || Math.abs(x - L / 2) < Math.abs((nascente % L) - L / 2))) nascente = y * L + x;
    }
  }
  if (nascente < 0) return null;

  // O caminho mais curto até cada ponto (Dijkstra com baldes, porque os custos são inteiros pequenos): 5 para o
  // lado e 7 na quina, vezes PASSO_PAPEL quando o passo pisa no papel
  const dist = new Int32Array(n).fill(2 ** 30);
  const NB = 7 * passoPapel + 1, baldes = Array.from({ length: NB }, () => []);
  dist[nascente] = 0;
  baldes[0].push(nascente);
  for (let d = 0, restam = 1; restam > 0; d++) {
    const balde = baldes[d % NB];
    while (balde.length) {
      const i = balde.pop();
      restam--;
      if (dist[i] !== d) continue; // já tinha sido alcançado por um caminho mais curto
      const x = i % L, y = (i - x) / L;
      for (let k = 0; k < 8; k++) {
        const nx = x + VX[k], ny = y + VY[k];
        if (nx < 0 || ny < 0 || nx >= L || ny >= A) continue;
        const j = ny * L + nx, nd = d + (k < 4 ? 5 : 7) * (dentro[j] ? 1 : passoPapel);
        if (nd < dist[j]) { dist[j] = nd; baldes[nd % NB].push(j); restam++; }
      }
    }
  }

  // A frente anda em área, não em distância: a mesma quantidade de tinta por trecho de scroll, como um líquido que
  // enche um canal. Ela corre nas hastes finas, demora nas largas e não para nos vãos de papel. Para isso fica
  // guardado, para cada fração da área, a que distância a frente está.
  let longe = 1, area = 0;
  for (let i = 0; i < n; i++) if (dentro[i]) { area++; if (dist[i] > longe) longe = dist[i]; }
  const conta = new Uint32Array(longe + 1);
  for (let i = 0; i < n; i++) if (dentro[i]) conta[dist[i]]++;
  const Q = 256;
  tintaQuantil = new Float32Array(Q + 1).fill(1);
  for (let d = 0, soma = 0, k = 0; d <= longe; d++) {
    soma += conta[d];
    while (k <= Q && soma >= (k / Q) * area) tintaQuantil[k++] = d / longe;
  }

  // O campo, de 0 a 1. Em volta da forma o papel repete o ponto mais próximo dela: a leitura da textura, na beira
  // do traço, mistura os vizinhos, e com a distância do papel (que é maior) a beira se encheria atrasada.
  const campo = new Float32Array(n).fill(1);
  let beira = [];
  for (let i = 0; i < n; i++) if (dentro[i]) { campo[i] = dist[i] / longe; beira.push(i); }
  for (let volta = 0; volta < 6 && beira.length; volta++) {
    const nova = [];
    for (const i of beira) {
      const x = i % L, y = (i - x) / L;
      for (let k = 0; k < 8; k++) {
        const nx = x + VX[k], ny = y + VY[k];
        if (nx < 0 || ny < 0 || nx >= L || ny >= A) continue;
        const j = ny * L + nx;
        if (!dentro[j]) { dentro[j] = 2; campo[j] = campo[i]; nova.push(j); }
      }
    }
    beira = nova;
  }

  // Vai para a placa em meia precisão (com 8 bits a frente andaria aos saltos), com a primeira linha embaixo,
  // como a textura do monograma
  const meia = new Uint16Array(n);
  for (let y = 0; y < A; y++) for (let x = 0; x < L; x++) meia[(A - 1 - y) * L + x] = THREE.DataUtils.toHalfFloat(campo[y * L + x]);
  const tx = new THREE.DataTexture(meia, L, A, THREE.RedFormat, THREE.HalfFloatType);
  tx.minFilter = THREE.LinearFilter;
  tx.magFilter = THREE.LinearFilter;
  tx.needsUpdate = true;
  return tx;
}

// Até que distância a frente da tinta chegou quando a fração u da área do monograma já está cheia.
// Antes de começar fica abaixo de 0 (nada cheio) e no fim acima de 1 (tudo cheio): a folga cobre a largura da frente.
function frenteDaTinta(u) {
  if (!tintaQuantil) return u > 0.5 ? 2 : -1;
  const Q = tintaQuantil.length - 1, i = limitar(u) * Q, i0 = Math.min(Q - 1, Math.floor(i));
  return misturar(-0.02, 1.04, misturar(tintaQuantil[i0], tintaQuantil[i0 + 1], i - i0));
}

function elipse(a, b, furoA = 0, furoB = 0) {
  const f = new THREE.Shape();
  f.absellipse(0, 0, a, b, 0, Math.PI * 2, false, 0);
  if (furoA > 0) {
    const furo = new THREE.Path();
    furo.absellipse(0, 0, furoA, furoB, 0, Math.PI * 2, true, 0);
    f.holes.push(furo);
  }
  return f;
}

// O florão: uma placa oval que sai do forro, com uma moldura na beira, uma coroa de flores desenhadas à mão, um
// filete e, no campo, o monograma. Ele é desenhado de frente, no plano xy, e depois deitado no forro com o alto
// para o lado da porta: é assim que se lê de baixo, por quem entrou e levanta os olhos.
// Em tela estreita ele é mais alto que largo e a coroa é mais fina, para caber na largura do celular.
function montarFlorao(estreita) {
  if (floraoEstreito !== estreita) {
    floraoEstreito = estreita;
    for (const m of [florao, seloFim]) if (m) { interior.remove(m); m.geometry.dispose(); }
    const o = new Obra();
    const [a, b] = estreita ? [0.78, 0.9] : [1.04, 0.86];
    const faixa = estreita ? 0.24 : 0.36; // da beira até o campo
    floraoCampo = [a - faixa + 0.01, b - faixa + 0.01]; // por dentro do filete: é a janela por onde a frase do fim aparece
    const placa = new THREE.ExtrudeGeometry(elipse(a, b), { depth: 0.3, bevelEnabled: false, curveSegments: 48 });
    placa.translate(0, 0, -0.3); // o corpo entra no forro; a face fica em z = 0
    o.junta(placa, PLACA);
    const anel = (ea, eb, larg, alt) => o.junta(new THREE.ExtrudeGeometry(elipse(ea, eb, ea - larg, eb - larg), { depth: alt, bevelEnabled: false, curveSegments: 48 }));
    anel(a - 0.02, b - 0.02, 0.05, 0.03); // a moldura da beira
    anel(a - faixa + 0.03, b - faixa + 0.03, 0.02, 0.018); // o filete em volta do campo
    // a coroa de flores, entre a moldura e o filete: cachos e ramos alternados, como na guirlanda do arco
    const ca = a - faixa / 2, cb = b - faixa / 2, alt = faixa * 0.8;
    const N = 2 * Math.round((Math.PI * (ca + cb)) / (alt * 1.9));
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2 + Math.PI / 2;
      const fora = Math.atan2(Math.sin(t) / cb, Math.cos(t) / ca); // para onde aponta o lado de fora da oval
      colar(o, i % 2 ? "ramo" : "cacho", Math.cos(t) * ca, Math.sin(t) * cb, 0.036 + (i % 2) * 0.012, { alt: i % 2 ? alt * 0.85 : alt, pega: "meio", roda: fora - Math.PI / 2, espelha: i % 4 > 1 });
    }
    // A moldura e o monograma são duas peças soltas, cada uma no seu lugar do forro: no fim a moldura cresce até
    // sair pelas beiras da tela, como se a câmera passasse por dentro da coroa, e o monograma cresce menos e fica
    // (ver posicionarCamera). As duas são desenhadas de frente e deitadas no forro.
    const deitar = (obra, ordem) => {
      const g = obra.geometria();
      g.rotateX(Math.PI / 2); // de frente para baixo, com o alto do desenho para o lado da porta
      const m = new THREE.Mesh(g, materialFlorao);
      m.position.set(0, FLORAO.y, FLORAO.z);
      m.frustumCulled = false;
      m.renderOrder = ordem; // os dois são desenhados por último: primeiro o florão, depois o monograma
      interior.add(m);
      return m;
    };
    florao = deitar(o, 10);
    // Ao crescer, a placa do florão passa dos arcos e das paredes da nave, que ficam mais perto da câmera e a
    // cortariam. Enquanto ela se solta, é desenhada por cima de tudo: a profundidade é zerada antes dela.
    florao.onBeforeRender = (r) => { if (soltando) r.clearDepth(); };
    const os = new Obra();
    const chapa = new THREE.PlaneGeometry(SELO_TAM[0], SELO_TAM[1]);
    chapa.translate(0, 0, 0.01);
    os.junta(chapa, SELO);
    seloFim = deitar(os, 11);
  }
  // A câmera para à distância em que o monograma fica com 46% da largura ou 36% da altura da tela, o que for menor
  const naTela = Math.min(0.46 * vw, 0.36 * vh);
  fimDist = (SELO_LARG * vh * q.lente) / (2 * naTela);
  palco.style.setProperty("--selo", `${(naTela * SELO_CRESCE).toFixed(1)}px`); // a largura final do monograma: as duas metades da frase se arrumam em volta dele
  comum.uFimZ.value = FLORAO.z;
  // (não passa muito do florão: os painéis de céu ao lado dele ficariam cortados pela beira da tela)
  const [fa, fb] = vw < vh ? [0.78, 0.9] : [1.04, 0.86];
  // (a vinheta do fim, em volta do florão, tem o tamanho do quadro e não muda mais)
  comum.uFimRaio.value.set(Math.min(((vw / vh) * fimDist) / q.lente, fa + 0.48), Math.min(fimDist / q.lente, fb + 0.9));
}

function montar() {
  const o = new Obra();
  corpoCentral(o);
  torre(o, 0);
  torre(o, 1095 - 207);
  terraco(o);
  const igreja = new THREE.Mesh(o.geometria(), materialTraco);
  igreja.frustumCulled = false;
  igreja.layers.enable(1); // só a igreja entra no mapa de sombra
  fora.add(igreja);

  const od = new Obra();
  ornatos(od);
  const desenhos = new THREE.Mesh(od.geometria(), materialTraco);
  desenhos.frustumCulled = false;
  fora.add(desenhos);
  montarAves();
  montarPomba();

  // As duas folhas da porta do meio, cada uma no seu gonzo
  for (const lado of [-1, 1]) {
    const of = new Obra();
    of.n = lado > 0 ? 3 : 9; // números diferentes, para a linha do meio aparecer com a porta fechada
    folha(of, lado);
    const m = new THREE.Mesh(of.geometria(), materialFolha);
    m.frustumCulled = false;
    m.position.set(lado * PORTA_HW, PISO, Z_FOLHA);
    fora.add(m);
    folhas.push(m);
  }

  const on = new Obra();
  nave(on);
  interior = new THREE.Mesh(on.geometria(), materialNave);
  interior.frustumCulled = false;
  interior.visible = false;
  cena.add(interior);
  montarPetalas();

  // Ponteiros dos dois relógios, na hora de verdade
  for (const d of [0, 1095 - 207]) {
    for (const [comp, larg] of [[0.24, 0.035], [0.34, 0.024]]) {
      const p = new Obra();
      const g = new THREE.BoxGeometry(larg, comp, 0.012);
      g.translate(0, comp / 2 - 0.03, 0);
      p.junta(g, CHEIO, 0.98);
      const m = new THREE.Mesh(p.geometria(), materialTraco);
      m.position.set(X(200 + d), Y(853), Z_TORRE + 0.11);
      m.frustumCulled = false;
      fora.add(m);
      ponteiros.push(m);
    }
  }
  return (o.pos.length + on.pos.length) / 9;
}

// Sombra projetada: um mapa de profundidade visto da luz, feito uma vez (a igreja não se mexe)
let SOMBRA_LADO = 2048;
function fazerSombra(renderer) {
  // A placa compara e mistura os pontos vizinhos do mapa (sampler2DShadow): a beira da sombra sai lisa, sem degraus
  const lado = Math.min(SOMBRA_LADO, renderer.capabilities.maxTextureSize);
  const fundo = new THREE.DepthTexture(lado, lado);
  fundo.compareFunction = THREE.LessEqualCompare;
  fundo.minFilter = THREE.LinearFilter;
  fundo.magFilter = THREE.LinearFilter;
  const alvo = new THREE.WebGLRenderTarget(lado, lado, { depthTexture: fundo });
  const luz = new THREE.OrthographicCamera(-15, 15, 14, -14, 1, 90);
  luz.layers.set(1);
  const centro = new THREE.Vector3(0, 7, -1);
  luz.position.copy(centro).addScaledVector(comum.uLuz.value, 40);
  luz.lookAt(centro);
  luz.updateMatrixWorld();
  luz.updateProjectionMatrix();
  cena.overrideMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  renderer.setRenderTarget(alvo);
  renderer.clear();
  renderer.render(cena, luz);
  renderer.setRenderTarget(null);
  cena.overrideMaterial.dispose();
  cena.overrideMaterial = null;
  comum.uLuzMat.value.multiplyMatrices(luz.projectionMatrix, luz.matrixWorldInverse);
  comum.uSombra.value = alvo.depthTexture;
}

// ---------- Câmera ----------
// A câmera nunca gira: fica de frente e reta, e o enquadramento é uma janela no plano da fachada
// (como a lente descentrada da fotografia de arquitetura). As verticais ficam sempre verticais.
let vw = 1, vh = 1;
let q = null; // janela de repouso: centro e meia altura, em unidades da cena
const LENTE = 4.2; // distância do olho, em meias alturas da janela
const ponteiro = { x: 0, y: 0, ax: 0, ay: 0 };

// ---------- O giroscópio ----------
// No celular não há mouse: quem move o cenário é a inclinação do aparelho, pelo mesmo caminho do ponteiro.
// A tela é uma janela: inclinar a borda direita para longe mostra mais do lado direito da cena (a câmera vai para
// a esquerda), e deitar o aparelho mostra mais do alto. Não existe posição certa de segurar: o repouso é a
// inclinação em que o aparelho está, e ele acompanha a mão devagar. Quem inclina e fica vê a cena responder e
// depois voltar ao meio.
const GIRO = {
  graus: 14, // a inclinação que leva o cenário até o fim do curso, como o mouse na beira da tela
  volta: 5, // em quantos segundos o repouso alcança a inclinação em que o aparelho ficou
  sentido: -1, // -1: a tela é uma janela; 1: o cenário acompanha a inclinação, como uma bolha de nível
};
const giro = { vivo: false, x: 0, y: 0, x0: 0, y0: 0, de: null, antes: 0, mouse: -1e9 };

// Uma leitura do sensor (gamma: tombo para os lados; beta: tombo para a frente e para trás, em graus)
function inclinou(ev) {
  if (ev.gamma == null || ev.beta == null) return;
  // com a tela deitada os dois eixos trocam de lugar
  const tela = (((screen.orientation?.angle ?? window.orientation ?? 0) % 360) + 360) % 360;
  let x = ev.gamma, y = ev.beta;
  if (tela === 90) [x, y] = [ev.beta, -ev.gamma];
  else if (tela === 270) [x, y] = [-ev.beta, ev.gamma];
  else if (tela === 180) [x, y] = [-ev.gamma, -ev.beta];
  // a primeira leitura, e um salto do sensor (com o aparelho em pé os ângulos dão a volta), viram o novo repouso
  if (giro.de === null || Math.abs(x - giro.x) > 35 || Math.abs(y - giro.y) > 35) {
    giro.x0 = x;
    giro.y0 = y;
    if (giro.de === null) giro.de = { x, y };
  }
  giro.x = x;
  giro.y = y;
  // só vale depois que o aparelho se mexeu de verdade: um notebook com sensor, parado na mesa, fica com o mouse
  if (!giro.vivo && Math.hypot(x - giro.de.x, y - giro.de.y) > 0.4) giro.vivo = true;
}

// A cada quadro: o repouso anda para a inclinação de agora, e a diferença vai para o ponteiro
function seguirGiro() {
  const agora = performance.now();
  const dt = Math.min(0.25, Math.max(0, (agora - giro.antes) / 1000));
  giro.antes = agora;
  if (!giro.vivo) return;
  const c = 1 - Math.exp(-dt / GIRO.volta);
  giro.x0 += (giro.x - giro.x0) * c;
  giro.y0 += (giro.y - giro.y0) * c;
  if (agora - giro.mouse < 2000) return; // quem acabou de mexer o mouse manda
  ponteiro.x = limitar((GIRO.sentido * (giro.x - giro.x0)) / GIRO.graus, -1, 1);
  ponteiro.y = limitar((GIRO.sentido * (giro.y - giro.y0)) / GIRO.graus, -1, 1);
}

function ligarGiro() {
  if (typeof DeviceOrientationEvent === "undefined") return;
  const ouvir = () => {
    removeEventListener("deviceorientation", inclinou);
    addEventListener("deviceorientation", inclinou, { passive: true });
  };
  ouvir(); // onde o sistema entrega a inclinação sem perguntar (Android), é só ouvir
  if (typeof DeviceOrientationEvent.requestPermission !== "function") return;
  // iPhone e iPad: o sistema só entrega a inclinação depois de um toque do visitante e de um sim dele.
  // Se até o primeiro toque de verdade não chegou leitura nenhuma, o pedido sai nele; um arrasto de scroll não
  // vale como toque e fica para o próximo.
  const largar = () => {
    removeEventListener("touchend", pedir);
    removeEventListener("click", pedir);
  };
  const pedir = () => {
    if (giro.de !== null) return largar(); // as leituras já chegam: não há o que pedir
    DeviceOrientationEvent.requestPermission().then((resposta) => {
      largar();
      if (resposta === "granted") ouvir();
    }).catch(() => {});
  };
  addEventListener("touchend", pedir, { passive: true });
  addEventListener("click", pedir);
}

function enquadrar() {
  const a = vw / vh;
  const hh = Math.max(7.0 / a, 10.3);
  const pe = a < 1 ? 0.2 : 0.1; // altura do pé da igreja na tela, a partir de baixo
  const baixo = -pe * 2 * hh;
  // lente e sobe valem lá dentro: a lente em meias alturas do quadro (menor = mais aberta), e o quanto o quadro olha para cima
  q = { cy: baixo + hh, hh, meio: a < 1 ? 3.4 : 3.1, fim: a < 1 ? 3.3 : 2.3, lente: a < 1 ? 1.25 : 2.0, sobe: a < 1 ? 0.2 : 0.1 };
  texto.style.setProperty("--ceu", `${(((baixo + 2 * hh - ALTO) / (2 * hh)) * 100).toFixed(2)}%`);
  // O corpo das partes da frase na nave acompanha o tamanho do branco do fundo, que cresce com a altura da tela e
  // com a lente. Como só há uma parte de cada vez na tela, ela é grande: 0,103 e 0,0875 dão corpo 56 em 402 x 874
  // e 70 em 1250 x 800 (a parte mais larga toma metade da largura do celular).
  corpoPx = Math.max(28, (a < 1 ? 0.103 : 0.0875) * vh * q.lente * 0.5);
  palco.style.setProperty("--corpo", `${corpoPx.toFixed(1)}px`);
}

// Os tempos do scroll, em fração do percurso (0 a 1)
const T = {
  fachada: 0.307, // até aqui a câmera sobe aos capitéis e desce até as portas
  abre: [0.256, 0.375], // as folhas da porta do meio giram para dentro
  anda: [0.3, 0.975], // a câmera anda até a porta, passa por ela e segue pelo tapete até debaixo do florão
  solta: [0.92, 0.98], // a coroa do florão gira e cresce até sair da tela (em 0,964 já saiu), e o monograma cresce
  enche: [0.962, 0.998], // já sozinho no papel, o monograma se enche: a tinta corre por dentro do traço
};
// O fim é contado pelo caminho, não pelo scroll: o que acontece depende de onde a câmera está na nave.
const Z_FIM = FLORAO.z; // onde a câmera para: debaixo do florão do último vão
const Z_VIRA = -9.5; // daqui em diante ela levanta o olhar para o florão e sobe até ele

function posicionarCamera(p, t) {
  // Dois tempos na fachada: a câmera chega perto na altura dos capitéis e dos frontões das janelas (o ornamento
  // desenhado à mão) e depois desce até as portas. Os dois se sobrepõem, para não haver parada.
  const e = limitar(p / T.fachada);
  const sobe = suave(e / 0.5), desce = suave((e - 0.42) / 0.58);
  const hh = Math.exp(misturar(misturar(Math.log(q.hh), Math.log(q.meio), sobe), Math.log(q.fim), desce));
  const cy = misturar(misturar(q.cy, 5.35, sobe), 1.25, desce);
  const D = hh * LENTE;

  // Terceiro tempo: a câmera anda. Sai de onde estava, chega à porta, passa por ela e segue pelo tapete até o último vão.
  // No caminho até a porta a lente abre (lá dentro o teleobjetiva achataria a nave), o olho desce para a altura
  // de uma pessoa e o quadro sobe um pouco, para caber o forro. Continua sem girar: as verticais ficam verticais.
  const zFora = Z_CORPO + D;
  // (a chegada freia, mas pouco: com o freio inteiro o fim, que é só o monograma no papel, ficava comprido demais)
  const ida = Math.pow(limitar((p - T.anda[0]) / (T.anda[1] - T.anda[0])), 0.7);
  const anda = misturar(suave(ida), ida, 0.4);
  const ez = misturar(zFora, Z_FIM, anda);
  caminhoZ = ez;
  const k = suave((zFora - ez) / (zFora - (Z_CORPO - 0.45))); // 0 lá fora, 1 da porta para dentro
  const th = 1 / Math.exp(misturar(Math.log(LENTE), Math.log(q.lente), k)); // meia altura do quadro, em tangente
  const tw = th * (vw / vh);
  const sc = misturar((cy - 1.7) / D, q.sobe, k); // para onde o quadro olha, em tangente
  const olho = misturar(1.7, PISO + 1.0, k);
  const foco = misturar(D, 5, k); // a que distância o balanço da câmera deixa a imagem parada
  const perto = misturar(0.5, 0.12, k);

  seguirGiro();
  ponteiro.ax += (ponteiro.x - ponteiro.ax) * 0.06;
  ponteiro.ay += (ponteiro.y - ponteiro.ay) * 0.06;
  // O fim: do meio da nave em diante a câmera levanta o olhar para o florão do forro, onde está o monograma, e
  // sobe até ele. É a única vez em que ela gira. No fim está debaixo dele, olhando reto para cima.
  const g = limitar((Z_VIRA - ez) / (Z_VIRA - Z_FIM));
  const mira = suave(g / 0.7); // quanto do olhar já é do florão
  comum.uFim.value = suave((g - 0.45) / 0.55);
  // Na chegada, o ornamento larga o monograma sem esmaecer (pedido de André): a moldura e a coroa giram um pouco e
  // crescem até sair pelas beiras da tela, com a tinta inteira, como se a câmera passasse por dentro da coroa. A
  // placa cresce junto e vira a página: papel limpo. O monograma cresce menos e fica sozinho nele.
  const solta = suave((p - T.solta[0]) / (T.solta[1] - T.solta[0]));
  soltando = solta > 0;
  if (florao) {
    const abre = Math.pow(COROA_CRESCE, solta), cresce = misturar(1, SELO_CRESCE, solta);
    florao.scale.set(abre, 1, abre);
    florao.rotation.y = 0.35 * solta;
    seloFim.scale.set(cresce, 1, cresce);
  }
  // Depois a tinta corre por dentro do traço do monograma, em área cheia por trecho de scroll (ver campoDaTinta)
  comum.uSeloCheio.value = frenteDaTinta((p - T.enche[0]) / (T.enche[1] - T.enche[0]));
  // (o passo dos riscos do monograma: no tamanho final, um pouco mais aberto que o da hachura da cena)
  const pontosPorUnidade = (Math.min(0.46 * vw, 0.36 * vh) * (final.uTela.value.x / Math.max(vw, 1)) * SELO_CRESCE) / SELO_LARG;
  comum.uSeloPasso.value = (comum.uPasso.value * 1.15) / Math.max(pontosPorUnidade, 1);
  const altura = misturar(olho, FLORAO.y - fimDist, suave((g - 0.15) / 0.85));
  const vai = (parado ? 0 : 1) * foco * (1 - 0.5 * k) * (1 - 0.8 * g);
  // (lá dentro o ponteiro pesa mais: os bancos e as flores de perto correm, e o fundo da nave fica parado)
  const ex = (Math.sin(t * 0.21) * 0.35 + ponteiro.ax * 0.9 * (1 + 1.6 * k)) * 0.03 * vai;
  const dy = (Math.sin(t * 0.16 + 1) * 0.2 - ponteiro.ay * 0.5 * (1 + 1.2 * k)) * 0.012 * vai;

  const ey = altura + dy;
  const giro = mira * Math.atan2(FLORAO.y - ey, Math.max(ez - FLORAO.z, 0));
  const olha = sc * (1 - mira); // o quadro deixa de olhar para cima por conta própria: quem olha agora é a câmera
  // Onde cai na tela o fundo da nave à altura do olho (0 no alto, 1 embaixo), sem o balanço: a estrofe da frase
  // fica presa nesse ponto. Quando a câmera levanta o olhar, ele desce e sai por baixo, e a estrofe vai junto.
  {
    const giro0 = mira * Math.atan2(FLORAO.y - altura, Math.max(ez - FLORAO.z, 0));
    const frente = ez - Z_FUNDO, acima = PISO + 1.0 - altura, cg = Math.cos(giro0), sg = Math.sin(giro0);
    const fr = frente * cg + acima * sg;
    fundoNaTela = fr > 0.05 ? Math.min(9, (olha + th - (acima * cg - frente * sg) / fr) / (2 * th)) : 9;
  }
  camera.position.set(ex, ey, ez);
  camera.rotation.set(giro, 0, 0);
  camera.updateMatrixWorld();
  const dx = ex / foco, dv = dy / foco;
  camera.projectionMatrix.makePerspective((-tw - dx) * perto, (tw - dx) * perto, (olha + th - dv) * perto, (olha - th - dv) * perto, perto, LONGE);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

// ---------- A frase do caminho ----------
// O texto vem da página: um <span> por parte dentro de .frase-texto (o leitor de tela lê esse texto corrido, uma
// vez). Daqui saem duas montagens, só para os olhos, como André pediu: uma parte de cada vez, com ritmo, e a
// frase inteira só no fim.
//   Na nave, cada parte nasce como um ponto no fundo, presa ao fim do tapete, e cresce com o passo da câmera até
//   o tamanho de leitura. Chega gravada, só contorno e hachura, como o monograma antes da tinta; parada, a tinta
//   corre por ela da esquerda para a direita, com a frente nítida. Depois desce pelo eixo do tapete, crescendo,
//   e passa por baixo da câmera, enquanto a parte seguinte nasce lá no fundo. A última fica mais: desce com o
//   altar quando a câmera levanta o olhar.
//   O movimento é macio (André achou a primeira versão abrupta): a frase não acompanha a câmera ponto a ponto,
//   mas com um atraso amortecido, de modo que um gesto rápido no scroll não faz a palavra saltar; ela chega
//   devagar, crescendo por igual, e sai devagar, sem inchar.
//   No fim, as duas metades da frase (a parte com data-vira abre a de baixo) e a origem dela ficam em volta do
//   monograma, presas ao florão e escondidas atrás da coroa. Quando a coroa cresce e sai, a beira de dentro dela
//   vai descobrindo a frase, e a tinta que enche o monograma enche as letras, uma linha depois da outra.
// Nada esmaece e nada sobe de trás de máscara (pedidos de André): o que aparece vem do fundo, é descoberto pela
// coroa ou é coberto pela tinta. Na nave a conta é pelo lugar da câmera, não pelo scroll: a câmera do computador
// chega mais cedo que a do celular.
const versos = { partes: [], janela: null, miolo: null, fim: [], fonte: null };
const FRASE = {
  de: 3.4, // o z da câmera quando a primeira parte nasce (a porta fica em 0.3)
  chega: 1.5, // quanto a câmera anda enquanto a parte vem do fundo
  fica: 1.9, // e enquanto ela fica no lugar (na primeira metade a tinta corre por ela)
  sai: 1.9, // e enquanto ela desce pelo tapete e passa por baixo da câmera
  ultima: 2.2, // a última parte fica este tanto a mais, com o altar aparecendo atrás
  atraso: 0.34, // em quantos segundos a frase alcança a câmera
};
const Z_FUNDO = -21.5; // o fundo da capela-mor: o ponto da cena em que as partes da frase ficam presas
let caminhoZ = 99; // o z da câmera no caminho, sem o balanço (posicionarCamera escreve)
let fundoNaTela = 0.6; // onde cai na tela o fundo da nave à altura do olho, de 0 (alto) a 1 (baixo) (posicionarCamera escreve)
let corpoPx = 56; // o corpo das partes da frase na nave, em pontos (enquadrar escreve)
let floraoCampo = [0.55, 0.67]; // os meios eixos do campo do florão, por dentro do filete (montarFlorao escreve)
let fraseNaTela = 0; // quanto da parte da frase está à vista: as pétalas saem de trás dela
const caixaFrase = { x: 0, y: 0, a: 0, b: 0 }; // o meio e as meias medidas dessa parte na tela, em pontos
// O que a frase acompanha, com atraso: o z da câmera (na nave) e a tinta do fim. Cada um guarda o valor e a velocidade.
const segueZ = { v: null, vel: 0 }, segueTinta = { v: null, vel: 0 };
let fraseAntes = 0;
// Leva o valor para o alvo como uma mola sem balanço: sai do repouso, alcança e para, sem tranco nem volta
function amortecer(segue, alvo, tempo, dt) {
  if (segue.v === null || dt <= 0) { segue.v = alvo; segue.vel = 0; return alvo; }
  const w = 2 / tempo, x = w * dt, cai = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const falta = segue.v - alvo, passo = (segue.vel + w * falta) * dt;
  segue.vel = (segue.vel - w * passo) * cai;
  segue.v = alvo + (falta + passo) * cai;
  return segue.v;
}

function montarFrase() {
  if (!frase) return;
  const linhas = [...frase.querySelectorAll(".frase-texto > span")].map((l) => l.textContent.trim()).filter(Boolean);
  if (!linhas.length) return;
  const criar = (tag, classe, pai, texto) => {
    const el = document.createElement(tag);
    el.className = classe;
    if (texto) el.textContent = texto;
    pai.appendChild(el);
    return el;
  };
  let vira = [...frase.querySelectorAll(".frase-texto > span")].findIndex((l) => l.hasAttribute("data-vira"));
  if (vira < 0) vira = Math.ceil(linhas.length / 2);
  for (const texto of linhas) {
    const el = criar("span", "parte gravada", frase, texto);
    el.setAttribute("aria-hidden", "true");
    versos.partes.push({ el, larg: 0 });
  }
  versos.janela = criar("div", "fim-janela", frase);
  versos.miolo = criar("div", "fim-miolo", versos.janela);
  for (const [classe, texto] of [["fim fim-acima", linhas.slice(0, vira).join(" ")], ["fim fim-abaixo", linhas.slice(vira).join(" ")]]) {
    const linha = criar("div", classe, versos.miolo);
    linha.setAttribute("aria-hidden", "true");
    versos.fim.push(criar("span", "gravada", linha, texto));
  }
  versos.fonte = frase.querySelector(".frase-fonte");
  if (versos.fonte) {
    versos.miolo.appendChild(versos.fonte);
    versos.fonte.style.visibility = "inherit"; // aparece com a janela do fim, descoberta pela coroa
  }
}

// A largura de cada parte no tamanho de leitura (não muda com o que o js move)
function medirFrase() {
  for (const parte of versos.partes) parte.larg = parte.el.offsetWidth;
}

// Cada valor só é escrito na página quando muda
const escrito = new Map();
function escrever(el, chave, valor) {
  let dele = escrito.get(el);
  if (!dele) escrito.set(el, (dele = {}));
  if (dele[chave] === valor) return;
  dele[chave] = valor;
  if (chave.startsWith("--")) el.style.setProperty(chave, valor);
  else el.style[chave] = valor;
}
const pontoDoFlorao = new THREE.Vector3();
function floraoNaTela(x, z) {
  pontoDoFlorao.set(x, 0, z);
  florao.localToWorld(pontoDoFlorao).project(camera);
  return [(pontoDoFlorao.x + 1) * 0.5 * vw, (1 - pontoDoFlorao.y) * 0.5 * vh];
}

function moverFrase(p) {
  if (!versos.partes.length) return;
  // Na nave: uma parte de cada vez. A seguinte nasce quando a anterior começa a sair.
  const n = versos.partes.length, chao = fundoNaTela * vh;
  // (quem pediu menos movimento, e as capturas de um quadro fixo, veem a frase onde a câmera está, sem atraso)
  const agora = performance.now(), direto = parado || fixoP !== null;
  const dt = direto ? 0 : Math.min(0.1, (agora - fraseAntes) / 1000);
  fraseAntes = agora;
  const zFrase = amortecer(segueZ, caminhoZ, FRASE.atraso, dt);
  let peso = 0;
  versos.partes.forEach((parte, k) => {
    const d = FRASE.de - k * (FRASE.chega + FRASE.fica) - zFrase; // quanto a câmera já andou desde que a parte nasceu
    const fica = FRASE.fica + (k === n - 1 ? FRASE.ultima : 0);
    const a = limitar(d / FRASE.chega), h = limitar((d - FRASE.chega) / fica), l = limitar((d - FRASE.chega - fica) / FRASE.sai);
    // (a parte nova nasce atrás da que está saindo: só aparece quando a outra já desceu e a descobre)
    let s = 1, y = chao, tinta = 108, vista = d > (k > 0 ? 0.2 * FRASE.sai : 0) && l < 1;
    if (parado) {
      vista = a >= 0.5 && l < 0.5; // quem pediu menos movimento vê a parte pronta no lugar, ou não vê
    } else {
      // nasce como um ponto e cresce por igual até o tamanho de leitura, saindo do repouso e assentando sem tranco
      // (fica pequena por mais tempo: a anterior ainda está saindo, e as duas não podem se encostar)
      const chega = misturar(0.045, 1, Math.pow(suave(a), 1.5));
      // ao sair ela cresce só mais um pouco, e nunca além da largura da tela: a palavra desce inteira
      const cresce = Math.min(1.5, Math.max(1.1, (0.94 * vw) / Math.max(1, parte.larg * (1 + 0.12 * h))));
      s = chega * (1 + 0.12 * h) * (1 + (cresce - 1) * suave(l));
      y += Math.pow(l, 1.5) * (Math.max(0, vh - chao) + 1.2 * corpoPx * s);
      tinta = -8 + 116 * limitar((d - FRASE.chega) / (FRASE.fica * 0.5));
    }
    vista = vista && y - corpoPx * s < vh + 8;
    escrever(parte.el, "visibility", vista ? "visible" : "hidden");
    if (!vista) return;
    escrever(parte.el, "--s", s.toFixed(4));
    escrever(parte.el, "--t", tinta.toFixed(2));
    escrever(parte.el, "transform", `translate(${(vw / 2).toFixed(1)}px, ${y.toFixed(1)}px) scale(${s.toFixed(4)}) translate(-50%, -70%)`);
    // a parte que mais pesa na tela, para as pétalas saírem de trás dela
    const pesa = a * (1 - l);
    if (pesa > peso) {
      peso = pesa;
      caixaFrase.x = vw / 2;
      caixaFrase.a = (parte.larg * s) / 2;
      caixaFrase.b = 0.62 * corpoPx * s;
      caixaFrase.y = y - 0.42 * corpoPx * s;
    }
  });
  fraseNaTela = suave(peso * 1.5);

  // No fim: a frase inteira, presa ao florão, aparece dentro da coroa que se abre
  const solta = (p - T.solta[0]) / (T.solta[1] - T.solta[0]);
  const aberta = florao && (parado ? solta > 0.5 : solta > 0);
  escrever(versos.janela, "visibility", aberta ? "visible" : "hidden");
  if (aberta) {
    florao.updateMatrixWorld();
    const [cx, cy] = floraoNaTela(0, 0), [ax, ay] = floraoNaTela(floraoCampo[0], 0), [bx, by] = floraoNaTela(0, floraoCampo[1]);
    const rx = Math.hypot(ax - cx, ay - cy), ry = Math.hypot(bx - cx, by - cy);
    let giro = Math.atan2(ay - cy, ax - cx);
    if (giro > Math.PI / 2) giro -= Math.PI;
    if (giro < -Math.PI / 2) giro += Math.PI;
    const meio = `${cx.toFixed(1)}px ${cy.toFixed(1)}px`;
    const inteira = parado || Math.min(rx, ry) > 1.3 * Math.hypot(vw, vh); // a coroa já saiu da tela
    escrever(versos.janela, "clipPath", inteira ? "none" : `ellipse(${rx.toFixed(1)}px ${ry.toFixed(1)}px at ${meio})`);
    escrever(versos.janela, "transformOrigin", meio);
    escrever(versos.janela, "transform", inteira ? "none" : `rotate(${giro.toFixed(4)}rad)`);
    escrever(versos.miolo, "transformOrigin", meio);
    escrever(versos.miolo, "transform", `rotate(${inteira ? 0 : (-giro).toFixed(4)}rad) translate(${(cx - vw / 2).toFixed(1)}px, ${(cy - vh / 2).toFixed(1)}px)`);
    // a tinta do monograma enche também as letras: a linha de cima na primeira metade, a de baixo na segunda
    const u = amortecer(segueTinta, (p - T.enche[0]) / (T.enche[1] - T.enche[0]), FRASE.atraso * 1.4, dt);
    versos.fim.forEach((el, i) => {
      const v = limitar((u - (i ? 0.5 : 0.02)) / 0.45);
      escrever(el, "--t", (parado ? (u > 0.5 ? 108 : -8) : -8 + 116 * v).toFixed(2));
    });
  } else segueTinta.v = null; // da próxima vez a tinta parte de onde o scroll estiver
}

// ---------- Quadro a quadro ----------
let renderer = null;
let alvo = null;
let p = 0, destino = 0;
let atlasPronto = null;
let fixoP = null, fixoT = null; // para conferir quadros à mão
let t0 = 0;
let visivel = true;
let triangulos = 0;
let passo = 3.1; // distância entre riscos, em pixels de tela
let dprFixo = null; // para conferir como fica numa tela de celular (2x)
let amostrasFixas = null; // para comparar o antisserrilhado

let pAntes = null, quandoAntes = 0, passa = 0, passaFixa = null; // o passo da câmera (ver desenhar)
let seloCheio = null, apertoEm = null; // a apertada do selo (ver desenhar)

let entrou = [-1, -1];
let saiVisto = -1, dicaVista = "";
function entrar(nomes, lugar) {
  if (nomes !== entrou[0]) texto.style.setProperty("--entra-nomes", nomes.toFixed(3));
  if (lugar !== entrou[1]) texto.style.setProperty("--entra-lugar", lugar.toFixed(3));
  entrou = [nomes, lugar];
}

function lerScroll() {
  const r = abertura.getBoundingClientRect();
  const curso = r.height - innerHeight;
  destino = curso > 0 ? limitar(-r.top / curso) : 0;
}

function desenhar(agora) {
  if (vw < 2 || vh < 2) return; // janela minimizada
  // A sombra espera o primeiro quadro com tamanho: feita com a janela minimizada, saía vazia
  if (!comum.uSombra.value) fazerSombra(renderer);
  const t = fixoT ?? (agora - t0) / 1000;
  if (fixoP !== null) p = fixoP;
  else p += (destino - p) * (parado ? 1 : 0.12);

  posicionarCamera(p, t);
  moverFrase(p);
  comum.uTempo.value = parado ? 0 : t;

  // Quanto a câmera está andando agora, de 0 (parada) a 1 (passo cheio): as chamas dos lustres e as fitas dos
  // buquês respondem a isso e sossegam quando o visitante para
  const dt = limitar((agora - quandoAntes) / 1000, 0.001, 0.1);
  if (pAntes !== null && fixoP === null) passa += (limitar(Math.abs(p - pAntes) / dt / 0.06) - passa) * (1 - Math.exp(-dt / 0.3));
  pAntes = p;
  quandoAntes = agora;
  comum.uPassa.value = parado ? 0 : passaFixa ?? passa;
  comum.uOlhoZ.value = caminhoZ;

  // A apertada do selo: quando a tinta acaba de encher o monograma, ele afunda um pouco no papel, como o sinete na
  // cera, e volta. Uma vez só: para ver de novo é preciso voltar o scroll.
  if (seloFim && !parado) {
    const cheio = p >= T.enche[1];
    if (cheio && seloCheio === false) apertoEm = t;
    if (!cheio) apertoEm = null;
    seloCheio = cheio;
    const x = apertoEm === null ? -1 : t - apertoEm;
    if (x >= 0 && x < 1) {
      const k = 1 - 0.05 * Math.exp(-6 * x) * Math.sin(22 * x);
      seloFim.scale.x *= k;
      seloFim.scale.z *= k;
    }
  }

  // A porta do meio, a nave e a luz do fim
  const tempo = ([a, b]) => suave((p - a) / (b - a));
  const abre = tempo(T.abre);
  folhas[0].rotation.y = abre * 1.48;
  folhas[1].rotation.y = -abre * 1.48;
  interior.visible = abre > 0.001;
  fora.visible = camera.position.z > -0.5;
  moverAves(t);
  moverPomba(t, abre);
  moverPetalas(t);

  // Relógios na hora local, com os ponteiros andando de verdade
  const h = new Date();
  const min = h.getMinutes() + h.getSeconds() / 60;
  for (let i = 0; i < ponteiros.length; i += 2) {
    ponteiros[i].rotation.z = -(((h.getHours() % 12) + min / 60) / 12) * Math.PI * 2;
    ponteiros[i + 1].rotation.z = -(min / 60) * Math.PI * 2;
  }

  final.uRevela.value = parado ? 1.2 : suave((t - 0.25) / 2.6) * 1.2;
  final.uFerve.value = parado || !FERVE ? 0 : Math.floor(t * 6);

  entrar(suave((t - 1.3) / 1.1), suave((t - 1.6) / 1.1));
  const sai = +suave(p / 0.034).toFixed(3);
  if (sai !== saiVisto) {
    saiVisto = sai;
    texto.style.opacity = 1 - sai;
    texto.style.transform = `translate3d(0, ${(-sai * 2).toFixed(2)}rem, 0)`;
  }
  let emQual = 0;
  for (let i = 0; i < paradas.length; i++) if (p >= +paradas[i].dataset.p - 0.03) emQual = i;
  if (emQual !== paradaAtual) {
    paradaAtual = emQual;
    paradas.forEach((b, i) => { if (i === emQual) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current"); });
  }
  const mostra = +suave((t - 2.6) / 0.9).toFixed(2);
  if (trilho && mostra !== trilhoVisto) { trilhoVisto = mostra; trilho.style.opacity = mostra; }
  const dicaAgora = (suave((t - 3) / 0.8) * (1 - suave(p / 0.0136))).toFixed(3);
  if (dicaAgora !== dicaVista) { dicaVista = dicaAgora; dica.style.opacity = dicaAgora; }

  renderer.setRenderTarget(alvo);
  renderer.clear();
  renderer.render(cena, camera);
  renderer.setRenderTarget(null);
  renderer.render(cenaFinal, cameraFinal);
}

// Com #fps no fim do endereço aparece um medidor no canto: quadros por segundo, o pior intervalo do último meio
// segundo e o tamanho do desenho. Serve para conferir num celular de verdade.
const medidor = location.hash === "#fps" ? palco.appendChild(document.createElement("output")) : null;
if (medidor) medidor.style.cssText = "position:absolute;left:max(0.5rem,env(safe-area-inset-left));top:max(0.5rem,env(safe-area-inset-top));padding:0.2rem 0.45rem;font:600 12px/1.3 ui-monospace,Menlo,Consolas,monospace;color:#082882;background:#ffefd7cc;border:1px solid #28488c66;border-radius:4px;pointer-events:none;white-space:pre";
let medeDesde = 0, medeQuadros = 0, medeAntes = 0, medePior = 0;
function medir(agora) {
  if (medeAntes) medePior = Math.max(medePior, agora - medeAntes);
  medeAntes = agora;
  medeQuadros += 1;
  if (agora - medeDesde < 500) return;
  const tam = final.uTela.value;
  medidor.textContent = `${Math.round((medeQuadros * 1000) / (agora - medeDesde))} qps  pior ${medePior.toFixed(0)} ms\n${tam.x}×${tam.y}  aa${alvo.samples}`;
  medeDesde = agora; medeQuadros = 0; medePior = 0;
}

function quadro(agora) {
  requestAnimationFrame(quadro);
  if (!visivel || fixoP !== null) return;
  desenhar(agora);
  if (medidor) medir(agora);
}

function redimensionar() {
  vw = palco.clientWidth;
  vh = palco.clientHeight;
  const dpr = dprFixo ?? Math.min(devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(vw, vh, false);
  const tam = renderer.getDrawingBufferSize(final.uTela.value);
  // Em tela densa (2 pontos por pixel ou mais) duas amostras de antisserrilhado bastam: ampliado 3 vezes, o desenho
  // não se distingue do de quatro, e o quadro custa bem menos. Em tela comum ficam as quatro.
  const amostras = amostrasFixas ?? (dpr >= 2 ? 2 : 4);
  if (alvo.samples !== amostras) { alvo.samples = amostras; alvo.dispose(); }
  alvo.setSize(Math.max(1, tam.x), Math.max(1, tam.y));
  // Em tela estreita a igreja fica menor, e a pena afina junto para o desenho não pesar
  const pena = dpr * limitar(vw / 900, 0.72, 1);
  final.uDpr.value = pena;
  pintarPapel(Math.max(1, tam.x), Math.max(1, tam.y));
  comum.uPasso.value = passo * pena;
  if (vw > 1 && vh > 1) montarEntorno(vw < vh);
  enquadrar();
  if (vw > 1 && vh > 1) montarFlorao(vw < vh);
  medirFrase();
  lerScroll();
}

function iniciar() {
  renderer = new THREE.WebGLRenderer({ canvas: tela, antialias: false, alpha: false });
  renderer.setClearColor(0x000000, 0);
  alvo = new THREE.WebGLRenderTarget(4, 4, {
    count: 3,
    type: THREE.HalfFloatType,
    samples: 4,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  // só o primeiro alvo (normal e profundidade) precisa de meia precisão; os outros dois cabem em 8 bits
  alvo.textures[1].type = THREE.UnsignedByteType;
  alvo.textures[2].type = THREE.UnsignedByteType;
  final.t0.value = alvo.textures[0];
  final.t1.value = alvo.textures[1];
  final.t2.value = alvo.textures[2];

  // Enquanto o atlas não chega, as peças desenhadas ficam em branco
  const vazio = new THREE.DataTexture(new Uint8Array([0, 255, 0, 255]), 1, 1);
  vazio.needsUpdate = true;
  comum.uOrnato.value = vazio;
  atlasPronto = new THREE.TextureLoader().loadAsync("img/ornato.png").then((tx) => {
    tx.colorSpace = THREE.NoColorSpace;
    tx.generateMipmaps = true;
    tx.minFilter = THREE.LinearMipmapLinearFilter;
    tx.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    comum.uOrnato.value = tx;
    return true;
  }).catch(() => false);

  comum.uSelo.value = texturaDoSelo(renderer);
  triangulos = montar();
  montarFrase();
  redimensionar();
  document.fonts?.ready.then(medirFrase); // com a letra de verdade a estrofe muda de largura

  addEventListener("resize", redimensionar);
  addEventListener("scroll", lerScroll, { passive: true });
  if (!parado) {
    addEventListener("pointermove", (ev) => {
      if (ev.pointerType === "mouse") giro.mouse = performance.now();
      else if (giro.vivo) return; // com o giroscópio ligado, o dedo só rola a página
      ponteiro.x = (ev.clientX / innerWidth) * 2 - 1;
      ponteiro.y = (ev.clientY / innerHeight) * 2 - 1;
    }, { passive: true });
    ligarGiro();
  }
  new IntersectionObserver(([e]) => { visivel = e.isIntersecting; }).observe(palco);

  t0 = performance.now();
  requestAnimationFrame(quadro);
}

try {
  iniciar();
} catch (erro) {
  console.error(erro);
  entrar(1, 1);
  palco.querySelector(".aviso").hidden = false;
}

// Para conferir à mão: __traco.quadro(0.5, 6) fixa o scroll em 50% e o relógio da cena em 6 s e desenha na hora
// (funciona mesmo com a aba em segundo plano); __traco.solta() devolve ao normal.
window.__traco = {
  pronto: () => atlasPronto,
  quadro(pp, tt) { fixoP = pp; fixoT = tt ?? 10; desenhar(performance.now()); },
  solta() { fixoP = null; fixoT = null; passaFixa = null; voo.fixo = null; },
  // __traco.passa(1) faz de conta que a câmera anda a passo cheio (chamas e fitas); __traco.pomba(0.4) põe a pomba
  // a 0,4 s do voo; com null os dois voltam ao normal
  passa(v) { passaFixa = v; },
  // o que o giroscópio está mandando: se já vale, a leitura, o repouso e o ponteiro
  giro: () => ({ vivo: giro.vivo, x: +giro.x.toFixed(2), y: +giro.y.toFixed(2), x0: +giro.x0.toFixed(2), y0: +giro.y0.toFixed(2), px: +ponteiro.x.toFixed(3), py: +ponteiro.y.toFixed(3), ax: +ponteiro.ax.toFixed(3), ay: +ponteiro.ay.toFixed(3) }),
  pomba(tau) { voo.fixo = { tau }; }, // um instante do voo de saída
  pulo(de, para, u) { voo.fixo = { de, para, u }; }, // um instante do pulo entre dois pousos
  ave() { return { estado: voo.estado, em: voo.em, para: voo.para, u: +voo.u.toFixed(2), tau: +voo.tau.toFixed(2), espera: +voo.espera.toFixed(2), lado: voo.lado, rumo: voo.rumo, x: +pomba.position.x.toFixed(2) }; },
  dpr(v) { dprFixo = v; redimensionar(); },
  amostras(v) { amostrasFixas = v; redimensionar(); },
  // Desenha o quadro e manda o canvas para capturas/nome.png (ver ferramentas/servidor.mjs)
  async captura(nome, pp, tt) {
    this.quadro(pp, tt);
    const corpo = await (await fetch(tela.toDataURL("image/png"))).blob();
    return (await fetch(`/__captura/${nome}.png`, { method: "POST", body: corpo })).status;
  },
  // Quanto custa um quadro, em ms: desenha n quadros seguidos em pp e espera a placa terminar cada um
  tempo(pp, n = 40) {
    const gl = renderer.getContext(), px = new Uint8Array(4);
    fixoP = pp;
    for (let i = 0; i < 4; i++) { fixoT = 9 + i / 60; desenhar(0); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    const ini = performance.now();
    for (let i = 0; i < n; i++) { fixoT = 10 + i / 60; desenhar(0); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    return +((performance.now() - ini) / n).toFixed(2);
  },
  // __traco.ajuste({ uLinha: 0.5, uTom: 0.6, passo: 3.2 }) muda o traço na hora
  ajuste(valores) {
    for (const [nome, valor] of Object.entries(valores)) {
      if (nome === "passo") passo = valor;
      else (final[nome] ?? comum[nome]).value = valor;
    }
    redimensionar();
  },
  // __traco.tinta(8) refaz o caminho da tinta do monograma com outro custo para o passo no papel
  tinta(passoPapel) {
    comum.uSeloCampo.value?.dispose();
    comum.uSeloCampo.value = campoDaTinta(comum.uSelo.value.image, passoPapel);
  },
  dentro: () => ({ cena, fora, interior, comum, final, renderer, alvo }),
  medidas: () => ({ vw, vh, triangulos, z: +camera.position.z.toFixed(2), janela: q, tela: final.uTela.value.toArray(), erros: renderer.info.programs?.length }),
};
