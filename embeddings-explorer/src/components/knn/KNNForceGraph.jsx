import { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import { getTier1Color } from '../../lib/colors.js';
import { buildForceGraphData } from '../../lib/knn.js';

export default function KNNForceGraph({ centerLabel, neighbors, width = 500, height = 500 }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!neighbors.length || !svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', width).attr('height', height);

    const { nodes, links } = buildForceGraphData(centerLabel, neighbors);

    // Distance reference rings
    const ringGroup = svg.append('g').attr('opacity', 0.3);
    [0.75, 0.50, 0.25].forEach(sim => {
      const r = 120 * (1 - sim + 0.3); // matches force link distance formula
      ringGroup.append('circle')
        .attr('cx', width / 2).attr('cy', height / 2)
        .attr('r', r)
        .attr('fill', 'none')
        .attr('stroke', '#475569')
        .attr('stroke-width', 0.5)
        .attr('stroke-dasharray', '3,3');
      ringGroup.append('text')
        .attr('x', width / 2 + r + 4).attr('y', height / 2 - 2)
        .attr('fill', '#64748b')
        .attr('font-size', '8px')
        .text(`${(sim * 100).toFixed(0)}%`);
    });

    // Force simulation
    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(d => d.id).distance(d => 120 * (1 - d.similarity + 0.3)))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide(30));

    // Links
    const link = svg.append('g')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', d => d.similarity >= 0.5 ? '#22c55e' : '#3b82f6')
      .attr('stroke-opacity', d => Math.max(0.3, d.similarity))
      .attr('stroke-width', d => 1 + d.similarity * 4);

    // Link labels
    const linkLabel = svg.append('g')
      .selectAll('text')
      .data(links)
      .join('text')
      .attr('text-anchor', 'middle')
      .attr('fill', '#94a3b8')
      .attr('font-size', '10px')
      .attr('font-family', 'monospace')
      .text(d => d.similarity.toFixed(3));

    // Nodes
    const node = svg.append('g')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .call(d3.drag()
        .on('start', (e, d) => {
          if (!e.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x; d.fy = d.y;
        })
        .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on('end', (e, d) => {
          if (!e.active) simulation.alphaTarget(0);
          d.fx = null; d.fy = null;
        })
      );

    // Center node (query)
    node.filter(d => d.isCenter)
      .append('polygon')
      .attr('points', '0,-18 16,10 -16,10')
      .attr('fill', '#fbbf24')
      .attr('stroke', '#f59e0b')
      .attr('stroke-width', 2);

    // Neighbor nodes
    node.filter(d => !d.isCenter)
      .append('circle')
      .attr('r', d => 8 + (d.similarity || 0) * 12)
      .attr('fill', d => getTier1Color(d.tier1Parent || 'Unknown'))
      .attr('stroke', '#1e293b')
      .attr('stroke-width', 2);

    // Labels
    node.append('text')
      .attr('dy', d => d.isCenter ? 30 : -(12 + (d.similarity || 0) * 12))
      .attr('text-anchor', 'middle')
      .attr('fill', '#f1f5f9')
      .attr('font-size', '11px')
      .attr('font-weight', d => d.isCenter ? 'bold' : 'normal')
      .text(d => {
        const label = d.label || '';
        return label.length > 22 ? label.slice(0, 20) + '..' : label;
      });

    // Tick
    simulation.on('tick', () => {
      link
        .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);

      linkLabel
        .attr('x', d => (d.source.x + d.target.x) / 2)
        .attr('y', d => (d.source.y + d.target.y) / 2 - 6);

      node.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    return () => simulation.stop();
  }, [centerLabel, neighbors, width, height]);

  return <svg ref={svgRef} className="w-full" />;
}
