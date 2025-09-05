import ForceGraph from 'force-graph';
import { forceCollide, forceLink, forceY } from 'd3-force';
import { parse as CSVParse } from './csv-sync.js';

const hashCode = s => {
  return s.split("").reduce(function(a, b) {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return Math.abs(a & a);
  }, 0);
};

const computeCurvature = links => {
    const selfLoopLinks = {};
    const sameNodesLinks = {};
    const curvatureMinMax = 0.1;

    // 1. assign each link a nodePairId that combines their source and target independent of the links direction
    // 2. group links together that share the same two nodes or are self-loops
    links.forEach(link => {
      link.nodePairId = link.source <= link.target ? (link.source + "_" + link.target) : (link.target + "_" + link.source);
      let map = link.source === link.target ? selfLoopLinks : sameNodesLinks;
      if (!map[link.nodePairId]) {
        map[link.nodePairId] = [];
      }
      map[link.nodePairId].push(link);
    });

    // Compute the curvature for self-loop links to avoid overlaps
    Object.keys(selfLoopLinks).forEach(id => {
      let links = selfLoopLinks[id];
      let lastIndex = links.length - 1;
      links[lastIndex].curvature = 1;
      let delta = (1 - curvatureMinMax) / lastIndex;
      for (let i = 0; i < lastIndex; i++) {
        links[i].curvature = curvatureMinMax + i * delta;
      }
    });

    // Compute the curvature for links sharing the same two nodes to avoid overlaps
    Object.keys(sameNodesLinks).filter(nodePairId => sameNodesLinks[nodePairId].length > 1).forEach(nodePairId => {
      let links = sameNodesLinks[nodePairId];
      let lastIndex = links.length - 1;
      let lastLink = links[lastIndex];
      lastLink.curvature = curvatureMinMax;
      let delta = 2 * curvatureMinMax / lastIndex;
      for (let i = 0; i < lastIndex; i++) {
        links[i].curvature = - curvatureMinMax + i * delta;
        if (lastLink.source !== links[i].source) {
          links[i].curvature *= -1; // flip it around, otherwise they overlap
        }
      }
    });

};

const init = async () => {
    const res = await fetch('./collation.csv');
    const csv = CSVParse(await res.text());
    const sigla = csv.map(arr => arr.shift());
    const colours = ['#a6cee3','#1f78b4','#b2df8a','#33a02c','#fb9a99','#e31a1c','#fdbf6f','#ff7f00','#cab2d6'];
    const levels = [];
    for(let n=0;n<csv[0].length;n++) {
        const set = new Map();
        for(const text of csv)
            if(text[n]) {
                const count = set.get(text[n]) || 0;
                set.set(text[n],count + 1);
            }
        levels.push([...set]);
    }
    const nextcell = (arr, start) => {
        for(let n=start+1;n<arr.length;n++)
            if(arr[n] !== '') return arr[n];
        return undefined;
    };
    const links = [];
    for(let n=0;n<sigla.length;n++) {
        const name = sigla[n];
        const colour = colours[n];
        const text = csv[n];
        for(let m=0;m<text.length-1;m++) {
            if(text[m] === '') continue;
            const next = nextcell(text,m);
            if(!next) continue;
            links.push({
                id: `${name}${m}`,
                siglum: name,
                colour: colour,
                source: hashCode(text[m]),
                target: hashCode(next)
            });
        }
    }
    const nodes = [];
    for(let n=0;n<levels.length;n++) {
        for(const node of levels[n]) {
            nodes.push({
                name: node[0],
                id: hashCode(node[0]),
                size: node[1],
                color: 'rgba(255,255,255,0.9)',
                level: n
            });
        }
    }

    computeCurvature(links);
    
    links.forEach(link => {
      const a = nodes.find(n => n.id === link.source);
      const b = nodes.find(n => n.id === link.target);
      if(!a.hasOwnProperty('neighbors')) a.neighbors = [];
      if(!b.hasOwnProperty('neighbors')) b.neighbors = [];
      a.neighbors.push(b);
      b.neighbors.push(a);

      if(!a.hasOwnProperty('links')) a.links = [];
      if(!b.hasOwnProperty('links')) b.links = [];
      a.links.push(link);
      b.links.push(link);
    });

    const highlightNodes = new Set();
    const highlightLinks = new Set();
    let hoverNode = null;

    const NODE_REL_SIZE = 100;
    const graph = new ForceGraph(document.getElementById('graph'))
      .dagMode('lr')
      .dagLevelDistance(250)
      .backgroundColor('#101020')
      .linkColor(l => l.colour)
      .linkWidth(l => highlightLinks.has(l) ? 5 : 1)
      .linkLabel('siglum')
      .nodeRelSize(NODE_REL_SIZE)
      .nodeCanvasObjectMode(() => 'replace')
      .nodeCanvasObject((node, ctx, globalScale) => {
          if(highlightNodes.size > 0 && !highlightNodes.has(node)) return;
          const label = node.name;
          const fontSize = 12/globalScale * (node.size/4 + 0.5); 
          ctx.font = `${fontSize}px Sans-Serif`;
          const textWidth = ctx.measureText(label).width;
          const bckgDimensions = [textWidth, fontSize].map(n => n + fontSize * 0.2); // some padding

          ctx.fillStyle = 'rgba(0,0,0, 0.5)';
          ctx.fillRect(node.x - bckgDimensions[0] / 2, node.y - bckgDimensions[1] / 2, ...bckgDimensions);

          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = node.color;
          ctx.fillText(label, node.x, node.y);

          node.__bckgDimensions = bckgDimensions; // to re-use in nodePointerAreaPaint
        })
        .nodePointerAreaPaint((node, color, ctx) => {
          ctx.fillStyle = color;
          const bckgDimensions = node.__bckgDimensions;
          if(bckgDimensions) ctx.fillRect(node.x - bckgDimensions[0] / 2, node.y - bckgDimensions[1] / 2, ...bckgDimensions);
       })
      .nodeVal(node => node.x - node._bckgDimensions[0] / 2)
      .linkDirectionalParticles(2)
      .linkDirectionalParticleWidth(l => !highlightLinks.size ? 4 : highlightLinks.has(l) ? 15 : 0)
      .linkCurvature('curvature')
      //.d3Force('y',forceY(n => levels[n.level].map(l => l[0]).indexOf(n.name)-1).strength(1))
      .d3Force('collision', forceCollide(node => node.__bckgDimensions[1] + NODE_REL_SIZE))
      .d3Force('link', forceLink().strength(0))
      .d3VelocityDecay(0.2)
      .graphData({nodes: nodes, links: links});

      graph.onNodeHover(node => { 
        highlightNodes.clear();
        highlightLinks.clear();
        if (node) {
          highlightNodes.add(node);
          node.neighbors.forEach(neighbor => highlightNodes.add(neighbor));
          node.links.forEach(link => highlightLinks.add(link));
        }

        hoverNode = node || null;
      })
      .onLinkHover(link => {
        highlightNodes.clear();
        highlightLinks.clear();

        if (link) {
          highlightLinks.add(link);
          for(const other of links)
              if(other.siglum === link.siglum)
                  highlightLinks.add(other);
          highlightNodes.add(link.source);
          highlightNodes.add(link.target);
          for(const other of nodes)
              for(const otherlink of other.links)
                  if(otherlink.siglum === link.siglum) {
                      highlightNodes.add(other);
                      break;
                  }
        }
      });
};

init();
