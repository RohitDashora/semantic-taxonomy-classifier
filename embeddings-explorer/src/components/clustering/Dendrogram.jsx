import { useRef, useEffect, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { getTier1Color } from '../../lib/colors.js';

const MARGIN = { top: 20, right: 200, bottom: 20, left: 40 };
const NODE_HEIGHT = 22;
const TRANSITION_MS = 400;

export default function Dendrogram({ categories }) {
  const containerRef = useRef();
  const svgRef = useRef();
  const gRef = useRef();
  const rootRef = useRef();
  const [linkageData, setLinkageData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tooltip, setTooltip] = useState(null);

  // Fetch dendrogram data
  useEffect(() => {
    async function fetchDendrogram() {
      try {
        const res = await fetch('/api/dendrogram');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setLinkageData(data.linkage);
      } catch {
        setLinkageData(null);
      } finally {
        setLoading(false);
      }
    }
    fetchDendrogram();
  }, []);

  const update = useCallback((source) => {
    if (!gRef.current || !rootRef.current) return;

    const root = rootRef.current;
    const g = d3.select(gRef.current);
    const containerWidth = containerRef.current?.clientWidth || 900;
    const innerW = containerWidth - MARGIN.left - MARGIN.right;

    // Count visible leaves for dynamic height
    const visibleLeaves = root.leaves().length;
    const innerH = Math.max(400, visibleLeaves * NODE_HEIGHT);

    // Update SVG height
    d3.select(svgRef.current).attr('height', innerH + MARGIN.top + MARGIN.bottom);

    // Horizontal tree layout
    const tree = d3.tree().size([innerH, innerW]);
    tree(root);

    // --- Links ---
    const links = g.selectAll('path.link')
      .data(root.links(), d => d.target.data.id);

    const linkEnter = links.enter()
      .append('path')
      .attr('class', 'link')
      .attr('d', () => {
        const o = { x: source.x0 ?? source.x, y: source.y0 ?? source.y };
        return diagonal(o, o);
      });

    links.merge(linkEnter)
      .transition().duration(TRANSITION_MS)
      .attr('d', d => diagonal(d.source, d.target))
      .attr('fill', 'none')
      .attr('stroke', d => getDominantColor(d.target))
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.6);

    links.exit()
      .transition().duration(TRANSITION_MS)
      .attr('d', () => {
        const o = { x: source.x, y: source.y };
        return diagonal(o, o);
      })
      .remove();

    // --- Nodes ---
    const nodes = g.selectAll('g.node')
      .data(root.descendants(), d => d.data.id);

    const nodeEnter = nodes.enter()
      .append('g')
      .attr('class', 'node')
      .attr('transform', () => `translate(${source.y0 ?? source.y},${source.x0 ?? source.x})`)
      .attr('cursor', 'pointer')
      .on('click', (event, d) => {
        event.stopPropagation();
        toggle(d);
        update(d);
      })
      .on('mouseenter', (event, d) => {
        const rect = containerRef.current.getBoundingClientRect();
        setTooltip({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top - 10,
          node: d,
        });
      })
      .on('mouseleave', () => setTooltip(null));

    // Circle
    nodeEnter.append('circle')
      .attr('r', 0);

    // Label
    nodeEnter.append('text')
      .attr('dy', '0.35em')
      .attr('fill', '#e2e8f0')
      .attr('font-size', '11px');

    // Merge
    const nodeUpdate = nodeEnter.merge(nodes);

    nodeUpdate.transition().duration(TRANSITION_MS)
      .attr('transform', d => `translate(${d.y},${d.x})`);

    nodeUpdate.select('circle')
      .transition().duration(TRANSITION_MS)
      .attr('r', d => d.children || d._children ? 5 : 4)
      .attr('fill', d => {
        if (d._children) return '#64748b'; // collapsed
        return getDominantColor(d);
      })
      .attr('stroke', d => d._children ? getDominantColor(d) : 'none')
      .attr('stroke-width', d => d._children ? 2 : 0);

    nodeUpdate.select('text')
      .attr('x', d => (d.children || d._children) ? -10 : 10)
      .attr('text-anchor', d => (d.children || d._children) ? 'end' : 'start')
      .text(d => getNodeLabel(d))
      .attr('fill', d => {
        if (!d.children && !d._children) return getDominantColor(d);
        return '#e2e8f0';
      });

    // Exit
    const nodeExit = nodes.exit()
      .transition().duration(TRANSITION_MS)
      .attr('transform', () => `translate(${source.y},${source.x})`)
      .remove();

    nodeExit.select('circle').attr('r', 0);
    nodeExit.select('text').style('fill-opacity', 0);

    // Store positions for transitions
    root.each(d => {
      d.x0 = d.x;
      d.y0 = d.y;
    });
  }, []);

  // Initial render
  useEffect(() => {
    if (!linkageData || !svgRef.current || !categories.length) return;

    const n = categories.length;
    const rawRoot = linkageToHierarchy(linkageData, n, categories);
    const hierarchy = d3.hierarchy(rawRoot);

    // Start collapsed at depth 2
    hierarchy.each(d => {
      if (d.depth >= 2 && d.children) {
        d._children = d.children;
        d.children = null;
      }
    });

    rootRef.current = hierarchy;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const containerWidth = containerRef.current?.clientWidth || 900;
    svg.attr('width', containerWidth);

    const g = svg.append('g')
      .attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);
    gRef.current = g.node();

    // Zoom
    svg.call(d3.zoom()
      .scaleExtent([0.3, 3])
      .on('zoom', (e) => g.attr('transform', `translate(${MARGIN.left + e.transform.x},${MARGIN.top + e.transform.y}) scale(${e.transform.k})`))
    );

    hierarchy.x0 = 0;
    hierarchy.y0 = 0;

    update(hierarchy);
  }, [linkageData, categories, update]);

  if (loading) {
    return <div className="text-[var(--text-secondary)] text-sm p-4">Loading dendrogram data...</div>;
  }

  if (!linkageData) {
    return <div className="text-[var(--text-secondary)] text-sm p-4">Dendrogram data not available. Run the pre-computation notebook first.</div>;
  }

  return (
    <div ref={containerRef} className="relative overflow-hidden">
      <p className="text-xs text-[var(--text-secondary)] mb-2">
        Categories that merge at lower distances are more semantically similar. Click any node to expand/collapse.
      </p>
      <svg ref={svgRef} className="w-full" style={{ minHeight: 400 }} />

      {tooltip && (
        <div
          className="absolute pointer-events-none bg-[#0f172a]/95 backdrop-blur border border-[#334155] rounded-lg px-3 py-2 shadow-xl z-50"
          style={{ left: tooltip.x, top: tooltip.y, transform: 'translate(-50%, -100%)' }}
        >
          {tooltip.node.data.name && (
            <div className="text-xs font-semibold text-white">{tooltip.node.data.name}</div>
          )}
          {tooltip.node.data.tierPath && (
            <div className="text-[10px] text-slate-400">{tooltip.node.data.tierPath}</div>
          )}
          {tooltip.node.data.distance != null && (
            <div className="text-[10px] text-cyan-400 font-mono">
              Merge distance: {tooltip.node.data.distance.toFixed(3)}
            </div>
          )}
          {tooltip.node.data.count != null && (
            <div className="text-[10px] text-slate-400">
              {tooltip.node.data.count} descendants
            </div>
          )}
          {tooltip.node._children && (
            <div className="text-[10px] text-amber-400 mt-0.5">Click to expand</div>
          )}
        </div>
      )}
    </div>
  );
}

function diagonal(s, d) {
  return `M${s.y},${s.x}C${(s.y + d.y) / 2},${s.x} ${(s.y + d.y) / 2},${d.x} ${d.y},${d.x}`;
}

function toggle(d) {
  if (d.children) {
    d._children = d.children;
    d.children = null;
  } else if (d._children) {
    d.children = d._children;
    d._children = null;
  }
}

function getNodeLabel(d) {
  if (!d.children && !d._children) {
    // Leaf
    return d.data.name || '';
  }
  // Internal: show count
  const count = d._children
    ? countDescendants(d._children)
    : (d.data.count || '');
  const name = d.data.dominantTier1 || '';
  return name ? `${name} (${count})` : `(${count})`;
}

function countDescendants(children) {
  let count = 0;
  const stack = [...children];
  while (stack.length) {
    const node = stack.pop();
    if (!node.children && !node._children) count++;
    if (node.children) stack.push(...node.children);
    if (node._children) stack.push(...node._children);
  }
  return count;
}

function getDominantColor(d) {
  // Leaf node
  if (d.data.tier1Parent) return getTier1Color(d.data.tier1Parent);
  // Internal: find the most common tier1Parent among descendants
  if (d.data.dominantTier1) return getTier1Color(d.data.dominantTier1);
  return '#64748b';
}

/**
 * Convert scipy linkage matrix to a D3-compatible hierarchy.
 * Also annotates internal nodes with their dominant Tier 1 category.
 */
function linkageToHierarchy(linkage, n, categories) {
  const nodes = new Array(2 * n - 1);

  // Leaf nodes
  for (let i = 0; i < n; i++) {
    nodes[i] = {
      id: i,
      name: categories[i]?.name || `Leaf ${i}`,
      tierLevel: categories[i]?.tierLevel,
      tier1Parent: categories[i]?.tier1Parent,
      tierPath: categories[i]?.tierPath,
    };
  }

  // Internal nodes
  for (let i = 0; i < linkage.length; i++) {
    const [left, right, dist, count] = linkage[i];
    const leftNode = nodes[Math.round(left)];
    const rightNode = nodes[Math.round(right)];
    nodes[n + i] = {
      id: n + i,
      children: [leftNode, rightNode],
      distance: dist,
      count: Math.round(count),
    };
  }

  // Annotate dominant Tier 1 via bottom-up pass
  for (let i = 0; i < nodes.length; i++) {
    if (!nodes[i].children) continue;
    const counts = {};
    const stack = [nodes[i]];
    while (stack.length) {
      const node = stack.pop();
      if (node.tier1Parent) {
        counts[node.tier1Parent] = (counts[node.tier1Parent] || 0) + 1;
      }
      if (node.children) stack.push(...node.children);
    }
    let maxCount = 0;
    let dominant = null;
    for (const [key, val] of Object.entries(counts)) {
      if (val > maxCount) { maxCount = val; dominant = key; }
    }
    nodes[i].dominantTier1 = dominant;
  }

  return nodes[2 * n - 2]; // root
}
