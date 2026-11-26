/* HEARTLAB heart: a raymarched anatomical form drawn as an engraved contour study (plain WebGL, no libraries).
   The surface is rendered as horizontal section lines whose weight follows the light, like a scientific plate.
   One data-driven element: a crimson level that rises with the model estimate supplied by the page
   (setLevel(0..1) = position of the backend estimate within the observed range of state rates).
   The anatomy is an artistic approximation; nothing about it is simulated physiology. */
(function () {
  const VERT = `attribute vec2 a;varying vec2 v;void main(){v=a;gl_Position=vec4(a,0.,1.);}`;

  const FRAG = (deriv) => `
${deriv ? "#extension GL_OES_standard_derivatives : enable" : ""}
precision highp float;
varying vec2 v;
uniform vec2 uRes;
uniform float uYaw, uPitch, uBeat, uLevel, uLevelOn;
uniform vec3 uLight, uPaper, uShade, uInk, uInk2, uAccent;

mat3 rotX(float a){float c=cos(a),s=sin(a);return mat3(1.,0.,0.,0.,c,s,0.,-s,c);}
mat3 rotY(float a){float c=cos(a),s=sin(a);return mat3(c,0.,-s,0.,1.,0.,s,0.,c);}
mat3 rotZ(float a){float c=cos(a),s=sin(a);return mat3(c,s,0.,-s,c,0.,0.,0.,1.);}
float sdEll(vec3 p, vec3 r){float k0=length(p/r);float k1=length(p/(r*r));return k0*(k0-1.)/k1;}
float sdCap(vec3 p, vec3 a, vec3 b, float r1, float r2){
  vec3 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return length(pa-ba*h)-mix(r1,r2,h);
}
float sdRoundCone(vec3 p, vec3 a, vec3 b, float r1, float r2){
  vec3 ba=b-a; float l2=dot(ba,ba); float rr=r1-r2; float a2=l2-rr*rr; float il2=1./l2;
  vec3 pa=p-a; float y=dot(pa,ba); float z=y-l2;
  vec3 xv=pa*l2-ba*y; float x2=dot(xv,xv); float y2=y*y*l2; float z2=z*z*l2;
  float k=sign(rr)*rr*rr*x2;
  if(sign(z)*a2*z2>k) return sqrt(x2+z2)*il2-r2;
  if(sign(y)*a2*y2<k) return sqrt(x2+y2)*il2-r1;
  return (sqrt(x2*a2*il2)+y*rr)*il2-r1;
}
float smin(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}
float seg2(vec2 p, vec2 a, vec2 b){vec2 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*h);}

// x: distance, y: material (0 myocardium, 1 arterial, 2 venous)
vec2 map(vec3 p){
  float sq = 1.-.018*uBeat;
  vec3 q = vec3(p.x, p.y, p.z*1.22);
  float vent = sdRoundCone(q/sq, vec3(.42,-.98,.12), vec3(-.02,.26,-.04), .1, .66)*sq;
  float rv = sdEll(rotZ(.35)*(p-vec3(-.2,-.06,.2))/sq, vec3(.5,.56,.34))*sq;
  float lv = sdEll(rotZ(.55)*(p-vec3(.3,-.2,-.06))/sq, vec3(.44,.62,.42))*sq;
  float body = smin(smin(vent, rv, .2), lv, .18);
  float g = seg2(p.xy, vec2(.13,.3), vec2(.42,-.86));
  float front = smoothstep(.0,.25,p.z);
  body += (.026*exp(-g*g/.006) - .012*exp(-g*g/.0007))*front;

  float ra  = sdEll(p-vec3(-.58,.33,-.06), vec3(.29,.33,.29));
  float raa = sdEll(rotZ(-.55)*(p-vec3(-.37,.53,.25)), vec3(.2,.08,.11));
  float la  = sdEll(p-vec3(.14,.42,-.45), vec3(.4,.24,.3));
  float laa = sdEll(rotZ(.5)*(p-vec3(.53,.45,.13)), vec3(.16,.075,.1));
  float heart = smin(body, ra, .14);
  heart = smin(heart, raa, .09);
  heart = smin(heart, la, .12);
  heart = smin(heart, laa, .07);

  float ao = sdCap(p,vec3(-.08,.22,.02),vec3(-.05,.86,.05),.17,.16);
  ao = smin(ao, sdCap(p,vec3(-.05,.86,.05),vec3(.08,1.04,-.02),.16,.155),.06);
  ao = smin(ao, sdCap(p,vec3(.08,1.04,-.02),vec3(.26,1.05,-.16),.155,.15),.06);
  ao = smin(ao, sdCap(p,vec3(.26,1.05,-.16),vec3(.38,.92,-.3),.15,.145),.06);
  ao = smin(ao, sdCap(p,vec3(.38,.92,-.3),vec3(.41,.2,-.42),.145,.13),.06);
  ao = smin(ao, sdCap(p,vec3(.0,1.0,.03),vec3(-.1,1.4,.06),.072,.056),.045);
  ao = smin(ao, sdCap(p,vec3(.13,1.08,-.05),vec3(.15,1.44,-.04),.054,.042),.04);
  ao = smin(ao, sdCap(p,vec3(.26,1.06,-.15),vec3(.41,1.4,-.19),.058,.045),.04);

  float pa = sdCap(p,vec3(.12,.24,.36),vec3(.26,.76,.2),.165,.15);
  pa = smin(pa, sdCap(p,vec3(.26,.76,.2),vec3(.64,.8,-.05),.11,.09),.06);
  pa = smin(pa, sdCap(p,vec3(.22,.79,.1),vec3(-.3,.83,-.22),.1,.09),.06);
  float vc = sdCap(p,vec3(-.56,.44,-.08),vec3(-.53,1.16,-.12),.13,.12);
  vc = min(vc, sdCap(p,vec3(-.56,.0,-.18),vec3(-.56,-.34,-.24),.13,.12));

  float d = smin(heart, ao, .07);
  d = smin(d, pa, .06);
  d = smin(d, vc, .07);
  float m = 0.;
  float art = exp(-g*g/.0006)*front;
  if (ao < heart && ao < pa && ao < vc) m = 1.;
  else if (min(pa,vc) < heart) m = 2.;
  else if (art > .5) m = 1.;
  return vec2(d, m);
}

vec3 calcNormal(vec3 p){
  const vec2 e=vec2(1.,-1.)*.0015;
  return normalize(e.xyy*map(p+e.xyy).x+e.yyx*map(p+e.yyx).x+e.yxy*map(p+e.yxy).x+e.xxx*map(p+e.xxx).x);
}
float calcAO(vec3 p, vec3 n){
  float o=0., s=1.;
  for(int i=0;i<4;i++){float h=.03+.1*float(i);o+=(h-map(p+h*n).x)*s;s*=.7;}
  return clamp(1.-2.*o,0.,1.);
}
float lines(float t, float w){
  float d = abs(fract(t)-.5);
  ${deriv ? "float aa = fwidth(t)*.75;" : "float aa = .04;"}
  return 1.-smoothstep(w*.5-aa, w*.5+aa, d);
}

void main(){
  vec2 uv = v*vec2(uRes.x/uRes.y,1.);
  mat3 R = rotY(uYaw)*rotX(uPitch);
  vec3 ro = R*vec3(0.,.2,3.7);
  vec3 rd = R*normalize(vec3(uv,-2.15));
  float t=0., minD=1e3; vec2 h=vec2(0.); bool hit=false;
  float b=dot(ro,rd), c=dot(ro,ro)-2.05*2.05, disc=b*b-c;
  if (disc>0.) {
    t=max(0.,-b-sqrt(disc)); float tEnd=-b+sqrt(disc);
    for(int i=0;i<120;i++){
      h=map(ro+rd*t);
      minD=min(minD,h.x);
      if(h.x<.0008*t){hit=true;break;}
      t+=h.x*.8;
      if(t>tEnd)break;
    }
  }
  if(!hit){
    float a = 1.-smoothstep(0., 2.4/uRes.y*t, minD);
    gl_FragColor = vec4(uInk*a*.9, a*.9);
    return;
  }
  vec3 p=ro+rd*t, n=calcNormal(p), V=-rd;
  vec3 L=normalize(R*uLight);
  float dif=clamp(dot(n,L)*.5+.5,0.,1.);
  float ao=calcAO(p,n);
  float lit=dif*mix(.55,1.,ao);
  float tone=clamp(1.-lit,0.,1.);
  float freq = 30.;
  float w = mix(.05,.5,pow(tone,1.15));
  float ln = lines(p.y*freq, w);
  float hatch = lines((p.x*.7+p.z*.7-p.y*.35)*freq*.9, .32)*smoothstep(.55,.85,tone);
  float edge = smoothstep(.42,.12,abs(dot(n,V)));
  float ink = max(max(ln, hatch*.8), edge);
  float gg = seg2(p.xy, vec2(.13,.3), vec2(.42,-.86));
  float art = exp(-gg*gg/.0006)*smoothstep(.0,.25,p.z);
  vec3 lineCol = h.y>1.5 ? uInk2 : uInk;
  float myo = h.y<.5 || (h.y<1.5 && art>.5) ? 1. : 0.;
  float below = step(p.y, uLevel)*uLevelOn*myo;
  lineCol = mix(lineCol, uAccent, below);
  ${deriv ? "float ringAA = fwidth(p.y)*1.2;" : "float ringAA = .006;"}
  float ring = (1.-smoothstep(.006, .006+ringAA, abs(p.y-uLevel)))*uLevelOn*myo;
  vec3 ground = mix(uPaper, uShade, tone*.55);
  vec3 col = mix(ground, lineCol, clamp(ink,0.,1.)*mix(.55,1.,tone));
  col = mix(col, uAccent, ring);
  gl_FragColor = vec4(col,1.);
}`;

  function compile(gl, type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  const hex = (h) => { const m = h.trim().replace("#", ""); const n = parseInt(m.length === 3 ? m.split("").map((c) => c + c).join("") : m, 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

  function mount(host, opts = {}) {
    const canvas = document.createElement("canvas");
    canvas.className = "heart-canvas";
    canvas.setAttribute("aria-hidden", "true");
    host.prepend(canvas);
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, antialias: false, alpha: true });
    if (!gl) { host.classList.add("no-webgl"); canvas.remove(); return null; }
    const deriv = !!gl.getExtension("OES_standard_derivatives");
    let prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG(deriv)));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    } catch (e) { host.classList.add("no-webgl"); canvas.remove(); console.warn("heart shader:", e.message); return null; }
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = {}; ["uRes", "uYaw", "uPitch", "uBeat", "uLevel", "uLevelOn", "uLight", "uPaper", "uShade", "uInk", "uInk2", "uAccent"]
      .forEach((n) => { U[n] = gl.getUniformLocation(prog, n); });

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let scale = Math.min(window.devicePixelRatio || 1, 2);
    const LV_LO = -0.98, LV_HI = 0.62;               // vertical extent of the ventricles in model space
    const st = { yaw: .28, pitch: .06, vy: 0, vp: 0, ty: .28, tp: .06, drag: 0, lx: -.5, ly: .7, tlx: -.5, tly: .7,
                 level: LV_LO, tlevel: LV_LO, levelOn: 0, visible: true, last: 0, slow: 0, dirty: true, colors: null };

    function readColors() {
      const cs = getComputedStyle(document.documentElement);
      const g = (n) => hex(cs.getPropertyValue(n) || "#000");
      st.colors = { paper: g("--heart-paper"), shade: g("--heart-shade"), ink: g("--heart-ink"), ink2: g("--heart-ink-2"), accent: g("--accent") };
      st.dirty = true;
    }
    readColors();
    new MutationObserver(readColors).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", readColors);

    function resize() {
      const r = host.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width * scale)), h = Math.max(1, Math.round(r.height * scale));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); st.dirty = true; }
    }
    new ResizeObserver(resize).observe(host); resize();

    const area = opts.area || host;
    let down = null;
    area.addEventListener("pointermove", (e) => {
      const r = host.getBoundingClientRect();
      const nx = Math.max(-1.5, Math.min(1.5, ((e.clientX - r.left) / r.width) * 2 - 1));
      const ny = Math.max(-1.5, Math.min(1.5, ((e.clientY - r.top) / r.height) * 2 - 1));
      st.tlx = -.5 + nx * .9; st.tly = .7 - ny * .6;
      if (down) { st.drag = down.drag + (e.clientX - down.x) * .007; st.tp = Math.max(-.35, Math.min(.4, down.p + (e.clientY - down.y) * .003)); }
      else if (!reduce.matches) { st.ty = .28 + nx * .3; st.tp = .06 + ny * .1; }
      st.dirty = true;
    });
    host.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, drag: st.drag, p: st.tp }; host.setPointerCapture(e.pointerId); host.classList.add("grabbing"); });
    const up = () => { down = null; host.classList.remove("grabbing"); };
    host.addEventListener("pointerup", up); host.addEventListener("pointercancel", up);
    host.addEventListener("keydown", (e) => {
      const k = { ArrowLeft: [-.25, 0], ArrowRight: [.25, 0], ArrowUp: [0, -.08], ArrowDown: [0, .08] }[e.key];
      if (k) { e.preventDefault(); st.drag += k[0]; st.tp = Math.max(-.35, Math.min(.4, st.tp + k[1])); st.dirty = true; }
    });
    new IntersectionObserver((en) => { st.visible = en[0].isIntersecting; if (st.visible) requestAnimationFrame(frame); }).observe(host);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) requestAnimationFrame(frame); });

    const t0 = performance.now();
    function frame(now) {
      if (!st.visible || document.hidden || !host.isConnected || host.offsetParent === null) { st.last = 0; return; }
      const dt = Math.min(.05, (now - (st.last || now)) / 1000); st.last = now;
      const t = (now - t0) / 1000;
      const k = 12, d = 7;
      const ty = st.ty + st.drag + (reduce.matches ? 0 : Math.sin(t * .35) * .07);
      st.vy += ((ty - st.yaw) * k - st.vy * d) * dt; st.yaw += st.vy * dt;
      st.vp += ((st.tp - st.pitch) * k - st.vp * d) * dt; st.pitch += st.vp * dt;
      st.lx += (st.tlx - st.lx) * Math.min(1, dt * 4); st.ly += (st.tly - st.ly) * Math.min(1, dt * 4);
      const dl = st.tlevel - st.level; st.level += dl * Math.min(1, dt * (reduce.matches ? 60 : 5));
      const ph = t % 1;                                // slow, low-amplitude cadence: a sign of life, not physiology
      const beat = reduce.matches ? 0 : Math.exp(-((ph - .1) ** 2) / .003) + .5 * Math.exp(-((ph - .3) ** 2) / .003);
      const moving = !reduce.matches || Math.abs(st.vy) + Math.abs(st.vp) > 1e-4 || Math.abs(dl) > 1e-4 || st.dirty;
      if (moving) {
        resize();
        const c = st.colors;
        gl.uniform2f(U.uRes, canvas.width, canvas.height);
        gl.uniform1f(U.uYaw, st.yaw); gl.uniform1f(U.uPitch, st.pitch); gl.uniform1f(U.uBeat, beat);
        gl.uniform1f(U.uLevel, st.level); gl.uniform1f(U.uLevelOn, st.levelOn);
        gl.uniform3f(U.uLight, st.lx, st.ly, .75);
        gl.uniform3fv(U.uPaper, c.paper); gl.uniform3fv(U.uShade, c.shade); gl.uniform3fv(U.uInk, c.ink);
        gl.uniform3fv(U.uInk2, c.ink2); gl.uniform3fv(U.uAccent, c.accent);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        st.dirty = false;
        if (dt > .03) { if (++st.slow > 20 && scale > .6) { scale *= .8; st.slow = 0; resize(); } } else st.slow = 0;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    return {
      /* f in [0, 1]: where the model estimate sits between the lowest and highest observed state rates. */
      setLevel(f) { st.levelOn = 1; st.tlevel = LV_LO + Math.max(0, Math.min(1, f)) * (LV_HI - LV_LO); st.dirty = true; },
      wake() { requestAnimationFrame(frame); },
    };
  }

  window.HeartSpecimen = { mount };
})();
