// Diagrams — categorised
function reg(p) { return Math.abs(p); } // placeholder for any helpers
const diagrams = {
  // ============ SHAPES 2D ============
  triangle: { cat: 'Shapes 2D', name: 'Triangle', defaults: { a:'A', b:'B', c:'C', cap:'Triangle ABC' }, fields: [['a','Vertex A'],['b','Vertex B'],['c','Vertex C'],['cap','Caption']],
    render: (p, col) => `<svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg" width="320"><polygon points="160,30 40,200 280,200" fill="${col}" fill-opacity=".1" stroke="${col}" stroke-width="2.2"/><text x="160" y="22" font-family="Lora,serif" font-size="16" font-weight="700" text-anchor="middle" fill="#1c1612">${esc(p.a)}</text><text x="30" y="215" font-family="Lora,serif" font-size="16" font-weight="700" text-anchor="middle" fill="#1c1612">${esc(p.b)}</text><text x="290" y="215" font-family="Lora,serif" font-size="16" font-weight="700" text-anchor="middle" fill="#1c1612">${esc(p.c)}</text></svg>` },
  righttriangle: { cat: 'Shapes 2D', name: 'Right Triangle', defaults: { a:'A', b:'B', c:'C', cap:'Right-angled triangle' }, fields: [['a','A'],['b','B'],['c','C'],['cap','Caption']],
    render: (p, col) => `<svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg" width="320"><polygon points="60,40 60,200 280,200" fill="${col}" fill-opacity=".1" stroke="${col}" stroke-width="2.2"/><rect x="60" y="184" width="16" height="16" fill="none" stroke="${col}" stroke-width="1.6"/><text x="50" y="35" font-family="Lora,serif" font-size="16" font-weight="700" text-anchor="end" fill="#1c1612">${esc(p.a)}</text><text x="50" y="215" font-family="Lora,serif" font-size="16" font-weight="700" text-anchor="end" fill="#1c1612">${esc(p.b)}</text><text x="290" y="215" font-family="Lora,serif" font-size="16" font-weight="700" text-anchor="middle" fill="#1c1612">${esc(p.c)}</text></svg>` },
  square: { cat: 'Shapes 2D', name: 'Square', defaults: { side:'side', cap:'Square' }, fields: [['side','Side label'],['cap','Caption']],
    render: (p, col) => `<svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" width="240"><rect x="40" y="40" width="160" height="160" fill="${col}" fill-opacity=".1" stroke="${col}" stroke-width="2.2"/><text x="120" y="30" font-family="Lora,serif" font-style="italic" font-size="14" text-anchor="middle" fill="#3a2f25">${esc(p.side)}</text></svg>` },
  rectangle: { cat: 'Shapes 2D', name: 'Rectangle', defaults: { l:'length', w:'width', cap:'Rectangle' }, fields: [['l','Length'],['w','Width'],['cap','Caption']],
    render: (p, col) => `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg" width="320"><rect x="40" y="40" width="240" height="120" fill="${col}" fill-opacity=".1" stroke="${col}" stroke-width="2.2"/><text x="160" y="30" font-family="Lora,serif" font-style="italic" font-size="14" text-anchor="middle" fill="#3a2f25">${esc(p.l)}</text><text x="30" y="105" font-family="Lora,serif" font-style="italic" font-size="14" text-anchor="end" fill="#3a2f25">${esc(p.w)}</text></svg>` },
  parallelogram: { cat: 'Shapes 2D', name: 'Parallelogram', defaults: { base:'base', side:'side', cap:'Parallelogram' }, fields: [['base','Base'],['side','Side'],['cap','Caption']],
    render: (p, col) => `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg" width="320"><polygon points="80,40 300,40 240,160 20,160" fill="${col}" fill-opacity=".1" stroke="${col}" stroke-width="2.2"/><text x="160" y="180" font-family="Lora,serif" font-style="italic" font-size="14" text-anchor="middle" fill="#3a2f25">${esc(p.base)}</text><text x="30" y="105" font-family="Lora,serif" font-style="italic" font-size="14" text-anchor="end" fill="#3a2f25">${esc(p.side)}</text></svg>` },
  trapezium: { cat: 'Shapes 2D', name: 'Trapezium', defaults: { top:'a', bottom:'b', height:'h', cap:'Trapezium' }, fields: [['top','Top side'],['bottom','Bottom side'],['height','Height'],['cap','Caption']],
    render: (p, col) => `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg" width="320"><polygon points="80,40 240,40 300,160 20,160" fill="${col}" fill-opacity=".1" stroke="${col}" stroke-width="2.2"/><text x="160" y="32" font-family="Lora,serif" font-style="italic" font-size="14" text-anchor="middle" fill="#3a2f25">${esc(p.top)}</text><text x="160" y="180" font-family="Lora,serif" font-style="italic" font-size="14" text-anchor="middle" fill="#3a2f25">${esc(p.bottom)}</text><text x="170" y="105" font-family="Lora,serif" font-style="italic" font-size="14" fill="#3a2f25">${esc(p.height)}</text><line x1="160" y1="40" x2="160" y2="160" stroke="${col}" stroke-width="1" stroke-dasharray="3 3"/></svg>` },
  rhombus: { cat: 'Shapes 2D', name: 'Rhombus', defaults: { side:'a', cap:'Rhombus' }, fields: [['side','Side'],['cap','Caption']],
    render: (p, col) => `<svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" width="240"><polygon points="120,30 220,120 120,210 20,120" fill="${col}" fill-opacity=".1" stroke="${col}" stroke-width="2.2"/><text x="180" y="65" font-family="Lora,serif" font-style="italic" font-size="14" fill="#3a2f25">${esc(p.side)}</text></svg>` },
  pentagon: { cat: 'Shapes 2D', name: 'Pentagon', defaults: { cap:'Regular pentagon' }, fields: [['cap','Caption']],
    render: (p, col) => `<svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" width="240"><polygon points="120,30 220,105 180,215 60,215 20,105" fill="${col}" fill-opacity=".1" stroke="${col}" stroke-width="2.2"/></svg>` },
  hexagon: { cat: 'Shapes 2D', name: 'Hexagon', defaults: { cap:'Regular hexagon' }, fields: [['cap','Caption']],
    render: (p, col) => `<svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" width="240"><polygon points="120,30 210,80 210,180 120,230 30,180 30,80" fill="${col}" fill-opacity=".1" stroke="${col}" stroke-width="2.2"/></svg>` },
  circle: { cat: 'Shapes 2D', name: 'Circle', defaults: { center:'O', radius:'r', cap:'Circle, centre O' }, fields: [['center','Centre'],['radius','Radius'],['cap','Caption']],
    render: (p, col) => `<svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" width="240"><circle cx="120" cy="120" r="90" fill="${col}" fill-opacity=".1" stroke="${col}" stroke-width="2.2"/><line x1="120" y1="120" x2="210" y2="120" stroke="${col}" stroke-width="1.6" stroke-dasharray="4 3"/><circle cx="120" cy="120" r="3.5" fill="#1c1612"/><text x="115" y="115" font-family="Lora,serif" font-size="14" font-weight="700" text-anchor="end" fill="#1c1612">${esc(p.center)}</text><text x="165" y="113" font-family="Lora,serif" font-style="italic" font-size="13" fill="#3a2f25">${esc(p.radius)}</text></svg>` },
  angle: { cat: 'Shapes 2D', name: 'Angle', defaults: { label:'θ', cap:'Angle θ' }, fields: [['label','Angle label'],['cap','Caption']],
    render: (p, col) => `<svg viewBox="0 0 280 220" xmlns="http://www.w3.org/2000/svg" width="280"><line x1="40" y1="180" x2="240" y2="180" stroke="#1c1612" stroke-width="2"/><line x1="40" y1="180" x2="220" y2="50" stroke="#1c1612" stroke-width="2"/><path d="M 90,180 A 50,50 0 0,0 78,150" fill="none" stroke="${col}" stroke-width="2"/><text x="100" y="170" font-family="Lora,serif" font-style="italic" font-size="16" fill="${col}">${esc(p.label)}</text></svg>` },

  // ============ SHAPES 3D ============
  cube: { cat: 'Shapes 3D', name: 'Cube', defaults: { side:'a', cap:'Cube' }, fields: [['side','Side label'],['cap','Caption']],
    render: (p, col) => `<svg viewBox="0 0 260 240" xmlns="http://www.w3.org/2000/svg" width="260"><polygon points="40,80 160,80 220,40 100,40" fill="${col}" fill-opacity=".15" stroke="${col}" stroke-width="2"/><polygon points="160,80 220,40 220,160 160,200" fill="${col}" fill-opacity=".25" stroke="${col}" stroke-width="2"/><polygon points="40,80 160,80 160,200 40,200" fill="${col}" fill-opacity=".08" stroke="${col}" stroke-width="2"/><line x1="40" y1="80" x2="100" y2="40" stroke="${col}" stroke-width="1" stroke-dasharray="3 3"/><line x1="100" y1="40" x2="100" y2="160" stroke="${col}" stroke-width="1" stroke-dasharray="3 3"/><line x1="40" y1="200" x2="100" y2="160" stroke="${col}" stroke-width="1" stroke-dasharray="3 3"/><line x1="100" y1="160" x2="220" y2="160" stroke="${col}" stroke-width="1" stroke-dasharray="3 3"/><text x="100" y="225" font-family="Lora,serif" font-style="italic" font-size="14" text-anchor="middle" fill="#3a2f25">${esc(p.side)}</text></svg>` },
  cuboid: { cat: 'Shapes 3D', name: 'Cuboid', defaults: { l:'l', w:'w', h:'h', cap:'Cuboid' }, fields: [['l','Length'],['w','Width'],['h','Height'],['cap','Caption']],
    render: (p, col) => `<svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg" width="320"><polygon points="40,80 200,80 260,40 100,40" fill="${col}" fill-opacity=".15" stroke="${col}" stroke-width="2"/><polygon points="200,80 260,40 260,180 200,220" fill="${col}" fill-opacity=".25" stroke="${col}" stroke-width="2"/><polygon points="40,80 200,80 200,220 40,220" fill="${col}" fill-opacity=".08" stroke="${col}" stroke-width="2"/><line x1="40" y1="80" x2="100" y2="40" stroke="${col}" stroke-width="1" stroke-dasharray="3 3"/><line x1="100" y1="40" x2="100" y2="180" stroke="${col}" stroke-width="1" stroke-dasharray="3 3"/><line x1="40" y1="220" x2="100" y2="180" stroke="${col}" stroke-width="1" stroke-dasharray="3 3"/><line x1="100" y1="180" x2="260" y2="180" stroke="${col}" stroke-width="1" stroke-dasharray="3 3"/><text x="120" y="240" font-family="Lora,serif" font-style="italic" font-size="13" text-anchor="middle" fill="#3a2f25">${esc(p.l)}</text><text x="280" y="120" font-family="Lora,serif" font-style="italic" font-size="13" fill="#3a2f25">${esc(p.h)}</text><text x="230" y="50" font-family="Lora,serif" font-style="italic" font-size="13" fill="#3a2f25">${esc(p.w)}</text></svg>` },
  cylinder: { cat: 'Shapes 3D', name: 'Cylinder', defaults: { r:'r', h:'h', cap:'Cylinder' }, fields: [['r','Radius'],['h','Height'],['cap','Caption']],
    render: (p, col) => `<svg viewBox="0 0 220 280" xmlns="http://www.w3.org/2000/svg" width="220"><ellipse cx="110" cy="50" rx="80" ry="20" fill="${col}" fill-opacity=".25" stroke="${col}" stroke-width="2"/><line x1="30" y1="50" x2="30" y2="230" stroke="${col}" stroke-width="2"/><line x1="190" y1="50" x2="190" y2="230" stroke="${col}" stroke-width="2"/><path d="M 30,230 A 80,20 0 0,0 190,230" fill="${col}" fill-opacity=".15" stroke="${col}" stroke-width="2"/><path d="M 30,230 A 80,20 0 0,1 190,230" fill="none" stroke="${col}" stroke-width="1" stroke-dasharray="3 3"/><text x="110" y="46" font-family="Lora,serif" font-style="italic" font-size="13" text-anchor="middle" fill="#1c1612">${esc(p.r)}</text><text x="200" y="140" font-family="Lora,serif" font-style="italic" font-size="13" fill="#3a2f25">${esc(p.h)}</text></svg>` },
  cone: { cat: 'Shapes 3D', name: 'Cone', defaults: { r:'r', h:'h', cap:'Cone' }, fields: [['r','Radius'],['h','Height'],['cap','Caption']],
    render: (p, col) => `<svg viewBox="0 0 220 280" xmlns="http://www.w3.org/2000/svg" width="220"><line x1="110" y1="30" x2="30" y2="230" stroke="${col}" stroke-width="2"/><line x1="110" y1="30" x2="190" y2="230" stroke="${col}" stroke-width="2"/><path d="M 30,230 A 80,20 0 0,0 190,230" fill="${col}" fill-opacity=".25" stroke="${col}" stroke-width="2"/><path d="M 30,230 A 80,20 0 0,1 190,230" fill="none" stroke="${col}" stroke-width="1" stroke-dasharray="3 3"/><line x1="110" y1="30" x2="110" y2="230" stroke="${col}" stroke-width="1" stroke-dasharray="3 3"/><text x="120" y="135" font-family="Lora,serif" font-style="italic" font-size="13" fill="#3a2f25">${esc(p.h)}</text><text x="150" y="245" font-family="Lora,serif" font-style="italic" font-size="13" fill="#3a2f25">${esc(p.r)}</text></svg>` },
  sphere: { cat: 'Shapes 3D', name: 'Sphere', defaults: { r:'r', cap:'Sphere' }, fields: [['r','Radius'],['cap','Caption']],
    render: (p, col) => `<svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" width="240"><circle cx="120" cy="120" r="90" fill="${col}" fill-opacity=".15" stroke="${col}" stroke-width="2"/><ellipse cx="120" cy="120" rx="90" ry="25" fill="none" stroke="${col}" stroke-width="1" stroke-dasharray="3 3"/><line x1="120" y1="120" x2="210" y2="120" stroke="${col}" stroke-width="1.6" stroke-dasharray="4 3"/><circle cx="120" cy="120" r="3" fill="#1c1612"/><text x="160" y="113" font-family="Lora,serif" font-style="italic" font-size="13" fill="#3a2f25">${esc(p.r)}</text></svg>` },

  // ============ GRAPHS ============
  numberline: { cat: 'Graphs', name: 'Number Line', defaults: { min:'-5', max:'5', step:'1', highlight:'0', cap:'Number line' }, fields: [['min','Min'],['max','Max'],['step','Step'],['highlight','Highlight'],['cap','Caption']],
    render: (p, col) => {
      const min=parseFloat(p.min), max=parseFloat(p.max), step=parseFloat(p.step)||1, w=540, m=30, axisY=50;
      const inX = v => m + ((v-min)/(max-min)) * (w-2*m);
      let ticks=''; for (let v=min; v<=max+0.0001; v+=step) { const x=inX(v); ticks += `<line x1="${x}" y1="${axisY-7}" x2="${x}" y2="${axisY+7}" stroke="#1c1612" stroke-width="1.2"/><text x="${x}" y="${axisY+24}" font-family="Lora,serif" font-size="12" text-anchor="middle" fill="#1c1612">${+v.toFixed(2)}</text>`; }
      const h=parseFloat(p.highlight); const hl = (!isNaN(h) && h>=min && h<=max) ? `<circle cx="${inX(h)}" cy="${axisY}" r="6" fill="${col}"/>` : '';
      return `<svg viewBox="0 0 ${w} 90" xmlns="http://www.w3.org/2000/svg" width="${w}"><line x1="${m-4}" y1="${axisY}" x2="${w-m+4}" y2="${axisY}" stroke="#1c1612" stroke-width="1.6"/><polygon points="${m-10},${axisY} ${m-4},${axisY-5} ${m-4},${axisY+5}" fill="#1c1612"/><polygon points="${w-m+10},${axisY} ${w-m+4},${axisY-5} ${w-m+4},${axisY+5}" fill="#1c1612"/>${ticks}${hl}</svg>`;
    } },
  coordgrid: { cat: 'Graphs', name: 'Coordinate Grid', defaults: { range:'5', cap:'Cartesian plane' }, fields: [['range','Range (±)'],['cap','Caption']],
    render: (p, col) => {
      const r=parseInt(p.range,10)||5, size=320, m=20, ax=(size-2*m)/(2*r);
      let lines='';
      for (let i=-r;i<=r;i++) {
        const x=m+(i+r)*ax, y=m+(i+r)*ax;
        const stroke=i===0?'#1c1612':'#d9cfbe', sw=i===0?1.6:0.8;
        lines += `<line x1="${x}" y1="${m}" x2="${x}" y2="${size-m}" stroke="${stroke}" stroke-width="${sw}"/><line x1="${m}" y1="${y}" x2="${size-m}" y2="${y}" stroke="${stroke}" stroke-width="${sw}"/>`;
        if (i!==0) lines += `<text x="${m+(i+r)*ax}" y="${m+r*ax+14}" font-family="Lora,serif" font-size="10" text-anchor="middle" fill="#3a2f25">${i}</text><text x="${m+r*ax-6}" y="${m+(r-i)*ax+4}" font-family="Lora,serif" font-size="10" text-anchor="end" fill="#3a2f25">${i}</text>`;
      }
      return `<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" width="${size}">${lines}<text x="${size-14}" y="${m+r*ax-6}" font-family="Lora,serif" font-style="italic" font-size="13" fill="#1c1612">x</text><text x="${m+r*ax+8}" y="${m+12}" font-family="Lora,serif" font-style="italic" font-size="13" fill="#1c1612">y</text></svg>`;
    } },
  fractionbar: { cat: 'Graphs', name: 'Fraction Bar', defaults: { parts:'4', shaded:'3', cap:'3/4' }, fields: [['parts','Total parts'],['shaded','Shaded'],['cap','Caption']],
    render: (p, col) => {
      const parts=Math.max(1, parseInt(p.parts,10)||1);
      const shaded=Math.min(parts, Math.max(0, parseInt(p.shaded,10)||0));
      const w=480, h=80, pw=w/parts;
      let bars=''; for (let i=0;i<parts;i++) bars += `<rect x="${i*pw}" y="0" width="${pw}" height="${h}" fill="${i<shaded?col:'#fff'}" fill-opacity="${i<shaded?'.55':'1'}" stroke="${col}" stroke-width="2"/>`;
      return `<svg viewBox="0 0 ${w} ${h+30}" xmlns="http://www.w3.org/2000/svg" width="${w}">${bars}<text x="${w/2}" y="${h+24}" font-family="Lora,serif" font-size="16" font-weight="700" text-anchor="middle" fill="#1c1612">${shaded} / ${parts}</text></svg>`;
    } },
  barchart: { cat: 'Graphs', name: 'Bar Chart', defaults: { labels:'Mon,Tue,Wed,Thu,Fri', values:'12,18,9,15,21', cap:'Bar chart' }, fields: [['labels','Labels'],['values','Values'],['cap','Caption']],
    render: (p, col) => {
      const labels=p.labels.split(',').map(s=>s.trim());
      const values=p.values.split(',').map(s=>parseFloat(s)||0);
      const w=460, h=240, pad=36, max=Math.max(...values,1);
      const bw=(w-pad*2)/values.length*0.65, gap=(w-pad*2)/values.length*0.35;
      let bars=''; values.forEach((v,i)=>{
        const x=pad+i*(bw+gap)+gap/2, bh=(v/max)*(h-pad*2), y=h-pad-bh;
        bars += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="${col}" fill-opacity=".75"/><text x="${x+bw/2}" y="${y-6}" font-family="Lora,serif" font-size="11" text-anchor="middle" fill="#1c1612">${v}</text><text x="${x+bw/2}" y="${h-pad+16}" font-family="Lora,serif" font-size="11" text-anchor="middle" fill="#3a2f25">${esc(labels[i]||'')}</text>`;
      });
      return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" width="${w}"><line x1="${pad}" y1="${pad}" x2="${pad}" y2="${h-pad}" stroke="#1c1612" stroke-width="1.2"/><line x1="${pad}" y1="${h-pad}" x2="${w-pad}" y2="${h-pad}" stroke="#1c1612" stroke-width="1.2"/>${bars}</svg>`;
    } },
  piechart: { cat: 'Graphs', name: 'Pie Chart', defaults: { labels:'A,B,C,D', values:'30,25,20,25', cap:'Pie chart' }, fields: [['labels','Labels'],['values','Values'],['cap','Caption']],
    render: (p, col) => {
      const labels=p.labels.split(',').map(s=>s.trim());
      const values=p.values.split(',').map(s=>parseFloat(s)||0);
      const total=values.reduce((a,b)=>a+b,0)||1;
      const cx=140, cy=140, r=100;
      const palette = [col, '#b8492a', '#c89a3a', '#365314', '#581c87', '#1e3a8a', '#831843'];
      let angle=-Math.PI/2, slices=''; values.forEach((v,i)=>{
        const a2 = angle + (v/total)*2*Math.PI;
        const large = (a2-angle) > Math.PI ? 1 : 0;
        const x1=cx+r*Math.cos(angle), y1=cy+r*Math.sin(angle);
        const x2=cx+r*Math.cos(a2), y2=cy+r*Math.sin(a2);
        const mid=(angle+a2)/2;
        slices += `<path d="M ${cx},${cy} L ${x1},${y1} A ${r},${r} 0 ${large},1 ${x2},${y2} Z" fill="${palette[i%palette.length]}" fill-opacity=".75" stroke="#fff" stroke-width="2"/>`;
        const lx = cx + (r+18)*Math.cos(mid), ly = cy + (r+18)*Math.sin(mid);
        slices += `<text x="${lx}" y="${ly+4}" font-family="Lora,serif" font-size="11" text-anchor="middle" fill="#1c1612">${esc(labels[i]||'')}</text>`;
        angle = a2;
      });
      return `<svg viewBox="0 0 280 290" xmlns="http://www.w3.org/2000/svg" width="280">${slices}</svg>`;
    } },
  linegraph: { cat: 'Graphs', name: 'Line Graph', defaults: { labels:'Mon,Tue,Wed,Thu,Fri', values:'5,8,6,12,10', cap:'Line graph' }, fields: [['labels','X labels'],['values','Y values'],['cap','Caption']],
    render: (p, col) => {
      const labels=p.labels.split(',').map(s=>s.trim());
      const values=p.values.split(',').map(s=>parseFloat(s)||0);
      const w=460, h=240, pad=36, max=Math.max(...values,1);
      const step = (w-pad*2)/(values.length-1 || 1);
      const points = values.map((v,i)=>`${pad+i*step},${h-pad-(v/max)*(h-pad*2)}`).join(' ');
      let dots = values.map((v,i)=>`<circle cx="${pad+i*step}" cy="${h-pad-(v/max)*(h-pad*2)}" r="4" fill="${col}"/>`).join('');
      let xlabs = labels.map((l,i)=>`<text x="${pad+i*step}" y="${h-pad+16}" font-family="Lora,serif" font-size="11" text-anchor="middle" fill="#3a2f25">${esc(l)}</text>`).join('');
      return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" width="${w}"><line x1="${pad}" y1="${pad}" x2="${pad}" y2="${h-pad}" stroke="#1c1612" stroke-width="1.2"/><line x1="${pad}" y1="${h-pad}" x2="${w-pad}" y2="${h-pad}" stroke="#1c1612" stroke-width="1.2"/><polyline points="${points}" fill="none" stroke="${col}" stroke-width="2.5"/>${dots}${xlabs}</svg>`;
    } },
  venn2: { cat: 'Graphs', name: '2-Set Venn', defaults: { a:'Set A', b:'Set B', cap:'Venn diagram' }, fields: [['a','Set A'],['b','Set B'],['cap','Caption']],
    render: (p, c) => `<svg viewBox="0 0 360 220" xmlns="http://www.w3.org/2000/svg" width="360"><circle cx="135" cy="110" r="80" fill="${c}" fill-opacity=".22" stroke="${c}" stroke-width="2"/><circle cx="225" cy="110" r="80" fill="${c}" fill-opacity=".22" stroke="${c}" stroke-width="2"/><text x="90" y="115" font-family="Lora,serif" font-size="16" font-weight="700" text-anchor="middle" fill="#1c1612">${esc(p.a)}</text><text x="270" y="115" font-family="Lora,serif" font-size="16" font-weight="700" text-anchor="middle" fill="#1c1612">${esc(p.b)}</text><text x="180" y="115" font-family="Lora,serif" font-size="14" font-weight="600" text-anchor="middle" fill="#1c1612">A∩B</text></svg>` },
  venn3: { cat: 'Graphs', name: '3-Set Venn', defaults: { a:'A', b:'B', c:'C', cap:'Venn of three sets' }, fields: [['a','Set A'],['b','Set B'],['c','Set C'],['cap','Caption']],
    render: (p, col) => `<svg viewBox="0 0 360 320" xmlns="http://www.w3.org/2000/svg" width="360"><circle cx="140" cy="130" r="80" fill="${col}" fill-opacity=".22" stroke="${col}" stroke-width="2"/><circle cx="220" cy="130" r="80" fill="${col}" fill-opacity=".22" stroke="${col}" stroke-width="2"/><circle cx="180" cy="200" r="80" fill="${col}" fill-opacity=".22" stroke="${col}" stroke-width="2"/><text x="80" y="100" font-family="Lora,serif" font-size="16" font-weight="700" text-anchor="middle" fill="#1c1612">${esc(p.a)}</text><text x="280" y="100" font-family="Lora,serif" font-size="16" font-weight="700" text-anchor="middle" fill="#1c1612">${esc(p.b)}</text><text x="180" y="290" font-family="Lora,serif" font-size="16" font-weight="700" text-anchor="middle" fill="#1c1612">${esc(p.c)}</text></svg>` },

  // ============ SCIENCE ============
  plantcell: { cat: 'Science', name: 'Plant Cell', defaults: { cap:'Plant cell' }, fields: [['cap','Caption']],
    render: (p, col) => `<svg viewBox="0 0 360 280" xmlns="http://www.w3.org/2000/svg" width="360"><rect x="20" y="20" width="320" height="240" rx="14" fill="#d9f0c8" stroke="${col}" stroke-width="3"/><rect x="32" y="32" width="296" height="216" rx="8" fill="#fff" stroke="#7a9a4a" stroke-width="1.5"/><ellipse cx="180" cy="140" rx="40" ry="34" fill="#7a9a4a" fill-opacity=".4" stroke="#365314" stroke-width="1.6"/><circle cx="180" cy="140" r="14" fill="#365314"/><ellipse cx="80" cy="80" rx="14" ry="8" fill="#7a9a4a"/><ellipse cx="280" cy="90" rx="14" ry="8" fill="#7a9a4a"/><ellipse cx="100" cy="200" rx="14" ry="8" fill="#7a9a4a"/><ellipse cx="280" cy="200" rx="14" ry="8" fill="#7a9a4a"/><text x="180" y="143" font-family="Lora,serif" font-size="9" text-anchor="middle" fill="#fff">nucleus</text><text x="80" y="65" font-family="Lora,serif" font-size="10" text-anchor="middle" fill="#1c1612">chloroplast</text><text x="40" y="270" font-family="Lora,serif" font-size="10" fill="#1c1612">cell wall →</text></svg>` },
  animalcell: { cat: 'Science', name: 'Animal Cell', defaults: { cap:'Animal cell' }, fields: [['cap','Caption']],
    render: (p, col) => `<svg viewBox="0 0 320 280" xmlns="http://www.w3.org/2000/svg" width="320"><ellipse cx="160" cy="140" rx="140" ry="120" fill="#fce4d6" stroke="${col}" stroke-width="2.5"/><circle cx="160" cy="140" r="40" fill="#b8492a" fill-opacity=".5" stroke="#7c2d12" stroke-width="1.6"/><circle cx="160" cy="140" r="14" fill="#7c2d12"/><ellipse cx="90" cy="100" rx="20" ry="10" fill="#c89a3a" fill-opacity=".7"/><ellipse cx="240" cy="180" rx="22" ry="12" fill="#c89a3a" fill-opacity=".7"/><circle cx="100" cy="200" r="6" fill="#7c2d12"/><circle cx="220" cy="80" r="6" fill="#7c2d12"/><text x="160" y="143" font-family="Lora,serif" font-size="9" text-anchor="middle" fill="#fff">nucleus</text><text x="90" y="100" font-family="Lora,serif" font-size="9" text-anchor="middle" fill="#1c1612">mitochondrion</text></svg>` },
  circuit: { cat: 'Science', name: 'Simple Circuit', defaults: { cap:'Simple electric circuit' }, fields: [['cap','Caption']],
    render: (p, col) => `<svg viewBox="0 0 360 240" xmlns="http://www.w3.org/2000/svg" width="360"><rect x="40" y="40" width="280" height="160" fill="none" stroke="${col}" stroke-width="2.5"/><line x1="60" y1="40" x2="80" y2="40" stroke="#fff" stroke-width="6"/><line x1="60" y1="36" x2="60" y2="44" stroke="#1c1612" stroke-width="3"/><line x1="80" y1="30" x2="80" y2="50" stroke="#1c1612" stroke-width="3"/><line x1="65" y1="36" x2="65" y2="44" stroke="#1c1612" stroke-width="3"/><line x1="75" y1="30" x2="75" y2="50" stroke="#1c1612" stroke-width="3"/><text x="55" y="25" font-family="Lora,serif" font-size="11" fill="#1c1612">Battery</text><circle cx="180" cy="40" r="14" fill="#fff9c4" stroke="${col}" stroke-width="2"/><line x1="170" y1="30" x2="190" y2="50" stroke="${col}" stroke-width="1.5"/><line x1="190" y1="30" x2="170" y2="50" stroke="${col}" stroke-width="1.5"/><text x="180" y="22" font-family="Lora,serif" font-size="11" text-anchor="middle" fill="#1c1612">Bulb</text><line x1="280" y1="40" x2="300" y2="40" stroke="#fff" stroke-width="6"/><line x1="280" y1="40" x2="305" y2="20" stroke="#1c1612" stroke-width="2.5"/><circle cx="280" cy="40" r="3" fill="#1c1612"/><circle cx="300" cy="40" r="3" fill="#1c1612"/><text x="290" y="65" font-family="Lora,serif" font-size="11" text-anchor="middle" fill="#1c1612">Switch</text></svg>` },
  forcearrows: { cat: 'Science', name: 'Force Arrows', defaults: { up:'N (Normal)', down:'W (Weight)', left:'F (Friction)', right:'P (Push)', cap:'Forces on object' }, fields: [['up','Up'],['down','Down'],['left','Left'],['right','Right'],['cap','Caption']],
    render: (p, col) => `<svg viewBox="0 0 320 280" xmlns="http://www.w3.org/2000/svg" width="320"><rect x="120" y="120" width="80" height="40" fill="${col}" fill-opacity=".15" stroke="${col}" stroke-width="2.5"/><line x1="160" y1="120" x2="160" y2="40" stroke="#1c1612" stroke-width="2.5"/><polygon points="160,30 154,46 166,46" fill="#1c1612"/><text x="170" y="60" font-family="Lora,serif" font-size="11" fill="#1c1612">${esc(p.up)}</text><line x1="160" y1="160" x2="160" y2="240" stroke="#1c1612" stroke-width="2.5"/><polygon points="160,250 154,234 166,234" fill="#1c1612"/><text x="170" y="220" font-family="Lora,serif" font-size="11" fill="#1c1612">${esc(p.down)}</text><line x1="120" y1="140" x2="40" y2="140" stroke="#1c1612" stroke-width="2.5"/><polygon points="30,140 46,134 46,146" fill="#1c1612"/><text x="60" y="130" font-family="Lora,serif" font-size="11" fill="#1c1612">${esc(p.left)}</text><line x1="200" y1="140" x2="280" y2="140" stroke="#1c1612" stroke-width="2.5"/><polygon points="290,140 274,134 274,146" fill="#1c1612"/><text x="240" y="130" font-family="Lora,serif" font-size="11" text-anchor="middle" fill="#1c1612">${esc(p.right)}</text></svg>` },
  foodchain: { cat: 'Science', name: 'Food Chain', defaults: { a:'Sun', b:'Grass', c:'Goat', d:'Lion', cap:'Food chain' }, fields: [['a','Item 1'],['b','Item 2'],['c','Item 3'],['d','Item 4'],['cap','Caption']],
    render: (p, col) => `<svg viewBox="0 0 540 120" xmlns="http://www.w3.org/2000/svg" width="540"><g font-family="Lora,serif" font-size="13" font-weight="600">${[p.a,p.b,p.c,p.d].map((t,i)=>`<rect x="${20+i*130}" y="40" width="100" height="40" rx="6" fill="${col}" fill-opacity=".15" stroke="${col}" stroke-width="2"/><text x="${70+i*130}" y="64" text-anchor="middle" fill="#1c1612">${esc(t)}</text>`).join('')}${[0,1,2].map(i=>`<line x1="${120+i*130}" y1="60" x2="${145+i*130}" y2="60" stroke="#1c1612" stroke-width="2"/><polygon points="${150+i*130},60 ${143+i*130},56 ${143+i*130},64" fill="#1c1612"/>`).join('')}</g></svg>` },

  // ============ GEOGRAPHY ============
  compass: { cat: 'Geography', name: 'Compass Rose', defaults: { cap:'Compass rose' }, fields: [['cap','Caption']],
    render: (p, col) => `<svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" width="240"><circle cx="120" cy="120" r="100" fill="none" stroke="${col}" stroke-width="1.5"/><polygon points="120,30 130,120 120,210 110,120" fill="${col}" fill-opacity=".5" stroke="${col}" stroke-width="1.5"/><polygon points="30,120 120,130 210,120 120,110" fill="${col}" fill-opacity=".3" stroke="${col}" stroke-width="1.5"/><text x="120" y="22" font-family="Lora,serif" font-size="18" font-weight="700" text-anchor="middle" fill="#1c1612">N</text><text x="120" y="232" font-family="Lora,serif" font-size="18" font-weight="700" text-anchor="middle" fill="#1c1612">S</text><text x="20" y="126" font-family="Lora,serif" font-size="18" font-weight="700" text-anchor="middle" fill="#1c1612">W</text><text x="222" y="126" font-family="Lora,serif" font-size="18" font-weight="700" text-anchor="middle" fill="#1c1612">E</text><circle cx="120" cy="120" r="6" fill="${col}"/></svg>` },
  contourlines: { cat: 'Geography', name: 'Contour Lines', defaults: { cap:'Contour lines (hill)' }, fields: [['cap','Caption']],
    render: (p, col) => `<svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg" width="320"><ellipse cx="160" cy="120" rx="140" ry="90" fill="none" stroke="${col}" stroke-width="1.6"/><ellipse cx="160" cy="120" rx="110" ry="70" fill="none" stroke="${col}" stroke-width="1.6"/><ellipse cx="160" cy="120" rx="80" ry="50" fill="none" stroke="${col}" stroke-width="1.6"/><ellipse cx="160" cy="120" rx="50" ry="30" fill="none" stroke="${col}" stroke-width="1.6"/><ellipse cx="160" cy="120" rx="20" ry="12" fill="${col}" fill-opacity=".3" stroke="${col}" stroke-width="1.6"/><text x="160" y="124" font-family="Lora,serif" font-size="11" text-anchor="middle" fill="#1c1612">peak</text></svg>` },

  // ============ ORGANISERS ============
  mindmap: { cat: 'Organisers', name: 'Mind Map', defaults: { centre:'Topic', a:'Idea 1', b:'Idea 2', c:'Idea 3', d:'Idea 4', cap:'Mind map' }, fields: [['centre','Centre'],['a','Branch 1'],['b','Branch 2'],['c','Branch 3'],['d','Branch 4'],['cap','Caption']],
    render: (p, col) => `<svg viewBox="0 0 480 320" xmlns="http://www.w3.org/2000/svg" width="480"><line x1="240" y1="160" x2="100" y2="60" stroke="${col}" stroke-width="2"/><line x1="240" y1="160" x2="380" y2="60" stroke="${col}" stroke-width="2"/><line x1="240" y1="160" x2="100" y2="260" stroke="${col}" stroke-width="2"/><line x1="240" y1="160" x2="380" y2="260" stroke="${col}" stroke-width="2"/><ellipse cx="240" cy="160" rx="70" ry="34" fill="${col}" stroke="${col}" stroke-width="2"/><text x="240" y="166" font-family="Lora,serif" font-size="14" font-weight="700" text-anchor="middle" fill="#fff">${esc(p.centre)}</text>${[[100,60,p.a],[380,60,p.b],[100,260,p.c],[380,260,p.d]].map(([x,y,t])=>`<rect x="${x-55}" y="${y-18}" width="110" height="36" rx="18" fill="#fff" stroke="${col}" stroke-width="2"/><text x="${x}" y="${y+5}" font-family="Lora,serif" font-size="12" font-weight="600" text-anchor="middle" fill="#1c1612">${esc(t)}</text>`).join('')}</svg>` },
  tchart: { cat: 'Organisers', name: 'T-Chart', defaults: { left:'Side A', right:'Side B', cap:'Comparison' }, fields: [['left','Left header'],['right','Right header'],['cap','Caption']],
    render: (p, col) => `<svg viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg" width="400"><line x1="20" y1="60" x2="380" y2="60" stroke="${col}" stroke-width="2.5"/><line x1="200" y1="20" x2="200" y2="220" stroke="${col}" stroke-width="2.5"/><text x="110" y="44" font-family="Lora,serif" font-size="14" font-weight="700" text-anchor="middle" fill="#1c1612">${esc(p.left)}</text><text x="290" y="44" font-family="Lora,serif" font-size="14" font-weight="700" text-anchor="middle" fill="#1c1612">${esc(p.right)}</text>${[80,110,140,170,200].map(y=>`<line x1="30" y1="${y}" x2="180" y2="${y}" stroke="#c4b69e" stroke-width="1"/><line x1="220" y1="${y}" x2="370" y2="${y}" stroke="#c4b69e" stroke-width="1"/>`).join('')}</svg>` },
  timeline: { cat: 'Organisers', name: 'Timeline', defaults: { years:'1964,1980,1991,2011,2024', events:'Independence,One-party,Multi-party,New Constitution,Today', cap:'Timeline' }, fields: [['years','Markers'],['events','Events'],['cap','Caption']],
    render: (p, col) => {
      const years=p.years.split(',').map(s=>s.trim());
      const events=p.events.split(',').map(s=>s.trim());
      const w=560, axisY=120, m=40;
      const step=(w-2*m)/(years.length-1||1);
      let dots=''; years.forEach((y,i)=>{
        const x=m+i*step;
        dots += `<circle cx="${x}" cy="${axisY}" r="7" fill="${col}"/><text x="${x}" y="${axisY+28}" font-family="Lora,serif" font-size="12" font-weight="700" text-anchor="middle" fill="#1c1612">${esc(y)}</text><text x="${x}" y="${axisY-18}" font-family="Lora,serif" font-size="11" text-anchor="middle" fill="#3a2f25">${esc(events[i]||'')}</text>`;
      });
      return `<svg viewBox="0 0 ${w} 200" xmlns="http://www.w3.org/2000/svg" width="${w}"><line x1="${m}" y1="${axisY}" x2="${w-m}" y2="${axisY}" stroke="${col}" stroke-width="2.5"/>${dots}</svg>`;
    } },
  flowchart: { cat: 'Organisers', name: 'Flowchart', defaults: { a:'Start', b:'Process', c:'Decide?', d:'End', cap:'Flowchart' }, fields: [['a','Step 1'],['b','Step 2'],['c','Step 3'],['d','Step 4'],['cap','Caption']],
    render: (p, col) => `<svg viewBox="0 0 200 360" xmlns="http://www.w3.org/2000/svg" width="200"><g font-family="Lora,serif" font-size="13" font-weight="600">${[p.a,p.b,p.c,p.d].map((t,i)=>`<rect x="20" y="${20+i*84}" width="160" height="50" rx="${i===2?0:14}" fill="${col}" fill-opacity=".15" stroke="${col}" stroke-width="2" transform="${i===2?`rotate(45 100 ${45+i*84})`:''}"/><text x="100" y="${50+i*84}" text-anchor="middle" fill="#1c1612">${esc(t)}</text>`).join('')}${[0,1,2].map(i=>`<line x1="100" y1="${72+i*84}" x2="100" y2="${102+i*84}" stroke="#1c1612" stroke-width="2"/><polygon points="100,${108+i*84} 95,${100+i*84} 105,${100+i*84}" fill="#1c1612"/>`).join('')}</g></svg>` }
};

function openDiagramModal() {
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const cats = ['All', ...Array.from(new Set(Object.values(diagrams).map(d => d.cat)))];
  const renderGrid = (filter) => `<div class="diagram-grid" id="diagram-grid">${Object.entries(diagrams).filter(([k,d]) => filter === 'All' || d.cat === filter).map(([key, d]) => `<div class="diagram-card" data-diagram="${key}"><div class="preview">${d.render(d.defaults, accent)}</div><div class="name">${d.name}</div></div>`).join('')}</div>`;
  $('#diagram-modal-body').innerHTML = `
    <div class="diagram-cats">${cats.map((c,i) => `<button class="cat-btn ${i===0?'active':''}" data-cat="${c}">${c}</button>`).join('')}</div>
    ${renderGrid('All')}`;
  $('#modal-diagram').classList.add('show');
  function bindCards() {
    $$('#diagram-grid .diagram-card').forEach(c => c.addEventListener('click', () => openDiagramConfig(c.dataset.diagram)));
  }
  bindCards();
  $$('#diagram-modal-body .cat-btn').forEach(b => b.addEventListener('click', () => {
    $$('#diagram-modal-body .cat-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    const grid = $('#diagram-grid');
    grid.outerHTML = renderGrid(b.dataset.cat);
    bindCards();
  }));
}
function openDiagramConfig(key) {
  const d = diagrams[key];
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const state = { ...d.defaults };
  $('#diagram-modal-body').innerHTML = `
    <button class="btn-outline" id="dc-back" style="margin-bottom:14px">← Back to gallery</button>
    <div class="diagram-config">
      <div><h4 style="margin:0 0 12px;font:600 14px/1.2 var(--font-display)">${d.name}</h4>${d.fields.map(([k,label]) => `<div class="config-field"><label>${label}</label><input type="text" data-key="${k}" value="${esc(state[k]||'')}"></div>`).join('')}</div>
      <div><label style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:8px">Preview</label><div class="diagram-preview" id="dc-preview"></div></div>
    </div>
    <div class="diagram-actions"><button class="btn-outline" id="dc-cancel">Cancel</button><button class="btn-solid" id="dc-insert">Insert into Lesson</button></div>`;
  const update = () => $('#dc-preview').innerHTML = d.render(state, accent);
  update();
  $$('#diagram-modal-body input[data-key]').forEach(inp => inp.addEventListener('input', () => { state[inp.dataset.key] = inp.value; update(); }));
  $('#dc-back').addEventListener('click', openDiagramModal);
  $('#dc-cancel').addEventListener('click', closeModal);
  $('#dc-insert').addEventListener('click', () => insertDiagram(key, state));
}
function insertDiagram(key, state) {
  const d = diagrams[key];
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const html = `<div class="diagram-wrap" contenteditable="false">${d.render(state, accent)}<div class="diagram-caption">${esc(state.cap || d.name)}</div></div>`;
  if (!editing) $('#btn-edit').click();
  doc.focus();
  const sel = window.getSelection();
  if (!sel.rangeCount || !doc.contains(sel.getRangeAt(0).startContainer)) {
    const r = document.createRange(); r.selectNodeContents(doc); r.collapse(false);
    sel.removeAllRanges(); sel.addRange(r);
  }
  document.execCommand('insertHTML', false, html + '<p>&nbsp;</p>');
  closeModal();
  toast('Diagram inserted');
}
function closeModal() {
  $$('.modal-scrim.show').forEach(m => m.classList.remove('show'));
}
$$('[data-close-modal]').forEach(b => b.addEventListener('click', closeModal));
// Backdrop-click closes the modal (clicking on the scrim itself, not its inner modal)
$$('.modal-scrim').forEach(scrim => {
  scrim.addEventListener('click', e => { if (e.target === scrim) closeModal(); });
});
$('#btn-diagram').addEventListener('click', openDiagramModal);

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'p') { e.preventDefault(); exportPDF(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); exportWord(); }
  if (e.key === 'Escape') { closeModal(); closePdfViewer(); exportPop.classList.remove('open'); }
});
