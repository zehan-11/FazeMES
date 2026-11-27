/* Derived from cyberdaddyleo/agent-display, WORKS v10.0.
 * Required Notice: Copyright (c) 2026 赛博老爸
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0. See LICENSE. */
function mountLoom(host, SR){
"use strict";
var TAU = Math.PI * 2;
var RM = false;
try { RM = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

var AGENTS = projectAgents;
var live = null, liveId = null, fanVisible = true;
var orbitCue = null, deckOn = false, modelOnly = false, splitDeck = false;
function modelOnStage() { return fanVisible && (!deckOn || modelOnly || splitDeck); }
function wantsSplitDeck() {
  return !!(deckOn && !modelOnly && !L.narrow && L.beamX1 - L.beamX0 >= 440 && live && live.showFan &&
    (live.materials?.length || live.display?.focusParts?.length));
}
var shortageFlags = new Float32Array(8), offsets = new Float32Array(24);
var targetOffsets = new Float32Array(24), targets = new Float32Array(8), revealAt = new Float32Array(8);
var partTint = fanProject.secs.map(function (s) { return tint(s.c, 0.4); });

var JOBS = [fanProject];

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
var R = mulberry32(1);
function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
function ease(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
function easeIO(t) { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function mRotX(a) { var c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, s, 0, -s, c]; }
function mRotY(a) { var c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 1, 0, s, 0, c]; }
function mMul(a, b) {
  var o = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (var col = 0; col < 3; col++) for (var row = 0; row < 3; row++)
    o[col * 3 + row] = a[row] * b[col * 3] + a[3 + row] * b[col * 3 + 1] + a[6 + row] * b[col * 3 + 2];
  return o;
}
function mApply(m, v) { return [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]]; }

/* =====================================================================
   3. 织造模型：每个项目由若干「织片」组成，每个织片是一组折线（按织造先后排好），
      采样成一串点，点上记录「第几织片、在织片里的先后（0~1）」，着色器按进度一针一针织出来
   ===================================================================== */
function MB() { this.S = []; this.R = []; this.F = []; this.T = []; this.cur = null; this.ci = 0; }
MB.prototype.s = function (i, r) { while (this.S.length <= i) { this.S.push([]); this.F.push([]); this.T.push([]); } this.cur = this.S[i]; this.ci = i; if (r) this.R[i] = r; return this; };
/* 实体面：在当前织片里登记一个多边形面（扇形三角化），按织到这里时一起出现 */
MB.prototype.face = function (pts) { this.F[this.ci].push({ p: pts, after: this.cur.length }); return this; };
/* 两条等长折线之间铺一条实体带（看台、桥面这种） */
MB.prototype.strip = function (a, b) { this.T[this.ci].push({ a: a, b: b, after: this.cur.length }); return this; };
MB.prototype.pl = function (pts, closed) { var c = pts.slice(); if (closed) c.push(pts[0]); if (c.length > 1) this.cur.push(c); return this; };
MB.prototype.ln = function (a, b) { return this.pl([a, b]); };
MB.prototype.ring = function (cx, cy, cz, rx, rz, n, a0, a1) {
  var pts = [], i; a0 = a0 || 0; if (a1 === undefined) a1 = a0 + TAU;
  for (i = 0; i <= n; i++) { var a = a0 + (a1 - a0) * i / n; pts.push([cx + Math.cos(a) * rx, cy, cz + Math.sin(a) * rz]); }
  return this.pl(pts);
};
/* 竖直的圆：ax="z" 时在 x-y 平面（正对观众），ax="x" 时在 z-y 平面 */
MB.prototype.vring = function (cx, cy, cz, r, n, ax) {
  var pts = [], i;
  for (i = 0; i <= n; i++) { var a = i / n * TAU; pts.push(ax === "x" ? [cx, cy + Math.sin(a) * r, cz + Math.cos(a) * r] : [cx + Math.cos(a) * r, cy + Math.sin(a) * r, cz]); }
  return this.pl(pts);
};
MB.prototype.box = function (x0, y0, z0, x1, y1, z1) {
  this.pl([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], true);
  this.ln([x0, y0, z0], [x0, y1, z0]); this.ln([x1, y0, z0], [x1, y1, z0]); this.ln([x1, y0, z1], [x1, y1, z1]); this.ln([x0, y0, z1], [x0, y1, z1]);
  this.pl([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], true);
  var c = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
  [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]].forEach(function (q) { this.face([c[q[0]], c[q[1]], c[q[2]], c[q[3]]]); }, this);
  return this;
};
/* 竖直矩形（x-y 平面，正对观众） */
MB.prototype.rect = function (x0, y0, x1, y1, z, solid) { this.pl([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], true); if (solid) this.face([[x0, y0, z - 0.004], [x1, y0, z - 0.004], [x1, y1, z - 0.004], [x0, y1, z - 0.004]]); return this; };
MB.prototype.curve = function (f, n) { var pts = [], i; for (i = 0; i <= n; i++) pts.push(f(i / n)); return this.pl(pts); };
/* 悬链（两点间下垂的线） */
MB.prototype.sag = function (a, b, s, n) {
  return this.curve(function (t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - s * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t]; }, n || 40);
};
var MODEL_DEFS = { fan: buildTableFan };

/* 折线 → 点串。step 越小越密；每个织片最多 MAXP 个点 */
function compileModel(m, step, maxP, scatter) {
  var pos = [], meta = [], idx = [], secStart = [], secCount = [], anchors = [], tops = [], s, c, i, j, ends = [], totals = [];
  var rr = mulberry32(911);
  for (s = 0; s < m.S.length; s++) {
    var chains = m.S[s], total = 0, lens = [], ce = [];
    for (c = 0; c < chains.length; c++) {
      var ch = chains[c], cl = [];
      for (i = 1; i < ch.length; i++) { var dx = ch[i][0] - ch[i - 1][0], dy = ch[i][1] - ch[i - 1][1], dz = ch[i][2] - ch[i - 1][2]; cl.push(Math.sqrt(dx * dx + dy * dy + dz * dz)); total += cl[cl.length - 1]; }
      lens.push(cl); ce.push(total);
    }
    ends.push(ce); totals.push(total);
    var st = Math.max(step, total / maxP), acc = 0, start = pos.length / 3, sum = [0, 0, 0], top = 0;
    for (c = 0; c < chains.length; c++) {
      var chn = chains[c], segL = lens[c], first = true, prev = -1;
      for (i = 1; i < chn.length; i++) {
        var a = chn[i - 1], b = chn[i], L0 = segL[i - 1], n = Math.max(1, Math.ceil(L0 / st));
        for (j = first ? 0 : 1; j <= n; j++) {
          var t = j / n, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
          var id = pos.length / 3;
          pos.push(p[0], p[1], p[2]);
          meta.push(s, total > 0 ? (acc + L0 * t) / total : 0, rr(), 0);
          sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; if (p[1] > top) top = p[1];
          if (prev >= 0) idx.push(prev, id);
          prev = id;
        }
        first = false; acc += L0;
      }
    }
    var cnt = pos.length / 3 - start;
    secStart.push(start); secCount.push(cnt); tops.push(top);
    anchors.push(cnt ? [sum[0] / cnt, sum[1] / cnt, sum[2] / cnt] : [0, 0, 0]);
  }
  var nLine = pos.length / 3;
  /* 粒子化：线上的每个点再撒几颗散粒子；实体面（屏幕、机柜、屋面、看台）按面积撒满粒子 */
  if (scatter) {
    var k, base = nLine;
    for (k = 0; k < base; k++) {
      for (j = 0; j < scatter.n; j++) {
        var r1 = rr(), th = rr() * TAU, ph2 = Math.acos(2 * rr() - 1), rad = scatter.r * Math.pow(r1, 0.6);
        pos.push(pos[k * 3] + rad * Math.sin(ph2) * Math.cos(th), pos[k * 3 + 1] + rad * Math.cos(ph2), pos[k * 3 + 2] + rad * Math.sin(ph2) * Math.sin(th));
        meta.push(meta[k * 4], meta[k * 4 + 1], rr(), 2);
      }
    }
    var tri = function (sec, ord, A, B, C) {
      var ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], ac = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
      var cx = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      var area = 0.5 * Math.sqrt(cx[0] * cx[0] + cx[1] * cx[1] + cx[2] * cx[2]), nn = Math.min(900, Math.round(area * scatter.fill));
      for (var q = 0; q < nn; q++) {
        var u = rr(), v = rr(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
        pos.push(A[0] + ab[0] * u + ac[0] * v, A[1] + ab[1] * u + ac[1] * v, A[2] + ab[2] * u + ac[2] * v);
        meta.push(sec, Math.min(1, ord + rr() * 0.02), rr(), 3);
      }
    };
    for (s = 0; s < m.S.length; s++) {
      var tot = totals[s] || 1, E = ends[s];
      (m.F[s] || []).forEach(function (f) { var ord = f.after > 0 ? E[f.after - 1] / tot : 0; for (var q = 1; q < f.p.length - 1; q++) tri(s, ord, f.p[0], f.p[q], f.p[q + 1]); });
      (m.T[s] || []).forEach(function (stp) { var ord = stp.after > 0 ? E[stp.after - 1] / tot : 0; for (var q = 0; q < stp.a.length - 1; q++) { tri(s, ord, stp.a[q], stp.a[q + 1], stp.b[q + 1]); tri(s, ord, stp.a[q], stp.b[q + 1], stp.b[q]); } });
    }
  }
  return { pos: new Float32Array(pos), meta: new Float32Array(meta), idx: new Uint16Array(idx), n: pos.length / 3, nLine: nLine, ni: idx.length, secStart: secStart, secCount: secCount, anchors: anchors, tops: tops };
}

/* 织造台地面（参考视频）：半透明薄板上布满白色等高线 + 星点粒子；外框与刻度 */
function buildGround() {
  var m = new MB(), GX = 2.36, GZ = 1.2, i, j, k;
  m.s(0);
  m.pl([[-GX, 0, -GZ], [GX, 0, -GZ], [GX, 0, GZ], [-GX, 0, GZ]], true);
  for (i = -23; i <= 23; i++) { var x = i * 0.1, l = i % 5 === 0 ? 0.06 : 0.03; m.ln([x, 0, GZ], [x, 0, GZ - l]); }
  /* 地形等高线：随机丘陵叠加成高度场，再用 marching squares 抽出等值线（参考视频里那种层层嵌套的地形线） */
  var rr = mulberry32(5150), H = [];
  for (k = 0; k < 20; k++) H.push([(rr() * 2 - 1) * 2.2, (rr() * 2 - 1) * 1.1, (rr() < 0.3 ? -1 : 1) * (0.35 + rr() * 0.8), 0.22 + rr() * 0.5, 0.16 + rr() * 0.32]);
  var F = function (x, z) {
    var v = 0.12 * Math.sin(x * 1.9 + 0.7) * Math.cos(z * 2.6 - 0.4) + 0.05 * Math.sin(x * 4.3 + z * 3.1), q;
    for (q = 0; q < H.length; q++) { var h = H[q], ex = (x - h[0]) / h[3], ez = (z - h[1]) / h[4]; v += h[2] * Math.exp(-ex * ex - ez * ez); }
    return v;
  };
  var NX = NARROW_G ? 96 : 150, NZ = NARROW_G ? 48 : 76, G = [], sx = 2 * GX / NX, sz = 2 * GZ / NZ, mn = 1e9, mx = -1e9;
  for (j = 0; j <= NZ; j++) for (i = 0; i <= NX; i++) { var v = F(-GX + i * sx, -GZ + j * sz); G.push(v); if (v < mn) mn = v; if (v > mx) mx = v; }
  var LV = NARROW_G ? 14 : 24, W = NX + 1;
  for (k = 1; k < LV; k++) {
    var lv = mn + (mx - mn) * k / LV;
    for (j = 0; j < NZ; j++) for (i = 0; i < NX; i++) {
      var A = G[j * W + i], B = G[j * W + i + 1], C = G[(j + 1) * W + i + 1], D = G[(j + 1) * W + i], x0 = -GX + i * sx, z0 = -GZ + j * sz, P = [];
      if ((A < lv) !== (B < lv)) P.push([x0 + sx * (lv - A) / (B - A), 0, z0]);
      if ((B < lv) !== (C < lv)) P.push([x0 + sx, 0, z0 + sz * (lv - B) / (C - B)]);
      if ((D < lv) !== (C < lv)) P.push([x0 + sx * (lv - D) / (C - D), 0, z0 + sz]);
      if ((A < lv) !== (D < lv)) P.push([x0, 0, z0 + sz * (lv - A) / (D - A)]);
      if (P.length === 2) m.ln(P[0], P[1]);
      else if (P.length === 4) { m.ln(P[0], P[1]); m.ln(P[2], P[3]); }
    }
  }
  var g = compileModel(m, 0.05, 90000);
  var pos = Array.prototype.slice.call(g.pos), meta = Array.prototype.slice.call(g.meta), dn = NARROW_G ? 2600 : 6500;
  for (i = 0; i < dn; i++) { pos.push((rr() * 2 - 1) * (GX - 0.04), 0.002, (rr() * 2 - 1) * (GZ - 0.04)); meta.push(0, 0, rr(), 1); }
  g.dust0 = g.n; g.pos = new Float32Array(pos); g.meta = new Float32Array(meta); g.n = pos.length / 3;
  return g;
}
/* 落点彩色粒子云：8 个槽位，每个槽位一团高斯分布的粒子，位置跟着「织造前沿」走，颜色跟着织机 */
function buildClouds() {
  var rr = mulberry32(6262), n = NARROW_G ? 300 : 900, pos = [], meta = [], s, i;
  for (s = 0; s < 8; s++) for (i = 0; i < n; i++) {
    var u1 = Math.max(rr(), 1e-6), th = rr() * TAU, r = Math.sqrt(-2 * Math.log(u1)) * (i % 4 === 0 ? 0.75 : 0.42);
    pos.push(Math.cos(th) * r * 0.36, Math.pow(rr(), 3) * 0.14, Math.sin(th) * r * 0.22);
    meta.push(s, rr(), rr(), 4);
  }
  return { pos: new Float32Array(pos), meta: new Float32Array(meta), n: pos.length / 3 };
}
var NARROW_G = (host.clientWidth || window.innerWidth) < 760;

/* 实体化：每条折线做成细管（6 边），盒子 / 矩形 / 屋面做成实体面；每个顶点记录「第几织片、织到哪」，
   着色器按进度只显示已经织出来的部分，前沿是熔融发光的那一圈 */
function v3sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function v3len(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }
function v3n(a) { var l = v3len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
function v3x(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function compileSolid(m, sides, maxSeg) {
  sides = sides || 6; maxSeg = maxSeg || 0.05;
  var P = [], NN = [], A = [], I = [], s, c, i, k, rr = mulberry32(4711);
  function push(p, n, sec, ord, kind) { P.push(p[0], p[1], p[2]); NN.push(n[0], n[1], n[2]); A.push(sec, ord, kind, rr()); return P.length / 3 - 1; }
  for (s = 0; s < m.S.length; s++) {
    var chains = m.S[s], rad = m.R[s] || 0.008, total = 0, ends = [];
    for (c = 0; c < chains.length; c++) { for (i = 1; i < chains[c].length; i++) total += v3len(v3sub(chains[c][i], chains[c][i - 1])); ends.push(total); }
    var acc = 0;
    for (c = 0; c < chains.length; c++) {
      var src = chains[c], pts = [src[0]], cum = [0], l = 0;
      for (i = 1; i < src.length; i++) {
        var a = src[i - 1], b = src[i], L0 = v3len(v3sub(b, a)), n = Math.max(1, Math.ceil(L0 / maxSeg));
        for (k = 1; k <= n; k++) { var t = k / n; pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); cum.push(l + L0 * t); }
        l += L0;
      }
      var base = P.length / 3, np = pts.length;
      for (i = 0; i < np; i++) {
        var tg = v3n(v3sub(pts[Math.min(np - 1, i + 1)], pts[Math.max(0, i - 1)]));
        var ref = Math.abs(tg[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], u = v3n(v3x(tg, ref)), w = v3x(tg, u);
        var ord = total > 0 ? (acc + cum[i]) / total : 0;
        for (k = 0; k < sides; k++) {
          var an = k / sides * TAU, cs = Math.cos(an), sn = Math.sin(an), nn = [u[0] * cs + w[0] * sn, u[1] * cs + w[1] * sn, u[2] * cs + w[2] * sn];
          push([pts[i][0] + nn[0] * rad, pts[i][1] + nn[1] * rad, pts[i][2] + nn[2] * rad], nn, s, ord, 0);
        }
      }
      for (i = 0; i < np - 1; i++) for (k = 0; k < sides; k++) { var k2 = (k + 1) % sides, v0 = base + i * sides + k, v1 = base + i * sides + k2; I.push(v0, v1, v1 + sides, v0, v1 + sides, v0 + sides); }
      acc += l;
    }
    m.F[s].forEach(function (f) {
      var ord = total > 0 ? (f.after > 0 ? ends[f.after - 1] : 0) / total : 0, p = f.p;
      var nf = v3n(v3x(v3sub(p[1], p[0]), v3sub(p[2], p[0]))), b0 = P.length / 3;
      p.forEach(function (q) { push(q, nf, s, ord, 1); });
      for (var j = 1; j < p.length - 1; j++) I.push(b0, b0 + j, b0 + j + 1);
    });
    m.T[s].forEach(function (st) {
      var ord = total > 0 ? (st.after > 0 ? ends[st.after - 1] : 0) / total : 0, A1 = st.a, B1 = st.b;
      for (var j = 0; j < A1.length - 1; j++) {
        var nq = v3n(v3x(v3sub(A1[j + 1], A1[j]), v3sub(B1[j], A1[j]))), b1 = P.length / 3;
        push(A1[j], nq, s, ord, 1); push(A1[j + 1], nq, s, ord, 1); push(B1[j + 1], nq, s, ord, 1); push(B1[j], nq, s, ord, 1);
        I.push(b1, b1 + 1, b1 + 2, b1, b1 + 2, b1 + 3);
      }
    });
  }
  var nv = P.length / 3;
  return { pos: new Float32Array(P), nrm: new Float32Array(NN), att: new Float32Array(A), idx: nv > 65535 ? new Uint32Array(I) : new Uint16Array(I), big: nv > 65535, n: nv, ni: I.length };
}
/* 织造台：一块有厚度的深色石板（顶面有细格纹） */
function buildSlab() {
  var GX = 2.44, GZ = 1.28, H = 0.14, P = [], NN = [], A = [], I = [];
  var c = [[-GX, -H, -GZ], [GX, -H, -GZ], [GX, -H, GZ], [-GX, -H, GZ], [-GX, 0, -GZ], [GX, 0, -GZ], [GX, 0, GZ], [-GX, 0, GZ]];
  [[[4, 5, 6, 7], [0, 1, 0]], [[0, 1, 2, 3], [0, -1, 0]], [[3, 2, 6, 7], [0, 0, 1]], [[1, 0, 4, 5], [0, 0, -1]], [[2, 1, 5, 6], [1, 0, 0]], [[0, 3, 7, 4], [-1, 0, 0]]].forEach(function (f) {
    var b = P.length / 3;
    f[0].forEach(function (q) { P.push(c[q][0], c[q][1], c[q][2]); NN.push(f[1][0], f[1][1], f[1][2]); A.push(0, 0, 2, 0); });
    I.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return { pos: new Float32Array(P), nrm: new Float32Array(NN), att: new Float32Array(A), idx: new Uint16Array(I), n: P.length / 3, ni: I.length };
}

/* =====================================================================
   4. DOM 引用与构建
   ===================================================================== */
function $(id) { return SR.getElementById(id); }
var glc = $("gl"), fxc = $("fx"), board = $("board"), fitIn = $("fitIn"), nr = $("nr"), mid = $("mid");
var loomBox = $("loom");
function pad(n, w) { n = String(n); while (n.length < w) n = "0" + n; return n; }
function hexA(h, a) { var n = parseInt(h.slice(1), 16); return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + a + ")"; }
function tint(h, k) { var n = parseInt(h.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255; return [Math.round(r + (255 - r) * k), Math.round(g + (255 - g) * k), Math.round(b + (255 - b) * k)]; }
function rgbA(c, a) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }
function hex3(h) { var n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }

var SPF = [[0.18, 318], [0.39, 365], [0.61, 365], [0.82, 318]];
var cardEls = [], agentEls = [], pinEls = [];
function makeButton(container, cls, label, handler) {
  var b = document.createElement("button");
  b.type = "button"; b.className = cls; b.textContent = label;
  b.addEventListener("click", handler); container.appendChild(b); return b;
}
function select(type, index) {
  host.dispatchEvent(new CustomEvent("scene-select", { detail: { type: type, index: index } }));
}
function buildJobDom() {
  if (cardEls.length) return;
  AGENTS.forEach(function (agent, index) {
    var b = makeButton($("agent-labels"), "sat-label", "", function () { select("agent", index); });
    b.style.setProperty("--accent", agent.c);
    var title = document.createElement("strong"), state = document.createElement("span");
    title.textContent = agent.name; b.append(title, state);
    agentEls.push({ el: b, state: state });
  });
  fanProject.secs.forEach(function (part, index) {
    var b = makeButton(loomBox, "part-card", "", function () { select("part", index); });
    b.style.setProperty("--accent", part.c);
    var title = document.createElement("b"), status = document.createElement("small");
    title.textContent = part.n; b.append(title, status);
    cardEls.push({ el:b, status:status });
    var pin = makeButton($("part-pins"), "part-pin", "", function () { select("part", index); });
    pin.hidden = true; pinEls.push(pin);
  });
}

var NARROW = (host.clientWidth || window.innerWidth) < 760;
var MO = [], curObj = null, curPart = null;
var I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
var M_DARK = 0, M_PAINT = 1, M_LED = 2, M_GLASS = 3, M_PANEL = 4, M_RUBBER = 5, M_GOLD = 6, M_ORANGE = 7, M_ALU = 8, M_BRASS = 9;
function nrm(v) { var l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function rotAxis(ax, a) {
  var x = ax[0], y = ax[1], z = ax[2], c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  return [t * x * x + c, t * x * y + s * z, t * x * z - s * y, t * x * y - s * z, t * y * y + c, t * y * z + s * x, t * x * z + s * y, t * y * z - s * x, t * z * z + c];
}
function alignY(d) { d = nrm(d); var ref = Math.abs(d[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0]; var u = nrm(v3x(ref, d)), w = v3x(u, d); return [u[0], u[1], u[2], d[0], d[1], d[2], w[0], w[1], w[2]]; }
var AXX = rotAxis([0, 0, 1], -Math.PI / 2), AXZ = rotAxis([1, 0, 0], Math.PI / 2);
function TT(m, t) { return { m: m || I3, t: t || [0, 0, 0] }; }
function tf(T, p) { if (!T) return p; var m = T.m; return [m[0] * p[0] + m[3] * p[1] + m[6] * p[2] + T.t[0], m[1] * p[0] + m[4] * p[1] + m[7] * p[2] + T.t[1], m[2] * p[0] + m[5] * p[1] + m[8] * p[2] + T.t[2]]; }
function tn(T, n) { return T ? nrm(mApply(T.m, n)) : nrm(n); }
function obj(o) {
  curObj = { parts: [], V: [], N: [], M: [], I: [], emit: o.emit, ep: o.ep || 0, top: o.top, spin: o.spin || 0, yaw: o.yaw || 0, pitch: o.pitch || 0.3, s: o.s || 1, t: 0 };
  MO.push(curObj); return curObj;
}
function part(a) {
  a = a || {};
  curPart = { i0: curObj.I.length, n: 0, ax: a.ax || null, pv: a.pv || [0, 0, 0], sp: a.sp || 0, osc: a.osc || 0, of: a.of || 0.9, ph: a.ph || 0, ao: a.ao || 0, pa: a.pa === undefined ? -1 : a.pa, R: I3, T: [0, 0, 0] };
  curObj.parts.push(curPart); return curObj.parts.length - 1;
}
function V(p, n, m) { var o = curObj; o.V.push(p[0], p[1], p[2]); o.N.push(n[0], n[1], n[2]); o.M.push(m); return o.V.length / 3 - 1; }
function quad(a, b, c, d) { curObj.I.push(a, b, c, a, c, d); curPart.n = curObj.I.length - curPart.i0; }
function rpt(r, y, t) { return [r * Math.cos(t), y, r * Math.sin(t)]; }
/* 车削体：profile 从上往下、从轴往外排 [[半径, 高度], ...]；smooth=true 时法线平滑 */
function lathe(prof, seg, mat, T, smooth) {
  var i, j, np = prof.length;
  if (smooth) {
    var vn = [], base = curObj.V.length / 3;
    for (i = 0; i < np; i++) { var a = prof[Math.max(0, i - 1)], b = prof[Math.min(np - 1, i + 1)], l = Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1])) || 1; vn.push([-(b[1] - a[1]) / l, (b[0] - a[0]) / l]); }
    for (i = 0; i < np; i++) for (j = 0; j <= seg; j++) { var th = j / seg * TAU, c = Math.cos(th), s = Math.sin(th); V(tf(T, [prof[i][0] * c, prof[i][1], prof[i][0] * s]), tn(T, [vn[i][0] * c, vn[i][1], vn[i][0] * s]), mat); }
    for (i = 0; i < np - 1; i++) for (j = 0; j < seg; j++) { var k0 = base + i * (seg + 1) + j, k1 = k0 + seg + 1; quad(k0, k0 + 1, k1 + 1, k1); }
    return;
  }
  var flat = seg <= 8;
  for (i = 0; i < np - 1; i++) {
    var p0 = prof[i], p1 = prof[i + 1], ll = Math.sqrt((p1[0] - p0[0]) * (p1[0] - p0[0]) + (p1[1] - p0[1]) * (p1[1] - p0[1])) || 1, nr = -(p1[1] - p0[1]) / ll, ny = (p1[0] - p0[0]) / ll;
    for (j = 0; j < seg; j++) {
      var t0 = j / seg * TAU, t1 = (j + 1) / seg * TAU, tm = (t0 + t1) / 2;
      var n0 = flat ? [nr * Math.cos(tm), ny, nr * Math.sin(tm)] : [nr * Math.cos(t0), ny, nr * Math.sin(t0)], n1 = flat ? n0 : [nr * Math.cos(t1), ny, nr * Math.sin(t1)];
      quad(V(tf(T, rpt(p0[0], p0[1], t0)), tn(T, n0), mat), V(tf(T, rpt(p0[0], p0[1], t1)), tn(T, n1), mat), V(tf(T, rpt(p1[0], p1[1], t1)), tn(T, n1), mat), V(tf(T, rpt(p1[0], p1[1], t0)), tn(T, n0), mat));
    }
  }
}
function torus(R, r, mat, T, su, sv) {
  su = su || 40; sv = sv || 8;
  var base = curObj.V.length / 3, i, j;
  for (i = 0; i <= su; i++) { var u = i / su * TAU, cu = Math.cos(u), snu = Math.sin(u);
    for (j = 0; j <= sv; j++) { var v = j / sv * TAU, cv = Math.cos(v), snv = Math.sin(v); V(tf(T, [(R + r * cv) * cu, r * snv, (R + r * cv) * snu]), tn(T, [cv * cu, snv, cv * snu]), mat); } }
  for (i = 0; i < su; i++) for (j = 0; j < sv; j++) { var a = base + i * (sv + 1) + j, b = a + sv + 1; quad(a, b, b + 1, a + 1); }
}
function box(c, s, mat, T) {
  var hx = s[0] / 2, hy = s[1] / 2, hz = s[2] / 2;
  var F = [[[1, 0, 0], [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]]], [[-1, 0, 0], [[-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz]]],
    [[0, 1, 0], [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]]], [[0, -1, 0], [[-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]]],
    [[0, 0, 1], [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]]], [[0, 0, -1], [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]]]];
  F.forEach(function (f) { var id = f[1].map(function (p) { return V(tf(T, [p[0] + c[0], p[1] + c[1], p[2] + c[2]]), tn(T, f[0]), mat); }); quad(id[0], id[1], id[2], id[3]); });
}
function sph(c, r, mat, seg) { var pr = [], k; for (k = 0; k <= 12; k++) { var a = k / 12 * Math.PI; pr.push([Math.max(0.0001, r * Math.sin(a)), r * Math.cos(a)]); } lathe(pr, seg || 24, mat, TT(I3, c), true); }
function cyl(c, r, h, mat, m, seg) { lathe([[0.0001, h / 2], [r, h / 2], [r, -h / 2], [0.0001, -h / 2]], seg || 22, mat, TT(m, c)); }
function tube(a, b, r, mat, seg) { var d = v3sub(b, a), L0 = v3len(d); lathe([[r, L0 / 2], [r, -L0 / 2]], seg || 12, mat, TT(alignY(d), [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2])); }
function pipe(pts, r, mat) { for (var i = 1; i < pts.length; i++) { tube(pts[i - 1], pts[i], r, mat); if (i < pts.length - 1) sph(pts[i], r, mat, 10); } }
function nozzle(y, r, mat) { lathe([[0.0001, y], [r, y], [r, y - 0.03], [r * 0.7, y - 0.08], [r * 0.32, y - 0.12], [0.0001, y - 0.12]], 18, mat || M_BRASS); }
function boltRing(y, R, n, r, mat) { for (var k = 0; k < n; k++) { var a = k / n * TAU; cyl([Math.cos(a) * R, y, Math.sin(a) * R], r, r * 1.2, mat || M_ALU, null, 8); } }

/* ---- 8 台织机：每个 Agent 一台真实造型的工业设备 ---- */
(function buildUnits() {
  var k, a, p1, p2, e;
  /* U02 research · 激光雷达：吊装支架 + 旋转扫描头 + 底部透镜 */
  obj({ emit: [0, -0.25, 0], top: [0, 0.6, 0], yaw: 0.3, s: 1.12 });
  part();
  cyl([0, 0.585, 0], 0.12, 0.03, M_DARK, null, 24); tube([0, 0.57, 0], [0, 0.4, 0], 0.03, M_ALU); box([0, 0.39, 0], [0.26, 0.025, 0.26], M_DARK);
  lathe([[0.0001, 0.0], [0.22, 0.0], [0.25, -0.03], [0.25, -0.12], [0.21, -0.16], [0.0001, -0.16]], 36, M_DARK);
  lathe([[0.252, -0.05], [0.252, -0.07]], 36, M_ALU);
  lathe([[0.0001, -0.16], [0.1, -0.16], [0.09, -0.2], [0.05, -0.225], [0.0001, -0.235]], 24, M_GLASS, null, true);
  box([0.255, -0.08, 0], [0.05, 0.05, 0.08], M_RUBBER); pipe([[0.28, -0.08, 0], [0.33, -0.02, 0.02], [0.32, 0.2, 0.05], [0.12, 0.38, 0.05]], 0.012, M_RUBBER);
  part({ ax: [0, 1, 0], sp: 3.2 });
  lathe([[0.0001, 0.36], [0.2, 0.36], [0.24, 0.34], [0.25, 0.3], [0.25, 0.05], [0.22, 0.02], [0.0001, 0.02]], 40, M_PAINT);
  torus(0.25, 0.008, M_DARK, TT(I3, [0, 0.3, 0]), 40, 5);
  box([0, 0.18, 0.235], [0.22, 0.17, 0.04], M_GLASS); box([0, 0.18, -0.235], [0.16, 0.12, 0.04], M_GLASS);
  box([0.09, 0.28, 0.25], [0.025, 0.012, 0.006], M_LED);

  /* U04 review · 通信卫星：金箔六棱舱 + 高增益天线 + 太阳翼 */
  obj({ emit: [0, -0.36, 0], top: [0, 0.52, 0], spin: 0.12, yaw: 0.6, s: 1.08 });
  part();
  lathe([[0.0001, 0.24], [0.22, 0.24], [0.22, -0.2], [0.0001, -0.2]], 6, M_GOLD);
  lathe([[0.0001, 0.262], [0.235, 0.262], [0.235, 0.24], [0.0001, 0.24]], 6, M_PAINT);
  lathe([[0.0001, -0.2], [0.235, -0.2], [0.235, -0.222], [0.0001, -0.222]], 6, M_PAINT);
  tube([0, 0.262, 0], [0.05, 0.38, 0.05], 0.014, M_ALU, 8);
  lathe([[0.0001, 0.0], [0.06, 0.005], [0.12, 0.02], [0.17, 0.046]], 32, M_PAINT, TT(rotAxis([1, 0, 0], -0.55), [0.05, 0.39, 0.05]), true);
  tube([0.05, 0.39, 0.05], [0.05, 0.47, 0.1], 0.006, M_DARK, 6);
  box([-0.17, 0.12, 0.12], [0.07, 0.07, 0.07], M_DARK); cyl([-0.17, 0.12, 0.16], 0.025, 0.02, M_GLASS, AXZ, 12);
  for (k = 0; k < 4; k++) { a = (k + 0.5) / 4 * TAU; lathe([[0.0001, -0.222], [0.025, -0.222], [0.035, -0.27], [0.0001, -0.27]], 10, M_DARK, TT(I3, [Math.cos(a) * 0.15, 0, Math.sin(a) * 0.15])); }
  nozzle(-0.222, 0.05, M_ALU);
  part({ ax: [1, 0, 0], ao: 1.05, osc: 0.25, of: 0.35 });
  [-1, 1].forEach(function (sd) {
    tube([sd * 0.22, 0.02, 0], [sd * 0.34, 0.02, 0], 0.012, M_ALU, 8); box([sd * 0.35, 0.02, 0], [0.03, 0.04, 0.04], M_DARK);
    box([sd * 0.62, 0.02, 0], [0.5, 0.012, 0.3], M_PANEL); box([sd * 0.62, 0.02, 0], [0.52, 0.007, 0.32], M_ALU);
  });

  /* U06 designer · 云台检测相机：吊杆 + 水平旋转 + 俯仰 + 遮阳罩 */
  obj({ emit: [0, 0.07, 0.3], ep: 2, top: [0, 0.6, 0], yaw: 0.3, s: 1.18 });
  part();
  cyl([0, 0.585, 0], 0.1, 0.03, M_DARK, null, 22); tube([0, 0.57, 0], [0, 0.32, 0], 0.024, M_PAINT); cyl([0, 0.31, 0], 0.06, 0.04, M_DARK, null, 20);
  p1 = part({ ax: [0, 1, 0], osc: 0.8, of: 0.32 });
  cyl([0, 0.265, 0], 0.07, 0.05, M_PAINT, null, 22);
  box([0, 0.225, 0], [0.32, 0.03, 0.1], M_PAINT);
  box([0.15, 0.13, 0], [0.03, 0.17, 0.08], M_PAINT); box([-0.15, 0.13, 0], [0.03, 0.17, 0.08], M_PAINT);
  part({ ax: [1, 0, 0], pv: [0, 0.1, 0], osc: 0.2, of: 0.5, ph: 1, pa: p1 });
  box([0, 0.1, 0.03], [0.2, 0.15, 0.42], M_PAINT);
  box([0, 0.186, 0.06], [0.24, 0.014, 0.5], M_PAINT);
  box([0, 0.1, -0.185], [0.16, 0.11, 0.02], M_DARK);
  cyl([0, 0.1, 0.25], 0.056, 0.03, M_DARK, AXZ, 20); cyl([0, 0.1, 0.268], 0.045, 0.006, M_GLASS, AXZ, 20);
  box([0.07, 0.155, 0.243], [0.02, 0.012, 0.004], M_LED);
  cyl([0.11, 0.1, 0], 0.03, 0.02, M_ALU, AXX, 14); cyl([-0.11, 0.1, 0], 0.03, 0.02, M_ALU, AXX, 14);
  pipe([[0, 0.1, -0.2], [0, 0.04, -0.26], [0, 0.2, -0.3]], 0.01, M_RUBBER);

  /* U07 scout · 球形侦察无人机：分缝球壳 + 镜头 + 天线 + 侧推 + 旋转传感环 */
  obj({ emit: [0, -0.37, 0], top: [0, 0.44, 0], spin: 0.22, s: 1.1 });
  part();
  sph([0, 0, 0], 0.25, M_PAINT, 32);
  torus(0.252, 0.007, M_DARK, null, 48, 6); torus(0.252, 0.006, M_DARK, TT(AXX), 48, 6); torus(0.252, 0.006, M_DARK, TT(AXZ), 48, 6);
  cyl([0, 0.03, 0.24], 0.08, 0.04, M_DARK, AXZ, 24); cyl([0, 0.03, 0.262], 0.06, 0.006, M_GLASS, AXZ, 24); torus(0.064, 0.006, M_LED, TT(AXZ, [0, 0.03, 0.264]), 24, 5);
  tube([0.1, 0.2, -0.05], [0.16, 0.42, -0.08], 0.007, M_DARK, 6); sph([0.16, 0.42, -0.08], 0.014, M_LED, 10);
  tube([-0.12, 0.19, -0.02], [-0.2, 0.36, -0.04], 0.007, M_DARK, 6);
  [-1, 1].forEach(function (sd) { cyl([sd * 0.3, 0.02, 0], 0.05, 0.12, M_DARK, AXX, 18); lathe([[0.0001, 0.0], [0.04, 0.0], [0.05, -0.04], [0.0001, -0.04]], 14, M_ALU, TT(sd > 0 ? AXX : rotAxis([0, 0, 1], Math.PI / 2), [sd * 0.36, 0.02, 0])); });
  nozzle(-0.235, 0.055, M_ALU);
  part({ ax: [0, 1, 0], sp: 1.4 });
  torus(0.31, 0.011, M_ALU, TT(I3, [0, -0.1, 0]), 56, 6);
  for (k = 0; k < 3; k++) { a = k / 3 * TAU; box([Math.cos(a) * 0.31, -0.1, Math.sin(a) * 0.31], [0.05, 0.04, 0.05], M_DARK); box([Math.cos(a) * 0.335, -0.1, Math.sin(a) * 0.335], [0.012, 0.012, 0.012], M_LED); }

})();

/* ---- 总控：大型通信卫星 —— 金箔舱体、白色散热板、三联太阳翼、大口径高增益天线、8 个发射喇叭（各对准一台织机） ---- */
var CLAMP_A = [], PORT_TIP = [];
(function buildMaster() {
  var k, a;
  for (k = 0; k < 8; k++) CLAMP_A.push(Math.PI - Math.PI * (0.12 + 0.76 * k / 7));
  obj({ emit: [0, -0.46, 0.05], top: [0, 0.8, 0], pitch: 0.26, yaw: 0, s: 1 });
  part();
  box([0, 0.05, 0], [0.9, 0.78, 0.7], M_GOLD);
  box([0, 0.08, 0.352], [0.72, 0.56, 0.008], M_PAINT); box([0, 0.08, -0.352], [0.72, 0.56, 0.008], M_PAINT);
  for (k = 0; k < 6; k++) { box([0, -0.16 + k * 0.096, 0.358], [0.7, 0.005, 0.004], M_DARK); box([0, -0.16 + k * 0.096, -0.358], [0.7, 0.005, 0.004], M_DARK); }
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (q) { box([q[0] * 0.45, 0.05, q[1] * 0.35], [0.03, 0.8, 0.03], M_ALU); });
  box([0, 0.455, 0], [0.94, 0.035, 0.74], M_PAINT); box([0, -0.355, 0], [0.94, 0.035, 0.74], M_ALU);
  box([0.47, 0.05, 0], [0.012, 0.6, 0.5], M_PAINT); box([-0.47, 0.05, 0], [0.012, 0.6, 0.5], M_PAINT);
  box([-0.2, 0.38, 0.358], [0.16, 0.03, 0.004], M_ORANGE); box([0.28, 0.38, 0.358], [0.04, 0.016, 0.004], M_LED);
  /* 顶部：两面小天线 + 全向天线杆 + 星敏感器 */
  tube([-0.24, 0.47, -0.1], [-0.24, 0.58, -0.1], 0.02, M_ALU, 10);
  lathe([[0.0001, 0.0], [0.06, 0.004], [0.11, 0.016], [0.15, 0.036]], 28, M_PAINT, TT(rotAxis([1, 0, 0], -0.45), [-0.24, 0.6, -0.1]), true);
  tube([-0.24, 0.6, -0.1], [-0.24, 0.7, -0.05], 0.005, M_DARK, 6);
  tube([0.2, 0.47, 0.14], [0.22, 0.56, 0.16], 0.018, M_ALU, 10);
  lathe([[0.0001, 0.0], [0.05, 0.004], [0.09, 0.014], [0.12, 0.03]], 24, M_PAINT, TT(rotAxis([0, 0, 1], 0.4), [0.22, 0.57, 0.16]), true);
  tube([0.36, 0.47, -0.22], [0.36, 0.86, -0.22], 0.008, M_DARK, 6); sph([0.36, 0.87, -0.22], 0.02, M_LED, 10);
  box([-0.36, 0.5, 0.26], [0.08, 0.07, 0.08], M_DARK); cyl([-0.36, 0.5, 0.31], 0.026, 0.02, M_GLASS, AXZ, 12);
  box([0.36, 0.5, 0.26], [0.08, 0.07, 0.08], M_DARK); cyl([0.36, 0.5, 0.31], 0.026, 0.02, M_GLASS, AXZ, 12);
  /* 四角推力器 */
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (q) { var x = q[0] * 0.4, z = q[1] * 0.3; lathe([[0.0001, -0.37], [0.03, -0.37], [0.045, -0.44], [0.0001, -0.44]], 12, M_DARK, TT(I3, [x, 0, z])); });
  /* 大口径高增益天线（正前下方） */
  var dir = nrm([0, -0.45, 0.9]), dc = [0, -0.62, 0.58];
  tube([0, -0.37, 0.2], [0, -0.55, 0.45], 0.03, M_ALU, 12); box([0, -0.37, 0.22], [0.12, 0.05, 0.1], M_DARK);
  lathe([[0.0001, 0.0], [0.14, 0.01], [0.28, 0.042], [0.42, 0.094], [0.52, 0.146]], 40, M_PAINT, TT(alignY(dir), dc), true);
  torus(0.52, 0.012, M_ALU, TT(alignY(dir), [dc[0] + dir[0] * 0.146, dc[1] + dir[1] * 0.146, dc[2] + dir[2] * 0.146]), 48, 6);
  var fp = [dc[0] + dir[0] * 0.42, dc[1] + dir[1] * 0.42, dc[2] + dir[2] * 0.42];
  for (k = 0; k < 3; k++) {
    a = k / 3 * TAU; var m = alignY(dir), rimL = [Math.cos(a) * 0.5, 0.14, Math.sin(a) * 0.5];
    var rim = [m[0] * rimL[0] + m[3] * rimL[1] + m[6] * rimL[2] + dc[0], m[1] * rimL[0] + m[4] * rimL[1] + m[7] * rimL[2] + dc[1], m[2] * rimL[0] + m[5] * rimL[1] + m[8] * rimL[2] + dc[2]];
    tube(rim, fp, 0.007, M_DARK, 6);
  }
  lathe([[0.0001, 0.0], [0.04, 0.0], [0.03, -0.07], [0.0001, -0.08]], 14, M_ALU, TT(alignY(dir), fp));
  /* 底部 8 个发射喇叭：每个对准一台织机 */
  for (k = 0; k < 8; k++) {
    a = CLAMP_A[k];
    var hx = Math.cos(a) * 0.36, hz = 0.1 + Math.sin(a) * 0.12;
    cyl([hx, -0.39, hz], 0.03, 0.04, M_ALU, null, 12);
    lathe([[0.022, -0.41], [0.03, -0.41], [0.05, -0.5], [0.044, -0.5]], 14, M_ALU, TT(I3, [hx, 0, hz]));
    sph([hx, -0.47, hz], 0.012, M_LED, 8);
    PORT_TIP.push([hx, -0.52, hz]);
  }
  /* 太阳翼：三联板，整体缓慢对日跟踪 */
  part({ ax: [1, 0, 0], ao: 1.12, osc: 0.1, of: 0.22 });
  [-1, 1].forEach(function (sd) {
    tube([sd * 0.46, 0.06, 0], [sd * 0.68, 0.06, 0], 0.024, M_ALU, 10); box([sd * 0.69, 0.06, 0], [0.04, 0.06, 0.08], M_DARK);
    for (var p = 0; p < 3; p++) {
      var cx = sd * (0.99 + p * 0.6);
      box([cx, 0.06, 0], [0.56, 0.016, 0.52], M_PANEL); box([cx, 0.06, 0], [0.58, 0.009, 0.54], M_ALU);
      if (p < 2) box([cx + sd * 0.3, 0.06, 0], [0.03, 0.03, 0.1], M_DARK);
    }
  });
})();
var MASTER = MO.length - 1;

var MODELS = JOBS.map(function (j) { var m = new MB(); MODEL_DEFS[j.kind](m); return compileModel(m, NARROW ? 0.018 : 0.011, 5200, { n: NARROW ? 1 : 2, r: 0.014, fill: NARROW ? 500 : 1100 }); });
var SOLIDS = JOBS.map(function (project) {
  var model = new MB();
  MODEL_DEFS[project.kind](model);
  return compileSolid(model, NARROW ? 4 : 6, 0.10);
});
var GROUND = buildGround(), CLOUD = buildClouds();
var SLABM = buildSlab();
function curModel() { return MODELS[ST.job]; }

/* =====================================================================
   7. WebGL
   ===================================================================== */
var gl = null;
try { gl = glc.getContext("webgl", { antialias: true, alpha: false, depth: true, premultipliedAlpha: false, powerPreference: "high-performance" }); } catch (e) { gl = null; }
if (!gl) $("glFail").hidden = false;

var PROJ = [
  "uniform vec2 uRes; uniform vec2 uCtr; uniform float uScl; uniform float uCam;",
  "vec2 toScreen(vec3 pv, out float k){ float d = uCam - pv.z; k = uCam / max(d, 0.25); return uCtr + vec2(pv.x, -pv.y) * uScl * k; }",
  "vec4 toClip(vec2 sp){ return vec4(sp.x / uRes.x * 2.0 - 1.0, 1.0 - sp.y / uRes.y * 2.0, 0.0, 1.0); }",
  "mat3 rX(float a){ float c = cos(a), s = sin(a); return mat3(1.0,0.0,0.0, 0.0,c,s, 0.0,-s,c); }",
  "mat3 rY(float a){ float c = cos(a), s = sin(a); return mat3(c,0.0,-s, 0.0,1.0,0.0, s,0.0,c); }",
  "mat3 rZ(float a){ float c = cos(a), s = sin(a); return mat3(c,s,0.0, -s,c,0.0, 0.0,0.0,1.0); }",
  "float sq(float x){ return x * x; }"
].join("\n");

var FS_SOFT = [
  "precision mediump float;",
  "varying vec3 vC; varying float vA; uniform float uLine;",
  "void main(){",
  "  float a = vA;",
  "  if (uLine < 0.5) { vec2 q = gl_PointCoord - 0.5; float d = dot(q, q) * 4.0; a *= exp(-d * 3.2) * step(d, 1.0); }",
  "  gl_FragColor = vec4(vC * a, a);",
  "}"
].join("\n");
var VS_STAR = [
  "precision highp float;",
  "attribute vec4 aS;",
  "uniform float uTime, uDpr;",
  "varying vec3 vC; varying float vA;",
  "void main(){",
  "  gl_Position = vec4(aS.x * 2.0 - 1.0, 1.0 - aS.y * 2.0, 0.0, 1.0);",
  "  vA = (0.05 + 0.22 * fract(aS.w * 7.13)) * (0.6 + 0.4 * sin(uTime * (0.4 + fract(aS.w * 3.7)) + aS.w * 50.0));",
  "  vC = vec3(0.78, 0.86, 1.0);",
  "  gl_PointSize = aS.z * uDpr;",
  "}"
].join("\n");
/* 织造台点线层：只画还没织到的「蓝图虚线」、织造前沿的火花，以及收网时飞散的粒子；地面等高线在落点处被照亮 */
var VS_PRJ = [
  "precision highp float;",
  "attribute vec3 aP; attribute vec4 aM;",
  "uniform float uTime, uDpr, uPt, uVerify, uDel, uDis, uFocus, uGround, uFade;",
  "uniform mediump float uLine;",
  "uniform float uProg[8]; uniform vec3 uCol[8]; uniform vec3 uOffset[8];",
  "uniform float uShortage[8]; uniform float uKitting;",
  "uniform vec3 uHP[8]; uniform vec3 uHC[8];",
  "uniform mat3 uView;",
  PROJ,
  "varying vec3 vC; varying float vA;",
  "void main(){",
  "  vec3 p = aP;",
  "  float tw = 0.55 + 0.45 * sin(uTime * (1.3 + aM.z * 4.0) + aM.z * 70.0);",
  "  if (uGround > 1.5) {",
  "    int hi = int(aM.x + 0.5); vec3 H = uHP[hi]; float w = clamp(H.y, 0.0, 1.4);",
  "    float an = uTime * (0.5 + aM.y * 0.9) + aM.z * 6.283;",
  "    vec2 o = aP.xz + vec2(cos(an), sin(an)) * 0.01 * (1.0 + aM.y);",
  "    float sc = 0.85 + 0.5 * w;",
  "    vec3 pos = vec3(clamp(H.x + o.x * sc, -2.4, 2.4), aP.y * (0.3 + 0.8 * w), clamp(H.z + o.y * sc, -1.24, 1.24));",
  "    vec3 pv = uView * pos; float k; vec2 sp = toScreen(pv, k); gl_Position = toClip(sp);",
  "    vec2 rq = aP.xz / vec2(0.15, 0.09); float fall = exp(-dot(rq, rq) * 0.5);",
  "    vC = mix(uHC[hi], vec3(1.0), 0.12 + 0.55 * fall * clamp(w - 0.3, 0.0, 1.0));",
  "    vA = w * (0.25 + 0.95 * tw) * (0.25 + 0.85 * fall) * uFade;",
  "    gl_PointSize = uPt * uDpr * k * (0.45 + aM.z * 1.1 + fall * 0.9);",
  "    return;",
  "  }",
  "  if (uGround > 0.5) {",
  "    float g = 0.0; vec3 gc = vec3(0.0);",
  "    for (int i = 0; i < 8; i++) { vec2 d = p.xz - uHP[i].xz; float w = exp(-dot(d, d) * 7.5) * uHP[i].y; g += w; gc += uHC[i] * w; }",
  "    vec3 pv = uView * p; float k; vec2 sp = toScreen(pv, k); gl_Position = toClip(sp);",
  "    float gg = clamp(g, 0.0, 1.6);",
  "    vec3 hc = gc / max(g, 0.0001);",
  "    float depthF = 0.6 + 0.4 * clamp(pv.z * 0.5 + 0.5, 0.0, 1.0);",
  "    if (uLine > 0.5) {",
  "      vC = mix(vec3(0.82, 0.86, 0.94), hc, clamp(gg * 0.7, 0.0, 0.85));",
  "      vA = (0.3 + 0.45 * gg) * depthF * uFade;",
  "      gl_PointSize = 1.0;",
  "    } else {",
  "      vC = mix(vec3(0.9, 0.93, 1.0), mix(hc, vec3(1.0), 0.25), clamp(gg, 0.0, 1.0));",
  "      vA = (0.18 + 0.32 * tw + gg * (0.9 + 0.6 * tw)) * depthF * uFade;",
  "      gl_PointSize = uPt * uDpr * k * (0.45 + aM.z * 0.7 + gg * (0.9 + aM.z));",
  "    }",
  "    return;",
  "  }",
  "  int si = int(aM.x + 0.5);",
  "  float pr = uProg[si]; float missing = uShortage[si];",
  "  float o = aM.y;",
  "  float lim = min(pr, 1.0 - uDis * 1.05);",
  "  float rev = smoothstep(o - 0.012, o, lim);",
  "  float front = (pr > 0.001 && pr < 0.999) ? exp(-sq((pr - o) * 55.0)) * step(o, pr + 0.01) : 0.0;",
  "  vec3 pos = p + uOffset[si];",
  "  float lost = clamp((o - (1.0 - uDis * 1.05)) * 8.0, 0.0, 1.0) * step(0.001, uDis);",
  "  pos += vec3((aM.z - 0.5) * 0.6, 0.25 + aM.z * 0.8, (fract(aM.z * 7.31) - 0.5) * 0.6) * lost * uDis;",
  "  pos.y += uDel * 0.03;",
  "  vec3 pv = uView * pos; float k; vec2 sp = toScreen(pv, k); gl_Position = toClip(sp);",
  "  vec3 sc = uCol[si];",
  "  float vb = uVerify > -1.0 ? exp(-sq((p.y - uVerify) * 12.0)) : 0.0;",
  "  float isFill = step(2.5, aM.w), isScat = step(1.5, aM.w) * (1.0 - isFill);",
  "  vec3 woven = mix(sc, vec3(1.0), 0.42 + 0.2 * tw);",
  "  vec3 c = mix(vec3(0.55, 0.68, 0.9), woven, rev);",
  "  c = mix(c, vec3(1.0, 0.96, 0.88), clamp(front + vb * 0.7 + uDel * 0.3, 0.0, 1.0));",
  "  float ghost = step(aM.z, 0.3) * 0.08 * (1.0 - rev) * (1.0 - isFill) * (1.0 - isScat);",
  "  float body = rev * (0.5 + 0.38 * tw) * mix(1.0, 0.55, isScat) * mix(1.0, 0.42, isFill);",
  "  float a = ghost + body + front * 1.1 + vb * 0.6 * rev + uDel * 0.22 * rev + lost * 0.9;",
  "  float foc = uFocus < 0.0 ? 1.0 : (abs(aM.x - uFocus) < 0.5 ? 1.3 : 0.25);",
  "  float depthF = 0.6 + 0.4 * clamp(pv.z * 0.5 + 0.5, 0.0, 1.0);",
  "  a *= foc * depthF * uFade;",
  "  if (uLine > 0.5) a = ((1.0 - rev) * 0.09 + rev * 0.2) * foc * uFade * (1.0 - uDis);",
  "  float edgeLight = (si == 3 || si == 6) ? 0.13 : 0.22;",
  "  vC = c; vA = a * mix(edgeLight, 1.0, clamp(front + lost, 0.0, 1.0));",
  "  if (uKitting > 0.5 && pr < 0.001 && uLine > 0.5) { vC = vec3(0.36, 0.53, 0.66); vA = 0.35; }",
  "  if (missing > 0.5) { vC = vec3(1.0, 0.29, 0.055); vA = uLine > 0.5 ? 0.87 : (aM.w < 1.5 ? 0.23 : 0.0); }",
  "  gl_PointSize = uPt * uDpr * k * (0.62 + aM.z * 0.8 + front * 1.8) * mix(1.0, 0.75, isFill);",
  "}"
].join("\n");
/* 织造台薄板：半透明的灰色玻璃板，后方略亮、前缘有一条亮边 */
var VS_PLANE = [
  "precision highp float;",
  "attribute vec3 aP;",
  "uniform mat3 uView;",
  PROJ,
  "varying vec3 vW;",
  "void main(){ vec3 pv = uView * aP; float k; vec2 sp = toScreen(pv, k); gl_Position = toClip(sp); vW = aP; }"
].join("\n");
var FS_PLANE = [
  "precision mediump float;",
  "varying vec3 vW; uniform float uDel;",
  "void main(){",
  "  float zf = clamp(0.5 - vW.z / 2.56, 0.0, 1.0);",
  "  float edge = max(1.0 - smoothstep(0.0, 0.035, 1.28 - abs(vW.z)), 1.0 - smoothstep(0.0, 0.035, 2.44 - abs(vW.x)));",
  "  float a = 0.15 + 0.13 * zf + edge * 0.3 + uDel * 0.04;",
  "  vec3 c = mix(vec3(0.6, 0.62, 0.68), vec3(0.8, 0.82, 0.88), zf);",
  "  gl_FragColor = vec4(c * a, a);",
  "}"
].join("\n");

/* 公共光照：钥匙光（左上暖白）+ 补光（右侧冷蓝）+ 天/地半球环境光 + 粗糙高光，线性计算后做 gamma */
var LIGHT = [
  "float h3(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }",
  "vec3 shade(vec3 n, vec3 alb, float gs, float sh){",
  "  vec3 Lk = normalize(vec3(-0.55, 0.72, 0.45)), Lf = normalize(vec3(0.75, 0.15, 0.55)), Vv = vec3(0.0, 0.0, 1.0);",
  "  float dk = max(dot(n, Lk), 0.0), df = max(dot(n, Lf), 0.0), hemi = 0.5 + 0.5 * n.y;",
  "  vec3 amb = mix(vec3(0.035, 0.04, 0.05), vec3(0.17, 0.18, 0.21), hemi);",
  "  float sk = pow(max(dot(n, normalize(Lk + Vv)), 0.0), sh) * gs, sf = pow(max(dot(n, normalize(Lf + Vv)), 0.0), sh) * gs * 0.4;",
  "  float rim = pow(1.0 - abs(n.z), 4.0);",
  "  return alb * (amb + vec3(1.0, 0.96, 0.9) * dk * 1.25 + vec3(0.55, 0.65, 0.85) * df * 0.4) + vec3(1.0, 0.97, 0.92) * sk + vec3(0.7, 0.8, 1.0) * sf + rim * vec3(0.25, 0.32, 0.45) * 0.22;",
  "}"
].join("\n");

/* 机械：写实材质（深色金属 / 喷涂灰 / 指示灯 / 玻璃 / 太阳能板 / 橡胶 / 金箔 / 工业橙 / 铝 / 黄铜） */
var VS_MESH = [
  "precision highp float;",
  "attribute vec3 aP; attribute vec3 aN; attribute float aMat;",
  "uniform mat3 uObj, uPR; uniform vec3 uPT;",
  "uniform vec2 uRes; uniform vec2 uCtr; uniform float uScl; uniform float uCam;",
  "varying vec3 vN; varying vec3 vL; varying float vMat;",
  "void main(){",
  "  vec3 p = uPR * aP + uPT;",
  "  vec3 pv = uObj * p;",
  "  float k = uCam / max(uCam - pv.z, 0.25);",
  "  vec2 sp = uCtr + vec2(pv.x, -pv.y) * uScl * k;",
  "  gl_Position = vec4(sp.x / uRes.x * 2.0 - 1.0, 1.0 - sp.y / uRes.y * 2.0, clamp(-pv.z * 0.1, -0.99, 0.99), 1.0);",
  "  vN = uObj * (uPR * aN); vL = aP; vMat = aMat;",
  "}"
].join("\n");
var FS_MESH = [
  "precision mediump float;",
  "varying vec3 vN; varying vec3 vL; varying float vMat;",
  "uniform vec3 uAcc; uniform float uAct, uTime, uFade;",
  LIGHT,
  "void main(){",
  "  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;",
  "  float m = vMat; vec3 alb = vec3(0.3); float gs = 0.25, sh = 24.0; vec3 em = vec3(0.0);",
  "  if (m < 0.5) { alb = vec3(0.1, 0.105, 0.115); gs = 0.3; sh = 30.0; }",
  "  else if (m < 1.5) { alb = vec3(0.5, 0.51, 0.53); gs = 0.16; sh = 14.0; }",
  "  else if (m < 2.5) { alb = vec3(0.0); em = uAcc * (1.1 + 1.6 * uAct) + 0.2; }",
  "  else if (m < 3.5) { alb = vec3(0.012, 0.016, 0.024); gs = 0.9; sh = 90.0; em = uAcc * 0.04; }",
  "  else if (m < 4.5) { alb = vec3(0.025, 0.045, 0.11); gs = 0.6; sh = 60.0; float g = max(step(0.93, fract(vL.x * 11.0)), step(0.9, fract(vL.z * 7.0))); alb = mix(alb, vec3(0.32, 0.35, 0.4), g); }",
  "  else if (m < 5.5) { alb = vec3(0.03, 0.03, 0.035); gs = 0.08; sh = 10.0; }",
  "  else if (m < 6.5) { float c = h3(floor(vL * 42.0)); alb = vec3(0.6, 0.42, 0.13) * (0.62 + 0.6 * c); gs = 0.75; sh = 34.0; }",
  "  else if (m < 7.5) { alb = vec3(0.72, 0.3, 0.05); gs = 0.2; sh = 18.0; }",
  "  else if (m < 8.5) { alb = vec3(0.6, 0.62, 0.65); gs = 0.45; sh = 40.0; }",
  "  else { alb = vec3(0.55, 0.38, 0.15); gs = 0.55; sh = 40.0; }",
  "  alb *= 1.0 + (h3(floor(vL * 230.0)) - 0.5) * 0.07;",
  "  vec3 col = shade(n, alb, gs, sh);",
  "  col += alb * uAcc * max(-n.y, 0.0) * (0.3 + 0.55 * uAct);",
  "  col += em;",
  "  col = pow(max(col, vec3(0.0)), vec3(0.4545));",
  "  gl_FragColor = vec4(col * uFade, uFade);",
  "}"
].join("\n");

/* 织造台实体：石板 + 项目模型（细管 / 面）。已织部分是真实的混凝土/钢材质，前沿熔融发光、刚织好的部分慢慢冷却 */
var VS_SOLID = [
  "precision highp float;",
  "attribute vec3 aP; attribute vec3 aN; attribute vec4 aA;",
  "uniform mat3 uView; uniform mediump float uDel; uniform float uShortage[8]; varying mediump float vShort;",
  "uniform float uProg[8]; uniform vec3 uCol[8]; uniform vec3 uOffset[8];",
  PROJ,
  "varying vec3 vN; varying vec3 vW; varying vec4 vA; varying float vPr; varying vec3 vC;",
  "void main(){",
  "  int si = int(aA.x + 0.5);",
  "  vPr = aA.z > 1.5 ? 2.0 : uProg[si]; vShort = uShortage[si];",
  "  vC = aA.z > 1.5 ? vec3(0.5) : uCol[si];",
  "  vec3 p = aP; if (aA.z < 1.5) { p += uOffset[si]; p.y += uDel * 0.03; }",
  "  vec3 pv = uView * p; float k; vec2 sp = toScreen(pv, k); gl_Position = toClip(sp); gl_Position.z = clamp(-pv.z * 0.1, -0.99, 0.99);",
  "  vN = uView * aN; vW = aP; vA = aA;",
  "}"
].join("\n");
var FS_SOLID = [
  "precision mediump float;",
  "varying vec3 vN; varying vec3 vW; varying vec4 vA; varying float vPr; varying vec3 vC;",
  "uniform float uTime, uVerify, uDel, uDis, uFocus; varying mediump float vShort;",
  "uniform vec3 uHP[4]; uniform vec3 uHC[4];",
  LIGHT,
  "void main(){",
  "  float o = vA.y; bool slab = vA.z > 1.5; float lim = vPr;",
  "  if (!slab) { lim = min(lim, 1.0 - uDis * 1.05); if (o > lim + 0.0005) discard; }",
  "  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;",
  "  vec3 col; vec3 em = vec3(0.0);",
  "  if (slab) {",
  "    vec3 alb = vec3(0.05, 0.055, 0.065);",
  "    if (vW.y > -0.001) {",
  "      float gx = 1.0 - smoothstep(0.0, 0.006, abs(fract(vW.x * 4.0) - 0.5) - 0.494);",
  "      float gz = 1.0 - smoothstep(0.0, 0.006, abs(fract(vW.z * 4.0) - 0.5) - 0.494);",
  "      alb += vec3(0.018, 0.022, 0.03) * max(gx, gz);",
  "      alb *= 0.9 + 0.2 * h3(floor(vW * 60.0));",
  "      for (int i = 0; i < 4; i++) { vec2 d = vW.xz - uHP[i].xz; float w = exp(-dot(d, d) * 16.0) * uHP[i].y; em += uHC[i] * w * 0.28; }",
  "    } else { alb = vec3(0.035, 0.04, 0.05); em = vec3(0.05, 0.03, 0.09) * smoothstep(-0.14, -0.02, vW.y) * 0.6; }",
  "    col = shade(n, alb, 0.35, 40.0) + em;",
  "  } else {",
  "    vec3 alb = mix(vec3(0.44, 0.45, 0.48), vC, 0.1);",
  "    if (vA.x < 0.5 || abs(vA.x - 2.0) < 0.5) alb = vec3(0.12, 0.22, 0.25); if (abs(vA.x - 4.0) < 0.5) alb = vec3(0.055, 0.54, 0.57); if (abs(vA.x - 5.0) < 0.5) alb = vec3(0.68, 0.32, 0.12);",
  "    if (vShort > 0.5) discard;",
  "    alb *= 1.0 + (h3(floor(vW * 140.0)) - 0.5) * 0.12;",
  "    col = shade(n, alb, vA.z > 0.5 ? 0.6 : 0.3, vA.z > 0.5 ? 60.0 : 26.0);",
  "    float age = lim - o;",
  "    float front = lim < 0.999 ? exp(-age * age * 4000.0) : 0.0;",
  "    float warm = lim < 0.999 ? exp(-age * 16.0) : 0.0;",
  "    float fk = vA.z > 0.5 ? 0.35 : 1.0;",
  "    col += (vC * warm * 0.45 + mix(vC, vec3(1.0, 0.95, 0.85), 0.5) * front * 2.2) * fk;",
  "    if (uVerify > -1.0) { float vq = (vW.y - uVerify) * 14.0; col += vec3(0.45, 0.72, 1.0) * exp(-vq * vq) * 0.8; }",
  "    col += uDel * vec3(0.1, 0.16, 0.24) * (0.5 + 0.5 * sin(uTime * 4.0 + vW.y * 10.0));",
  "    if (uFocus >= 0.0 && abs(vA.x - uFocus) > 0.5) col *= 0.65;",
  "  }",
  "  col = pow(max(col, vec3(0.0)), vec3(0.4545));",
  "  gl_FragColor = vec4(col, 1.0);",
  "}"
].join("\n");

/* 喷射光丝：每根丝是一条屏幕空间的光带，横向高斯光晕 + 白热芯，沿丝快速冲刷的「喷射」光团 */
var VS_STRAND = [
  "precision highp float;",
  "attribute vec2 aXY; attribute vec4 aS; attribute vec4 aC;",
  "uniform vec2 uRes;",
  "varying vec4 vS; varying vec4 vC;",
  "void main(){ gl_Position = vec4(aXY.x / uRes.x * 2.0 - 1.0, 1.0 - aXY.y / uRes.y * 2.0, 0.0, 1.0); vS = aS; vC = aC; }"
].join("\n");
var FS_STRAND = [
  "precision mediump float;",
  "varying vec4 vS; varying vec4 vC; uniform float uTime;",
  "void main(){",
  "  float v = vS.y, u = vS.x, d = vS.z, sd = vS.w;",
  "  float base = min(vC.a, 1.0), las = clamp(vC.a - 1.0, 0.0, 1.0);",
  "  float halo = exp(-v * v * 3.5), core = exp(-v * v * 30.0), hot = exp(-v * v * 160.0);",
  "  float wave = 0.5 + 0.5 * sin((d - uTime * (60.0 + 40.0 * sd + las * 240.0)) / (36.0 + sd * 40.0));",
  "  float per = 200.0 + sd * 220.0, ph = fract((uTime * (180.0 + las * 480.0) - d) / per + sd * 5.0);",
  "  float pulse = smoothstep(0.0, 0.05, ph) * pow(1.0 - ph, 5.0);",
  "  float src = exp(-d / (16.0 + las * 26.0)), endF = exp(-(1.0 - u) * 28.0);",
  "  float flick = 0.85 + 0.15 * sin(uTime * 43.0 + sd * 31.0);",
  "  float a = base * (halo * (0.05 + 0.04 * wave) + core * (0.2 + 0.14 * wave + 0.25 * pulse) + hot * 0.12 + (halo * 0.25 + core * 0.4) * src + (halo * 0.2 + core * 0.3) * endF);",
  "  a += las * flick * (halo * (0.1 + 0.25 * pulse) + core * (0.45 + 0.7 * pulse) + hot * 0.9 + (halo * 0.7 + core) * (src * 1.3 + endF * 0.8));",
  "  vec3 col = mix(vC.rgb, vec3(1.0), clamp(hot * (0.3 + 0.55 * las) + src * 0.45 * las + pulse * hot * 0.5, 0.0, 1.0)) * a;",
  "  gl_FragColor = vec4(col, a);",
  "}"
].join("\n");

var P_STAR, P_PRJ, P_MESH, P_SOLID, P_STRAND, P_PLANE, B = {}, STAR_N = 0, EXT32 = null;
function glSetup() {
  function shd(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s)); return s; }
  function prog(vs, fs) { var p = gl.createProgram(); gl.attachShader(p, shd(gl.VERTEX_SHADER, vs)); gl.attachShader(p, shd(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p)); p.u = {}; p.a = {}; return p; }
  EXT32 = gl.getExtension("OES_element_index_uint");
  P_STAR = prog(VS_STAR, FS_SOFT); P_PRJ = prog(VS_PRJ, FS_SOFT); P_MESH = prog(VS_MESH, FS_MESH); P_SOLID = prog(VS_SOLID, FS_SOLID); P_STRAND = prog(VS_STRAND, FS_STRAND); P_PLANE = prog(VS_PLANE, FS_PLANE);
  var i;
  R = mulberry32(4242);
  MO.forEach(function (o) { o.bP = gbuf(new Float32Array(o.V)); o.bN = gbuf(new Float32Array(o.N)); o.bM = gbuf(new Float32Array(o.M)); o.bI = gibuf(new Uint16Array(o.I)); });
  STAR_N = NARROW ? 380 : 900;
  var sv = new Float32Array(STAR_N * 4);
  for (i = 0; i < STAR_N; i++) { sv[i * 4] = R(); sv[i * 4 + 1] = R(); sv[i * 4 + 2] = 0.8 + Math.pow(R(), 4) * 2.2; sv[i * 4 + 3] = R(); }
  B.sv = gbuf(sv);
  B.gP = gbuf(GROUND.pos); B.gM = gbuf(GROUND.meta); B.gI = gibuf(GROUND.idx);
  B.cP = gbuf(CLOUD.pos); B.cM = gbuf(CLOUD.meta);
  B.pl = gbuf(new Float32Array([-2.44, 0, -1.28, 2.44, 0, -1.28, -2.44, 0, 1.28, 2.44, 0, 1.28]));
  B.lP = gbuf(SLABM.pos); B.lN = gbuf(SLABM.nrm); B.lA = gbuf(SLABM.att); B.lI = gibuf(SLABM.idx);
  B.mP = gbuf(MODELS[0].pos, gl.DYNAMIC_DRAW); B.mM = gbuf(MODELS[0].meta, gl.DYNAMIC_DRAW); B.mI = gibuf(MODELS[0].idx, gl.DYNAMIC_DRAW);
  B.sP = gbuf(SOLIDS[0].pos, gl.DYNAMIC_DRAW); B.sN = gbuf(SOLIDS[0].nrm, gl.DYNAMIC_DRAW); B.sA = gbuf(SOLIDS[0].att, gl.DYNAMIC_DRAW); B.sI = gibuf(SOLIDS[0].idx, gl.DYNAMIC_DRAW);
  B.str = gl.createBuffer(); B.strI = gl.createBuffer();
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
}
function gbuf(data, usage) { var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, usage || gl.STATIC_DRAW); return b; }
function gibuf(data, usage) { var b = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, usage || gl.STATIC_DRAW); return b; }
function uploadModel() {
  if (!gl) return;
  var m = curModel(), s = SOLIDS[ST.job];
  gl.bindBuffer(gl.ARRAY_BUFFER, B.mP); gl.bufferData(gl.ARRAY_BUFFER, m.pos, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, B.mM); gl.bufferData(gl.ARRAY_BUFFER, m.meta, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, B.mI); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, B.sP); gl.bufferData(gl.ARRAY_BUFFER, s.pos, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, B.sN); gl.bufferData(gl.ARRAY_BUFFER, s.nrm, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, B.sA); gl.bufferData(gl.ARRAY_BUFFER, s.att, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, B.sI); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, s.idx, gl.DYNAMIC_DRAW);
}
function U(p, n) { if (!(n in p.u)) p.u[n] = gl.getUniformLocation(p, n); return p.u[n]; }
function attr(p, name, b, size, stride, off) { if (!(name in p.a)) p.a[name] = gl.getAttribLocation(p, name); var loc = p.a[name]; if (loc < 0) return; gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride || 0, off || 0); }
function unbindAll() { for (var i = 0; i < 8; i++) gl.disableVertexAttribArray(i); }
function setProj(p, cx, cy, s) {
  gl.uniform2f(U(p, "uRes"), glc.width, glc.height);
  gl.uniform2f(U(p, "uCtr"), cx * L.dpr, cy * L.dpr);
  gl.uniform1f(U(p, "uScl"), s * L.dpr);
  gl.uniform1f(U(p, "uCam"), CAM);
}

/* =====================================================================
   8. 布局：总控机械在中栏顶部正中，8 台织机挂在下方一排，织位卡在中部，织造台在底部
   ===================================================================== */
var CAM = 6.0, zoom = 1, yawDrag = 0, pitchDrag = 0, yawVel = 0, pitchVel = 0;
var MODES = [{ zh: "环绕", pitch: 0.42, sway: 0.6 }, { zh: "正视", pitch: 0.14, sway: 0 }, { zh: "俯瞰", pitch: 0.98, sway: 0.3 }];
var modeI = 0, pitchBase = 0.42, swayT = 0;
var L = { w: 1, h: 1, dpr: 1, bs: 0.5, frX: 0, frY: 0, narrow: false, core: { x: 0, y: 0, S: 60 }, stg: { x: 0, y: 0, S: 150 }, sp: [], spS: 0.8, cards: [], beamY: 0, beamX0: 0, beamX1: 0, slab: [], labs: false };
var fx = fxc.getContext("2d"), appR = null;
var TINT = AGENTS.map(function (a) { return tint(a.c, 0.4); });

function rel(el) { var r = el.getBoundingClientRect(); return { x: r.left - appR.left, y: r.top - appR.top, w: r.width, h: r.height }; }
function layout() {
  if (host.hidden || host.clientWidth < 2) return;
  appR = host.getBoundingClientRect();
  L.w = Math.max(1, appR.width); L.h = Math.max(1, appR.height);
  L.narrow = L.w <= 860 || L.w / L.h <= 1;
  nr.classList.toggle("narrow", L.narrow);
  var fr = fitIn.getBoundingClientRect();
  L.bs = Math.min(fr.width / 1920, fr.height / 1080) || 0.2;
  board.style.width = (fr.width / L.bs) + "px"; board.style.height = (fr.height / L.bs) + "px";
  board.style.setProperty("--s", L.bs);
  L.frX = fr.left - appR.left; L.frY = fr.top - appR.top;
  L.dpr = Math.min(window.devicePixelRatio || 1, L.narrow ? 1.5 : 1.75);
  glc.width = Math.round(L.w * L.dpr); glc.height = Math.round(L.h * L.dpr);
  fxc.width = glc.width; fxc.height = glc.height;
  var i;
  if (!L.narrow) {
    var sideWidth = $("chat").getBoundingClientRect().width;
    mid.style.left = mid.style.right = ((sideWidth + 22) / L.bs) + "px";
    var mx = mid.offsetLeft, mw = mid.offsetWidth, bs = L.bs;
    var B2 = function (bx, by) { return [L.frX + bx * bs, L.frY + by * bs]; };
    var cc = B2(mx + mw / 2, 146);
    L.core = { x: cc[0], y: cc[1], S: 70 * bs };
    L.spS = 0.92 * bs; L.uS = 61 * bs;
    for (i = 0; i < AGENTS.length; i++) { var p = B2(mx + SPF[i][0] * mw, SPF[i][1]); L.sp[i] = { x: p[0], y: p[1] }; }
    L.cards = cardEls.map(function (c) { return rel(c.el); });
    var lr = rel(loomBox);
    L.beamY = lr.y - 9 * bs; L.beamX0 = lr.x - 10 * bs; L.beamX1 = lr.x + lr.w + 10 * bs;
    var sc = B2(mx + mw / 2, mid.offsetHeight - 142);
    L.stg = { x: sc[0], y: sc[1], S: Math.min(mw * 0.158, 178) * bs };
    L.labs = true;
  } else {
    var w = L.w, h = L.h;
    L.core = { x: w / 2, y: 72 + h * 0.045, S: Math.min(w, h) * 0.07 };
    L.spS = clamp(w / 900, 0.36, 0.6); L.uS = 52 * L.spS;
    for (i = 0; i < AGENTS.length; i++) L.sp[i] = { x: w * (0.135 + i * 0.243), y: L.core.y + L.core.S * 2.9 + (i % 2 ? 0 : 22 * L.spS) + 16 };
    var n = job().secs.length, x0 = w * 0.07, bw = w * 0.86 / n;
    L.cards = []; for (i = 0; i < n; i++) L.cards.push({ x: x0 + i * bw + 2, y: h * 0.43, w: bw - 4, h: 0 });
    L.beamY = h * 0.43; L.beamX0 = x0; L.beamX1 = w - x0;
    L.stg = { x: w / 2, y: h * 0.73, S: Math.min(w * 0.22, h * 0.12) };
    L.labs = false;
  }
  var corridor = Math.max(1, L.beamX1 - L.beamX0);
  splitDeck = wantsSplitDeck();
  host.toggleAttribute("data-deck-split", splitDeck);
  host.style.setProperty("--deck-width", corridor + "px");
  host.style.setProperty("--deck-y", Math.round(L.beamY + (L.narrow ? 16 : 15 * L.bs)) + "px");
  if (splitDeck) {
    L.stg.x += corridor * .27;
    L.stg.S *= .56;
    L.stg.y -= L.h * .035;
  }
}

/* 视角：环绕（轻摆）/ 正视 / 俯瞰；拖动可转 */
var VIEW = mRotX(0.42);
function viewMat(dt) {
  var md = MODES[modeI];
  swayT += dt * (RM ? 0 : 1);
  pitchBase += (md.pitch - pitchBase) * Math.min(1, dt * 2.5);
  var pitch = clamp(pitchBase + pitchDrag, -0.1, 1.3);
  var yaw = Math.sin(swayT * 0.11) * md.sway + yawDrag;
  return mMul(mRotX(pitch), mRotY(yaw));
}
function projStage(v) {
  var pv = mApply(VIEW, v), k = CAM / Math.max(CAM - pv[2], 0.25), S = L.stg.S * zoom;
  return [L.stg.x + pv[0] * S * k, L.stg.y - pv[1] * S * k, pv[2]];
}

/* =====================================================================
   9. 状态机：下达 → 吐丝 → 织网（3 路并行）→ 校验 → 交付 → 收网
   ===================================================================== */
var PHASES = ["dispatch", "spin", "weave", "verify", "deliver", "unravel"];
var PD = { dispatch: 2.8, spin: 2.3, verify: 2.8, deliver: 3.0, unravel: 2.2 };
var ST = { job: 0, ph: 0, t: 0, prog: [], start: [], dur: [], doneF: [], startF: [], grow: 0, desc: 0, verY: -9, del: 0, dis: 0, pulse: -1, focus: -1, focusT: 0, jobT0: 0, weaveT: 14, cardsOn: 0, tension: 0.4 };
var now = 0;
function job() { return JOBS[ST.job]; }
function phDur(k) { return k === "weave" ? ST.weaveT : PD[k]; }
function planJob() {
  var n = job().secs.length, rr = mulberry32(300 + ST.job * 13 + Math.floor(Math.random() * 1000)), mx = 0, i;
  ST.prog = []; ST.start = []; ST.dur = []; ST.doneF = []; ST.startF = [];
  for (i = 0; i < n; i++) {
    ST.prog.push(0); ST.doneF.push(0); ST.startF.push(0);
    ST.start.push(0.15 + i * 1.5 + rr() * 0.35); ST.dur.push(4.1 + rr() * 1.4);
    mx = Math.max(mx, ST.start[i] + ST.dur[i]);
  }
  ST.weaveT = mx + 0.5;
}
function enterPhase() {
  var k = PHASES[ST.ph];
  if (k === "dispatch" || k === "deliver") ST.pulse = 0;
}
function nextJob() {
  ST.job = (ST.job + 1) % JOBS.length;
  ST.ph = 0; ST.t = 0; ST.jobT0 = now;
  DROPS.length = 0; SPL.length = 0;
  planJob(); uploadModel(); syncCols(); buildJobDom(); buildStrands(); enterPhase();
}
function startSec(i) { ST.startF[i] = 1; }
function doneSec(i) { ST.doneF[i] = 1; ST.prog[i] = 1; }
function updateState(dt) {
  var k = PHASES[ST.ph], dur = phDur(k), n = job().secs.length, i;
  ST.t += dt;
  if (ST.t >= dur) {
    ST.t -= dur;
    if (k === "weave") for (i = 0; i < n; i++) { if (!ST.startF[i]) startSec(i); if (!ST.doneF[i]) doneSec(i); }
    ST.ph++;
    if (ST.ph >= PHASES.length) { nextJob(); return; }
    enterPhase();
    k = PHASES[ST.ph]; dur = phDur(k);
  }
  var p = ST.t / dur, act = 0;
  ST.verY = -9; ST.del = 0; ST.dis = 0;
  if (k === "dispatch") { ST.desc = ease(p * 1.3); ST.grow = 1; ST.cardsOn = Math.min(n, Math.floor(clamp(p * 1.3, 0, 1) * n + 0.0001)); for (i = 0; i < n; i++) ST.prog[i] = 0; }
  else if (k === "spin") { ST.desc = 1; ST.grow = 1; ST.cardsOn = n; }
  else if (k === "weave") {
    ST.desc = 1; ST.grow = 1; ST.cardsOn = n;
    for (i = 0; i < n; i++) {
      var q = clamp((ST.t - ST.start[i]) / ST.dur[i], 0, 1);
      if (q > 0 && !ST.startF[i]) startSec(i);
      if (!ST.doneF[i]) ST.prog[i] = q;
      if (q >= 1 && !ST.doneF[i]) doneSec(i);
      if (q > 0 && q < 1) act++;
    }

  }
  else if (k === "verify") { ST.grow = 1; ST.verY = -0.06 + 1.26 * ease(p); for (i = 0; i < n; i++) ST.prog[i] = 1; }
  else if (k === "deliver") { ST.grow = 1; ST.del = Math.sin(Math.PI * clamp(p, 0, 1)); }
  else if (k === "unravel") { ST.dis = easeIO(p); ST.grow = 1; ST.desc = 1 - 0.55 * ease(p); ST.cardsOn = Math.round(n * (1 - ease(p))); }
  ST.tension += ((k === "weave" ? 0.5 + act * 0.18 : k === "spin" ? 0.6 : 0.3) - ST.tension) * Math.min(1, dt * 2);
  if (ST.pulse >= 0) { ST.pulse += dt / 1.8; if (ST.pulse >= 1) ST.pulse = -1; }
  if (ST.focus >= 0) { ST.focusT -= dt; if (ST.focusT <= 0) ST.focus = -1; }
}
/* 每台织机当前在干什么：act 0~1 决定部件转速、发光强度、丝光亮度 */
function spiderState(index) {
  var status = live && live.agents ? live.agents[AGENTS[index].id] : "";
  if (orbitCue && live) {
    var id = AGENTS[index].id, on = orbitCue.role === id;
    var seen = orbitCue.done.includes(id);
    var state = on ? "运行中" : seen ? (status === "失败" || status === "部分完成" ? status : "完成") : "待命";
    return { act: on ? 1 : .28, st: state };
  }
  var active = status === "运行中" || (!live && PHASES[ST.ph] === "weave");
  return { act: active ? 1 : 0.28, st: live ? (status || "待命") : ["识别提问","检索证据","核对依据","汇总报告"][index] };
}

var SPP = [], SPS = [];
var BOB = AGENTS.map(function (a, i) { return mulberry32(700 + i * 17)() * TAU; });
var MACT = 0.5, ZERO3 = [0, 0, 0];
function computeSpiders(t) {
  for (var i = 0; i < AGENTS.length; i++) {
    var b = L.sp[i]; if (!b) continue;
    var s = spiderState(i); SPS[i] = s;
    var y = b.y - (1 - ST.desc) * 12 * L.bs + Math.sin(t * 0.9 + BOB[i]) * 4 * L.bs + (s.act > 0.9 ? Math.sin(t * 7 + i) * 1 * L.bs : 0);
    SPP[i] = { x: b.x + Math.sin(t * 0.37 + i * 2.1) * 2.5 * L.bs, y: y, sc: L.spS, act: s.act, ex: 0, ey: 0, tx: 0, ty: 0 };
  }
  var k = PHASES[ST.ph], pulse = ST.pulse >= 0 ? Math.sin(Math.PI * ST.pulse) : 0;
  MACT = orbitCue ? (orbitCue.role === 'dispatch' ? 1 : .72) : k === "dispatch" || k === "deliver" ? 0.85 + 0.15 * pulse : 0.45 + 0.4 * pulse;
}
/* 机械的整体朝向与部件联动（子部件跟着父部件走：机械臂、云台）；活跃度越高转得越快 */
function updateMachines(dt, t) {
  var i;
  for (i = 0; i < MO.length; i++) {
    var o = MO[i], act = i === MASTER ? MACT : (SPP[i] ? SPP[i].act : 0.3), j;
    o.t += dt * (RM ? 0.3 : (0.45 + act * 1.3));
    o.view = mMul(mRotX(o.pitch), mRotY(o.yaw + o.spin * o.t + (i === MASTER ? Math.sin(t * 0.2) * 0.12 : Math.sin(t * 0.3 + i) * 0.06)));
    for (j = 0; j < o.parts.length; j++) {
      var pt = o.parts[j], Rl = I3, Tl = ZERO3;
      if (pt.ax) {
        var ang = pt.ao + pt.sp * o.t + (pt.osc ? pt.osc * Math.sin(t * pt.of * (RM ? 0.3 : 1) + i * 1.7 + pt.ph) : pt.ph);
        Rl = rotAxis(pt.ax, ang); var rp = mApply(Rl, pt.pv); Tl = [pt.pv[0] - rp[0], pt.pv[1] - rp[1], pt.pv[2] - rp[2]];
      }
      if (pt.pa >= 0) { var PP = o.parts[pt.pa], tt = mApply(PP.R, Tl); pt.R = mMul(PP.R, Rl); pt.T = [tt[0] + PP.T[0], tt[1] + PP.T[1], tt[2] + PP.T[2]]; }
      else { pt.R = Rl; pt.T = Tl; }
    }
  }
  for (i = 0; i < AGENTS.length; i++) { var sp = SPP[i]; if (!sp) continue; var e = projObj(i, MO[i].emit, MO[i].ep), tp = projObj(i, MO[i].top, 0); sp.ex = e[0]; sp.ey = e[1]; sp.tx = tp[0]; sp.ty = tp[1]; }
}
function projObj(i, p, pi) {
  var o = MO[i], pos = i === MASTER ? L.core : SPP[i], sc = (i === MASTER ? L.core.S : L.uS) * o.s;
  if (pi) { var pt = o.parts[pi]; if (pt) { var q = mApply(pt.R, p); p = [q[0] + pt.T[0], q[1] + pt.T[1], q[2] + pt.T[2]]; } }
  var pv = mApply(o.view || I3, p), k = CAM / Math.max(CAM - pv[2], 0.25);
  return [pos.x + pv[0] * sc * k, pos.y - pv[1] * sc * k];
}

/* 喷射光丝：每台织机向自己负责的织位喷 7 束，再向别的织位甩几束，校验机连向所有织位（GPU 光带） */
var STR = [], STRN = 34, SGEO = null, SIDX = 0;
var SPAL = [[1, 0.88, 0.8], [1, 0.56, 0.72], [1, 0.78, 0.46], [1, 0.5, 0.48], [1, 0.95, 0.9], [0.86, 0.7, 1]];
function mkStrand(a, c, own, rr, chk) {
  var base = hex3(AGENTS[a].c), pal = SPAL[Math.floor(rr() * SPAL.length)], mx = 0.3 + rr() * 0.35;
  return { a: a, c: c, own: own, chk: !!chk, dx: (rr() - 0.5) * 10, ex: own ? -0.12 + rr() * 1.24 : 0.1 + rr() * 0.8, sag: rr(), fan: rr(), bend: rr() - 0.5, lift: rr() * 18, sd: rr() < 0.5 ? -1 : 1, seed: rr(), d: rr() * 0.35,
    col: [base[0] + (pal[0] - base[0]) * mx, base[1] + (pal[1] - base[1]) * mx, base[2] + (pal[2] - base[2]) * mx] };
}
function buildStrands() {
  STR = [];
  var j = job(), n = j.secs.length, rr = mulberry32(77 + ST.job * 31), i, k, a;
  for (a = 0; a < AGENTS.length; a++) {
    for (i = 0; i < n; i++) {
      for (k = 0; k < 4; k++) STR.push(mkStrand(a, i, k < 2, rr, a === 2));
    }
  }
  SGEO = new Float32Array(STR.length * STRN * 2 * 10);
  var idx = new Uint16Array(STR.length * (STRN - 1) * 6), q = 0;
  for (i = 0; i < STR.length; i++) for (k = 0; k < STRN - 1; k++) { var b = (i * STRN + k) * 2; idx[q++] = b; idx[q++] = b + 1; idx[q++] = b + 3; idx[q++] = b; idx[q++] = b + 3; idx[q++] = b + 2; }
  SIDX = q;
  if (gl) { gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, B.strI); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW); }
}
/* 光丝强度：0~1 是平时一直亮着的光束；超过 1 的部分是「开工激光」（白热芯 + 闪烁 + 高速光团） */
function strandInt(s, k) {
  if (orbitCue && live) {
    if (orbitCue.role === AGENTS[s.a].id) return s.own ? 2.0 : .72;
    return s.own ? .46 : .24;
  }
  if (live) return (SPS[s.a] && SPS[s.a].act > 0.9) ? (shortageFlags[s.c] ? 1.8 : 0.88) : (live.agents && live.agents[AGENTS[s.a].id] === "完成" ? 0.47 : 0.22);
  var base = s.own ? 0.5 : (s.chk ? 0.26 : 0.4);
  if (k === "spin") return s.own ? 1.65 : base;
  if (k === "weave") { var p = ST.prog[s.c], on = p > 0 && p < 1; if (s.own && on) return 2.0; return on ? 0.6 : base; }
  if (k === "verify") return s.chk ? 1.8 : base;
  if (k === "deliver") return s.own ? 0.85 : base;
  return base;
}
function splitBz(p, t) {
  var x01 = p[0] + (p[2] - p[0]) * t, y01 = p[1] + (p[3] - p[1]) * t, x12 = p[2] + (p[4] - p[2]) * t, y12 = p[3] + (p[5] - p[3]) * t, x23 = p[4] + (p[6] - p[4]) * t, y23 = p[5] + (p[7] - p[5]) * t;
  var xa = x01 + (x12 - x01) * t, ya = y01 + (y12 - y01) * t, xb = x12 + (x23 - x12) * t, yb = y12 + (y23 - y12) * t;
  return [p[0], p[1], x01, y01, xa, ya, xa + (xb - xa) * t, ya + (yb - ya) * t];
}
function fillStrandGeo() {
  var k = PHASES[ST.ph], bs = Math.max(0.5, L.bs), d = L.dpr, i, j, o = 0;
  for (i = 0; i < STR.length; i++) {
    var s = STR[i], g = clamp(ST.grow * 1.4 - s.d, 0, 1), it = strandInt(s, k), sp = SPP[s.a], cd = L.cards[s.c];
    var ok = g > 0.002 && it > 0.01 && sp && cd, cp = null;
    if (ok) {
      var x0 = sp.ex + s.dx * sp.sc * 0.2, y0 = sp.ey + 1, x3 = cd.x + cd.w * s.ex, y3 = L.beamY - s.lift * L.bs, dy = y3 - y0, dx = x3 - x0, ad = Math.abs(dx), sg = ad > 40 * L.bs ? (dx >= 0 ? 1 : -1) : s.sd;
      /* 出射角各不相同（扇形散开），落到卡片上方前先水平掠过一段，像视频里那样一层层搭在织位上 */
      cp = [x0, y0, x0 + dx * (0.1 + 0.5 * s.fan) + s.bend * 190 * L.bs, y0 + dy * (0.25 + s.sag * 0.6), x3 - sg * (ad * (0.3 + s.sag * 0.35) + (30 + 50 * s.fan) * L.bs), y3 + (1 + s.lift * 0.4) * L.bs, x3, y3];
      if (g < 1) cp = splitBz(cp, g);
    }
    var hw = (4.2 + 1.6 * Math.min(it, 1) + 3.4 * Math.max(it - 1, 0)) * bs * d, len = 0, px = 0, py = 0;
    for (j = 0; j < STRN; j++) {
      var t = j / (STRN - 1), X = 0, Y = 0, tx = 1, ty = 0;
      if (ok) {
        var u = 1 - t;
        X = u * u * u * cp[0] + 3 * u * u * t * cp[2] + 3 * u * t * t * cp[4] + t * t * t * cp[6];
        Y = u * u * u * cp[1] + 3 * u * u * t * cp[3] + 3 * u * t * t * cp[5] + t * t * t * cp[7];
        tx = 3 * u * u * (cp[2] - cp[0]) + 6 * u * t * (cp[4] - cp[2]) + 3 * t * t * (cp[6] - cp[4]);
        ty = 3 * u * u * (cp[3] - cp[1]) + 6 * u * t * (cp[5] - cp[3]) + 3 * t * t * (cp[7] - cp[5]);
      }
      if (j > 0) len += Math.sqrt((X - px) * (X - px) + (Y - py) * (Y - py));
      px = X; py = Y;
      var tl = Math.sqrt(tx * tx + ty * ty) || 1, nx = -ty / tl, ny = tx / tl, w = hw * (0.6 + 0.4 * Math.min(1, t * 5)) * (1 - 0.2 * t);
      for (var side = -1; side <= 1; side += 2) {
        SGEO[o++] = X * d + nx * w * side; SGEO[o++] = Y * d + ny * w * side;
        SGEO[o++] = t; SGEO[o++] = side; SGEO[o++] = len / bs; SGEO[o++] = s.seed;
        SGEO[o++] = s.col[0]; SGEO[o++] = s.col[1]; SGEO[o++] = s.col[2]; SGEO[o++] = ok ? it : 0;
      }
    }
  }
}
function drawStrandsGL(t) {
  if (!SGEO || !STR.length) return;
  fillStrandGeo();
  var P = P_STRAND;
  gl.useProgram(P);
  gl.bindBuffer(gl.ARRAY_BUFFER, B.str); gl.bufferData(gl.ARRAY_BUFFER, SGEO, gl.DYNAMIC_DRAW);
  attr(P, "aXY", B.str, 2, 40, 0); attr(P, "aS", B.str, 4, 40, 8); attr(P, "aC", B.str, 4, 40, 24);
  gl.uniform2f(U(P, "uRes"), glc.width, glc.height); gl.uniform1f(U(P, "uTime"), RM ? 0 : now);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, B.strI); gl.drawElements(gl.TRIANGLES, SIDX, gl.UNSIGNED_SHORT, 0);
  unbindAll();
}

/* 织机光梁：所有光丝汇到这里，正在织的织位上方更亮 */
function drawBeam(c, t) {
  if (!L.cards.length) return;
  var x0 = L.beamX0, x1 = L.beamX1, y = L.beamY, bs = Math.max(0.5, L.bs), lv = 0.25 + 0.75 * ST.grow, i, j = job();
  var g = c.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, "rgba(200,225,255,0)"); g.addColorStop(0.12, "rgba(225,238,255," + (0.6 * lv) + ")"); g.addColorStop(0.88, "rgba(255,225,200," + (0.6 * lv) + ")"); g.addColorStop(1, "rgba(255,210,180,0)");
  c.fillStyle = g; c.fillRect(x0, y - 1 * bs, x1 - x0, 2 * bs);
  var g2 = c.createLinearGradient(0, y - 14 * bs, 0, y + 10 * bs);
  g2.addColorStop(0, "rgba(160,200,255,0)"); g2.addColorStop(0.6, "rgba(190,215,255," + (0.14 * lv) + ")"); g2.addColorStop(1, "rgba(160,200,255,0)");
  c.fillStyle = g2; c.fillRect(x0, y - 14 * bs, x1 - x0, 24 * bs);
  for (i = 0; i < L.cards.length && i < j.secs.length; i++) {
    var p = ST.prog[i], on = PHASES[ST.ph] === "weave" && p > 0 && p < 1, chk = PHASES[ST.ph] === "verify";
    if (!on && !chk && PHASES[ST.ph] !== "spin") continue;
    var cd = L.cards[i], cx = cd.x + cd.w / 2, a = i, rr = (on ? 80 : 50) * bs * (1 + 0.08 * Math.sin(t * 6 + i));
    var g3 = c.createRadialGradient(0, 0, 0, 0, 0, rr);
    g3.addColorStop(0, "rgba(255,252,245," + (on ? 0.55 : 0.25) + ")"); g3.addColorStop(0.25, rgbA(partTint[a], on ? 0.45 : 0.2)); g3.addColorStop(1, rgbA(partTint[a], 0));
    c.save(); c.translate(cx, y); c.scale(1, 0.26); c.fillStyle = g3; c.beginPath(); c.arc(0, 0, rr, 0, TAU); c.fill(); c.restore();
  }
}

/* 一滴一滴：每个织位卡底部不断滴下发光的液滴，落到下方织造台正在织的位置，溅起光圈，项目就这样一点点被「滴」出来 */
var HEADS = [], HSM = [], DROPS = [], SPL = [], dropAcc = [];
function frontPoint(i) { var m = curModel(), hi = m.secStart[i] + Math.min(m.secCount[i] - 1, Math.floor(clamp(ST.prog[i], 0, 1) * m.secCount[i])); return [m.pos[hi * 3], m.pos[hi * 3 + 1], m.pos[hi * 3 + 2]]; }
function randPoint(i) { var m = curModel(), hi = m.secStart[i] + Math.floor(Math.random() * m.secCount[i]); return [m.pos[hi * 3], m.pos[hi * 3 + 1], m.pos[hi * 3 + 2]]; }
function stepDrops(dt) {
  var k = PHASES[ST.ph], j = job(), i;
  HEADS = [];
  for (i = 0; i < j.secs.length; i++) {
    var p = ST.prog[i], on = k === "weave" && p > 0 && p < 1;
    var rate = on ? 7 : (k === "weave" ? (p >= 1 ? 1.0 : 0.6) : k === "spin" ? 1.2 : k === "verify" ? 1.4 : k === "deliver" ? 0.8 : 0);
    if (k === "dispatch" && i < ST.cardsOn) rate = 0.4;
    if (dropAcc[i] === undefined) dropAcc[i] = Math.random();
    dropAcc[i] += dt * rate;
    while (dropAcc[i] >= 1) {
      dropAcc[i] -= 1;
      if (modelOnStage() && DROPS.length < 180) DROPS.push({ i: i, jx: Math.random() - 0.5, t: 0, dur: 0.48 + Math.random() * 0.22, on: on, tg: on ? null : (p >= 1 ? randPoint(i) : curModel().anchors[i]) });
    }
    var wgt = on ? 1.2 + 0.15 * Math.sin(now * 9 + i) : (p >= 1 ? 0.8 : 0.5);
    if (k === "unravel") wgt *= 1 - ST.dis;
    if (k === "verify") wgt = 0.75;
    if (k === "deliver") wgt = 0.9;
    /* 粒子云平时停在自己织位正下方的薄板后排（像视频里一排彩色星云），开织时飞到织造前沿，织完再回去 */
    var pad = [-2.0 + 4.0 * (i + 0.5) / j.secs.length, 0, -0.78 + 0.12 * Math.sin(i * 2.1)], tgp = on ? frontPoint(i) : pad, hs = HSM[i];
    if (!hs || hs.job !== ST.job) hs = HSM[i] = { x: tgp[0], z: tgp[2], job: ST.job };
    var kk = Math.min(1, dt * 3.2); hs.x += (tgp[0] - hs.x) * kk; hs.z += (tgp[2] - hs.z) * kk;
    HEADS[i] = { p: [hs.x, 0, hs.z], w: wgt, c: hex3(j.secs[i].c) };
  }
}
function drawDrops(c, dt) {
  if (!modelOnStage()) return;
  var j = job(), bs = Math.max(0.5, L.bs), ph = PHASES[ST.ph], i, k;
  for (i = 0; i < j.secs.length; i++) {
    var cd = L.cards[i]; if (!cd) continue;
    if (ph === "dispatch" && i >= ST.cardsOn) continue;
    var a = i, p = ST.prog[i], tg = (ph === "weave" && p > 0 && p < 1) ? frontPoint(i) : curModel().anchors[i], sp = projStage(tg);
    var x0 = cd.x + cd.w / 2, y0 = cd.y + cd.h + 1;
    var g = c.createLinearGradient(x0, y0, sp[0], sp[1]); g.addColorStop(0, hexA(j.secs[a].c, 0.42)); g.addColorStop(1, hexA(j.secs[a].c, 0.06));
    c.strokeStyle = g; c.lineWidth = 0.9 * bs; c.beginPath(); c.moveTo(x0, y0 + 9 * bs); c.lineTo(sp[0], sp[1]); c.stroke();
    var gd0 = c.createRadialGradient(x0, y0 + 9 * bs, 0, x0, y0 + 9 * bs, 9 * bs); gd0.addColorStop(0, "rgba(255,252,245,0.95)"); gd0.addColorStop(0.3, rgbA(partTint[a], 0.55)); gd0.addColorStop(1, hexA(j.secs[a].c, 0));
    c.fillStyle = gd0; c.beginPath(); c.arc(x0, y0 + 9 * bs, 9 * bs, 0, TAU); c.fill();
    if (!L.narrow) {
      var an = Math.atan2(sp[1] - y0, sp[0] - x0);
      c.save(); c.translate(x0, y0 + 9 * bs); c.rotate(an); c.globalCompositeOperation = "source-over";
      c.font = "500 " + Math.round(7.5 * bs) + "px JetBrains Mono, ui-monospace, monospace"; c.fillStyle = hexA(j.secs[a].c, 0.75);
      c.fillText(j.secs[i].en, 14 * bs, -4 * bs); c.restore();
    }
  }
  for (k = DROPS.length - 1; k >= 0; k--) {
    var d = DROPS[k], cd2 = L.cards[d.i]; if (!cd2 || d.i >= j.secs.length) { DROPS.splice(k, 1); continue; }
    d.t += dt / d.dur;
    var ag = d.i, e = projStage(d.on ? frontPoint(d.i) : d.tg);
    var X0 = cd2.x + cd2.w * (0.5 + d.jx * 0.04), Y0 = cd2.y + cd2.h + 9 * bs;
    if (d.t >= 1) { DROPS.splice(k, 1); if (SPL.length < 140) SPL.push({ x: e[0], y: e[1], t: 0, a: ag, big: d.on }); continue; }
    var tt = d.t, yy = Y0 + (e[1] - Y0) * tt * tt, xx = X0 + (e[0] - X0) * (tt * tt * (3 - 2 * tt));
    var t2 = Math.max(0, tt - 0.1), y2 = Y0 + (e[1] - Y0) * t2 * t2, x2 = X0 + (e[0] - X0) * (t2 * t2 * (3 - 2 * t2));
    var gd = c.createLinearGradient(x2, y2, xx, yy); gd.addColorStop(0, hexA(j.secs[ag].c, 0)); gd.addColorStop(1, rgbA(partTint[ag], 0.9));
    c.strokeStyle = gd; c.lineWidth = 1.8 * bs; c.beginPath(); c.moveTo(x2, y2); c.lineTo(xx, yy); c.stroke();
    var r = (d.on ? 5.5 : 4) * bs, gh = c.createRadialGradient(xx, yy, 0, xx, yy, r);
    gh.addColorStop(0, "rgba(255,252,245,0.95)"); gh.addColorStop(0.3, rgbA(partTint[ag], 0.6)); gh.addColorStop(1, hexA(j.secs[ag].c, 0));
    c.fillStyle = gh; c.beginPath(); c.arc(xx, yy, r, 0, TAU); c.fill();
  }
  for (k = SPL.length - 1; k >= 0; k--) {
    var s = SPL[k]; s.t += dt / (s.big ? 0.55 : 0.45);
    if (s.t >= 1) { SPL.splice(k, 1); continue; }
    var rr = (3 + (s.big ? 17 : 10) * s.t) * bs, al = 1 - s.t;
    c.strokeStyle = rgbA(partTint[s.a], 0.85 * al); c.lineWidth = 1.2 * bs;
    c.beginPath(); c.ellipse(s.x, s.y, rr, rr * 0.36, 0, 0, TAU); c.stroke();
    if (s.t < 0.3) { var gs2 = c.createRadialGradient(s.x, s.y, 0, s.x, s.y, 13 * bs); gs2.addColorStop(0, "rgba(255,250,240," + (0.9 * (1 - s.t / 0.3)) + ")"); gs2.addColorStop(1, hexA(j.secs[s.a].c, 0)); c.fillStyle = gs2; c.beginPath(); c.arc(s.x, s.y, 13 * bs, 0, TAU); c.fill(); }
  }
}
/* 薄板中央的小字（参考视频里的 STATE 标注） */
function drawStateLabel(c) {
  if (L.narrow) return;
  var p = projStage([0, 0, 0.98]), bs = Math.max(0.5, L.bs);
  c.font = "500 " + Math.round(8.5 * bs) + "px JetBrains Mono, ui-monospace, monospace"; c.textAlign = "center";
  c.fillStyle = "rgba(225,232,245,0.6)"; c.fillText(live ? (fanVisible ? "FAZEMES  /  齐套核对" : "FAZEMES  /  本轮依据") : "FAZEMES  /  装配演示", p[0], p[1]);
  c.fillStyle = "rgba(160,172,190,0.45)"; c.fillText(live ? (live.orderCode || "") : job().title, p[0], p[1] + 12 * bs);
  c.textAlign = "left";
}
/* 织造台下沿的彩色漏光（参考视频里石板底部的紫 / 绿 / 粉色光） */
var SLAB_GLOW = [[-1.85, "#9a5cff", 0.3], [-0.65, "#d070ff", 0.12], [0.65, "#40d8c0", 0.12], [1.85, "#3fe08a", 0.3]];
function drawSlabGlow(c, t) {
  var bs = Math.max(0.5, L.bs), i;
  for (i = 0; i < SLAB_GLOW.length; i++) {
    var q = SLAB_GLOW[i], p = projStage([q[0], 0, 1.28]), r = 190 * bs * (0.92 + 0.08 * Math.sin(t * 0.7 + i));
    var g = c.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, hexA(q[1], q[2] + 0.08 * ST.del)); g.addColorStop(1, hexA(q[1], 0));
    c.save(); c.translate(p[0], p[1] + 4 * bs); c.scale(1, 0.32); c.fillStyle = g; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill(); c.restore();
  }
  /* 每个落点上方的彩色光雾（粒子云本体在 GPU 里画） */
  for (i = 0; i < HEADS.length; i++) {
    var h = HEADS[i]; if (!h || h.w < 0.02) continue;
    var w = Math.min(h.w, 1.3), pp = projStage([h.p[0], 0, h.p[2]]), rr = (70 + 60 * w) * bs, col = "rgba(" + Math.round(h.c[0] * 255) + "," + Math.round(h.c[1] * 255) + "," + Math.round(h.c[2] * 255) + ",";
    var g2 = c.createRadialGradient(0, 0, 0, 0, 0, rr);
    g2.addColorStop(0, "rgba(255,250,240," + (0.16 * w) + ")"); g2.addColorStop(0.2, col + (0.2 * w) + ")"); g2.addColorStop(0.6, col + (0.06 * w) + ")"); g2.addColorStop(1, col + "0)");
    c.save(); c.translate(pp[0], pp[1]); c.scale(1, 0.5); c.fillStyle = g2; c.beginPath(); c.arc(0, 0, rr, 0, TAU); c.fill(); c.restore();
  }
}

/* 总控卫星底部的 8 个发射喇叭 → 各台织机的链路：下达任务时，指令光点往下送；交付时往回送 */
function drawDrag(c, t) {
  var k = PHASES[ST.ph], bs = Math.max(0.5, L.bs), i;
  var hot = k === "dispatch" ? 1 : (k === "deliver" ? 0.8 : 0.35);
  for (i = 0; i < AGENTS.length; i++) {
    var sp = SPP[i]; if (!sp) continue;
    var p0 = projObj(MASTER, PORT_TIP[[0, 2, 5, 7][i]], 0);
    var x0 = p0[0], y0 = p0[1], tx = sp.tx, ty = sp.ty;
    var qx = (x0 + tx) / 2, qy = (y0 + ty) / 2 + 16 * bs;
    c.setLineDash([]); c.lineWidth = 0.8 * bs; c.strokeStyle = "rgba(205,222,255,0.22)";
    c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo(qx, qy, tx, ty); c.stroke();
    c.fillStyle = hexA(AGENTS[i].c, 0.85); c.fillRect(x0 - 1.5 * bs, y0 - 1.5 * bs, 3 * bs, 3 * bs);
    if (orbitCue && live) {
      var active = orbitCue.role === AGENTS[i].id, dispatch = orbitCue.role === "dispatch";
      var strength = active ? .83 : dispatch ? .32 : .13;
      // Fan out from the existing transmitter sockets. Opposite travel shows the return channel.
      for (var ray = -2; ray <= 2; ray++) {
        c.lineWidth = (active && ray === 0 ? 2 : .9) * bs;
        c.strokeStyle = ray === 0 && active ? "rgba(255,245,221,.84)" : rgbA(TINT[i], strength * .72);
        var bend = ray * 12 * bs;
        c.beginPath(); c.moveTo(x0 + ray * bs, y0); c.quadraticCurveTo(qx + bend, qy + bend, tx + ray * bs, ty); c.stroke();
        if (!RM) {
          c.setLineDash([7 * bs, (38 + 8 * Math.abs(ray)) * bs]);
          c.lineDashOffset = (ray % 2 ? -1 : 1) * t * (active ? 135 : 60) + ray * 13;
          c.strokeStyle = rgbA(TINT[i], strength); c.stroke(); c.setLineDash([]);
        }
      }
      if (!gl) {
        for (var strand = 0; strand < 9; strand++) {
          var end = L.beamX0 + (L.beamX1 - L.beamX0) * (strand + .5) / 9;
          c.strokeStyle = rgbA(TINT[i], active ? .86 : .22);
          c.beginPath(); c.moveTo(sp.ex, sp.ey); c.quadraticCurveTo((sp.ex + end) / 2, L.beamY, end, L.beamY); c.stroke();
        }
      }
      if (active && orbitCue.backtrack && i === 1 && SPP[2]) {
        var from = SPP[2];
        c.lineWidth = 2 * bs; c.strokeStyle = rgbA(TINT[i], .84);
        if (!RM) { c.setLineDash([8 * bs, 9 * bs]); c.lineDashOffset = -t * 90; }
        c.beginPath(); c.moveTo(from.tx, from.ty); c.quadraticCurveTo((from.tx + tx)/2, ty - 34 * bs, tx, ty); c.stroke(); c.setLineDash([]);
      }
      continue;
    }
    if (RM || (live && sp.act < 0.9)) continue;
    c.setLineDash([5 * bs, 60 * bs]);
    c.lineDashOffset = (k === "deliver" ? 1 : -1) * t * (k === "dispatch" ? 170 : 70) - i * 29;
    c.lineWidth = 1.8 * bs; c.strokeStyle = rgbA(TINT[i], 0.85 * hot);
    c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo(qx, qy, tx, ty); c.stroke();
    c.setLineDash([]);
  }
}

/* 总控机械外圈刻度 + 顶部数据雨 */
var RAIN = (function () { var rr = mulberry32(31), a = [], i; for (i = 0; i < 52; i++) a.push({ f: rr(), sp: 40 + rr() * 120, len: 30 + rr() * 140, ph: rr() * 2000, a: 0.08 + rr() * 0.22 }); return a; })();
function drawRain(c, t) {
  if (L.narrow) return;
  var bs = L.bs, x0 = L.core.x - 470 * bs, w = 940 * bs, H = L.core.y + 150 * bs, i;
  for (i = 0; i < RAIN.length; i++) {
    var r = RAIN[i], x = x0 + r.f * w;
    var fade = 1 - Math.abs(r.f - 0.5) * 1.6;
    if (fade <= 0) continue;
    c.fillStyle = "rgba(150,185,235," + (0.035 * fade) + ")"; c.fillRect(x, 0, 1, H);
    if (RM) continue;
    var len = r.len * bs, y = ((t * r.sp * bs + r.ph) % (H + len)) - len;
    var g = c.createLinearGradient(0, y, 0, y + len);
    g.addColorStop(0, "rgba(170,205,255,0)"); g.addColorStop(1, "rgba(200,225,255," + (r.a * fade) + ")");
    c.fillStyle = g; c.fillRect(x, y, 1, len);
  }
}
function drawCoreHud(c, t) {
  var bs = Math.max(0.5, L.bs), cx = L.core.x, cy = L.core.y, r = L.core.S * 1.85, i, rot = RM ? 0 : t * 0.05;
  c.lineWidth = 1;
  for (i = 0; i < 96; i++) {
    var a = i / 96 * TAU + rot, l = (i % 8 === 0 ? 6 : 2.5) * bs;
    c.strokeStyle = i % 8 === 0 ? "rgba(170,200,240,0.24)" : "rgba(170,200,240,0.09)";
    c.beginPath(); c.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.92); c.lineTo(cx + Math.cos(a) * (r + l), cy + Math.sin(a) * (r + l) * 0.92); c.stroke();
  }
  c.strokeStyle = "rgba(156,208,255,0.32)";
  for (i = 0; i < 3; i++) { var a0 = -rot * 1.6 + i * TAU / 3; c.beginPath(); c.ellipse(cx, cy, r - 5 * bs, (r - 5 * bs) * 0.92, 0, a0, a0 + 0.36); c.stroke(); }
  if (ST.pulse >= 0) {
    var pr = r * (1 + ST.pulse * 1.4);
    c.strokeStyle = "rgba(200,225,255," + (0.5 * (1 - ST.pulse)) + ")"; c.lineWidth = 1.5 * bs;
    c.beginPath(); c.ellipse(cx, cy, pr, pr * 0.92, 0, 0, TAU); c.stroke();
  }
}

/* 交付：织好的项目化作一道光柱，回送给顶部的总控机械 */
function drawDeliverBeam(c, t) {
  if (ST.del <= 0.01) return;
  var m = curModel(), top = 0, i;
  for (i = 0; i < m.tops.length; i++) top = Math.max(top, m.tops[i]);
  var p0 = projStage([0, top, 0]), me = projObj(MASTER, MO[MASTER].emit), x = p0[0], y0 = p0[1], y1 = me[1], bs = Math.max(0.5, L.bs), w = (5 + 10 * ST.del) * bs;
  var g = c.createLinearGradient(x - w * 2, 0, x + w * 2, 0);
  g.addColorStop(0, "rgba(200,225,255,0)"); g.addColorStop(0.5, "rgba(235,242,255," + (0.3 * ST.del) + ")"); g.addColorStop(1, "rgba(200,225,255,0)");
  c.fillStyle = g; c.fillRect(x - w * 2, y1, w * 4, y0 - y1);
  c.fillStyle = "rgba(255,255,255," + (0.5 * ST.del) + ")"; c.fillRect(x - 0.6 * bs, y1, 1.2 * bs, y0 - y1);
  if (RM) return;
  for (i = 0; i < 26; i++) {
    var f = (t * (0.35 + (i % 5) * 0.08) + i * 0.173) % 1, yy = y0 + (y1 - y0) * f, xx = x + Math.sin(i * 7.1 + t * 3) * w * 1.6;
    c.fillStyle = "rgba(240,246,255," + (0.8 * ST.del * Math.sin(f * Math.PI)) + ")"; c.fillRect(xx - 1, yy - 1, 2, 2);
  }
}

/* 机械的 2D 光效：喷口辉光与喷溅火花、活跃时的锁定框；总控喷口的辉光 */
function drawUnitFx(c, i, t) {
  var sp = SPP[i]; if (!sp) return;
  var bs = Math.max(0.5, L.bs), act = sp.act, tc = TINT[i], col = AGENTS[i].c;
  var gr = (7 + 12 * act) * bs * (1 + 0.12 * Math.sin(t * 9 + i));
  var g = c.createRadialGradient(sp.ex, sp.ey, 0, sp.ex, sp.ey, gr);
  g.addColorStop(0, rgbA(tc, 0.55 + 0.35 * act)); g.addColorStop(0.4, hexA(col, 0.22 * (0.5 + act))); g.addColorStop(1, hexA(col, 0));
  c.fillStyle = g; c.beginPath(); c.arc(sp.ex, sp.ey, gr, 0, TAU); c.fill();
  var hr = L.uS * 0.95 * MO[i].s, k;
  if (!RM) for (k = 0; k < (act >= 0.9 ? 14 : 6); k++) {
    var f = (t * (1.4 + act * 2.4) + k / 14 + i * 0.13) % 1, an = Math.PI / 2 + (((k * 7) % 9) / 8 - 0.5) * 0.9, dd = f * (14 + 26 * act) * bs;
    c.fillStyle = rgbA(tc, (1 - f) * (0.4 + 0.6 * act)); c.fillRect(sp.ex + Math.cos(an) * dd - 1, sp.ey + Math.sin(an) * dd - 1, 2, 2);
  }
  if (act >= 0.9 && !L.narrow) {
    var bx = hr * 1.05, by = hr * 1.12, l = 7 * bs, x = sp.x, y = sp.y + 4 * bs;
    c.strokeStyle = hexA(col, 0.75); c.lineWidth = 1;
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (q) { var px = x + q[0] * bx, py = y + q[1] * by; c.beginPath(); c.moveTo(px, py - q[1] * l); c.lineTo(px, py); c.lineTo(px - q[0] * l, py); c.stroke(); });
  }
}
function drawMasterFx(c, t) {
  var bs = Math.max(0.5, L.bs), pulse = ST.pulse >= 0 ? Math.sin(Math.PI * ST.pulse) : 0;
  for (var i = 0; i < AGENTS.length; i++) {
    var q = projObj(MASTER, PORT_TIP[[0, 2, 5, 7][i]], 0), qr = (5 + 7 * MACT) * bs;
    var gq = c.createRadialGradient(q[0], q[1], 0, q[0], q[1], qr);
    gq.addColorStop(0, rgbA(TINT[i], 0.7 * (0.4 + 0.6 * MACT))); gq.addColorStop(1, hexA(AGENTS[i].c, 0));
    c.fillStyle = gq; c.beginPath(); c.arc(q[0], q[1], qr, 0, TAU); c.fill();
  }
  var e = projObj(MASTER, MO[MASTER].emit, 0), er = 14 * bs * (1 + 0.5 * MACT + 0.4 * pulse);
  var g2 = c.createRadialGradient(e[0], e[1], 0, e[0], e[1], er);
  g2.addColorStop(0, "rgba(230,242,255,0.8)"); g2.addColorStop(1, "rgba(150,200,255,0)");
  c.fillStyle = g2; c.beginPath(); c.arc(e[0], e[1], er, 0, TAU); c.fill();
}
var demoPhase = { dispatch: '准备装配', spin: '光丝定位', weave: '逐件成形', verify: '整机校验', deliver: '装配完成', unravel: '准备重播' };
function setTxt(el, value) { if (el.textContent !== value) el.textContent = value; }
function position(el, x, y) {
  el.style.left = Math.round(x) + "px"; el.style.top = Math.round(y) + "px";
}
var anchors = [[-.28,.12,.12],[-.07,.56,-.14],[-.12,1.08,-.25],[-.53,1.3,-.13],[.37,1.32,.08],[0,1.05,.16],[.53,.79,.12]];
function updateUI() {
  var k = PHASES[ST.ph], count = 0;
  var master = $("master-label");
  position(master, L.core.x, L.core.y + L.core.S * 1.16);
  setTxt($("coreSt"), orbitCue && live ? orbitCue.title : live ? live.stage : demoPhase[k]);
  AGENTS.forEach(function (agent, i) {
    var node = agentEls[i], sp = SPP[i];
    if (sp) position(node.el, sp.x, sp.y + L.uS * .70);
    var status = spiderState(i).st;
    setTxt(node.state, "子 Agent · " + status);
    node.el.classList.toggle("active", status === "运行中");
    node.el.classList.toggle("waiting", !!orbitCue && status === "待命");
  });
  var lanes = [[], []];
  cardEls.forEach(function (card, i) {
    var p = ST.prog[i] || 0, row = live && live.parts && live.parts[i];
    if (p >= 1) count++;
    var label = live ? (row ? row.label : "待核对") : p >= 1 ? "成形" : p > 0 ? Math.round(p * 100) + "%" : "待装配";
    setTxt(card.status, label); card.el.dataset.state = row ? row.state : "";
    var pin = pinEls[i];
    var marked = !!(live && live.display && live.display.focusParts && live.display.focusParts.indexOf(i) >= 0);
    pin.hidden = !modelOnStage() || (!marked && (!row || row.state !== "short"));
    if (!pin.hidden) {
      pin.classList.toggle("inspect", marked);
      var caption = marked ? (live.display.kind === "assembly" ? "安装位置" : "观察位置") : row.label;
      setTxt(pin, (marked ? fanProject.secs[i].n : row.name || fanProject.secs[i].n) + " · " + caption);
      pin.dataset.part = i;
      var a = anchors[i], point = projStage(a);
      var side = (i === 2 || i % 2 === 1) ? -1 : 1;
      var w = pin.offsetWidth, h = pin.offsetHeight;
      var x = L.stg.x + side * (L.stg.S * 0.92 + w * 0.45);
      x = splitDeck ? clamp(x, L.beamX0 + (L.beamX1 - L.beamX0) * .55 + w / 2, L.beamX1 - w / 2) :
        clamp(x, w / 2 + 4, L.w - w / 2 - 4);
      lanes[side < 0 ? 0 : 1].push({ el:pin, point:point, x:x, y:point[1], h:h, marked:marked });
    }
  });
  // Route each callout from its 3D anchor to an independent, clickable label.
  lanes.forEach(function (lane) {
    var edge = L.beamY + (L.narrow ? 10 : 70 * L.bs);
    lane.sort(function (a, b) { return a.y - b.y; });
    lane.forEach(function (tag) {
      tag.y = Math.max(tag.y, edge + tag.h / 2);
      edge = tag.y + tag.h / 2 + 5;
    });
    edge = L.h - (L.narrow ? 58 : 26);
    for (var i = lane.length - 1; i >= 0; i--) {
      var tag = lane[i];
      tag.y = Math.min(tag.y, edge - tag.h / 2);
      edge = tag.y - tag.h / 2 - 5;
      position(tag.el, tag.x, tag.y);
      fx.save(); fx.strokeStyle = tag.marked ? "#8adbd4" : "rgba(254,164,92,.85)"; fx.lineWidth = 1;
      if (tag.marked) { fx.setLineDash([4,3]); fx.beginPath(); fx.arc(tag.point[0],tag.point[1],8,0,TAU); fx.stroke(); }
      fx.beginPath(); fx.moveTo(tag.point[0],tag.point[1]); fx.lineTo(tag.x,tag.y); fx.stroke();
      fx.fillStyle=tag.marked ? "#a0f1e5" : "#ffad6f"; fx.beginPath(); fx.arc(tag.point[0],tag.point[1],2.7,0,TAU); fx.fill(); fx.restore();
    }
  });
  setTxt($("assembly-state"), orbitCue && !modelOnly ? orbitCue.title : live ? (live.display ? live.display.title : fanVisible ? "本单齐套装配示意" : "本轮查询依据") : demoPhase[k] + " · " + count + " / 7");
}

var progArr = new Float32Array(8), colArr = new Float32Array(24), hpArr = new Float32Array(24), hcArr = new Float32Array(24);
function syncCols() {
  var j = job();
  for (var i = 0; i < 8; i++) { var col = i < j.secs.length ? hex3(j.secs[i].c) : [1, 1, 1]; colArr[i * 3] = col[0]; colArr[i * 3 + 1] = col[1]; colArr[i * 3 + 2] = col[2]; }
}
function drawFanSurfaces(time) {
  var solid = SOLIDS[ST.job];
  if (!solid.ni || (solid.big && !EXT32)) return;
  var shader = P_SOLID;
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(shader);
  setProj(shader, L.stg.x, L.stg.y, L.stg.S * zoom);
  gl.uniformMatrix3fv(U(shader, "uView"), false, VIEW);
  gl.uniform1fv(U(shader, "uProg[0]"), progArr);
  gl.uniform1fv(U(shader, "uShortage[0]"), shortageFlags);
  gl.uniform3fv(U(shader, "uOffset[0]"), offsets);
  gl.uniform3fv(U(shader, "uCol[0]"), colArr);
  gl.uniform1f(U(shader, "uTime"), time);
  gl.uniform1f(U(shader, "uVerify"), ST.verY);
  gl.uniform1f(U(shader, "uDel"), ST.del);
  gl.uniform1f(U(shader, "uDis"), ST.dis);
  gl.uniform1f(U(shader, "uFocus"), ST.focus);
  attr(shader, "aP", B.sP, 3);
  attr(shader, "aN", B.sN, 3);
  attr(shader, "aA", B.sA, 4);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, B.sI);
  gl.drawElements(gl.TRIANGLES, solid.ni, solid.big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
  unbindAll();
  gl.disable(gl.DEPTH_TEST);
  gl.blendFunc(gl.ONE, gl.ONE);
}

function drawGL(t) {
  var dpr = L.dpr, m = curModel(), i;
  gl.viewport(0, 0, glc.width, glc.height);
  gl.clearColor(0.016, 0.024, 0.039, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.disable(gl.DEPTH_TEST);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.useProgram(P_STAR);
  gl.uniform1f(U(P_STAR, "uTime"), t); gl.uniform1f(U(P_STAR, "uDpr"), dpr); gl.uniform1f(U(P_STAR, "uLine"), 0);
  attr(P_STAR, "aS", B.sv, 4); gl.drawArrays(gl.POINTS, 0, STAR_N); unbindAll();

  for (i = 0; i < 8; i++) {
    progArr[i] = ST.prog[i] || 0;
    var h = HEADS[i];
    hpArr[i * 3] = h ? h.p[0] : 0; hpArr[i * 3 + 1] = h ? h.w : 0; hpArr[i * 3 + 2] = h ? h.p[2] : 0;
    hcArr[i * 3] = h ? h.c[0] : 0; hcArr[i * 3 + 1] = h ? h.c[1] : 0; hcArr[i * 3 + 2] = h ? h.c[2] : 0;
  }
  /* 半透明玻璃薄板 */
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  var Q = P_PLANE;
  gl.useProgram(Q); setProj(Q, L.stg.x, L.stg.y, L.stg.S * zoom);
  gl.uniformMatrix3fv(U(Q, "uView"), false, VIEW); gl.uniform1f(U(Q, "uDel"), ST.del);
  attr(Q, "aP", B.pl, 3); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); unbindAll();
  /* 等高线、星点粒子、粒子组成的项目（全部叠加发光） */
  gl.blendFunc(gl.ONE, gl.ONE);
  var P = P_PRJ;
  gl.useProgram(P); setProj(P, L.stg.x, L.stg.y, L.stg.S * zoom);
  gl.uniformMatrix3fv(U(P, "uView"), false, VIEW);
  gl.uniform1f(U(P, "uTime"), t); gl.uniform1f(U(P, "uDpr"), dpr); gl.uniform1f(U(P, "uPt"), L.narrow ? 2.0 : 1.85);
  gl.uniform1f(U(P, "uVerify"), ST.verY); gl.uniform1f(U(P, "uDel"), ST.del); gl.uniform1f(U(P, "uDis"), ST.dis);
  gl.uniform1f(U(P, "uFocus"), ST.focus); gl.uniform1f(U(P, "uFade"), 1);
  gl.uniform1f(U(P, "uKitting"), live && !live.display ? 1 : 0); gl.uniform1fv(U(P, "uShortage[0]"), shortageFlags); gl.uniform3fv(U(P, "uOffset[0]"), offsets);
  gl.uniform1fv(U(P, "uProg[0]"), progArr); gl.uniform3fv(U(P, "uCol[0]"), colArr);
  gl.uniform3fv(U(P, "uHP[0]"), hpArr); gl.uniform3fv(U(P, "uHC[0]"), hcArr);
  gl.uniform1f(U(P, "uGround"), 1);
  attr(P, "aP", B.gP, 3); attr(P, "aM", B.gM, 4);
  gl.uniform1f(U(P, "uLine"), 1); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, B.gI); gl.drawElements(gl.LINES, GROUND.ni, gl.UNSIGNED_SHORT, 0);
  gl.uniform1f(U(P, "uLine"), 0); gl.drawArrays(gl.POINTS, GROUND.dust0, GROUND.n - GROUND.dust0);
  unbindAll();
  gl.uniform1f(U(P, "uGround"), 2);
  attr(P, "aP", B.cP, 3); attr(P, "aM", B.cM, 4); gl.drawArrays(gl.POINTS, 0, CLOUD.n);
  unbindAll();
  if (modelOnStage()) {
  drawFanSurfaces(t);
  gl.useProgram(P);
  gl.uniform1f(U(P, "uGround"), 0);
  attr(P, "aP", B.mP, 3); attr(P, "aM", B.mM, 4);
  gl.uniform1f(U(P, "uLine"), 1); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, B.mI); gl.drawElements(gl.LINES, m.ni, gl.UNSIGNED_SHORT, 0);
  gl.uniform1f(U(P, "uLine"), 0); gl.drawArrays(gl.POINTS, 0, m.n);
  unbindAll();
  }
  /* 喷射光丝 */
  drawStrandsGL(t);
  /* 机械 */
  drawMeshes(t);
}
var ACC3 = AGENTS.map(function (a) { return hex3(a.c); });
function drawMeshes(t) {
  var P = P_MESH, i, j;
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(P);
  gl.uniform2f(U(P, "uRes"), glc.width, glc.height); gl.uniform1f(U(P, "uCam"), CAM); gl.uniform1f(U(P, "uTime"), t); gl.uniform1f(U(P, "uFade"), 1);
  for (i = 0; i < MO.length; i++) {
    var o = MO[i], pos = i === MASTER ? L.core : SPP[i], sc = (i === MASTER ? L.core.S : L.uS) * o.s;
    if (!pos || !o.view) continue;
    attr(P, "aP", o.bP, 3); attr(P, "aN", o.bN, 3); attr(P, "aMat", o.bM, 1);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, o.bI);
    gl.uniform2f(U(P, "uCtr"), pos.x * L.dpr, pos.y * L.dpr); gl.uniform1f(U(P, "uScl"), sc * L.dpr);
    gl.uniformMatrix3fv(U(P, "uObj"), false, o.view);
    var acc = i === MASTER ? [0.7, 0.85, 1.0] : ACC3[i];
    gl.uniform3f(U(P, "uAcc"), acc[0], acc[1], acc[2]);
    gl.uniform1f(U(P, "uAct"), i === MASTER ? MACT : pos.act);
    for (j = 0; j < o.parts.length; j++) {
      var pt = o.parts[j]; if (!pt.n) continue;
      gl.uniformMatrix3fv(U(P, "uPR"), false, pt.R || I3); gl.uniform3fv(U(P, "uPT"), pt.T || ZERO3);
      gl.drawElements(gl.TRIANGLES, pt.n, gl.UNSIGNED_SHORT, pt.i0 * 2);
    }
  }
  unbindAll();
  gl.disable(gl.DEPTH_TEST);
}
if (gl) glSetup();

/* =====================================================================
   13. 渲染循环
   ===================================================================== */
var last = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  if (host.hidden || document.hidden || !appR) { last = 0; return; }
  var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016;
  last = ts;
  var sdt = dt * (RM ? 0.6 : 1);
  now += sdt;
  if (!dragging) { yawDrag += yawVel * dt; pitchDrag += pitchVel * dt; yawVel *= Math.pow(0.04, dt); pitchVel *= Math.pow(0.04, dt); }
  VIEW = viewMat(dt);
  if (live) animateMaterials(sdt);
  else if (!inspection) updateState(sdt);
  computeSpiders(now);
  updateMachines(dt, now);
  var c = fx, d = L.dpr;
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, fxc.width, fxc.height);
  c.setTransform(d, 0, 0, d, 0, 0);
  c.globalCompositeOperation = "lighter";
  drawRain(c, now);
  drawCoreHud(c, now);
  drawDrag(c, now);
  drawBeam(c, now);
  stepDrops(sdt);
  drawDrops(c, sdt);
  drawSlabGlow(c, now);
  c.globalCompositeOperation = "source-over";
  drawStateLabel(c);
  c.globalCompositeOperation = "lighter";
  drawDeliverBeam(c, now);
  c.globalCompositeOperation = "source-over";
  c.globalCompositeOperation = "lighter";
  for (var i = 0; i < AGENTS.length; i++) drawUnitFx(c, i, now);
  drawMasterFx(c, now);
  c.globalCompositeOperation = "source-over";
  if (gl) drawGL(now);
  updateUI();
}

/* =====================================================================
   14. 交互：拖动 / 滚轮 / 双击 / 视角 / 全屏 / 点织位聚焦
   ===================================================================== */
var inspection = false;
// Only the latest kitting snapshot can set material state. Visual easing never advances a work order.
host.applyRun = function (run) {
  var changed = !live || liveId !== run.id;
  live = run; liveId = run.id; inspection = false; fanVisible = run.showFan;
  if (changed) {
    ST.prog.fill(0); offsets.fill(0); ST.focus = -1;
    DROPS.length = 0; SPL.length = 0; ST.jobT0 = now;
  }
  ST.ph = 2; ST.grow = 1; ST.desc = 1; ST.verY = -9;
  ST.dis = 0; ST.del = 0; ST.cardsOn = job().secs.length;
  var mounted = [];
  if (run.display) {
    var count = run.display.assembledParts == null ? job().secs.length : run.display.assembledParts;
    shortageFlags.fill(0); targets.fill(0); offsets.fill(0); targetOffsets.fill(0);
    for (var part = 0; part < job().secs.length; part++) ST.prog[part] = fanVisible && part < count ? 1 : 0;
  } else job().secs.forEach(function (sec, i) {
    var row = run.parts && run.parts[i], ready = row && row.state === "ready";
    shortageFlags[i] = row && row.state === "short" ? 1 : 0;
    if (ready && (changed || !targets[i])) revealAt[i] = now + (RM ? 0 : i * 0.14);
    targets[i] = ready ? 1 : 0;
    if (!ready) ST.prog[i] = 0;
    mounted[i] = ready && sec.needs.every(function (index) { return mounted[index]; });
    var waiting = ready && !mounted[i];
    targetOffsets[i * 3] = waiting ? (0.32 + 0.13 * i) : 0;
    targetOffsets[i * 3 + 1] = waiting ? 0.05 : 0;
    targetOffsets[i * 3 + 2] = waiting ? 0.09 * i : 0;
    if (changed || !ready || (waiting && ST.prog[i] === 0)) offsets.set(targetOffsets.subarray(i*3,i*3+3),i*3);
  });
  host.toggleAttribute("data-list-only", !fanVisible);
  if (deckOn && splitDeck !== wantsSplitDeck()) layout();
  syncButtons(); computeSpiders(now); updateUI();
};
function animateMaterials(dt) {
  for (var i = 0; i < job().secs.length; i++) {
    if (targets[i] && now >= revealAt[i]) ST.prog[i] = Math.min(1, ST.prog[i] + dt * (0.62 - i * 0.045));
    for (var j = i*3; j < i*3+3; j++) offsets[j] += (targetOffsets[j] - offsets[j]) * Math.min(1, dt*4);
  }
}
host.focusPart = function (i) {
  var marks = live && live.display && live.display.focusParts;
  ST.focus = Number.isInteger(i) && i >= 0 ? i : marks && marks.length === 1 ? marks[0] : -1;
};
function holdProgress(fraction, part) {
  inspection = true;
  var count = job().secs.length;
  var progress = clamp(fraction, 0, 1) * count;
  ST.ph = fraction >= 1 ? PHASES.indexOf("verify") : PHASES.indexOf("weave");
  ST.t = 0; ST.grow = 1; ST.desc = 1; ST.dis = 0; ST.del = 0;
  ST.pulse = -1; ST.verY = -9; ST.cardsOn = count;
  ST.focus = Number.isInteger(part) && part >= 0 && part < count ? part : -1;
  for (var i = 0; i < count; i++) {
    ST.prog[i] = clamp(progress - i, 0, 1);
    ST.startF[i] = ST.prog[i] > 0 ? 1 : 0;
    ST.doneF[i] = ST.prog[i] === 1 ? 1 : 0;
  }
  computeSpiders(now);
  updateUI(0);
  syncButtons();
}
host.showFanProgress = holdProgress;
host.layoutFan = layout;
host.setFlowCue = function (cue) { orbitCue = cue; };
host.setFlowDeck = function (on, onlyModel) {
  var changed = deckOn !== on || modelOnly !== onlyModel;
  deckOn = on; modelOnly = onlyModel;
  host.toggleAttribute("data-deck", deckOn);
  host.toggleAttribute("data-model-only", modelOnly);
  if (changed) layout();
};
host.startFanAssembly = function () {
  live = null; liveId = null; fanVisible = true; shortageFlags.fill(0); offsets.fill(0); targets.fill(0);
  host.removeAttribute("data-list-only"); inspection = false; ST.focus = -1; ST.dis = 0; ST.del = 0; nextJob(); syncButtons();
};

var dragging = false, lastX = 0, lastY = 0;
glc.addEventListener("pointerdown", function (e) { dragging = true; lastX = e.clientX; lastY = e.clientY; glc.classList.add("drag"); try { glc.setPointerCapture(e.pointerId); } catch (er) {} });
glc.addEventListener("pointermove", function (e) {
  if (!dragging) return;
  var dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
  yawDrag += dx * 0.006; pitchDrag = clamp(pitchDrag + dy * 0.004, -0.5, 0.9);
  yawVel = dx * 0.35; pitchVel = dy * 0.2;
});
function endDrag() { dragging = false; glc.classList.remove("drag"); }
glc.addEventListener("pointerup", endDrag); glc.addEventListener("pointercancel", endDrag);
function resetView() { yawDrag = 0; pitchDrag = 0; yawVel = 0; pitchVel = 0; zoom = 1; }
glc.addEventListener("dblclick", resetView);
glc.addEventListener("wheel", function (e) { e.preventDefault(); zoom = clamp(zoom * Math.exp(-e.deltaY * 0.0012), 0.7, 1.4); }, { passive: false });
function syncButtons() {
  SR.querySelectorAll('[data-act="inspect"]').forEach(function (b) { b.textContent = inspection ? "重播装配" : "看完整风扇"; });
  [].forEach.call(SR.querySelectorAll('[data-f="mode"]'), function (b) { b.textContent = MODES[modeI].zh; }); }
function act(name) {
  if (live && name === "inspect") return;
  if (name === "mode") { modeI = (modeI + 1) % MODES.length; yawDrag = 0; pitchDrag = 0; yawVel = 0; pitchVel = 0; }
  else if (name === "inspect") { if (inspection) host.startFanAssembly(); else holdProgress(1, -1); }
  else if (name === "full") {
    try {
      if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
      else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () { var b = SR.querySelector('[data-f="full"]'); b.textContent = "不支持"; setTimeout(function () { b.textContent = "全屏"; }, 1500); });
    } catch (e) { /* 部分窗口不允许全屏 */ }
  }
  syncButtons();
}
[].forEach.call(SR.querySelectorAll("[data-act]"), function (b) { b.addEventListener("click", function () { act(b.getAttribute("data-act")); }); });
document.addEventListener("fullscreenchange", function () { var b = SR.querySelector('[data-f="full"]'); if (b) b.textContent = document.fullscreenElement ? "退出全屏" : "全屏"; });
document.addEventListener("keydown", function (e) {
  if (host.hidden) return;
  var tag = (e.target && e.target.tagName) || "";
  if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "v" || e.key === "V") act("mode");
  if (e.key === "Escape" && ST.focus >= 0) ST.focus = -1;
});

/* ---------- 开场 ---------- */
planJob(); syncCols(); buildJobDom(); buildStrands(); uploadModel();
ST.jobT0 = 0; enterPhase();
syncButtons();
new ResizeObserver(layout).observe(host);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { layout(); });
layout();
requestAnimationFrame(frame);
}
